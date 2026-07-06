import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'virgo_user',
  password: process.env.DB_PASSWORD || 'virgo_password_secure',
  database: process.env.DB_NAME || 'virgo_db',
  port: parseInt(process.env.DB_PORT || '5432'),
});

// ─── GET /api/db/candidatos ────────────────────────────────
// Parámetros opcionales: ?estado=NUEVO&vacante=...&q=nombre
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const estado  = searchParams.get('estado');
  const vacante = searchParams.get('vacante');
  const q       = searchParams.get('q');
  const limit   = parseInt(searchParams.get('limit') || '500');

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
