import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from "zod";
import { jwtVerify } from "jose";

import { pool } from '@/lib/db';

import crypto from 'crypto';

const userSchema = z.object({
  usuario: z.string().min(3).max(100),
  password: z.string().min(5).max(100),
  rol: z.enum(["ADMIN", "USER", "RECLUTADOR", "ENCARGADO", "ROOT"]),
  correo: z.string().email("Correo inválido").optional().or(z.literal("")),
  telefono: z.string().optional(),
  grupo_id: z.string().uuid().optional().nullable(),
  empresa_id: z.string().uuid().optional().nullable(),
});

export async function GET(request: Request) {
  try {
    const token = request.headers.get('cookie')?.split('; ').find(row => row.startsWith('tci_session='))?.split('=')[1];
    if (!token) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const secretKey = new TextEncoder().encode(process.env.JWT_SECRET || "fallback_secret_do_not_use_in_prod");
    const { payload } = await jwtVerify(token, secretKey);
    const userRole = payload.rol as string;
    const userEmpresaId = payload.empresa_id as string | null;

    let query = `
      SELECT u.id, u.usuario, u.rol, u.actual_password, u.created_at, u.grupo_id, u.empresa_id,
             r.calendar_id as correo, r.telefono
      FROM usuarios u
      LEFT JOIN reclutadores r ON u.reclutador_id = r.id
    `;
    const params: any[] = [];
    const conditions: string[] = [];

    if (userRole !== 'ROOT') {
      conditions.push(`u.rol != 'ROOT'`);
      if (userEmpresaId) {
        conditions.push(`u.empresa_id = $${params.length + 1}`);
        params.push(userEmpresaId);
      }
    }

    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }
    query += ` ORDER BY u.id ASC`;

    const res = await pool.query(query, params);
    return NextResponse.json(res.rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Error al obtener usuarios' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const token = request.headers.get('cookie')?.split('; ').find(row => row.startsWith('tci_session='))?.split('=')[1];
    if (!token) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const secretKey = new TextEncoder().encode(process.env.JWT_SECRET || "fallback_secret_do_not_use_in_prod");
    const { payload } = await jwtVerify(token, secretKey);
    const creatorRole = payload.rol as string;
    const creatorEmpresaId = payload.empresa_id as string | null;

    if (creatorRole !== 'ADMIN' && creatorRole !== 'ROOT' && creatorRole !== 'ENCARGADO') {
      return NextResponse.json({ error: "No autorizado para crear usuarios" }, { status: 403 });
    }

    const body = await request.json();
    const parsed = userSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos o contraseña muy corta" }, { status: 400 });
    }

    const { usuario, password, rol, correo, telefono, grupo_id, empresa_id: parsed_empresa_id } = parsed.data;

    if (creatorRole === 'ENCARGADO') {
      if (rol !== 'RECLUTADOR') {
        return NextResponse.json({ error: "Un encargado solo puede crear usuarios reclutadores" }, { status: 403 });
      }
    }

    if ((rol === "RECLUTADOR" || rol === "ENCARGADO") && (!correo || correo.trim() === "")) {
      return NextResponse.json({ error: "El correo es obligatorio para Reclutadores y Encargados" }, { status: 400 });
    }

    // Normalize username: lowercase and remove accents
    const normalizedUser = usuario.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

    // Verificar si el usuario ya existe
    const check = await pool.query(`SELECT id FROM usuarios WHERE usuario = $1`, [normalizedUser]);
    if (check.rowCount && check.rowCount > 0) {
      return NextResponse.json({ error: "El usuario ya existe" }, { status: 409 });
    }

    const hash = await bcrypt.hash(password, 10);

    let reclutador_id = null;
    let empresa_id = parsed_empresa_id || null;

    if (creatorRole === 'ENCARGADO') {
      empresa_id = creatorEmpresaId;
    }

    if (grupo_id) {
      const grupoRes = await pool.query(`SELECT empresa_id FROM grupos_reclutamiento WHERE id = $1`, [grupo_id]);
      if (grupoRes.rows.length > 0) {
        const grupoEmpresaId = grupoRes.rows[0].empresa_id;
        if (creatorRole === 'ENCARGADO' && grupoEmpresaId !== creatorEmpresaId) {
          return NextResponse.json({ error: "No tienes permiso para asignar este grupo" }, { status: 403 });
        }
        empresa_id = grupoEmpresaId;
      }
    }

    // Si es reclutador o encargado, creamos también su perfil
    if (rol === "RECLUTADOR" || rol === "ENCARGADO") {
      reclutador_id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO reclutadores (id, nombre, activo, telefono, calendar_id, color, updated_at, empresa_id) 
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)`,
        [reclutador_id, usuario.toUpperCase(), true, telefono || '', correo || '', '#6366f1', empresa_id]
      );
    }

    const res = await pool.query(
      `INSERT INTO usuarios (usuario, password_hash, rol, actual_password, reclutador_id, grupo_id, empresa_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, usuario, rol`,
      [normalizedUser, hash, rol, password, reclutador_id, grupo_id || null, empresa_id]
    );

    return NextResponse.json(res.rows[0]);
  } catch (err) {
    console.error('Error creating usuario:', err);
    return NextResponse.json({ error: 'Error al crear usuario' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { targetUserId, newPassword, adminPassword, newRol, correo, telefono, transferTo, grupo_id } = body;

    if (!targetUserId || !adminPassword) {
      return NextResponse.json({ error: "Faltan datos requeridos" }, { status: 400 });
    }

    if ((newRol === "RECLUTADOR" || newRol === "ENCARGADO") && (!correo || correo.trim() === "")) {
      return NextResponse.json({ error: "El correo es obligatorio para Reclutadores y Encargados" }, { status: 400 });
    }

    // Obtener el admin actual desde el JWT
    const token = request.headers.get('cookie')?.split('; ').find(row => row.startsWith('tci_session='))?.split('=')[1];
    if (!token) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const secretKey = new TextEncoder().encode(process.env.JWT_SECRET || "fallback_secret_do_not_use_in_prod");
    const { payload } = await jwtVerify(token, secretKey);
    const adminUsername = payload.usuario as string;
    const adminRole = payload.rol as string;
    const adminGrupoId = payload.grupo_id as string | null;

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

    // Restricciones de encargado
    if (adminRole === 'ENCARGADO') {
      if (currentUser.rol !== 'RECLUTADOR' || currentUser.grupo_id !== adminGrupoId) {
        return NextResponse.json({ error: "No tienes permiso para modificar este usuario" }, { status: 403 });
      }
      if (grupo_id && grupo_id !== adminGrupoId) {
        return NextResponse.json({ error: "No puedes cambiar el grupo fuera de tu propio grupo" }, { status: 403 });
      }
      if (newRol && newRol !== 'RECLUTADOR') {
        return NextResponse.json({ error: "No tienes permiso para cambiar el rol de este usuario" }, { status: 403 });
      }
    }

    // Actualizar Contraseña si se provee
    if (newPassword && newPassword.trim().length > 0) {
      const newHash = await bcrypt.hash(newPassword, 10);
      await pool.query(`UPDATE usuarios SET password_hash = $1, actual_password = $2 WHERE id = $3`, [newHash, newPassword, targetUserId]);
    }

    // Actualizar Rol si se provee y es distinto
    if (newRol && newRol !== currentUser.rol) {

      // Ascenso a RECLUTADOR o ENCARGADO
      if (newRol === "RECLUTADOR" || newRol === "ENCARGADO") {
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

      // Descenso desde RECLUTADOR o ENCARGADO
      else if (currentUser.rol === "RECLUTADOR" || currentUser.rol === "ENCARGADO") {
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

    // Actualizar Grupo y Empresa Asignada
    if (grupo_id !== undefined) {
      let empresa_id = null;
      if (grupo_id) {
        const grupoRes = await pool.query(`SELECT empresa_id FROM grupos_reclutamiento WHERE id = $1`, [grupo_id]);
        if (grupoRes.rows.length > 0) {
          empresa_id = grupoRes.rows[0].empresa_id;
        }
      }

      await pool.query(
        `UPDATE usuarios SET grupo_id = $1, empresa_id = $2 WHERE id = $3 RETURNING reclutador_id`, 
        [grupo_id || null, empresa_id, targetUserId]
      );

      // Si el usuario tiene perfil de reclutador, actualizar su empresa_id tambien
      if (empresa_id && (currentUser.reclutador_id || (newRol === "RECLUTADOR" || newRol === "ENCARGADO"))) {
        // En caso de que se haya creado apenas en este bloque, lo recuperamos
        const getRec = await pool.query(`SELECT reclutador_id FROM usuarios WHERE id = $1`, [targetUserId]);
        const recId = getRec.rows[0]?.reclutador_id;
        if (recId) {
          await pool.query(`UPDATE reclutadores SET empresa_id = $1 WHERE id = $2`, [empresa_id, recId]);
        }
      }
    }

    // Actualizar datos del reclutador (correo y telefono) si existe
    if (currentUser.reclutador_id) {
      await pool.query(
        `UPDATE reclutadores SET calendar_id = $1, telefono = $2, updated_at = NOW() WHERE id = $3`,
        [correo || '', telefono || '', currentUser.reclutador_id]
      );
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
