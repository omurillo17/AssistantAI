import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'virgo_user',
  password: process.env.DB_PASSWORD || 'virgo_password_secure',
  database: process.env.DB_NAME || 'virgo_db',
  port: parseInt(process.env.DB_PORT || '5432'),
});

// ─── GET /api/db/candidato?telefono=xxx ───────────────────
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const telefono = searchParams.get('telefono');

  if (!telefono) {
    return NextResponse.json({ error: 'Falta el parámetro telefono' }, { status: 400 });
  }

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
  try {
    const body = await request.json();
    const { telefono, estado, notas, vacante_interes, escalado, escalation_reason } = body;

    if (!telefono) {
      return NextResponse.json({ error: 'Falta el campo telefono' }, { status: 400 });
    }

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

