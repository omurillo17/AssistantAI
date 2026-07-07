import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { z } from "zod";
import { jwtVerify } from "jose";

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'virgo_user',
  password: process.env.DB_PASSWORD || 'virgo_password_secure',
  database: process.env.DB_NAME || 'virgo_db',
  port: parseInt(process.env.DB_PORT || '5432'),
});

const userSchema = z.object({
  usuario: z.string().min(3).max(100),
  password: z.string().min(5).max(100),
  rol: z.enum(["ADMIN", "USER"]),
});

export async function GET() {
  try {
    const res = await pool.query(`SELECT id, usuario, rol, created_at FROM usuarios ORDER BY id ASC`);
    return NextResponse.json(res.rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Error al obtener usuarios' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = userSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos o contraseña muy corta" }, { status: 400 });
    }

    const { usuario, password, rol } = parsed.data;

    // Verificar si el usuario ya existe
    const check = await pool.query(`SELECT id FROM usuarios WHERE usuario = $1`, [usuario]);
    if (check.rowCount && check.rowCount > 0) {
      return NextResponse.json({ error: "El usuario ya existe" }, { status: 409 });
    }

    const hash = await bcrypt.hash(password, 10);

    const res = await pool.query(
      `INSERT INTO usuarios (usuario, password_hash, rol) VALUES ($1, $2, $3) RETURNING id, usuario, rol`,
      [usuario, hash, rol]
    );

    return NextResponse.json(res.rows[0]);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Error al crear usuario' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { targetUserId, newPassword, adminPassword } = body;

    if (!targetUserId || !newPassword || !adminPassword) {
      return NextResponse.json({ error: "Faltan datos requeridos" }, { status: 400 });
    }

    // Obtener el admin actual desde el JWT
    const token = request.headers.get('cookie')?.split('; ').find(row => row.startsWith('tci_session='))?.split('=')[1];
    if (!token) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const secretKey = new TextEncoder().encode(process.env.JWT_SECRET || "fallback_secret_do_not_use_in_prod");
    const { payload } = await jwtVerify(token, secretKey);
    const adminUsername = payload.usuario as string;

    // Verificar la contraseña del administrador
    const adminRes = await pool.query(`SELECT password_hash FROM usuarios WHERE usuario = $1`, [adminUsername]);
    if (adminRes.rowCount === 0) return NextResponse.json({ error: "Admin no encontrado" }, { status: 404 });
    const adminHash = adminRes.rows[0].password_hash;

    const isValidAdmin = await bcrypt.compare(adminPassword, adminHash);
    if (!isValidAdmin) return NextResponse.json({ error: "Contraseña de administrador incorrecta" }, { status: 403 });

    // Actualizar contraseña del usuario objetivo
    const newHash = await bcrypt.hash(newPassword, 10);
    const res = await pool.query(`UPDATE usuarios SET password_hash = $1 WHERE id = $2 RETURNING id`, [newHash, targetUserId]);

    if (res.rowCount === 0) {
      return NextResponse.json({ error: "Usuario a modificar no encontrado" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Error al actualizar contraseña' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: "Falta el ID del usuario" }, { status: 400 });
    }

    const res = await pool.query(`DELETE FROM usuarios WHERE id = $1 RETURNING id`, [id]);
    
    if (res.rowCount === 0) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Error al eliminar usuario' }, { status: 500 });
  }
}
