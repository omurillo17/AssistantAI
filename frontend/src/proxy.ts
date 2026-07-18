import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET = process.env.JWT_SECRET;

// Rutas exclusivas para ADMIN
const adminOnlyRoutes = ["/configuracion", "/reclutadores", "/usuarios", "/api/db/usuarios"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Rutas públicas que no requieren autenticación
  if (
    pathname.startsWith("/_next") || // Archivos estáticos de Next.js
    pathname.startsWith("/login") || // Página de Login
    pathname.startsWith("/api/auth/login") || // Endpoint de Login
    pathname.startsWith("/api/webhook") || // Webhooks de n8n no requieren JWT
    pathname.startsWith("/api/upload-cv") || // Endpoints de subida de archivos de n8n no requieren JWT
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

  try {
    // Verificar el token
    const secretKey = new TextEncoder().encode(JWT_SECRET || "fallback_secret_do_not_use_in_prod");
    const { payload } = await jwtVerify(token, secretKey);

    // Check roles
    const userRole = payload.rol as string;

    // Si es una ruta protegida solo para ADMIN
    const isAdminRoute = adminOnlyRoutes.some(r => pathname.startsWith(r));
    if (isAdminRoute && userRole !== "ADMIN") {
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
  } catch (err) {
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
