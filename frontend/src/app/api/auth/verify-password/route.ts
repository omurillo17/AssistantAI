import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { pool } from "@/lib/db";
import { ENV } from "@/lib/env";
import { cookies } from "next/headers";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  // Mismo límite que el login para frenar fuerza bruta con sesión activa
  const rl = rateLimit(request, 10);
  if (!rl.success) {
    return NextResponse.json({ success: false, error: "Demasiados intentos" }, { status: 429 });
  }

  try {
    const { password } = await request.json();

    if (!password) {
      return NextResponse.json({ success: false, error: "Contraseña requerida" }, { status: 400 });
    }

    // Obtener la sesión actual de las cookies
    const cookieStore = await cookies();
    const token = cookieStore.get("tci_session")?.value;

    if (!token) {
      return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 });
    }

    // Verificar el token
    const secretKey = new TextEncoder().encode(ENV.JWT_SECRET);
    const { payload } = await jwtVerify(token, secretKey);
    const usuario = payload.usuario as string;

    if (!usuario) {
      return NextResponse.json({ success: false, error: "Sesión inválida" }, { status: 401 });
    }

    // Buscar el usuario en la BD para comparar la contraseña
    const res = await pool.query(
      `SELECT password_hash FROM usuarios WHERE usuario = $1`,
      [usuario]
    );

    if (res.rowCount === 0) {
      return NextResponse.json({ success: false, error: "Usuario no encontrado" }, { status: 404 });
    }

    const user = res.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (passwordMatch) {
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json({ success: false, error: "Contraseña incorrecta" }, { status: 401 });
    }
  } catch (error) {
    console.error("Error verificando contraseña:", error);
    return NextResponse.json({ success: false, error: "Error en el servidor" }, { status: 500 });
  }
}
