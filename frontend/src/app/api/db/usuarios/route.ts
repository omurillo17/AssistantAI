import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from "zod";

import { pool } from '@/lib/db';
import { getSession, normalizeUsername } from '@/lib/auth';

import crypto from 'crypto';

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
  correo: z.string().email("Correo inválido").optional().or(z.literal("")),
  telefono: z.string().max(20).optional().or(z.literal("")),
  grupo_id: z.string().uuid().optional().nullable(),
  empresa_id: z.string().uuid().optional().nullable(),
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
      // Se devuelve el motivo concreto (usuario con símbolos, correo mal
      // formado, teléfono corto...) en vez de un "datos inválidos" genérico,
      // que obliga a adivinar cuál de los seis campos está mal.
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Datos inválidos" },
        { status: 400 }
      );
    }

    const { usuario, nombre, password, rol, correo, telefono, grupo_id, empresa_id: parsed_empresa_id } = parsed.data;

    // Solo el superusuario reparte el rol ROOT. Un ROOT normal administra la
    // plataforma pero no puede fabricarse pares ni escalar a otros a su nivel.
    if (rol === 'ROOT' && !(await esSuperusuario(payload.usuario))) {
      return NextResponse.json(
        { error: "No autorizado para crear usuarios ROOT" },
        { status: 403 }
      );
    }

    if (creatorRole === 'ENCARGADO') {
      if (rol !== 'RECLUTADOR') {
        return NextResponse.json({ error: "Un encargado solo puede crear usuarios reclutadores" }, { status: 403 });
      }
    }

    // Roles operativos: atienden candidatos sobre una nave concreta, agendan en
    // su propio calendario y reciben avisos por WhatsApp, así que su expediente
    // tiene que estar completo. ADMIN y ROOT solo administran -- el panel SaaS
    // los crea con usuario y contraseña y nada más.
    const rolOperativo = rol === "RECLUTADOR" || rol === "ENCARGADO" || rol === "USER";

    if (rolOperativo) {
      if (!(nombre || "").trim()) {
        return NextResponse.json({ error: "El nombre completo es obligatorio" }, { status: 400 });
      }
      if (!(correo || "").trim()) {
        return NextResponse.json({ error: "El correo es obligatorio para este rol" }, { status: 400 });
      }
      if ((telefono || "").trim().length < 10) {
        return NextResponse.json({ error: "El teléfono es obligatorio para este rol" }, { status: 400 });
      }
      if (!grupo_id) {
        return NextResponse.json(
          { error: "El grupo de reclutamiento es obligatorio para este rol" },
          { status: 400 }
        );
      }
    }

    const normalizedUser = normalizeUsername(usuario);

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
        // El reclutador se llama como la PERSONA, no como su usuario de login:
        // este nombre es el que ve el candidato por WhatsApp ("pregunta por
        // MICHELLE en recepción") y el que aparece en el calendario.
        [reclutador_id, (nombre || usuario).toUpperCase(), true, telefono || '', correo || '', '#6366f1', empresa_id]
      );
    }

    // Guardamos hash bcrypt para login y actual_password para visualización de administradores
    const res = await pool.query(
      `INSERT INTO usuarios (usuario, nombre, password_hash, actual_password, rol, reclutador_id, grupo_id, empresa_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, usuario, nombre, rol`,
      // Sin nombre propio (alta mínima de ADMIN desde el panel SaaS) se guarda
      // vacío: la interfaz ya cae al usuario cuando no hay nombre, y así se
      // distingue "no lo capturaron" de "se llama igual que su usuario".
      [normalizedUser, (nombre || "").trim(), hash, password, rol, reclutador_id, grupo_id || null, empresa_id]
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
    const { targetUserId, newPassword, adminPassword, newRol, nombre, correo, telefono, transferTo, grupo_id } = body;

    if (!targetUserId || !adminPassword) {
      return NextResponse.json({ error: "Faltan datos requeridos" }, { status: 400 });
    }

    if ((newRol === "RECLUTADOR" || newRol === "ENCARGADO") && (!correo || correo.trim() === "")) {
      return NextResponse.json({ error: "El correo es obligatorio para Reclutadores y Encargados" }, { status: 400 });
    }

    // Obtener el admin actual desde el JWT
    const payload = await getSession(request);
    if (!payload) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const adminUsername = payload.usuario as string;
    const adminRole = payload.rol as string;
    const adminGrupoId = payload.grupo_id as string | null;

    // Defensa en profundidad: aunque el middleware ya restringe /api/db/usuarios,
    // verificamos el rol también aquí.
    if (adminRole !== 'ADMIN' && adminRole !== 'ROOT' && adminRole !== 'ENCARGADO') {
      return NextResponse.json({ error: "No autorizado para modificar usuarios" }, { status: 403 });
    }

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

    // El superusuario solo se administra a sí mismo. Se responde 404 y no 403
    // para no confirmarle a un tercero que la cuenta existe -- para el resto
    // del sistema es invisible, y un 403 sería una filtración.
    const soySuperusuario = await esSuperusuario(adminUsername);
    if (currentUser.protegido && !soySuperusuario) {
      return NextResponse.json({ error: "Usuario a modificar no encontrado" }, { status: 404 });
    }
    // Ni siquiera él puede degradarse: dejaría al sistema sin nadie capaz de
    // repartir el rol ROOT.
    if (currentUser.protegido && newRol && newRol !== 'ROOT') {
      return NextResponse.json(
        { error: "El superusuario no puede cambiar de rol" },
        { status: 403 }
      );
    }
    // Ascender a otro a ROOT también es privilegio exclusivo del superusuario.
    if (newRol === 'ROOT' && !soySuperusuario) {
      return NextResponse.json({ error: "No autorizado para asignar el rol ROOT" }, { status: 403 });
    }

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
      await pool.query(
        `UPDATE usuarios SET password_hash = $1, actual_password = $2 WHERE id = $3`,
        [newHash, newPassword.trim(), targetUserId]
      );
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
        // Transferir chats si se especifica (transferTo = reclutador_id destino)
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

    // Nombre para mostrar. El `usuario` (credencial de login) no se toca aquí
    // a propósito: renombrar a alguien en pantalla no debe cambiarle la forma
    // de entrar al sistema.
    if (typeof nombre === 'string' && nombre.trim()) {
      await pool.query(`UPDATE usuarios SET nombre = $1 WHERE id = $2`, [nombre.trim(), targetUserId]);
    }

    // Actualizar datos del reclutador (nombre visible, correo y telefono) si existe
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

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Error al actualizar usuario' }, { status: 500 });
  }
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

    // Mismas restricciones que en PATCH: un encargado solo gestiona reclutadores de su grupo
    if (requesterRole === 'ENCARGADO' && (targetUser.rol !== 'RECLUTADOR' || targetUser.grupo_id !== requesterGrupoId)) {
      return NextResponse.json({ error: "No tienes permiso para eliminar este usuario" }, { status: 403 });
    }
    // Solo ROOT puede eliminar cuentas ROOT
    if (targetUser.rol === 'ROOT' && requesterRole !== 'ROOT') {
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
