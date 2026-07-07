import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'virgo_user',
  password: process.env.DB_PASSWORD || 'virgo_password_secure',
  database: process.env.DB_NAME || 'virgo_db',
  port: parseInt(process.env.DB_PORT || '5432'),
});

const getQuerySchema = z.object({
  telefono: z.string().min(1, "Falta el parámetro telefono").max(20),
});

const patchBodySchema = z.object({
  telefono: z.string().min(1, "Falta el campo telefono").max(20),
  estado: z.string().max(50).optional(),
  notas: z.string().optional(),
  vacante_interes: z.string().max(100).optional(),
  escalado: z.boolean().optional(),
  escalation_reason: z.string().optional(),
  event_id: z.string().optional(),
});

// ─── GET /api/db/candidato?telefono=xxx ───────────────────
export async function GET(request: Request) {
  const rl = rateLimit(request);
  if (!rl.success) {
    return NextResponse.json({ error: "Too Many Requests" }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = getQuerySchema.safeParse({
    telefono: searchParams.get('telefono'),
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { telefono } = parsed.data;

  try {
    const res = await pool.query(
      `SELECT * FROM candidatos WHERE telefono LIKE $1 ORDER BY ultima_interaccion DESC LIMIT 1`,
      [`%${telefono}%`]
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
  const rl = rateLimit(request);
  if (!rl.success) {
    return NextResponse.json({ error: "Too Many Requests" }, { status: 429 });
  }

  try {
    const body = await request.json();
    const parsed = patchBodySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }

    const { telefono, estado, notas, vacante_interes, escalado, escalation_reason, event_id } = parsed.data;

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

    return NextResponse.json(res.rows[0]);
  } catch (err) {
    console.error('Error updating candidate:', err);
    return NextResponse.json({ error: 'Error al actualizar el candidato' }, { status: 500 });
  }
}

