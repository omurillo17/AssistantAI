import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { pool } from "@/lib/db";
import { getSession } from "@/lib/auth";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "La contraseña actual es requerida"),
  newPassword: z.string().min(6, "La nueva contraseña debe tener al menos 6 caracteres"),
});

export async function POST(request: Request) {
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
    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      `UPDATE usuarios SET password_hash = $1, actual_password = $2 WHERE id = $3`,
      [newHash, newPassword, user.id]
    );

    return NextResponse.json({
      success: true,
      message: "Contraseña actualizada exitosamente",
    });
  } catch (err) {
    console.error("Error en change-password:", err);
    return NextResponse.json(
      { error: "Error interno al cambiar la contraseña" },
      { status: 500 }
    );
  }
}
