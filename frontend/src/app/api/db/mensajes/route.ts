import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { z } from "zod";

import { pool } from '@/lib/db';
import { getSession } from '@/lib/auth';

const postSchema = z.object({
  candidato_id: z.string().uuid("ID de candidato inválido").optional(),
  telefono: z.string().min(1, "Falta el campo telefono").max(20),
  ultimo_mensaje: z.string().optional(),
  ultimo_mensaje_rol: z.string().max(50).optional().default('user'),
  asignado_a: z.string().max(100).optional().nullable(),
  mensajes_no_leidos: z.number().int().min(0).optional().default(0),
  activo: z.boolean().optional().default(true),
});

// ─── GET /api/db/mensajes ──────────────────────────────────
// Devuelve conversaciones activas para la bandeja
// Prioriza escalados, luego por último mensaje
export async function GET(request: Request) {

  try {
    const payload = await getSession(request);
    if (!payload) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const rol = (payload.rol as string) || "USER";
    const jwt_empresa_id = (payload.empresa_id as string | null) ?? null;

    const { searchParams } = new URL(request.url);
    let filter_empresa_id = searchParams.get('empresa_id');
    const filter_nave_id = searchParams.get('nave_id');
    
    // Si no es ROOT, forzamos su empresa_id del JWT
    if (rol !== "ROOT") {
      filter_empresa_id = jwt_empresa_id;
    }

    let filterClause = `
      WHERE (c.escalado = TRUE
         OR mb.mensajes_no_leidos > 0
         OR (
           COALESCE(mb.activo, TRUE) = TRUE
           AND COALESCE(mb.ultimo_mensaje_at, c.ultima_interaccion) > NOW() - INTERVAL '72 hours'
         ))
    `;
    const queryParams: unknown[] = [];
    let paramIndex = 1;

    if (filter_empresa_id) {
      filterClause += ` AND c.empresa_id = $${paramIndex}`;
      queryParams.push(filter_empresa_id);
      paramIndex++;
    }

    if (filter_nave_id) {
      filterClause += ` AND c.nave_id = $${paramIndex}`;
      queryParams.push(filter_nave_id);
      paramIndex++;
    }

    // Eliminado el filtro por asignado_a para que todos los reclutadores vean todos los mensajes

    const res = await pool.query(`
      SELECT
        c.id AS candidato_id,
        c.telefono,
        COALESCE(NULLIF(TRIM(c.nombre_ine),''), NULLIF(TRIM(c.nombre_solicitud),''), NULLIF(TRIM(c.nombre_constancia),''), NULLIF(TRIM(c.nombre_chat),''), NULLIF(TRIM(c.nombre),''), c.telefono) AS nombre,
        c.estado,
        c.escalado,
        c.escalation_reason,
        c.vacante_interes,
        c.nave_interes,
        c.ultima_interaccion,
        mb.asignado_a,
        mb.mensajes_no_leidos,
        mb.ultimo_mensaje,
        mb.ultimo_mensaje_rol,
        mb.ultimo_mensaje_at,
        mb.activo AS bandeja_activa
      FROM candidatos c
      LEFT JOIN mensajes_bandeja mb ON mb.candidato_id = c.id
      ${filterClause}
      ORDER BY
        COALESCE(mb.ultimo_mensaje_at, c.ultima_interaccion) DESC
      LIMIT 1000
    `, queryParams);

    return NextResponse.json(res.rows);
  } catch (err) {
    console.error('Error fetching mensajes bandeja:', err);
    return NextResponse.json({ error: 'Error al conectar con la base de datos' }, { status: 500 });
  }
}

