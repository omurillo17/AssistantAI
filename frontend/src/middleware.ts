import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET = process.env.JWT_SECRET;

// Rutas exclusivas para ADMIN
const adminOnlyRoutes = ["/configuracion", "/reclutadores", "/usuarios", "/api/db/usuarios"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Rutas públicas que no requieren autenticación
  if (
    pathname.startsWith("/_next") || // Archivos estáticos de Next.js
    pathname.startsWith("/login") || // Página de Login
    pathname.startsWith("/api/auth/login") || // Endpoint de Login
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

    return NextResponse.next();
  } catch (err) {
    // Si el token es inválido o expiró
    console.error("Token JWT inválido");
    
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Sesión expirada" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
