import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verificarTokenSesion } from "@/lib/auth";
import { verificarTokenUpload } from "@/lib/uploadToken";

const JWT_SECRET = process.env.JWT_SECRET;

// Rutas exclusivas para ADMIN
const adminOnlyRoutes = ["/reclutadores"];
// Rutas exclusivas para ADMIN y ENCARGADO
const adminAndEncargadoRoutes = ["/usuarios", "/api/db/usuarios", "/api/db/grupos"];

const publicRoutePrefixes = [
  "/_next",
  "/login",
  "/api/auth/login",
  "/api/webhook",
  "/api/upload-cv",
  "/api/prompt-context",
  "/api/cron",
  "/api/db/reclutador_vacantes",
  "/api/db/encargados-por-nave",
  "/api/waha-status",
  "/portal",
  "/api/portal",
];

function isPublicRoute(pathname: string): boolean {
  if (pathname === "/api/health" || pathname === "/favicon.ico") {
    return true;
  }
  return publicRoutePrefixes.some((prefix) => pathname.startsWith(prefix));
}

function checkRoleAccess(pathname: string, userRole: string, requestUrl: string): NextResponse | null {
  const isAdminRoute = adminOnlyRoutes.some(r => pathname.startsWith(r));
  if (isAdminRoute && userRole !== "ADMIN" && userRole !== "ROOT") {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Permisos insuficientes" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/", requestUrl));
  }

  const isAdminEncargadoRoute = adminAndEncargadoRoutes.some(r => pathname.startsWith(r));
  if (isAdminEncargadoRoute && userRole !== "ADMIN" && userRole !== "ENCARGADO" && userRole !== "ROOT") {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Permisos insuficientes" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/", requestUrl));
  }

  return null;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Los expedientes (CV, INE, RFC, constancia) se sirven de /uploads como
  // estáticos de Next y estaban abiertos a internet: con la URL bastaba para
  // bajar el documento de identidad de un candidato sin sesión, y el nombre
  // del archivo es `<telefono>_<timestamp>.<ext>`, así que tampoco era
  // secreto. Ahora exigen sesión, con una sola excepción: WAHA los descarga
  // por HTTP para reenviarlos por WhatsApp y no lleva cookie, así que
  // enviarImagenCandidato() firma la ruta y manda el token en `?t=`.
  if (pathname.startsWith("/uploads")) {
    if (await verificarTokenUpload(pathname, request.nextUrl.searchParams.get("t"))) {
      return NextResponse.next();
    }
    // Sin token válido cae al flujo normal de abajo, que exige sesión.
  }

  // Rutas públicas que no requieren autenticación
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  // Obtener el token de las cookies
  const token = request.cookies.get("tci_session")?.value;

  if (!token) {
    // Redirigir a login si no hay token (solo si no es una API)
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Nunca verificar con un secreto de respaldo: si falta JWT_SECRET, se niega el acceso.
  if (!JWT_SECRET) {
    console.error("CRITICAL: JWT_SECRET no está configurado; se rechazan todas las sesiones.");
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Servidor mal configurado" }, { status: 500 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Firma, caducidad y token_version: un JWT de una sesión cerrada o de antes
  // de un cambio de contraseña se rechaza aquí aunque no haya caducado. El
  // proxy de Next 16 corre siempre en Node, así que puede consultar la base.
  const payload = await verificarTokenSesion(token);
  if (payload) {
    // Check roles
    const userRole = payload.rol as string;

    const accessDenied = checkRoleAccess(pathname, userRole, request.url);
    if (accessDenied) {
      return accessDenied;
    }

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-user-rol', userRole);
    // Nadie lo lee hoy, pero que no pueda llegar uno puesto por el cliente.
    requestHeaders.delete('x-reclutador-id');
    if (payload.reclutador_id) {
      requestHeaders.set('x-reclutador-id', payload.reclutador_id as string);
    }

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  } else {
    // Si el token es inválido, expiró o fue revocado
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.delete('tci_session');

    if (pathname.startsWith("/api/")) {
      const apiRes = NextResponse.json({ error: "Sesión expirada" }, { status: 401 });
      apiRes.cookies.delete('tci_session');
      return apiRes;
    }
    return response;
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
