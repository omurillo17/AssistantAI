import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'virgo_user',
  password: process.env.DB_PASSWORD || 'virgo_password_secure',
  database: process.env.DB_NAME || 'virgo_db',
  port: parseInt(process.env.DB_PORT || '5432'),
});

// ─── GET /api/db/mensajes ──────────────────────────────────
// Devuelve conversaciones activas para la bandeja
// Prioriza escalados, luego por último mensaje
export async function GET() {
  try {
    const res = await pool.query(`
      SELECT
        c.telefono,
        COALESCE(c.nombre_chat, c.nombre_solicitud, c.nombre_ine, c.nombre, 'Sin nombre') AS nombre,
        c.estado,
        c.escalado,
        c.escalation_reason,
        c.vacante_interes,
        c.nave_interes,
        (c.ultima_interaccion AT TIME ZONE 'America/Mexico_City') AS ultima_interaccion,
        mb.asignado_a,
        mb.mensajes_no_leidos,
        mb.ultimo_mensaje,
        mb.ultimo_mensaje_rol,
        (mb.ultimo_mensaje_at AT TIME ZONE 'America/Mexico_City') AS ultimo_mensaje_at,
        mb.activo AS bandeja_activa
      FROM candidatos c
      LEFT JOIN mensajes_bandeja mb ON mb.telefono = c.telefono
      WHERE c.escalado = TRUE
         OR (
           mb.activo = TRUE
           AND mb.ultimo_mensaje_at > NOW() - INTERVAL '24 hours'
         )
      ORDER BY
        c.escalado DESC,
        COALESCE(mb.mensajes_no_leidos, 0) DESC,
        COALESCE(mb.ultimo_mensaje_at, c.ultima_interaccion) DESC
      LIMIT 100
    `);

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
    const body = await request.json();
    const {
      telefono,
      ultimo_mensaje,
      ultimo_mensaje_rol = 'user',
      asignado_a,
      mensajes_no_leidos,
      activo,
    } = body;

    if (!telefono) {
      return NextResponse.json({ error: 'Falta el campo telefono' }, { status: 400 });
    }

    // Upsert en mensajes_bandeja
    const setClauses: string[] = ['updated_at = NOW()'];
    const values: any[] = [
      telefono,
      ultimo_mensaje ?? '',
      ultimo_mensaje_rol ?? 'user',
      asignado_a ?? null,
      mensajes_no_leidos ?? 0,
      activo ?? true
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
