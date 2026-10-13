import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { pool } from '@/lib/db';
import { syncPromptContextDisk } from '@/lib/syncPromptContext';
import { resolveGrupoNaveIds } from '@/lib/grupos';
import type { PoolClient } from 'pg';
import type { Recruiter } from '@/types';

/** Fila del SELECT de reclutadores + vacantes (LEFT JOIN: las columnas de vacante pueden ser nulas). */
type VacanteJoinRow = {
  reclutador_id: string;
  reclutador_nombre: string;
  reclutador_activo: boolean;
  reclutador_telefono: string | null;
  reclutador_calendar: string | null;
  reclutador_color: string | null;
  reclutador_usuario: string | null;
  vacante_id: string | null;
  vacante_nombre: string | null;
  naves: string | string[] | null;
  detalles: string | null;
  funciones: string | null;
  palabras_clave: string | null;
  filtros: unknown[] | null;
  vacante_activa: boolean | null;
};

// ─── HELPERS ─────────────────────────────────────────────
async function buildVacantesQuery({
  rol,
  reclutador_id,
  jwt_grupo_id,
  filter_empresa_id,
  filter_grupo_id,
  filter_nave_id,
}: {
  rol: string;
  reclutador_id: string | null;
  jwt_grupo_id: string | null;
  filter_empresa_id: string | null;
  filter_grupo_id: string | null;
  filter_nave_id: string | null;
}) {
  let whereClause = "";
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filter_empresa_id) {
    whereClause = `WHERE r.empresa_id = $${paramIndex}`;
    params.push(filter_empresa_id);
    paramIndex++;
  }

  // Si el reclutador pertenece a un grupo (filter_grupo_id), debe ver a todo
  // su equipo (p.ej. en Calendario), no solo a sí mismo.
  if (rol === "RECLUTADOR" && reclutador_id && !filter_grupo_id) {
    whereClause += whereClause ? ` AND r.id = $${paramIndex}` : `WHERE r.id = $${paramIndex}`;
    params.push(reclutador_id);
    paramIndex++;
  }

  // Un ENCARGADO solo debe ver a los reclutadores de su propio grupo
  // (la relación reclutador-grupo vive en usuarios.grupo_id, vía usuarios.reclutador_id)
  if (rol === "ENCARGADO") {
    whereClause += whereClause ? ` AND u.grupo_id = $${paramIndex}` : `WHERE u.grupo_id = $${paramIndex}`;
    params.push(jwt_grupo_id);
    paramIndex++;
  }

  // El filtro de nave/grupo se aplica en el ON del JOIN a vacantes_def, no en
  // el WHERE de reclutadores: así un reclutador sin vacantes en esa nave/grupo
  // sigue apareciendo en la respuesta (con vacantes: []), en vez de desaparecer
  // por completo de la lista — permite mostrar su tarjeta vacía para agregar una.
  let vacancyJoinCondition = "r.id = v.reclutador_id";

  if (filter_grupo_id) {
    const grupoNaveIds = await resolveGrupoNaveIds(filter_grupo_id);
    if (grupoNaveIds && grupoNaveIds.length > 0) {
      vacancyJoinCondition += ` AND (v.nave_id = ANY($${paramIndex}::uuid[]) OR v.naves::jsonb ?| $${paramIndex}::text[])`;
      params.push(grupoNaveIds);
      paramIndex++;
    } else {
      vacancyJoinCondition += ` AND FALSE`;
    }
  } else if (filter_nave_id) {
    // vacantes_def.naves guarda IDs de nave (ver VacancyModal.tsx), no nombres:
    // hay que comparar contra el id directamente, no contra naves.nombre.
    vacancyJoinCondition += ` AND (v.nave_id = $${paramIndex} OR v.naves::jsonb @> jsonb_build_array($${paramIndex}::text))`;
    params.push(filter_nave_id);
    paramIndex++;
  }

  return { whereClause, vacancyJoinCondition, params };
}

