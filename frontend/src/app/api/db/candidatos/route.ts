import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { ENV } from "@/lib/env";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'virgo_user',
  password: process.env.DB_PASSWORD || 'virgo_password_secure',
  database: process.env.DB_NAME || 'virgo_db',
  port: parseInt(process.env.DB_PORT || '5432'),
});

const querySchema = z.object({
  estado: z.string().optional().nullable(),
  vacante: z.string().max(100).optional().nullable(),
  q: z.string().max(100).optional().nullable(),
  limit: z.coerce.number().int().positive().default(500),
});

// ─── GET /api/db/candidatos ────────────────────────────────
// Parámetros opcionales: ?estado=NUEVO&vacante=...&q=nombre
export async function GET(request: Request) {
  const rl = rateLimit(request);
  if (!rl.success) {
    return NextResponse.json({ error: "Too Many Requests" }, { status: 429 });
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
  limit = Math.min(limit, 100); // Limit pagination

  try {
    const conditions: string[] = [];
    const values: (string | number)[] = [];
    let idx = 1;

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

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const res = await pool.query(
      `SELECT
        id, telefono, nombre, nombre_chat, nombre_solicitud, nombre_ine,
        estado, vacante_interes, nave_interes, veredicto,
        tiene_cv, datos_ine, datos_rfc, cv_manual,
        escalado, escalation_reason,
        fecha_entrevista, ultima_interaccion, updated_at, created_at,
        resumen_ia, motivo_analisis, privacidad_aceptada,
        nombre_confirmado, edad, correo, link_cv
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