// ─── POST /api/db/mensajes ────────────────────────────────
// Crea o actualiza un registro en mensajes_bandeja
// Body: { telefono, ultimo_mensaje?, ultimo_mensaje_rol?, asignado_a?, mensajes_no_leidos?, activo? }
export async function POST(request: Request) {

  try {
    const payload = await getSession(request);
    if (!payload) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const jwt_empresa_id = (payload.empresa_id as string | null) ?? null;
    const body = await request.json();
    const parsed = postSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }

    const {
      candidato_id,
      telefono,
      ultimo_mensaje,
      ultimo_mensaje_rol,
      asignado_a,
      mensajes_no_leidos,
      activo,
    } = parsed.data;

    let targetCandidatoId = candidato_id;

    if (!targetCandidatoId && telefono) {
      // Fallback: If no candidato_id is provided, try to find one by phone
      // IMPORTANT: In SaaS mode, N8N MUST send empresa_id (via JWT or URL) so we find the RIGHT candidate!
      const { searchParams } = new URL(request.url);
      const target_empresa = searchParams.get('empresa_id') || jwt_empresa_id;
      
      let candRes;
      if (target_empresa) {
         candRes = await pool.query('SELECT id FROM candidatos WHERE telefono = $1 AND empresa_id = $2 ORDER BY updated_at DESC LIMIT 1', [telefono, target_empresa]);
      } else {
         candRes = await pool.query('SELECT id FROM candidatos WHERE telefono = $1 ORDER BY updated_at DESC LIMIT 1', [telefono]);
      }
      
      if (candRes.rowCount && candRes.rowCount > 0) {
        targetCandidatoId = candRes.rows[0].id;
      } else {
        return NextResponse.json({ error: "No se encontró candidato para este teléfono" }, { status: 404 });
      }
    }

    // Upsert en mensajes_bandeja
    const setClauses: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [
      targetCandidatoId,
      telefono,
      ultimo_mensaje ?? '',
      ultimo_mensaje_rol,
      asignado_a ?? null,
      mensajes_no_leidos,
      activo
    ];
    let idx = 8;

    if (ultimo_mensaje !== undefined) {
      setClauses.push(`ultimo_mensaje = $${idx++}`);
      values.push(ultimo_mensaje);
      setClauses.push(`ultimo_mensaje_at = NOW()`);
    }
    if (ultimo_mensaje_rol !== undefined) {
      setClauses.push(`ultimo_mensaje_rol = $${idx++}`);
      values.push(ultimo_mensaje_rol);
    }
    if (asignado_a !== undefined) {
      setClauses.push(`asignado_a = $${idx++}`);
      values.push(asignado_a);
    }
    if (mensajes_no_leidos !== undefined) {
      setClauses.push(`mensajes_no_leidos = $${idx++}`);
      values.push(mensajes_no_leidos);
    }
    if (activo !== undefined) {
      setClauses.push(`activo = $${idx++}`);
      values.push(activo);
    }

    const res = await pool.query(
      `INSERT INTO mensajes_bandeja (candidato_id, telefono, ultimo_mensaje, ultimo_mensaje_rol, asignado_a, mensajes_no_leidos, activo)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (candidato_id) DO UPDATE SET ${setClauses.join(', ')}
       RETURNING *`,
      values
    );

    return NextResponse.json(res.rows[0]);
  } catch (err) {
    console.error('Error upserting mensajes_bandeja:', err);
    return NextResponse.json({ error: 'Error al actualizar bandeja' }, { status: 500 });
  }
}

// ─── PATCH /api/db/mensajes ───────────────────────────────
// Asigna un chat a un reclutador
// Body: { telefono, asignado_a }
export async function PATCH(request: Request) {
  try {
    const payload = await getSession(request);
    if (!payload) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const body = await request.json();
    const { candidato_id, telefono, asignado_a } = body;

    let targetCandidatoId = candidato_id;

    if (!targetCandidatoId && telefono) {
      const candRes = await pool.query('SELECT id FROM candidatos WHERE telefono = $1 ORDER BY updated_at DESC LIMIT 1', [telefono]);
      if (candRes.rowCount && candRes.rowCount > 0) {
        targetCandidatoId = candRes.rows[0].id;
      }
    }

    if (!targetCandidatoId) {
      return NextResponse.json({ error: "Falta identificador del candidato" }, { status: 400 });
    }

    const res = await pool.query(
      `UPDATE mensajes_bandeja SET asignado_a = $1, updated_at = NOW() WHERE candidato_id = $2 RETURNING *`,
      [asignado_a, targetCandidatoId]
    );

    return NextResponse.json({ success: true, updated: res.rows[0] });
  } catch (err) {
    console.error('Error assigning chat:', err);
    return NextResponse.json({ error: 'Error al asignar chat' }, { status: 500 });
  }
}
