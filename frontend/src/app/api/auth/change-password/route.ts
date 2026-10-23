import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { ENV } from "@/lib/env";
import { pool } from "@/lib/db";
import { getSession, revocarSesiones } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "La contraseña actual es requerida"),
  newPassword: z
    .string()
    .min(10, "La nueva contraseña debe tener al menos 10 caracteres")
    .max(255, "La nueva contraseña es demasiado larga"),
});

export async function POST(request: Request) {
  // Valida la contraseña actual: sin límite servía para adivinarla con una
  // sesión robada. Mismo límite que login y verify-password.
  const rl = rateLimit(request, 10);
  if (!rl.success) {
    return NextResponse.json({ error: "Demasiados intentos" }, { status: 429 });
  }

  try {
    const session = await getSession(request);
    if (!session?.usuario) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Datos inválidos" },
        { status: 400 }
      );
    }

    const { currentPassword, newPassword } = parsed.data;

    // Buscar al usuario por nombre de usuario (insensible a mayúsculas)
    const userRes = await pool.query(
      `SELECT id, usuario, password_hash FROM usuarios WHERE LOWER(usuario) = LOWER($1) LIMIT 1`,
      [session.usuario]
    );

    if (userRes.rowCount === 0) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    }

    const user = userRes.rows[0];

    // Validar contraseña actual
    const isCurrentValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isCurrentValid) {
      return NextResponse.json(
        { error: "La contraseña actual es incorrecta" },
        { status: 400 }
      );
    }

    // Hashear y actualizar nueva contraseña
    const newHash = await bcrypt.hash(newPassword, 12);
    await pool.query(
      `UPDATE usuarios SET password_hash = $1 WHERE id = $2`,
      [newHash, user.id]
    );
    // Cierra todas las sesiones abiertas con la contraseña anterior (otro
    // navegador, un token robado). Esta sigue viva: se re-firma con la versión
    // nueva y la misma caducidad, sin alargarla.
    const nuevaVersion = await revocarSesiones(user.usuario);
    // setIssuedAt/setExpirationTime sobrescriben el iat/exp copiados de la sesión.
    const expira = session.exp ?? Math.floor(Date.now() / 1000) + 4 * 60 * 60;
    const token = await new SignJWT({ ...session, tv: nuevaVersion ?? 0 })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(expira)
      .sign(new TextEncoder().encode(ENV.JWT_SECRET));

    const response = NextResponse.json({
      success: true,
      message: "Contraseña actualizada exitosamente",
    });
    response.cookies.set("tci_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      priority: "high",
      maxAge: Math.max(0, expira - Math.floor(Date.now() / 1000)),
    });
    return response;
  } catch (err) {
    console.error("Error en change-password:", err);
    return NextResponse.json(
      { error: "Error interno al cambiar la contraseña" },
      { status: 500 }
    );
  }
}
