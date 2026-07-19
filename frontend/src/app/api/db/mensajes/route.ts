import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { z } from "zod";

import { pool } from '@/lib/db';
import { jwtVerify } from "jose";
import { ENV } from "@/lib/env";
import { cookies } from "next/headers";

const postSchema = z.object({
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
    const cookieStore = await cookies();
    const token = cookieStore.get("tci_session")?.value;
    if (!token) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    
    let rol = "USER";
    let reclutador_id = null;
    let usuario = null;

    try {
      const secretKey = new TextEncoder().encode(ENV.JWT_SECRET);
      const { payload } = await jwtVerify(token, secretKey);
      rol = payload.rol as string;
      reclutador_id = payload.reclutador_id as string | null;
      usuario = payload.usuario as string;
    } catch (err) {
      return NextResponse.json({ error: "Token inválido" }, { status: 401 });
    }

    let filterClause = `
      WHERE (c.escalado = TRUE
         OR mb.mensajes_no_leidos > 0
         OR (
           COALESCE(mb.activo, TRUE) = TRUE
           AND COALESCE(mb.ultimo_mensaje_at, c.ultima_interaccion) > NOW() - INTERVAL '72 hours'
         ))
    `;
    let queryParams: any[] = [];

    // Eliminado el filtro por asignado_a para que todos los reclutadores vean todos los mensajes

    const res = await pool.query(`
      SELECT
        c.telefono,
        COALESCE(NULLIF(TRIM(c.nombre_chat),''), NULLIF(TRIM(c.nombre_solicitud),''), NULLIF(TRIM(c.nombre_ine),''), NULLIF(TRIM(c.nombre),''), c.telefono) AS nombre,
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
      LEFT JOIN mensajes_bandeja mb ON mb.telefono = c.telefono
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
    const cookieStore = await cookies();
    const token = cookieStore.get("tci_session")?.value;
    if (!token) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    try {
      const secretKey = new TextEncoder().encode(ENV.JWT_SECRET);
      await jwtVerify(token, secretKey);
    } catch (err) {
      return NextResponse.json({ error: "Token inválido" }, { status: 401 });
    }
    const body = await request.json();
    const parsed = postSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }

    const {
      telefono,
      ultimo_mensaje,
      ultimo_mensaje_rol,
      asignado_a,
      mensajes_no_leidos,
      activo,
    } = parsed.data;

    // Upsert en mensajes_bandeja
    const setClauses: string[] = ['updated_at = NOW()'];
    const values: any[] = [
      telefono,
      ultimo_mensaje ?? '',
      ultimo_mensaje_rol,
      asignado_a ?? null,
      mensajes_no_leidos,
      activo
    ];
    let idx = 7;

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
      `INSERT INTO mensajes_bandeja (telefono, ultimo_mensaje, ultimo_mensaje_rol, asignado_a, mensajes_no_leidos, activo)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (telefono) DO UPDATE SET ${setClauses.join(', ')}
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
    const cookieStore = await cookies();
    const token = cookieStore.get("tci_session")?.value;
    if (!token) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    try {
      const secretKey = new TextEncoder().encode(ENV.JWT_SECRET);
      await jwtVerify(token, secretKey);
    } catch (err) {
      return NextResponse.json({ error: "Token inválido" }, { status: 401 });
    }
    const body = await request.json();
    const { telefono, asignado_a } = body;

    if (!telefono) {
      return NextResponse.json({ error: "Falta teléfono" }, { status: 400 });
    }

    const res = await pool.query(
      `UPDATE mensajes_bandeja SET asignado_a = $1, updated_at = NOW() WHERE telefono = $2 RETURNING *`,
      [asignado_a, telefono]
    );

    return NextResponse.json({ success: true, updated: res.rows[0] });
  } catch (err) {
    console.error('Error assigning chat:', err);
    return NextResponse.json({ error: 'Error al asignar chat' }, { status: 500 });
  }
}
