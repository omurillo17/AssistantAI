import { NextResponse } from 'next/server';
import { z } from "zod";
import { getSession } from '@/lib/auth';
import { pool } from '@/lib/db';
import { buildCandidatosScope } from '@/lib/candidatosScope';

const querySchema = z.object({
  estado: z.string().optional().nullable(),
  vacante: z.string().max(100).optional().nullable(),
  q: z.string().max(100).optional().nullable(),
  limit: z.coerce.number().int().positive().default(500),
});

// ─── GET /api/db/candidatos ────────────────────────────────
// Parámetros opcionales: ?estado=NUEVO&vacante=...&q=nombre
export async function GET(request: Request) {
  const payload = await getSession(request);
  if (!payload) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  const parsedQuery = querySchema.safeParse({
    estado: searchParams.get('estado'),
    vacante: searchParams.get('vacante'),
    q: searchParams.get('q'),
    limit: searchParams.get('limit'),
  });

  if (!parsedQuery.success) {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  }

  const { estado, vacante, q } = parsedQuery.data;
  let { limit } = parsedQuery.data;
  limit = Math.min(limit, 2000); // Limit pagination

  try {
    // Alcance multi-tenant (empresa / grupo / nave / rol) compartido con el
    // resumen del dashboard — ver lib/candidatosScope.ts.
    const scope = await buildCandidatosScope(payload, searchParams);
    const conditions = [...scope.conditions];
    const values = [...scope.values];
    let idx = scope.nextIdx;

    if (estado && estado !== 'TODOS') {
      conditions.push(`c.estado = $${idx++}`);
      values.push(estado);
    }
    if (vacante) {
      conditions.push(`c.vacante_interes ILIKE $${idx++}`);
      values.push(`%${vacante}%`);
    }
    if (q) {
      conditions.push(`(c.nombre_chat ILIKE $${idx} OR c.nombre_solicitud ILIKE $${idx} OR c.telefono ILIKE $${idx})`);
      values.push(`%${q}%`);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const res = await pool.query(
      `SELECT
        c.id, c.telefono, c.nombre, c.nombre_chat, c.nombre_solicitud, c.nombre_ine, c.nombre_constancia,
        c.estado, c.vacante_interes, c.nave_interes, c.veredicto,
        c.tiene_cv, c.datos_ine, c.datos_rfc, c.cv_manual,
        c.escalado, c.escalation_reason,
        c.fecha_entrevista, c.event_id, c.nave_id, c.ultima_interaccion, c.updated_at, c.created_at,
        c.resumen_ia, c.motivo_analisis, c.privacidad_aceptada,
        c.nombre_confirmado, c.edad, c.correo, c.link_cv,
        c.curp_ine, c.curp_rfc, c.alerta_identidad_estado, c.alerta_identidad_motivo,
        c.asignado_a_id, r.nombre AS asignado_a_nombre
       FROM candidatos c
       LEFT JOIN reclutadores r ON r.id = c.asignado_a_id
       ${where}
       ORDER BY c.updated_at DESC
       LIMIT $${idx}`,
      [...values, limit]
    );

    return NextResponse.json(res.rows);
  } catch (err) {
    console.error('Error fetching candidatos:', err);
    return NextResponse.json({ error: 'Error al conectar con la base de datos' }, { status: 500 });
  }
}
