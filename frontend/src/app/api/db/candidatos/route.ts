import { NextResponse } from 'next/server';
import { z } from "zod";
import { getSession } from '@/lib/auth';
import { pool } from '@/lib/db';
import { resolveGrupoNaveIds } from '@/lib/grupos';

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
  const jwt_grupo_id = (payload.grupo_id as string | null) ?? null;

  const { searchParams } = new URL(request.url);

  let filter_empresa_id = searchParams.get("empresa_id");
  const filter_nave_id = searchParams.get("nave_id");
  let filter_grupo_id = searchParams.get("grupo_id");
  if (rol !== "ROOT") {
    filter_empresa_id = jwt_empresa_id;
  }
  // Solo ADMIN/ROOT pueden pedir el grupo de otra persona por query param.
  // Ojo: esto NO debe inyectar un grupo_id cuando el cliente no mandó uno
  // (p.ej. Dashboards/Mensajes/Expedientes filtrando solo por nave) — solo
  // corrige el caso en que alguien mande un grupo_id ajeno al suyo.
  if (filter_grupo_id && rol !== "ROOT" && rol !== "ADMIN" && filter_grupo_id !== jwt_grupo_id) {
    filter_grupo_id = jwt_grupo_id;
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
    const values: unknown[] = [];
    let idx = 1;

    if (filter_empresa_id) {
      conditions.push(`c.empresa_id = $${idx++}`);
      values.push(filter_empresa_id);
    }

    if (filter_grupo_id) {
      // El filtro por grupo tiene prioridad sobre nave_id (son mutuamente
      // excluyentes desde el TopNavbar, pero por robustez se prioriza grupo).
      const grupoNaveIds = await resolveGrupoNaveIds(filter_grupo_id);
      if (grupoNaveIds && grupoNaveIds.length > 0) {
        conditions.push(`(c.nave_id = ANY($${idx++}::uuid[]) OR c.nave_id IS NULL OR c.nave_interes IS NULL OR c.nave_interes = '' OR c.nave_interes = 'Pendiente')`);
        values.push(grupoNaveIds);
      } else {
        conditions.push(`FALSE`);
      }
    } else if (filter_nave_id) {
      conditions.push(`(c.nave_id = $${idx++} OR c.nave_id IS NULL OR c.nave_interes IS NULL OR c.nave_interes = '' OR c.nave_interes = 'Pendiente')`);
      values.push(filter_nave_id);
    }

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

    // Si hay un grupo aplicado (propio del usuario o elegido por ADMIN), el
    // alcance de grupo ya cubre a todo el equipo — no restringir además a
    // las vacantes propias del reclutador (ver Calendario: un reclutador de
    // un grupo debe ver las citas de todo su grupo, no solo las suyas).
    if (rol === "RECLUTADOR" && reclutador_id && !filter_grupo_id) {
      conditions.push(`
        c.vacante_interes IN (
          SELECT nombre FROM vacantes_def WHERE reclutador_id = $${idx}
        )
      `);
      values.push(reclutador_id);
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

