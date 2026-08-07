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
  let filter_empresa_id = searchParams.get('empresa_id');
  const filter_grupo_id = searchParams.get('grupo_id');
  if (payload.rol !== 'ROOT') {
    filter_empresa_id = (payload.empresa_id as string | null) ?? null;
  }

  try {
    // conversation_history.candidato_id nunca se popula en los webhooks actuales
    // (n8n-incoming, expediente, etc. solo escriben telefono) — cruzar por telefono
    // es lo único que realmente encuentra al candidato dueño del mensaje.
    const conditions: string[] = [`ch.role = 'user'`, `ch.timestamp > NOW() - INTERVAL '90 days'`];
    const values: unknown[] = [];
    if (filter_empresa_id) {
      conditions.push(`EXISTS (SELECT 1 FROM candidatos c WHERE c.telefono = ch.telefono AND c.empresa_id = $${values.length + 1})`);
      values.push(filter_empresa_id);
    }
    if (filter_grupo_id) {
      const grupoNaveIds = await resolveGrupoNaveIds(filter_grupo_id);
      if (grupoNaveIds && grupoNaveIds.length > 0) {
        conditions.push(`EXISTS (SELECT 1 FROM candidatos c WHERE c.telefono = ch.telefono AND c.nave_id = ANY($${values.length + 1}::uuid[]))`);
        values.push(grupoNaveIds);
      } else {
        conditions.push(`FALSE`);
      }
    }

    const res = await pool.query(
      `SELECT
         EXTRACT(DOW FROM (ch.timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City'))::int AS dia_semana,
         EXTRACT(HOUR FROM (ch.timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City'))::int AS hora,
         COUNT(*)::int AS total
       FROM conversation_history ch
       WHERE ${conditions.join(' AND ')}
       GROUP BY dia_semana, hora
       ORDER BY dia_semana, hora`,
      values
    );

    return NextResponse.json(res.rows);
  } catch (err) {
    console.error('Error fetching actividad-horaria:', err);
    return NextResponse.json({ error: 'Error al consultar actividad horaria' }, { status: 500 });
  }
}
