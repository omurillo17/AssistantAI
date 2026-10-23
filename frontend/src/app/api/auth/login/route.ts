import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import bcrypt from "bcryptjs";
import { ENV } from "@/lib/env";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { limpiarFallosLogin, rateLimit, registrarFalloLogin, usuarioBloqueado } from "@/lib/rate-limit";
import { normalizeUsername } from "@/lib/auth";

import { pool } from '@/lib/db';

const loginSchema = z.object({
  usuario: z.string().min(1, "El usuario es obligatorio").max(100),
  password: z.string().min(1, "La contraseña es obligatoria").max(255),
});

// Hash contra el que se compara cuando el usuario no existe: así esa respuesta
// tarda lo mismo que una contraseña incorrecta y el tiempo no delata qué
// usuarios existen. Se genera una vez al cargar, con una contraseña aleatoria.
const hashSenuelo = bcrypt.hash(randomUUID(), 12);

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
    
    const normalizedUser = normalizeUsername(usuario);

    if (usuarioBloqueado(normalizedUser)) {
      return NextResponse.json(
        { success: false, error: "Demasiados intentos. Espera 15 minutos." },
        { status: 429 }
      );
    }

    // Query using normalized username
    const res = await pool.query(
      `SELECT u.id, u.usuario, u.nombre, u.password_hash, u.rol, u.reclutador_id, u.empresa_id, u.grupo_id, u.token_version, g.naves_asignadas
       FROM usuarios u
       LEFT JOIN grupos_reclutamiento g ON u.grupo_id = g.id 
       WHERE u.usuario = $1`,
      [normalizedUser]
    );

    const user = res.rows[0];
    const passwordMatch = await bcrypt.compare(password, user?.password_hash ?? (await hashSenuelo));

    if (user && passwordMatch) {
      limpiarFallosLogin(normalizedUser);
      // Create a JWT token
      const secretKey = new TextEncoder().encode(ENV.JWT_SECRET);
      const token = await new SignJWT({ 
        authenticated: true, 
        usuario: user.usuario, 
        rol: user.rol, 
        reclutador_id: user.reclutador_id,
        empresa_id: user.empresa_id,
        grupo_id: user.grupo_id,
        naves_asignadas: user.naves_asignadas || [],
        // Versión de sesión: subirla en la base (logout, cambio de contraseña)
        // invalida este token antes de que caduque. Ver lib/auth.ts.
        tv: user.token_version ?? 0
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("4h")
        .sign(secretKey);

      // Create response and set HttpOnly Cookie
      const response = NextResponse.json({
        success: true,
        usuario: user.usuario,
        // Nombre de la persona: es lo que se pinta en la interfaz. Si la
        // cuenta es anterior a este campo, se cae al usuario para no dejar
        // la pantalla en blanco.
        nombre: user.nombre || user.usuario,
        rol: user.rol,
        reclutador_id: user.reclutador_id,
        empresa_id: user.empresa_id,
        grupo_id: user.grupo_id,
        naves_asignadas: user.naves_asignadas || []
      });
      response.cookies.set("tci_session", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        priority: "high",
        maxAge: 60 * 60 * 4, // 4 hours
      });

      return response;
    } else {
      registrarFalloLogin(normalizedUser);
      return NextResponse.json({ success: false, error: "Credenciales incorrectas" }, { status: 401 });
    }
  } catch {
    console.error("Login Error"); // Intentional generic log to avoid leaking sensitive data
    return NextResponse.json({ success: false, error: "Bad Request" }, { status: 400 });
  }
}


