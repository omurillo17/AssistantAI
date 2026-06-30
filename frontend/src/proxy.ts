import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_do_not_use_in_prod";

export async function proxy(request: NextRequest) {
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
    // Redirigir a login si no hay token
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    // Verificar el token
    const secretKey = new TextEncoder().encode(JWT_SECRET);
    await jwtVerify(token, secretKey);
    return NextResponse.next();
  } catch (err) {
    // Si el token es inválido o expiró
    console.error("Token JWT inválido:", err);
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)", "/api/:path*"],
};
