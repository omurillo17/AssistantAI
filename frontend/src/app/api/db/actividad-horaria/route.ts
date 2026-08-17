import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { resolveGrupoNaveIds } from '@/lib/grupos';

// ─── GET /api/db/actividad-horaria ─────────────────────────
// Cuenta mensajes de candidatos (no del bot) por día de la semana y hora,
// para el heatmap de "Horas con mayor actividad" del dashboard ejecutivo.
// Ventana fija de 90 días para mantener la consulta acotada.
export async function GET(request: Request) {
  const payload = await getSession(request);
  if (!payload) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const filter_grupo_id = searchParams.get('grupo_id');
  const filter_nave_id = searchParams.get('nave_id');
  const time_range = searchParams.get('time_range') || searchParams.get('dias') || '7d';

  let intervalStr = "INTERVAL '7 days'";
  if (time_range === '1d') intervalStr = "INTERVAL '1 day'";
  else if (time_range === '7d') intervalStr = "INTERVAL '7 days'";
  else if (time_range === '1m') intervalStr = "INTERVAL '30 days'";
  else if (time_range === '6m') intervalStr = "INTERVAL '180 days'";
  else if (time_range === '1y') intervalStr = "INTERVAL '365 days'";
  else if (time_range === '90d') intervalStr = "INTERVAL '90 days'";

  let filter_empresa_id = searchParams.get('empresa_id');
  if (payload.rol !== 'ROOT') {
    filter_empresa_id = (payload.empresa_id as string | null) ?? null;
  }

  try {
    const conditions: string[] = [`ch.role = 'user'`, `ch.timestamp > NOW() - ${intervalStr}`];
    const values: unknown[] = [];

    if (filter_empresa_id) {
      conditions.push(`EXISTS (
        SELECT 1 FROM candidatos c 
        WHERE (c.telefono = ch.telefono OR RIGHT(regexp_replace(c.telefono, '[^0-9]', '', 'g'), 10) = RIGHT(regexp_replace(ch.telefono, '[^0-9]', '', 'g'), 10))
          AND c.empresa_id = $${values.length + 1}
      )`);
      values.push(filter_empresa_id);
    }

    if (filter_grupo_id) {
      const grupoNaveIds = await resolveGrupoNaveIds(filter_grupo_id);
      if (grupoNaveIds && grupoNaveIds.length > 0) {
        conditions.push(`EXISTS (
          SELECT 1 FROM candidatos c
          WHERE (c.telefono = ch.telefono OR RIGHT(regexp_replace(c.telefono, '[^0-9]', '', 'g'), 10) = RIGHT(regexp_replace(ch.telefono, '[^0-9]', '', 'g'), 10))
            AND (
              c.nave_id = ANY($${values.length + 1}::uuid[])
              OR c.nave_id IS NULL
              OR c.nave_interes IS NULL
              OR TRIM(c.nave_interes) = ''
              OR LOWER(TRIM(c.nave_interes)) IN (
                SELECT LOWER(TRIM(nombre)) FROM naves WHERE id = ANY($${values.length + 1}::uuid[])
              )
            )
        )`);
        values.push(grupoNaveIds);
      }
    } else if (filter_nave_id) {
      conditions.push(`EXISTS (
        SELECT 1 FROM candidatos c
        WHERE (c.telefono = ch.telefono OR RIGHT(regexp_replace(c.telefono, '[^0-9]', '', 'g'), 10) = RIGHT(regexp_replace(ch.telefono, '[^0-9]', '', 'g'), 10))
          AND (
            c.nave_id = $${values.length + 1}
            OR c.nave_id IS NULL
            OR c.nave_interes IS NULL
            OR TRIM(c.nave_interes) = ''
            OR LOWER(TRIM(c.nave_interes)) = (
              SELECT LOWER(TRIM(nombre)) FROM naves WHERE id = $${values.length + 1}
            )
          )
      )`);
      values.push(filter_nave_id);
    }

    const res = await pool.query(
      `SELECT
         EXTRACT(DOW FROM (ch.timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City'))::int AS dia_semana,
         EXTRACT(HOUR FROM (ch.timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City'))::int AS hora,
         COUNT(*)::int AS total
       FROM conversation_history ch
       WHERE ${conditions.join(' AND ')}
       GROUP BY 1, 2
       ORDER BY 1, 2`,
      values
    );

    return NextResponse.json(res.rows);
  } catch (err) {
    console.error('Error fetching actividad-horaria:', err);
    return NextResponse.json({ error: 'Error al consultar actividad horaria' }, { status: 500 });
  }
}
