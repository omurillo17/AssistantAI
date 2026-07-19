import { NextResponse } from 'next/server';
import { z } from "zod";

import { pool } from '@/lib/db';

const getQuerySchema = z.object({
  telefono: z.string().min(1, "Falta el parámetro telefono").max(20),
});

const patchBodySchema = z.object({
  telefono: z.string().min(1, "Falta el campo telefono").max(20),
  estado: z.string().max(50).optional(),
  notas: z.string().optional(),
  vacante_interes: z.string().max(100).optional(),
  escalado: z.boolean().nullable().optional(),
  escalation_reason: z.string().nullable().optional(),
  event_id: z.string().nullable().optional(),
  asignado_a: z.string().nullable().optional(),
});

const WAHA_BASE = process.env.WAHA_BASE_URL || "http://localhost:3000";
const WAHA_API_KEY = process.env.WAHA_API_KEY || "virgo_secret_key";
const WAHA_SESSION = process.env.WAHA_SESSION || "default";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";

// ─── GET /api/db/candidato?telefono=xxx ───────────────────
export async function GET(request: Request) {

  const { searchParams } = new URL(request.url);
  const parsed = getQuerySchema.safeParse({
    telefono: searchParams.get('telefono'),
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { telefono } = parsed.data;

  let rol = "USER";
  let reclutador_id: string | null = null;
  
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("tci_session")?.value;
    if (!token) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'secret-key-default');
    const { payload } = await jwtVerify(token, secret);
    rol = payload.rol as string;
    reclutador_id = payload.reclutador_id as string;
  } catch (err) {
    return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  }

  try {
    let filterClause = "telefono LIKE $1";
    const queryParams: any[] = [`%${telefono}%`];
    let idx = 2;

    if (rol === "RECLUTADOR" && reclutador_id) {
      filterClause += `
        AND vacante_interes IN (
          SELECT nombre FROM vacantes_def WHERE reclutador_id = $${idx}
        )
      `;
      queryParams.push(reclutador_id);
    }

    const res = await pool.query(
      `SELECT * FROM candidatos WHERE ${filterClause} ORDER BY ultima_interaccion DESC LIMIT 1`,
      queryParams
    );

    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'Candidato no encontrado' }, { status: 404 });
    }

    return NextResponse.json(res.rows[0]);
  } catch (err) {
    console.error('Error fetching candidate:', err);
    return NextResponse.json({ error: 'Error al conectar con la base de datos' }, { status: 500 });
  }
}

// ─── PATCH /api/db/candidato ─────────────────────────────
// Body: { telefono, estado?, notas?, vacante_interes?, escalado?, escalation_reason? }
export async function PATCH(request: Request) {

  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("tci_session")?.value;
    if (!token) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    try {
      const secretKey = new TextEncoder().encode(process.env.JWT_SECRET || 'secret-key-default');
      await jwtVerify(token, secretKey);
    } catch (err) {
      return NextResponse.json({ error: "Token inválido" }, { status: 401 });
    }
    const body = await request.json();
    const parsed = patchBodySchema.safeParse(body);

    if (!parsed.success) {
      console.error("Zod validation error:", parsed.error.issues);
      return NextResponse.json({ error: "Datos inválidos", details: parsed.error.issues }, { status: 400 });
    }

    const { telefono, estado, notas, vacante_interes, escalado, escalation_reason, event_id, asignado_a } = parsed.data;

    const campos: string[] = ['updated_at = NOW()'];
    const valores: (string | boolean | null)[] = [];
    let idx = 1;

    if (estado !== undefined) {
      campos.push(`estado = $${idx++}`);
      valores.push(estado);
    }
    if (notas !== undefined) {
      campos.push(`escalation_reason = $${idx++}`);
      valores.push(notas);
    }
    if (escalation_reason !== undefined) {
      campos.push(`escalation_reason = $${idx++}`);
      valores.push(escalation_reason);
    }
    if (vacante_interes !== undefined) {
      campos.push(`vacante_interes = $${idx++}`);
      valores.push(vacante_interes);
    }
    if (event_id !== undefined) {
      campos.push(`event_id = $${idx++}`);
      valores.push(event_id);
    }
    if (asignado_a !== undefined) {
      campos.push(`asignado_a = $${idx++}`);
      valores.push(asignado_a);
    }
    if (escalado !== undefined) {
      campos.push(`escalado = $${idx++}`);
      valores.push(escalado);
      // Si se activa el escalado, registrar timestamp; si se desactiva, limpiarlo
      if (escalado === true) {
        campos.push(`escalated_at = NOW()`);
      } else {
        campos.push(`escalated_at = NULL`);
      }
    }

    if (campos.length === 1) {
      return NextResponse.json({ error: 'No hay campos para actualizar' }, { status: 400 });
    }

    valores.push(telefono);
    const res = await pool.query(
      `UPDATE candidatos SET ${campos.join(', ')} WHERE telefono = $${idx} RETURNING id, telefono, estado, escalado, escalated_at, updated_at`,
      valores
    );

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Candidato no encontrado' }, { status: 404 });
    }

    // Si se asignó a un reclutador y se está escalando, intentar notificarle vía WhatsApp
    if (asignado_a && escalado === true) {
      try {
        const recRes = await pool.query('SELECT telefono FROM reclutadores WHERE nombre = $1 AND activo = true LIMIT 1', [asignado_a]);
        if (recRes.rows.length > 0) {
          const recTelefono = recRes.rows[0].telefono;
          const msg = `🔔 *Atención*: Se te ha transferido un nuevo candidato.\n\n👤 *Teléfono:* ${telefono}\nPor favor revisa la plataforma para atenderlo.`;
          
          await fetch(`${WAHA_BASE}/api/sendText`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'X-Api-Key': WAHA_API_KEY
            },
            body: JSON.stringify({
              chatId: `${recTelefono}@c.us`,
              text: msg,
              session: WAHA_SESSION
            })
          });
          console.log(`Notificación enviada al reclutador ${asignado_a} (${recTelefono})`);
          
          // Guardar notificación en base de datos
          await pool.query(
            'INSERT INTO notificaciones (reclutador_id, mensaje) VALUES ((SELECT id FROM reclutadores WHERE nombre = $1 LIMIT 1), $2)',
            [asignado_a, `Se te ha transferido un nuevo candidato: ${telefono}`]
          );
        }
      } catch (notifyErr) {
        console.error('Error al notificar al reclutador:', notifyErr);
        // No bloqueamos la respuesta principal si falla la notificación
      }
    }

    return NextResponse.json(res.rows[0]);
  } catch (err) {
    console.error('Error updating candidate:', err);
    return NextResponse.json({ error: 'Error al actualizar el candidato' }, { status: 500 });
  }
}