function groupVacantesRows(rows: VacanteJoinRow[]) {
  const map = new Map<string, { [k: string]: unknown; vacantes: Record<string, unknown>[] }>();

  for (const row of rows) {
    if (!map.has(row.reclutador_id)) {
      map.set(row.reclutador_id, {
        reclutador_id: row.reclutador_id,
        nombre: row.reclutador_nombre,
        activo: row.reclutador_activo,
        telefono: row.reclutador_telefono || '',
        calendar_id: row.reclutador_calendar || '',
        color: row.reclutador_color || '#6366f1',
        usuario: row.reclutador_usuario || '',
        vacantes: []
      });
    }

    if (row.vacante_id) {
      map.get(row.reclutador_id)!.vacantes.push({
        id: row.vacante_id,
        nombre: row.vacante_nombre,
        naves: typeof row.naves === 'string' ? JSON.parse(row.naves) : row.naves,
        detalles: row.detalles || '',
        funciones: row.funciones || '',
        palabras_clave: row.palabras_clave || '',
        filtros: row.filtros || [],
        activa: row.vacante_activa
      });
    }
  }

  return Array.from(map.values());
}

export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const rol = (session.rol as string) || "USER";
  const reclutador_id = (session.reclutador_id as string | null) ?? null;
  const jwt_empresa_id = (session.empresa_id as string | null) ?? null;
  const jwt_grupo_id = (session.grupo_id as string | null) ?? null;

  const { searchParams } = new URL(request.url);
  let filter_empresa_id = searchParams.get("empresa_id");
  const filter_nave_id = searchParams.get("nave_id");
  let filter_grupo_id = searchParams.get("grupo_id");

  // Si no es ROOT, forzamos su propia empresa_id
  if (rol !== "ROOT") {
    filter_empresa_id = jwt_empresa_id;
  }
  // Solo ADMIN/ROOT pueden pedir el grupo de otra persona por query param.
  if (filter_grupo_id && rol !== "ROOT" && rol !== "ADMIN" && filter_grupo_id !== jwt_grupo_id) {
    filter_grupo_id = jwt_grupo_id;
  }

  try {
    const { whereClause, vacancyJoinCondition, params } = await buildVacantesQuery({
      rol,
      reclutador_id,
      jwt_grupo_id,
      filter_empresa_id,
      filter_grupo_id,
      filter_nave_id,
    });

    const res = await pool.query(`
      SELECT
        r.id AS reclutador_id,
        r.nombre AS reclutador_nombre,
        r.activo AS reclutador_activo,
        r.telefono AS reclutador_telefono,
        r.calendar_id AS reclutador_calendar,
        r.color AS reclutador_color,
        u.usuario AS reclutador_usuario,
        v.id AS vacante_id,
        v.nombre AS vacante_nombre,
        v.naves,
        v.detalles,
        v.funciones,
        v.palabras_clave,
        v.filtros,
        v.activa AS vacante_activa
      FROM reclutadores r
      LEFT JOIN usuarios u ON r.id = u.reclutador_id
      LEFT JOIN vacantes_def v ON ${vacancyJoinCondition}
      ${whereClause}
      ORDER BY r.created_at ASC, v.orden ASC, v.created_at ASC
    `, params);

    return NextResponse.json(groupVacantesRows(res.rows));
  } catch (err) {
    console.error('Error fetching vacantes:', err);
    return NextResponse.json({ error: 'Error al obtener las vacantes de la BD' }, { status: 500 });
  }
}

async function applyTransferMap(client: PoolClient, transfer_map: { from: string; to: string }[]) {
  for (const t of transfer_map) {
    if (t.from && t.to) {
      await client.query(`UPDATE mensajes_bandeja SET asignado_a_id = $1 WHERE asignado_a_id = $2`, [t.to, t.from]);
      await client.query(`UPDATE candidatos SET asignado_a_id = $1 WHERE asignado_a_id = $2`, [t.to, t.from]);
    }
  }
}

