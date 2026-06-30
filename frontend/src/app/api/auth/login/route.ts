import { NextResponse } from "next/server";
import { SignJWT } from "jose";

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_do_not_use_in_prod";
const APP_PASSWORD = process.env.APP_PASSWORD || "virgoadmin";

export async function POST(request: Request) {
  try {
    const { password } = await request.json();

    if (password === APP_PASSWORD) {
      // Create a JWT token
      const secretKey = new TextEncoder().encode(JWT_SECRET);
      const token = await new SignJWT({ authenticated: true })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("24h")
        .sign(secretKey);

      // Create response and set HttpOnly Cookie
      const response = NextResponse.json({ success: true });
      response.cookies.set("tci_session", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24, // 24 hours
      });

      return response;
    } else {
      return NextResponse.json({ success: false, error: "Contraseña incorrecta" }, { status: 401 });
    }
  } catch (error) {
    return NextResponse.json({ success: false, error: "Bad Request" }, { status: 400 });
  }
}
