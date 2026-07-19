import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from "zod";
import { jwtVerify } from "jose";

import { pool } from '@/lib/db';

import crypto from 'crypto';

const userSchema = z.object({
  usuario: z.string().min(3).max(100),
  password: z.string().min(5).max(100),
  rol: z.enum(["ADMIN", "USER", "RECLUTADOR"]),
  correo: z.string().email("Correo inválido").optional().or(z.literal("")),
  telefono: z.string().optional(),
});

export async function GET() {
  try {
    const res = await pool.query(`SELECT id, usuario, rol, actual_password, created_at FROM usuarios ORDER BY id ASC`);
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

    const { usuario, password, rol, correo, telefono } = parsed.data;

    // Normalize username: lowercase and remove accents
    const normalizedUser = usuario.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

    // Verificar si el usuario ya existe
    const check = await pool.query(`SELECT id FROM usuarios WHERE usuario = $1`, [normalizedUser]);
    if (check.rowCount && check.rowCount > 0) {
      return NextResponse.json({ error: "El usuario ya existe" }, { status: 409 });
    }

    const hash = await bcrypt.hash(password, 10);

    let reclutador_id = null;

    // Si es reclutador, creamos también su perfil
    if (rol === "RECLUTADOR") {
      reclutador_id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO reclutadores (id, nombre, activo, telefono, calendar_id, color, updated_at) 
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [reclutador_id, usuario.toUpperCase(), true, telefono || '', correo || '', '#6366f1']
      );
    }

    const res = await pool.query(
      `INSERT INTO usuarios (usuario, password_hash, rol, actual_password, reclutador_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, usuario, rol`,
      [normalizedUser, hash, rol, password, reclutador_id]
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
    const { targetUserId, newPassword, adminPassword, newRol, correo, telefono, transferTo } = body;

    if (!targetUserId || !adminPassword) {
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

    // Obtener usuario objetivo actual
    const userRes = await pool.query(`SELECT * FROM usuarios WHERE id = $1`, [targetUserId]);
    if (userRes.rowCount === 0) return NextResponse.json({ error: "Usuario a modificar no encontrado" }, { status: 404 });
    const currentUser = userRes.rows[0];

    // Actualizar Contraseña si se provee
    if (newPassword && newPassword.trim().length > 0) {
      const newHash = await bcrypt.hash(newPassword, 10);
      await pool.query(`UPDATE usuarios SET password_hash = $1, actual_password = $2 WHERE id = $3`, [newHash, newPassword, targetUserId]);
    }

    // Actualizar Rol si se provee y es distinto
    if (newRol && newRol !== currentUser.rol) {
      
      // Ascenso a RECLUTADOR
      if (newRol === "RECLUTADOR") {
        let recId = currentUser.reclutador_id;
        
        // Si no tenía perfil de reclutador, crearlo
        if (!recId) {
          recId = "rec_" + crypto.randomUUID().replace(/-/g, "").substring(0, 10);
          await pool.query(
            `INSERT INTO reclutadores (id, nombre, activo, telefono, calendar_id, color, updated_at) 
             VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [recId, currentUser.usuario.toUpperCase(), true, telefono || '', correo || '', '#6366f1']
          );
        } else {
          // Si ya tenía uno inactivo, reactivarlo
          await pool.query(`UPDATE reclutadores SET activo = true, updated_at = NOW() WHERE id = $1`, [recId]);
        }
        
        await pool.query(`UPDATE usuarios SET rol = $1, reclutador_id = $2 WHERE id = $3`, [newRol, recId, targetUserId]);
      } 
      
      // Descenso desde RECLUTADOR
      else if (currentUser.rol === "RECLUTADOR") {
        // Transferir chats si se especifica
        if (transferTo) {
          await pool.query(
            `UPDATE candidatos SET asignado_a = $1 WHERE asignado_a = $2`,
            [transferTo, currentUser.usuario]
          );
        }
        
        // Desactivar el perfil de reclutador en lugar de borrarlo
        if (currentUser.reclutador_id) {
          await pool.query(`UPDATE reclutadores SET activo = false, updated_at = NOW() WHERE id = $1`, [currentUser.reclutador_id]);
        }

        await pool.query(`UPDATE usuarios SET rol = $1 WHERE id = $2`, [newRol, targetUserId]);
      } 
      
      // Cambio entre ADMIN y USER
      else {
        await pool.query(`UPDATE usuarios SET rol = $1 WHERE id = $2`, [newRol, targetUserId]);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Error al actualizar usuario' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const transferTo = searchParams.get('transferTo');
    const username = searchParams.get('username');

    if (!id) {
      return NextResponse.json({ error: "Falta el ID del usuario" }, { status: 400 });
    }

    // Transferir chats si se especifica
    if (transferTo && username) {
      await pool.query(
        `UPDATE candidatos SET asignado_a = $1 WHERE asignado_a = $2`,
        [transferTo, username]
      );
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