async function cleanupDeletedReclutadores(
  client: PoolClient,
  rol: string,
  target_empresa_id: string | null,
  incomingRecruiters: string[],
  allowedReclutadorIds: string[]
) {
  if (rol === "ADMIN" || rol === "ROOT") {
    if (incomingRecruiters.length > 0) {
      if (target_empresa_id) {
        await client.query(`DELETE FROM reclutadores WHERE empresa_id = $1 AND id != ALL($2)`, [target_empresa_id, incomingRecruiters]);
      } else {
        await client.query(`DELETE FROM reclutadores WHERE id != ALL($1)`, [incomingRecruiters]);
      }
    } else if (target_empresa_id) {
      await client.query(`DELETE FROM reclutadores WHERE empresa_id = $1`, [target_empresa_id]);
    } else {
      await client.query(`DELETE FROM reclutadores`);
    }
  } else if (rol === "ENCARGADO" && allowedReclutadorIds.length > 0) {
    if (incomingRecruiters.length > 0) {
      await client.query(`DELETE FROM reclutadores WHERE id = ANY($1) AND id != ALL($2)`, [allowedReclutadorIds, incomingRecruiters]);
    } else {
      await client.query(`DELETE FROM reclutadores WHERE id = ANY($1)`, [allowedReclutadorIds]);
    }
  }
}

async function upsertRecruitersAndVacancies(
  client: PoolClient,
  data: Recruiter[],
  target_empresa_id: string | null
) {
  for (const rec of data) {
    await client.query(`
      INSERT INTO reclutadores (id, nombre, activo, telefono, calendar_id, color, empresa_id, updated_at) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (id) DO UPDATE SET 
        nombre = EXCLUDED.nombre, 
        activo = EXCLUDED.activo, 
        telefono = EXCLUDED.telefono,
        calendar_id = EXCLUDED.calendar_id,
        color = EXCLUDED.color,
        empresa_id = EXCLUDED.empresa_id,
        updated_at = NOW()
    `, [rec.reclutador_id, rec.nombre, rec.activo, rec.telefono || '', rec.calendar_id || '', rec.color || '#6366f1', target_empresa_id || null]);

    let orden = 0;
    for (const vac of rec.vacantes) {
      await client.query(`
        INSERT INTO vacantes_def (id, reclutador_id, nombre, naves, detalles, funciones, palabras_clave, filtros, activa, orden, empresa_id, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
        ON CONFLICT (id) DO UPDATE SET
          reclutador_id = EXCLUDED.reclutador_id,
          nombre = EXCLUDED.nombre,
          naves = EXCLUDED.naves,
          detalles = EXCLUDED.detalles,
          funciones = EXCLUDED.funciones,
          palabras_clave = EXCLUDED.palabras_clave,
          filtros = EXCLUDED.filtros,
          activa = EXCLUDED.activa,
          orden = EXCLUDED.orden,
          empresa_id = EXCLUDED.empresa_id,
          updated_at = NOW()
      `, [
        vac.id,
        rec.reclutador_id,
        vac.nombre,
        JSON.stringify(vac.naves || []),
        vac.detalles || '',
        vac.funciones || '',
        vac.palabras_clave || '',
        JSON.stringify(vac.filtros || []),
        vac.activa,
        orden,
        target_empresa_id || null
      ]);
      orden++;
    }
  }
}

async function cleanupAdminVacancies(
  client: PoolClient,
  target_empresa_id: string | null,
  incomingVacancies: string[]
) {
  const hasIncoming = incomingVacancies.length > 0;
  if (target_empresa_id) {
    const query = hasIncoming
      ? `DELETE FROM vacantes_def WHERE empresa_id = $1 AND id != ALL($2)`
      : `DELETE FROM vacantes_def WHERE empresa_id = $1`;
    const params = hasIncoming ? [target_empresa_id, incomingVacancies] : [target_empresa_id];
    await client.query(query, params);
  } else {
    const query = hasIncoming
      ? `DELETE FROM vacantes_def WHERE id != ALL($1)`
      : `DELETE FROM vacantes_def`;
    const params = hasIncoming ? [incomingVacancies] : [];
    await client.query(query, params);
  }
}

async function cleanupScopedVacancies(
  client: PoolClient,
  rol: string,
  incomingVacancies: string[],
  jwt_reclutador_id: string | null,
  allowedReclutadorIds: string[]
) {
  const hasIncoming = incomingVacancies.length > 0;
  if (rol === "RECLUTADOR") {
    const query = hasIncoming
      ? `DELETE FROM vacantes_def WHERE reclutador_id = $1 AND id != ALL($2)`
      : `DELETE FROM vacantes_def WHERE reclutador_id = $1`;
    const params = hasIncoming ? [jwt_reclutador_id, incomingVacancies] : [jwt_reclutador_id];
    await client.query(query, params);
  } else if (rol === "ENCARGADO" && allowedReclutadorIds.length > 0) {
    const query = hasIncoming
      ? `DELETE FROM vacantes_def WHERE reclutador_id = ANY($1) AND id != ALL($2)`
      : `DELETE FROM vacantes_def WHERE reclutador_id = ANY($1)`;
    const params = hasIncoming ? [allowedReclutadorIds, incomingVacancies] : [allowedReclutadorIds];
    await client.query(query, params);
  }
}

