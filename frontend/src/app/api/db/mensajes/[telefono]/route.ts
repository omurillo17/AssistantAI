import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'virgo_user',
  password: process.env.DB_PASSWORD || 'virgo_password_secure',
  database: process.env.DB_NAME || 'virgo_db',
  port: parseInt(process.env.DB_PORT || '5432'),
});

const WAHA_BASE = process.env.WAHA_BASE_URL || 'http://localhost:3000';
const WAHA_API_KEY = process.env.WAHA_API_KEY || 'virgo_secret_key';
const WAHA_SESSION = process.env.WAHA_SESSION || 'default';

// ─── GET /api/db/mensajes/[telefono] ──────────────────────
// Devuelve historial de conversation_history para ese candidato
// y resetea mensajes_no_leidos a 0
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ telefono: string }> }
) {
  const { telefono } = await params;

  if (!telefono) {
    return NextResponse.json({ error: 'Falta el parámetro telefono' }, { status: 400 });
  }

  try {
    // Obtener historial de conversación
    const histRes = await pool.query(
      `SELECT id, role, content, message_type, media_url, 
              (timestamp AT TIME ZONE 'America/Mexico_City') AS timestamp
       FROM conversation_history
       WHERE telefono = $1
         AND role IN ('user', 'assistant', 'user_temp')
         AND (content IS NOT NULL AND content != '')
         AND NOT (content LIKE '[SISTEMA:%')
       ORDER BY conversation_history.timestamp ASC
       LIMIT 200`,
      [telefono]
    );

    // Resetear mensajes no leídos
    await pool.query(
      `UPDATE mensajes_bandeja SET mensajes_no_leidos = 0 WHERE telefono = $1`,
      [telefono]
    );

    // Info del candidato
    const candRes = await pool.query(
      `SELECT telefono, COALESCE(nombre_chat, nombre_solicitud, nombre_ine, nombre, 'Sin nombre') AS nombre,
              estado, escalado, escalation_reason, vacante_interes, nave_interes, correo
       FROM candidatos WHERE telefono = $1 LIMIT 1`,
      [telefono]
    );

    return NextResponse.json({
      candidato: candRes.rows[0] || null,
      mensajes: histRes.rows,
    });
  } catch (err) {
    console.error('Error fetching chat history:', err);
    return NextResponse.json({ error: 'Error al obtener historial' }, { status: 500 });
  }
}

// ─── POST /api/db/mensajes/[telefono] ─────────────────────
// Envía un mensaje de WhatsApp via WAHA y lo guarda en conversation_history
// Body: { texto, asignado_a? }
export async function POST(
  request: Request,
  { params }: { params: Promise<{ telefono: string }> }
) {
  const { telefono } = await params;

  try {
    const body = await request.json();
    const { texto, asignado_a } = body;

    if (!texto?.trim()) {
      return NextResponse.json({ error: 'El mensaje no puede estar vacío' }, { status: 400 });
    }

    // Formatear número para WAHA (chatId = telefono@c.us)
    const chatId = telefono.includes('@') ? telefono : `${telefono}@c.us`;

    // 1. Enviar via WAHA
    const wahaRes = await fetch(`${WAHA_BASE}/api/sendText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': WAHA_API_KEY,
      },
      body: JSON.stringify({
        session: WAHA_SESSION,
        chatId,
        text: texto.trim(),
      }),
    });

    if (!wahaRes.ok) {
      const errText = await wahaRes.text();
      console.error('WAHA error:', errText);
      return NextResponse.json({ error: 'Error al enviar mensaje por WhatsApp', detail: errText }, { status: 502 });
    }

    // 2. Buscar candidato_id
    const candRes = await pool.query(
      `SELECT id FROM candidatos WHERE telefono = $1 LIMIT 1`,
      [telefono]
    );
    const candidato_id = candRes.rows[0]?.id || null;

    // 3. Guardar en conversation_history
    const savedMsg = await pool.query(
      `INSERT INTO conversation_history (telefono, candidato_id, role, content, message_type, timestamp)
       VALUES ($1, $2, 'assistant', $3, 'text', NOW() AT TIME ZONE 'America/Mexico_City')
       RETURNING id, role, content, message_type, (timestamp AT TIME ZONE 'America/Mexico_City') AS timestamp`,
      [telefono, candidato_id, texto.trim()]
    );

    // 4. Actualizar mensajes_bandeja
    await pool.query(
      `INSERT INTO mensajes_bandeja (telefono, ultimo_mensaje, ultimo_mensaje_rol, asignado_a, mensajes_no_leidos, activo)
       VALUES ($1, $2, 'assistant', $3, 0, TRUE)
       ON CONFLICT (telefono) DO UPDATE SET
         ultimo_mensaje = $2,
         ultimo_mensaje_rol = 'assistant',
         ultimo_mensaje_at = NOW(),
         asignado_a = COALESCE($3, mensajes_bandeja.asignado_a),
         updated_at = NOW()`,
      [telefono, texto.trim(), asignado_a || null]
    );

    return NextResponse.json({
      ok: true,
      mensaje: savedMsg.rows[0],
    });
  } catch (err) {
    console.error('Error sending message:', err);
    return NextResponse.json({ error: 'Error interno al enviar mensaje' }, { status: 500 });
  }
}
