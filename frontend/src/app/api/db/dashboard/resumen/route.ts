import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { pool } from '@/lib/db';
import { buildCandidatosScope } from '@/lib/candidatosScope';

export const dynamic = 'force-dynamic';

// ─── GET /api/db/dashboard/resumen ─────────────────────────
// Devuelve los agregados del dashboard ejecutivo ya calculados en Postgres.
// Antes el dashboard pedía /api/db/candidatos?limit=2000 (35 columnas por
// fila, incluidos datos_ine/datos_rfc/resumen_ia) y hacía los conteos en el
// navegador con .forEach: ~212 kB de JSON para pintar unos pocos números.
// Aquí viaja solo el resultado.
//
// El detalle fila-a-fila (drill-down al hacer clic en un estado) sigue
// pidiéndose a /api/db/candidatos?estado=..., pero ya solo cuando el usuario
// abre el modal.

const TZ = "AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City'";

// Cada rango define cómo se agrupa la línea de tiempo y desde cuándo. Se
// interpola en el SQL, así que sale de esta whitelist y nunca del query param.
const RANGOS: Record<string, { bucket: string; desde: string }> = {
  '1d': {
    bucket: `lpad(EXTRACT(HOUR FROM fecha_local)::text, 2, '0') || ':00'`,
    desde: `NOW() ${TZ} - INTERVAL '24 hours'`,
  },
  '7d': {
    bucket: `to_char(fecha_local, 'YYYY-MM-DD')`,
    desde: `date_trunc('day', NOW() ${TZ}) - INTERVAL '6 days'`,
  },
  '1m': {
    bucket: `to_char(fecha_local, 'YYYY-MM-DD')`,
    desde: `date_trunc('day', NOW() ${TZ}) - INTERVAL '29 days'`,
  },
  '6m': {
    bucket: `to_char(fecha_local, 'YYYY-MM')`,
    desde: `date_trunc('month', NOW() ${TZ}) - INTERVAL '5 months'`,
  },
  '1y': {
    bucket: `to_char(fecha_local, 'YYYY-MM')`,
    desde: `date_trunc('month', NOW() ${TZ}) - INTERVAL '11 months'`,
  },
};

export async function GET(request: Request) {
  const payload = await getSession(request);
  if (!payload) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
  // Sin empresa en el JWT (y sin ser ROOT) se niega: nunca se salta el filtro.
  if (payload.rol !== 'ROOT' && !payload.empresa_id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const rangoKey = searchParams.get('time_range') || '1m';
  const rango = RANGOS[rangoKey] ?? RANGOS['1m'];

  try {
    // Mismo alcance multi-tenant que /api/db/candidatos: si divergen, el
    // dashboard enseñaría totales de candidatos que el usuario no puede abrir.
    const scope = await buildCandidatosScope(payload, searchParams);
    const where = scope.conditions.length > 0 ? `WHERE ${scope.conditions.join(' AND ')}` : '';

    const sql = `
      WITH base AS (
        SELECT
          COALESCE(NULLIF(c.estado, ''), 'NUEVO') AS estado,
          COALESCE(
            NULLIF(
              CASE
                WHEN UPPER(TRIM(c.vacante_interes)) LIKE '%CAJER%' OR UPPER(TRIM(c.vacante_interes)) LIKE '%ESCAN%' THEN 'CAJERA O ESCANER'
                WHEN UPPER(TRIM(c.vacante_interes)) LIKE '%OPERADOR%GENERAL%' THEN 'OPERADOR GENERAL'
                ELSE UPPER(TRIM(c.vacante_interes))
              END,
              ''
            ),
            'General'
          ) AS vacante,
          c.nave_interes,
          COALESCE(c.escalado, FALSE) AS escalado,
          r.nombre AS asignado_a_nombre,
          (COALESCE(c.created_at, c.ultima_interaccion, c.updated_at) ${TZ}) AS fecha_local
        FROM candidatos c
        LEFT JOIN reclutadores r ON r.id = c.asignado_a_id
        ${where}
      )
      SELECT
        (SELECT COUNT(*)::int FROM base) AS total,
        (SELECT COUNT(*)::int FROM base WHERE escalado) AS escalados,

        (SELECT COALESCE(json_agg(t), '[]'::json) FROM (
          SELECT estado, COUNT(*)::int AS count
          FROM base GROUP BY estado
        ) t) AS estados,

        (SELECT COALESCE(json_agg(t), '[]'::json) FROM (
          SELECT vacante,
                 COUNT(*)::int AS total,
                 COUNT(*) FILTER (WHERE estado = 'CONTRATADO')::int AS contratados,
                 COUNT(*) FILTER (WHERE estado = 'RECHAZADO')::int AS rechazados
          FROM base
          WHERE estado != 'OTRA_CIUDAD'
          GROUP BY vacante ORDER BY COUNT(*) DESC
        ) t) AS vacantes,

        (SELECT COUNT(*)::int FROM base WHERE estado = 'OTRA_CIUDAD') AS otra_ciudad,

        (SELECT COALESCE(json_agg(t), '[]'::json) FROM (
          SELECT asignado_a_nombre AS nombre,
                 COUNT(*)::int AS asignados,
                 COUNT(*) FILTER (WHERE estado = 'CONTRATADO')::int AS contratados
          FROM base
          WHERE asignado_a_nombre IS NOT NULL
          GROUP BY asignado_a_nombre
          ORDER BY COUNT(*) FILTER (WHERE estado = 'CONTRATADO') DESC, COUNT(*) DESC
        ) t) AS reclutadores,

        -- nave_interes va cruda: el nombre legible lo resuelve el cliente, que
        -- es quien tiene el mapa de "número secuencial -> nombre de sucursal".
        (SELECT COALESCE(json_agg(t), '[]'::json) FROM (
          SELECT COALESCE(TRIM(nave_interes), '') AS nave, COUNT(*)::int AS count
          FROM base GROUP BY COALESCE(TRIM(nave_interes), '')
        ) t) AS naves,

        (SELECT COALESCE(json_agg(t), '[]'::json) FROM (
          SELECT ${rango.bucket} AS bucket, COUNT(*)::int AS count
          FROM base
          WHERE fecha_local IS NOT NULL AND fecha_local >= ${rango.desde}
          GROUP BY 1
        ) t) AS timeline
    `;

    const res = await pool.query(sql, scope.values);
    const row = res.rows[0] ?? {};

    return NextResponse.json({
      total: row.total ?? 0,
      escalados: row.escalados ?? 0,
      estados: row.estados ?? [],
      vacantes: row.vacantes ?? [],
      reclutadores: row.reclutadores ?? [],
      naves: row.naves ?? [],
      timeline: row.timeline ?? [],
    });
  } catch (err) {
    console.error('Error fetching resumen dashboard:', err);
    return NextResponse.json({ error: 'Error al conectar con la base de datos' }, { status: 500 });
  }
}
