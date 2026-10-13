import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from "zod";

import { pool } from '@/lib/db';
import { getSession, normalizeUsername } from '@/lib/auth';

import crypto from 'node:crypto';

/** Fila de `usuarios` que se está modificando (las columnas que usan las validaciones). */
type UsuarioRow = {
  id: number;
  usuario: string;
  rol: string;
  protegido: boolean | null;
  grupo_id: string | null;
  reclutador_id: string | null;
  empresa_id: string | null;
};

// Nombre de usuario: solo letras, números y . _ - (sin espacios, acentos ni
// símbolos). Es una credencial, no un nombre para mostrar -- para eso está
// `nombre`. Restringirlo evita cuentas visualmente idénticas (un usuario con
// acento y otro sin él) que se prestan a suplantación.
const USUARIO_REGEX = /^[a-zA-Z0-9._-]+$/;

// El `error` de cada campo cubre también el caso "no vino en la petición":
// sin él, Zod responde "expected string, received undefined", que no le dice
// nada a quien está llenando el formulario.
const userSchema = z.object({
  usuario: z
    .string({ error: "El usuario es obligatorio" })
    .min(3, "El usuario debe tener al menos 3 caracteres")
    .max(100)
    .regex(USUARIO_REGEX, "El usuario solo admite letras, números, punto, guion y guion bajo"),
  // nombre / correo / teléfono / grupo son obligatorios solo para los roles
  // operativos; la comprobación va más abajo, cuando ya se conoce el rol.
  // ADMIN y ROOT se dan de alta con lo mínimo (usuario y contraseña) desde el
  // panel SaaS: ahí el admin es el dueño de la empresa -- jefe de sistemas, de
  // RH, quien sea -- y no atiende candidatos ni tiene calendario propio.
  nombre: z.string().max(255).optional().or(z.literal("")),
  password: z
    .string({ error: "La contraseña es obligatoria" })
    .min(5, "La contraseña debe tener al menos 5 caracteres")
    .max(100),
  rol: z.enum(["ADMIN", "USER", "RECLUTADOR", "ENCARGADO", "ROOT"], { error: "Rol inválido" }),
  correo: z.email("Correo inválido").optional().or(z.literal("")),
  telefono: z.string().max(20).optional().or(z.literal("")),
  grupo_id: z.uuid().optional().nullable(),
  empresa_id: z.uuid().optional().nullable(),
});

/**
 * ¿La sesión pertenece al superusuario protegido?
 *
 * Se consulta la BD en vez de leerlo del JWT a propósito: el token se emite al
 * iniciar sesión y podría quedar desactualizado (o manipulado), y de esta
 * bandera dependen los permisos más altos del sistema.
 */