async function cleanupDeletedVacancies(
  client: PoolClient,
  rol: string,
  target_empresa_id: string | null,
  incomingVacancies: string[],
  jwt_reclutador_id: string | null,
  allowedReclutadorIds: string[]
) {
  if (rol === "ADMIN" || rol === "ROOT") {
    await cleanupAdminVacancies(client, target_empresa_id, incomingVacancies);
  } else {
    await cleanupScopedVacancies(client, rol, incomingVacancies, jwt_reclutador_id, allowedReclutadorIds);
  }
}

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const rol = (session.rol as string) || "USER";
  const jwt_reclutador_id = (session.reclutador_id as string | null) ?? null;
  const jwt_empresa_id = (session.empresa_id as string | null) ?? null;
  const jwt_grupo_id = (session.grupo_id as string | null) ?? null;

  const { searchParams } = new URL(request.url);
  let target_empresa_id = searchParams.get("empresa_id");

  // Si no es ROOT, forzamos su propia empresa_id
  if (rol !== "ROOT") {
    target_empresa_id = jwt_empresa_id;
  }
  const client = await pool.connect();
  try {
    const body = await request.json();
    let data = [];
    let transfer_map: {from: string, to: string}[] = [];

    if (Array.isArray(body)) {
      data = body;
    } else if (body && Array.isArray(body.recruiters)) {
      data = body.recruiters;
      if (Array.isArray(body.transfer_map)) {
        transfer_map = body.transfer_map;
      }
    } else {
      return NextResponse.json({ error: 'Formato de datos inválido' }, { status: 400 });
    }

    if (rol === "RECLUTADOR") {
      if (!jwt_reclutador_id) {
         return NextResponse.json({ error: 'Acceso denegado' }, { status: 403 });
      }
      data = data.filter((r: { reclutador_id: string }) => r.reclutador_id === jwt_reclutador_id);
    }

    // Un ENCARGADO solo puede tocar reclutadores de su propio grupo
    let allowedReclutadorIds: string[] = [];
    if (rol === "ENCARGADO") {
      const allowedRes = await client.query(
        `SELECT r.id FROM reclutadores r
         JOIN usuarios u ON u.reclutador_id = r.id
         WHERE u.grupo_id = $1 AND r.empresa_id = $2`,
        [jwt_grupo_id, jwt_empresa_id]
      );
      allowedReclutadorIds = allowedRes.rows.map((row: { id: string }) => row.id);
      data = data.filter((r: { reclutador_id: string }) => allowedReclutadorIds.includes(r.reclutador_id));
    }

    await client.query('BEGIN');

    // Transfer chats and candidates if requested
    if ((rol === "ADMIN" || rol === "ENCARGADO") && transfer_map.length > 0) {
      await applyTransferMap(client, transfer_map);
    }

    const incomingRecruiters = data.map((r: { reclutador_id: string }) => r.reclutador_id);
    const incomingVacancies = data.flatMap((r: { vacantes: { id: string }[] }) => r.vacantes.map((v) => v.id));

    await cleanupDeletedReclutadores(client, rol, target_empresa_id, incomingRecruiters, allowedReclutadorIds);
    await upsertRecruitersAndVacancies(client, data, target_empresa_id);
    await cleanupDeletedVacancies(client, rol, target_empresa_id, incomingVacancies, jwt_reclutador_id, allowedReclutadorIds);

    await client.query('COMMIT');
    
    // Auto-sync prompt_context.json file for n8n/AI
    await syncPromptContextDisk(target_empresa_id || undefined);

    return NextResponse.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error saving vacantes:', err);
    return NextResponse.json({ error: 'Error interno al guardar las vacantes' }, { status: 500 });
  } finally {
    client.release();
  }
}
