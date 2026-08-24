import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

import { verificarTokenUpload } from "@/lib/uploadToken";

const JWT_SECRET = process.env.JWT_SECRET;

// Rutas exclusivas para ADMIN
const adminOnlyRoutes = ["/reclutadores"];
// Rutas exclusivas para ADMIN y ENCARGADO
const adminAndEncargadoRoutes = ["/usuarios", "/api/db/usuarios", "/api/db/grupos"];

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
  if (
    pathname.startsWith("/_next") || // Archivos estáticos de Next.js
    pathname.startsWith("/login") || // Página de Login
    pathname.startsWith("/api/auth/login") || // Endpoint de Login
    // Rutas internas: las llama el backend Python server-to-server, sin sesión
    // de navegador. No llevan JWT; se protegen con x-api-key = INTERNAL_API_KEY
    // (ver verifyInternalApiKey en src/lib/auth.ts).
    pathname.startsWith("/api/webhook") ||
    pathname.startsWith("/api/upload-cv") ||
    pathname.startsWith("/api/prompt-context") ||
    pathname.startsWith("/api/cron") || // Disparado por el scheduler de backend
    pathname.startsWith("/api/db/reclutador_vacantes") || // La ruta valida sesión o x-api-key
    pathname.startsWith("/api/db/encargados-por-nave") || // La ruta valida sesión o x-api-key
    pathname.startsWith("/api/waha-status") || // Chequeo de estado de WAHA
    pathname === "/api/health" || // Sonda del healthcheck de Docker (sin cookie)
    pathname.startsWith("/portal") || // Portal público de candidatos
    pathname.startsWith("/api/portal") || // API pública del portal de candidatos
    pathname === "/favicon.ico"
  ) {
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

  try {
    // Verificar el token
    const secretKey = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jwtVerify(token, secretKey);

    // Check roles
    const userRole = payload.rol as string;

    // Si es una ruta protegida solo para ADMIN
    const isAdminRoute = adminOnlyRoutes.some(r => pathname.startsWith(r));
    if (isAdminRoute && userRole !== "ADMIN" && userRole !== "ROOT") {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Permisos insuficientes" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/", request.url));
    }

    // Si es ruta para ADMIN o ENCARGADO
    const isAdminEncargadoRoute = adminAndEncargadoRoutes.some(r => pathname.startsWith(r));
    if (isAdminEncargadoRoute && userRole !== "ADMIN" && userRole !== "ENCARGADO" && userRole !== "ROOT") {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Permisos insuficientes" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/", request.url));
    }

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-user-rol', userRole);
    if (payload.reclutador_id) {
      requestHeaders.set('x-reclutador-id', payload.reclutador_id as string);
    }

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  } catch {
    // Si el token es inválido o expiró
    console.error("Token JWT inválido");
    
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