async function esSuperusuario(usuario: unknown): Promise<boolean> {
  if (typeof usuario !== 'string' || !usuario) return false;
  const res = await pool.query(
    `SELECT 1 FROM usuarios WHERE usuario = $1 AND protegido = TRUE`,
    [usuario]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function GET(request: Request) {
  try {
    const payload = await getSession(request);
    if (!payload) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const userRole = payload.rol as string;
    const userEmpresaId = payload.empresa_id as string | null;
    const soySuperusuario = await esSuperusuario(payload.usuario);

    const puedeVerPassword = userRole === 'ROOT' || userRole === 'ADMIN';

    let query = `
      SELECT u.id, u.usuario, u.nombre, u.rol, ${puedeVerPassword ? 'u.actual_password' : 'NULL as actual_password'},
             u.created_at, u.grupo_id, u.empresa_id, u.reclutador_id,
             r.calendar_id as correo, r.telefono
      FROM usuarios u
      LEFT JOIN reclutadores r ON u.reclutador_id = r.id
    `;
    const params: unknown[] = [];
    const conditions: string[] = [];

    // El superusuario no aparece en el listado para nadie más -- ni siquiera
    // para otros ROOT. Él sí ve a todos, incluido a sí mismo.
    if (!soySuperusuario) {
      conditions.push(`u.protegido = FALSE`);
    }

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

function validateNewUserPayload({
  rol,
  nombre,
  correo,
  telefono,
  grupo_id,
  creatorRole,
}: {
  rol: string;
  nombre?: string;
  correo?: string;
  telefono?: string;
  grupo_id?: string | null;
  creatorRole: string;
}): string | null {
  if (creatorRole === 'ENCARGADO' && rol !== 'RECLUTADOR') {
    return "Un encargado solo puede crear usuarios reclutadores";
  }

  const rolOperativo = rol === "RECLUTADOR" || rol === "ENCARGADO" || rol === "USER";
  if (rolOperativo) {
    if (!(nombre || "").trim()) {
      return "El nombre completo es obligatorio";
    }
    if (!(correo || "").trim()) {
      return "El correo es obligatorio para este rol";
    }
    if ((telefono || "").trim().length < 10) {
      return "El teléfono es obligatorio para este rol";
    }
    if (!grupo_id) {
      return "El grupo de reclutamiento es obligatorio para este rol";
    }
  }
  return null;
}

async function resolveNewUserEmpresaId({
  creatorRole,
  creatorEmpresaId,
  parsed_empresa_id,
  grupo_id,
}: {
  creatorRole: string;
  creatorEmpresaId: string | null;
  parsed_empresa_id?: string | null;
  grupo_id?: string | null;
}): Promise<{ empresa_id: string | null; error?: string }> {
  let empresa_id = parsed_empresa_id || null;

  if (creatorRole === 'ENCARGADO') {
    empresa_id = creatorEmpresaId;
  }

  if (grupo_id) {
    const grupoRes = await pool.query(`SELECT empresa_id FROM grupos_reclutamiento WHERE id = $1`, [grupo_id]);
    if (grupoRes.rows.length > 0) {
      const grupoEmpresaId = grupoRes.rows[0].empresa_id;
      if (creatorRole === 'ENCARGADO' && grupoEmpresaId !== creatorEmpresaId) {
        return { empresa_id: null, error: "No tienes permiso para asignar este grupo" };
      }
      empresa_id = grupoEmpresaId;
    }
  }

  return { empresa_id };
}

export async function POST(request: Request) {
  try {
    const payload = await getSession(request);
    if (!payload) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const creatorRole = payload.rol as string;
    const creatorEmpresaId = payload.empresa_id as string | null;

    if (creatorRole !== 'ADMIN' && creatorRole !== 'ROOT' && creatorRole !== 'ENCARGADO') {
      return NextResponse.json({ error: "No autorizado para crear usuarios" }, { status: 403 });
    }

    const body = await request.json();
    const parsed = userSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Datos inválidos" },
        { status: 400 }
      );
    }

    const { usuario, nombre, password, rol, correo, telefono, grupo_id, empresa_id: parsed_empresa_id } = parsed.data;

    if (rol === 'ROOT' && !(await esSuperusuario(payload.usuario))) {
      return NextResponse.json(
        { error: "No autorizado para crear usuarios ROOT" },
        { status: 403 }
      );
    }

    const validationError = validateNewUserPayload({
      rol,
      nombre,
      correo,
      telefono,
      grupo_id,
      creatorRole,
    });
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const normalizedUser = normalizeUsername(usuario);

    // Verificar si el usuario ya existe
    const check = await pool.query(`SELECT id FROM usuarios WHERE usuario = $1`, [normalizedUser]);
    if (check.rowCount && check.rowCount > 0) {
      return NextResponse.json({ error: "El usuario ya existe" }, { status: 409 });
    }

    const hash = await bcrypt.hash(password, 10);
    const { empresa_id, error: empresaError } = await resolveNewUserEmpresaId({
      creatorRole,
      creatorEmpresaId,
      parsed_empresa_id,
      grupo_id,
    });
    if (empresaError) {
      return NextResponse.json({ error: empresaError }, { status: 403 });
    }

    let reclutador_id = null;
    // Si es reclutador o encargado, creamos también su perfil
    if (rol === "RECLUTADOR" || rol === "ENCARGADO") {
      reclutador_id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO reclutadores (id, nombre, activo, telefono, calendar_id, color, updated_at, empresa_id) 
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)`,
        [reclutador_id, (nombre || usuario).toUpperCase(), true, telefono || '', correo || '', '#6366f1', empresa_id]
      );
    }

    // Guardamos hash bcrypt para login y actual_password para visualización de administradores
    const res = await pool.query(
      `INSERT INTO usuarios (usuario, nombre, password_hash, actual_password, rol, reclutador_id, grupo_id, empresa_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, usuario, nombre, rol`,
      [normalizedUser, (nombre || "").trim(), hash, password, rol, reclutador_id, grupo_id || null, empresa_id]
    );

    return NextResponse.json(res.rows[0]);
  } catch (err) {
    console.error('Error creating usuario:', err);
    return NextResponse.json({ error: 'Error al crear usuario' }, { status: 500 });
  }
}

function verifyProtegidoOrRootPermissions(
  currentUser: UsuarioRow,
  soySuperusuario: boolean,
  newRol?: string
): { error?: string; status?: number } | null {
  if (currentUser.protegido && !soySuperusuario) {
    return { error: "Usuario a modificar no encontrado", status: 404 };
  }
  if (currentUser.protegido && newRol && newRol !== 'ROOT') {
    return { error: "El superusuario no puede cambiar de rol", status: 403 };
  }
  if (newRol === 'ROOT' && !soySuperusuario) {
    return { error: "No autorizado para asignar el rol ROOT", status: 403 };
  }
  return null;
}

function verifyEncargadoPermissions(
  currentUser: UsuarioRow,
  adminGrupoId: string | null,
  grupo_id?: string,
  newRol?: string
): { error?: string; status?: number } | null {
  if (currentUser.rol !== 'RECLUTADOR' || currentUser.grupo_id !== adminGrupoId) {
    return { error: "No tienes permiso para modificar este usuario", status: 403 };
  }
  if (grupo_id && grupo_id !== adminGrupoId) {
    return { error: "No puedes cambiar el grupo fuera de tu propio grupo", status: 403 };
  }
  if (newRol && newRol !== 'RECLUTADOR') {
    return { error: "No tienes permiso para cambiar el rol de este usuario", status: 403 };
  }
  return null;
}

async function verifyAdminPermissions({
  adminUsername,
  adminRole,
  adminPassword,
  adminGrupoId,
  currentUser,
  newRol,
  grupo_id,
}: {
  adminUsername: string;
  adminRole: string;
  adminPassword: string;
  adminGrupoId: string | null;
  currentUser: UsuarioRow;
  newRol?: string;
  grupo_id?: string;
}): Promise<{ error?: string; status?: number }> {
  const adminRes = await pool.query(`SELECT password_hash FROM usuarios WHERE usuario = $1`, [adminUsername]);
  if (adminRes.rowCount === 0) return { error: "Admin no encontrado", status: 404 };
  const adminHash = adminRes.rows[0].password_hash;

  const isValidAdmin = await bcrypt.compare(adminPassword, adminHash);
  if (!isValidAdmin) return { error: "Contraseña de administrador incorrecta", status: 403 };

  const soySuperusuario = await esSuperusuario(adminUsername);
  const protErr = verifyProtegidoOrRootPermissions(currentUser, soySuperusuario, newRol);
  if (protErr) return protErr;

  if (adminRole === 'ENCARGADO') {
    const encErr = verifyEncargadoPermissions(currentUser, adminGrupoId, grupo_id, newRol);
    if (encErr) return encErr;
  }

  return {};
}

async function applyRoleChange({
  targetUserId,
  currentUser,
  newRol,
  telefono,
  correo,
  transferTo,
}: {
  targetUserId: string;
  currentUser: UsuarioRow;
  newRol: string;
  telefono?: string;
  correo?: string;
  transferTo?: string;
}) {
  if (newRol === "RECLUTADOR" || newRol === "ENCARGADO") {
    let recId = currentUser.reclutador_id;
    if (!recId) {
      recId = "rec_" + crypto.randomUUID().replace(/-/g, "").substring(0, 10);
      await pool.query(
        `INSERT INTO reclutadores (id, nombre, activo, telefono, calendar_id, color, updated_at) 
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [recId, currentUser.usuario.toUpperCase(), true, telefono || '', correo || '', '#6366f1']
      );
    } else {
      await pool.query(`UPDATE reclutadores SET activo = true, updated_at = NOW() WHERE id = $1`, [recId]);
    }
    await pool.query(`UPDATE usuarios SET rol = $1, reclutador_id = $2 WHERE id = $3`, [newRol, recId, targetUserId]);
  } else if (currentUser.rol === "RECLUTADOR" || currentUser.rol === "ENCARGADO") {
    if (transferTo && currentUser.reclutador_id) {
      await pool.query(
        `UPDATE candidatos SET asignado_a_id = $1 WHERE asignado_a_id = $2`,
        [transferTo, currentUser.reclutador_id]
      );
      await pool.query(
        `UPDATE mensajes_bandeja SET asignado_a_id = $1, updated_at = NOW() WHERE asignado_a_id = $2`,
        [transferTo, currentUser.reclutador_id]
      );
    }
    if (currentUser.reclutador_id) {
      await pool.query(`UPDATE reclutadores SET activo = false, updated_at = NOW() WHERE id = $1`, [currentUser.reclutador_id]);
    }
    await pool.query(`UPDATE usuarios SET rol = $1 WHERE id = $2`, [newRol, targetUserId]);
  } else {
    await pool.query(`UPDATE usuarios SET rol = $1 WHERE id = $2`, [newRol, targetUserId]);
  }
}

async function applyGrupoUpdate(targetUserId: string, currentUser: UsuarioRow, grupo_id?: string, newRol?: string) {
  if (grupo_id === undefined) return;
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

  if (empresa_id && (currentUser.reclutador_id || (newRol === "RECLUTADOR" || newRol === "ENCARGADO"))) {
    const getRec = await pool.query(`SELECT reclutador_id FROM usuarios WHERE id = $1`, [targetUserId]);
    const recId = getRec.rows[0]?.reclutador_id;
    if (recId) {
      await pool.query(`UPDATE reclutadores SET empresa_id = $1 WHERE id = $2`, [empresa_id, recId]);
    }
  }
}

async function applyProfileUpdate(targetUserId: string, currentUser: UsuarioRow, nombre?: string, correo?: string, telefono?: string) {
  if (typeof nombre === 'string' && nombre.trim()) {
    await pool.query(`UPDATE usuarios SET nombre = $1 WHERE id = $2`, [nombre.trim(), targetUserId]);
  }

  if (currentUser.reclutador_id) {
    const nombreReclutador = (typeof nombre === 'string' && nombre.trim())
      ? nombre.trim().toUpperCase()
      : null;
    await pool.query(
      `UPDATE reclutadores
          SET calendar_id = $1,
              telefono = $2,
              nombre = COALESCE($4, nombre),
              updated_at = NOW()
        WHERE id = $3`,
      [correo || '', telefono || '', currentUser.reclutador_id, nombreReclutador]
    );
  }
}

async function applyGroupAndProfileUpdates({
  targetUserId,
  currentUser,
  grupo_id,
  nombre,
  correo,
  telefono,
  newRol,
}: {
  targetUserId: string;
  currentUser: UsuarioRow;
  grupo_id?: string;
  nombre?: string;
  correo?: string;
  telefono?: string;
  newRol?: string;
}) {
  await applyGrupoUpdate(targetUserId, currentUser, grupo_id, newRol);
  await applyProfileUpdate(targetUserId, currentUser, nombre, correo, telefono);
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { targetUserId, newPassword, adminPassword, newRol, nombre, correo, telefono, transferTo, grupo_id } = body;

    if (!targetUserId || !adminPassword) {
      return NextResponse.json({ error: "Faltan datos requeridos" }, { status: 400 });
    }

    if ((newRol === "RECLUTADOR" || newRol === "ENCARGADO") && (!correo || correo.trim() === "")) {
      return NextResponse.json({ error: "El correo es obligatorio para Reclutadores y Encargados" }, { status: 400 });
    }

    const payload = await getSession(request);
    if (!payload) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const adminUsername = payload.usuario as string;
    const adminRole = payload.rol as string;
    const adminGrupoId = payload.grupo_id as string | null;

    if (adminRole !== 'ADMIN' && adminRole !== 'ROOT' && adminRole !== 'ENCARGADO') {
      return NextResponse.json({ error: "No autorizado para modificar usuarios" }, { status: 403 });
    }

    const userRes = await pool.query(`SELECT * FROM usuarios WHERE id = $1`, [targetUserId]);
    if (userRes.rowCount === 0) return NextResponse.json({ error: "Usuario a modificar no encontrado" }, { status: 404 });
    const currentUser: UsuarioRow = userRes.rows[0];

    const permCheck = await verifyAdminPermissions({
      adminUsername,
      adminRole,
      adminPassword,
      adminGrupoId,
      currentUser,
      newRol,
      grupo_id,
    });
    if (permCheck.error) {
      return NextResponse.json({ error: permCheck.error }, { status: permCheck.status || 403 });
    }

    if (newPassword && newPassword.trim().length > 0) {
      const newHash = await bcrypt.hash(newPassword, 10);
      await pool.query(
        `UPDATE usuarios SET password_hash = $1, actual_password = $2 WHERE id = $3`,
        [newHash, newPassword.trim(), targetUserId]
      );
    }

    if (newRol && newRol !== currentUser.rol) {
      await applyRoleChange({
        targetUserId,
        currentUser,
        newRol,
        telefono,
        correo,
        transferTo,
      });
    }

    await applyGroupAndProfileUpdates({
      targetUserId,
      currentUser,
      grupo_id,
      nombre,
      correo,
      telefono,
      newRol,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Error al actualizar usuario' }, { status: 500 });
  }
}

function checkDeletePermissions(
  requesterRole: string,
  requesterGrupoId: string | null,
  targetUser: { rol: string; grupo_id: string | null }
): boolean {
  if (requesterRole === "ENCARGADO" && (targetUser.rol !== "RECLUTADOR" || targetUser.grupo_id !== requesterGrupoId)) {
    return false;
  }
  if (targetUser.rol === "ROOT" && requesterRole !== "ROOT") {
    return false;
  }
  return true;
}

export async function DELETE(request: Request) {
  try {
    const payload = await getSession(request);
    if (!payload) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const requesterRole = payload.rol as string;
    const requesterGrupoId = (payload.grupo_id as string | null) ?? null;

    if (requesterRole !== 'ADMIN' && requesterRole !== 'ROOT' && requesterRole !== 'ENCARGADO') {
      return NextResponse.json({ error: "No autorizado para eliminar usuarios" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const transferTo = searchParams.get('transferTo');

    if (!id) {
      return NextResponse.json({ error: "Falta el ID del usuario" }, { status: 400 });
    }

    const targetRes = await pool.query(`SELECT id, rol, grupo_id, reclutador_id, protegido FROM usuarios WHERE id = $1`, [id]);
    if (targetRes.rowCount === 0) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    }
    const targetUser = targetRes.rows[0];

    // El superusuario NO se borra: ni por otro ROOT, ni por sí mismo, ni por
    // error. Es la cuenta de último recurso para recuperar el control de la
    // plataforma; si desaparece, nadie puede volver a repartir el rol ROOT.
    // (La BD también lo impide con un trigger, por si alguien entra por SQL.)
    if (targetUser.protegido) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    }

    if (!checkDeletePermissions(requesterRole, requesterGrupoId, targetUser)) {
      return NextResponse.json({ error: "No tienes permiso para eliminar este usuario" }, { status: 403 });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Transferir chats si se especifica (transferTo = reclutador_id destino;
      // el origen se toma del propio usuario objetivo, nunca de un valor que mande el cliente)
      if (transferTo && targetUser.reclutador_id) {
        await client.query(
          `UPDATE candidatos SET asignado_a_id = $1 WHERE asignado_a_id = $2`,
          [transferTo, targetUser.reclutador_id]
        );
        await client.query(
          `UPDATE mensajes_bandeja SET asignado_a_id = $1, updated_at = NOW() WHERE asignado_a_id = $2`,
          [transferTo, targetUser.reclutador_id]
        );
      }

      // El perfil de reclutador se crea automáticamente al asignar el rol
      // (ver POST/PATCH de este mismo archivo); al borrar el usuario debe
      // desligarse igual de automático, si no, queda un reclutador fantasma
      // en el módulo de Vacantes sin usuario que lo respalde.
      if (targetUser.reclutador_id) {
        await client.query(`DELETE FROM reclutadores WHERE id = $1`, [targetUser.reclutador_id]);
      }

      const res = await client.query(`DELETE FROM usuarios WHERE id = $1 RETURNING id`, [id]);

      if (res.rowCount === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Error al eliminar usuario' }, { status: 500 });
  }
}
