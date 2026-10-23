import { NextResponse } from "next/server";
import { getSession, revocarSesiones } from "@/lib/auth";

/**
 * Cierra la sesión borrando la cookie `tci_session` desde el servidor.
 * La cookie es HttpOnly: el navegador no deja que JavaScript la borre, así que
 * sin esta ruta "Cerrar sesión" dejaba la sesión viva hasta que expirara (4 h).
 *
 * Además sube token_version: el JWT deja de valer aunque alguien lo hubiera
 * copiado antes. Cierra también las demás sesiones abiertas de ese usuario.
 */
export async function POST(request?: Request) {
  const session = await getSession(request);
  if (session?.usuario) {
    try {
      await revocarSesiones(session.usuario);
    } catch (err) {
      // La cookie se borra igual: cerrar sesión nunca debe fallar para el usuario.
      console.error("logout: no se pudo revocar la sesión:", err);
    }
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set("tci_session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
