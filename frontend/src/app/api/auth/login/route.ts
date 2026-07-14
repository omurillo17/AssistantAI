import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import bcrypt from "bcryptjs";
import { ENV } from "@/lib/env";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";

import { pool } from '@/lib/db';

const loginSchema = z.object({
  usuario: z.string().min(1, "El usuario es obligatorio").max(100),
  password: z.string().min(1, "La contraseña es obligatoria").max(255),
});

export async function POST(request: Request) {
  // Rate Limiting: 10 intentos por minuto para el login
  const rl = rateLimit(request, 10);
  if (!rl.success) {
    return NextResponse.json({ success: false, error: "Demasiados intentos" }, { status: 429 });
  }

  try {
    const body = await request.json();
    const parsed = loginSchema.safeParse(body);
    
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Datos inválidos" }, { status: 400 });
    }

    const { usuario, password } = parsed.data;
    
    // Normalize username: lowercase and remove accents
    const normalizedUser = usuario.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

    // Query using normalized username
    const res = await pool.query(
      `SELECT id, usuario, password_hash, rol, reclutador_id FROM usuarios WHERE usuario = $1`,
      [normalizedUser]
    );

    if (res.rowCount === 0) {
      return NextResponse.json({ success: false, error: "Credenciales incorrectas" }, { status: 401 });
    }

    const user = res.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (passwordMatch) {
      // Create a JWT token
      const secretKey = new TextEncoder().encode(ENV.JWT_SECRET);
      const token = await new SignJWT({ authenticated: true, usuario: user.usuario, rol: user.rol, reclutador_id: user.reclutador_id })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("24h")
        .sign(secretKey);

      // Create response and set HttpOnly Cookie
      const response = NextResponse.json({ success: true, usuario: user.usuario, rol: user.rol, reclutador_id: user.reclutador_id });
      response.cookies.set("tci_session", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        priority: "high",
        maxAge: 60 * 60 * 24, // 24 hours
      });

      return response;
    } else {
      return NextResponse.json({ success: false, error: "Credenciales incorrectas" }, { status: 401 });
    }
  } catch (error) {
    console.error("Login Error"); // Intentional generic log to avoid leaking sensitive data
    return NextResponse.json({ success: false, error: "Bad Request" }, { status: 400 });
  }
}


