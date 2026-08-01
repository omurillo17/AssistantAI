import { NextResponse } from 'next/server';
import { z } from "zod";
import { getSession } from '@/lib/auth';
import { pool } from '@/lib/db';

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
  const rol = (payload.rol as string) || "USER";
  const reclutador_id = (payload.reclutador_id as string | null) ?? null;
  const jwt_empresa_id = (payload.empresa_id as string | null) ?? null;

  const { searchParams } = new URL(request.url);
  
  let filter_empresa_id = searchParams.get("empresa_id");
  const filter_nave_id = searchParams.get("nave_id");
  if (rol !== "ROOT") {
    filter_empresa_id = jwt_empresa_id;
  }

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
    const conditions: string[] = [];
    const values: (string | number)[] = [];
    let idx = 1;

    if (filter_empresa_id) {
      conditions.push(`empresa_id = $${idx++}`);
      values.push(filter_empresa_id);
    }

    if (filter_nave_id) {
      conditions.push(`(nave_id = $${idx++} OR nave_id IS NULL OR nave_interes IS NULL OR nave_interes = '' OR nave_interes = 'Pendiente')`);
      values.push(filter_nave_id);
    }

    if (estado && estado !== 'TODOS') {
      conditions.push(`estado = $${idx++}`);
      values.push(estado);
    }
    if (vacante) {
      conditions.push(`vacante_interes ILIKE $${idx++}`);
      values.push(`%${vacante}%`);
    }
    if (q) {
      conditions.push(`(nombre_chat ILIKE $${idx} OR nombre_solicitud ILIKE $${idx} OR telefono ILIKE $${idx})`);
      values.push(`%${q}%`);
      idx++;
    }

    if (rol === "RECLUTADOR" && reclutador_id) {
      conditions.push(`
        vacante_interes IN (
          SELECT nombre FROM vacantes_def WHERE reclutador_id = $${idx}
        )
      `);
      values.push(reclutador_id);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const res = await pool.query(
      `SELECT
        id, telefono, nombre, nombre_chat, nombre_solicitud, nombre_ine, nombre_constancia,
        estado, vacante_interes, nave_interes, veredicto,
        tiene_cv, datos_ine, datos_rfc, cv_manual,
        escalado, escalation_reason,
        fecha_entrevista, ultima_interaccion, updated_at, created_at,
        resumen_ia, motivo_analisis, privacidad_aceptada,
        nombre_confirmado, edad, correo, link_cv,
        curp_ine, curp_rfc, alerta_identidad_estado, alerta_identidad_motivo
       FROM candidatos
       ${where}
       ORDER BY updated_at DESC
       LIMIT $${idx}`,
      [...values, limit]
    );

    return NextResponse.json(res.rows);
  } catch (err) {
    console.error('Error fetching candidatos:', err);
    return NextResponse.json({ error: 'Error al conectar con la base de datos' }, { status: 500 });
  }
}

