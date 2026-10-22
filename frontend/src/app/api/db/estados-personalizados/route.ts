import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { z } from 'zod';

import { pool } from '@/lib/db';
import { getSession } from '@/lib/auth';

// Estados que RH agrega a mano. El bot no los asigna ni los quita (lo impide
// el trigger candidatos_estado_guard, migrations/004). No se borran: se
// archivan con activo = false, porque puede haber candidatos e historial
// apuntando a ellos.

const GRUPOS = ['pipeline', 'alerta', 'exitoso', 'descartado', 'pool'] as const;
const COLOR = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color inválido');

const postSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio').max(100),
  color: COLOR.optional(),
  grupo: z.enum(GRUPOS, { error: 'Grupo inválido' }),
});

const patchSchema = z.object({
  clave: z.string().min(1),
  nombre: z.string().trim().min(1).max(100).optional(),
  color: COLOR.optional(),
  grupo: z.enum(GRUPOS).optional(),
  activo: z.boolean().optional(),
});

const ROLES_EDICION = ['ADMIN', 'ROOT', 'ENCARGADO'];

/** Empresa sobre la que actúa la petición: solo ROOT puede elegirla. */
function empresaDe(request: Request, session: Record<string, unknown>): string | null {
  const jwtEmpresa = (session.empresa_id as string | null) ?? null;
  if (session.rol !== 'ROOT') return jwtEmpresa;
  return new URL(request.url).searchParams.get('empresa_id') || jwtEmpresa;
}

export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const empresaId = empresaDe(request, session);
  const res = empresaId
    ? await pool.query(
        `SELECT clave, nombre, color, grupo, activo FROM estados_personalizados WHERE empresa_id = $1 ORDER BY created_at`,
        [empresaId]
      )
    : session.rol === 'ROOT'
      ? await pool.query(`SELECT clave, nombre, color, grupo, activo FROM estados_personalizados ORDER BY created_at`)
      : { rows: [] };
  return NextResponse.json(res.rows);
}

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  if (!ROLES_EDICION.includes(session.rol as string)) {
    return NextResponse.json({ error: 'Permisos insuficientes' }, { status: 403 });
  }
  const empresaId = empresaDe(request, session);
  if (!empresaId) return NextResponse.json({ error: 'Selecciona una empresa' }, { status: 400 });

  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Datos inválidos' }, { status: 400 });
  }
  const { nombre, color, grupo } = parsed.data;

  try {
    const res = await pool.query(
      `INSERT INTO estados_personalizados (clave, empresa_id, nombre, color, grupo)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING clave, nombre, color, grupo, activo`,
      [`M_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`, empresaId, nombre, color ?? '#64748b', grupo]
    );
    return NextResponse.json(res.rows[0], { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'Ya existe un estado con ese nombre' }, { status: 409 });
    }
    console.error('Error creando estado personalizado:', err);
    return NextResponse.json({ error: 'Error al crear el estado' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  if (!ROLES_EDICION.includes(session.rol as string)) {
    return NextResponse.json({ error: 'Permisos insuficientes' }, { status: 403 });
  }
  const empresaId = empresaDe(request, session);
  if (!empresaId) return NextResponse.json({ error: 'Selecciona una empresa' }, { status: 400 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Datos inválidos' }, { status: 400 });
  }
  const { clave, nombre, color, grupo, activo } = parsed.data;

  try {
    const res = await pool.query(
      `UPDATE estados_personalizados
          SET nombre = COALESCE($3, nombre),
              color = COALESCE($4, color),
              grupo = COALESCE($5, grupo),
              activo = COALESCE($6, activo)
        WHERE clave = $1 AND empresa_id = $2
        RETURNING clave, nombre, color, grupo, activo`,
      [clave, empresaId, nombre ?? null, color ?? null, grupo ?? null, activo ?? null]
    );
    if (res.rowCount === 0) return NextResponse.json({ error: 'Estado no encontrado' }, { status: 404 });
    return NextResponse.json(res.rows[0]);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'Ya existe un estado con ese nombre' }, { status: 409 });
    }
    console.error('Error actualizando estado personalizado:', err);
    return NextResponse.json({ error: 'Error al actualizar el estado' }, { status: 500 });
  }
}
