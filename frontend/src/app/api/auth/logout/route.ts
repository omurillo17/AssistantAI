import { NextResponse } from "next/server";

/**
 * Cierra la sesión borrando la cookie `tci_session` desde el servidor.
 * La cookie es HttpOnly: el navegador no deja que JavaScript la borre, así que
 * sin esta ruta "Cerrar sesión" dejaba la sesión viva hasta que expirara (4 h).
 */
export async function POST() {
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
