import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

import { pool } from '@/lib/db';

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
              timestamp
       FROM conversation_history
       WHERE telefono = $1
         AND role IN ('user', 'assistant', 'user_temp')
         AND (
           (content IS NOT NULL AND content != '') 
           OR 
           (media_url IS NOT NULL AND media_url != '')
           OR
           message_type IN ('image', 'video', 'document', 'audio', 'ptt', 'voice', 'sticker')
         )
         AND NOT (COALESCE(content, '') LIKE '[SISTEMA:%')
       ORDER BY conversation_history.timestamp ASC
       LIMIT 200`,
      [telefono]
    );

    // Info del candidato
    const candRes = await pool.query(
      `SELECT id as candidato_id, telefono, COALESCE(NULLIF(TRIM(nombre_ine),''), NULLIF(TRIM(nombre_solicitud),''), NULLIF(TRIM(nombre_constancia),''), NULLIF(TRIM(nombre_chat),''), NULLIF(TRIM(nombre),''), telefono) AS nombre,
              estado, escalado, escalation_reason, vacante_interes, nave_interes, correo
       FROM candidatos WHERE telefono = $1 ORDER BY updated_at DESC LIMIT 1`,
      [telefono]
    );

    const candidatoId = candRes.rows[0]?.candidato_id;

    // Solo resetear si NO es modo preview
    const { searchParams } = new URL(_request.url);
    const isPreview = searchParams.get('preview') === 'true';

    if (!isPreview && candidatoId) {
      await pool.query(
        `UPDATE mensajes_bandeja SET mensajes_no_leidos = 0 WHERE candidato_id = $1`,
        [candidatoId]
      );
    }

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
// Envía un mensaje de WhatsApp via WAHA y lo guarda en conversation_history y la cola (Outbox)
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

    const chatId = telefono.includes('@') ? telefono : `${telefono}@c.us`;

    // 1. Buscar candidato_id
    const candRes = await pool.query(
      `SELECT id FROM candidatos WHERE telefono = $1 ORDER BY updated_at DESC LIMIT 1`,
      [telefono]
    );
    const candidato_id = candRes.rows[0]?.id || null;

    if (!candidato_id) {
        return NextResponse.json({ error: 'Candidato no encontrado en la base de datos' }, { status: 404 });
    }

    // 2. Guardar en conversation_history (Para que UI lo vea instantáneo)
    const savedMsg = await pool.query(
      `INSERT INTO conversation_history (telefono, candidato_id, role, content, message_type, timestamp)
       VALUES ($1, $2, 'assistant', $3, 'text', NOW())
       RETURNING id, role, content, message_type, timestamp`,
      [telefono, candidato_id, texto.trim()]
    );

    // 3. Actualizar mensajes_bandeja
    await pool.query(
      `INSERT INTO mensajes_bandeja (candidato_id, telefono, ultimo_mensaje, ultimo_mensaje_rol, asignado_a, mensajes_no_leidos, activo)
       VALUES ($1, $2, $3, 'assistant', $4, 0, TRUE)
       ON CONFLICT (candidato_id) DO UPDATE SET
         ultimo_mensaje = $3,
         ultimo_mensaje_rol = 'assistant',
         ultimo_mensaje_at = NOW(),
         asignado_a = COALESCE($4, mensajes_bandeja.asignado_a),
         updated_at = NOW()`,
      [candidato_id, telefono, texto.trim(), asignado_a || null]
    );

    // 4. Guardar en cola_mensajes (Outbox Pattern)
    const colaRes = await pool.query(
      `INSERT INTO cola_mensajes (telefono, texto, asignado_a, estado)
       VALUES ($1, $2, $3, 'PENDIENTE')
       RETURNING id`,
      [chatId, texto.trim(), asignado_a || null]
    );
    const cola_id = colaRes.rows[0].id;

    // 5. Intentar Enviar via WAHA Inmediatamente (Fallo seguro)
    try {
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
        console.error('WAHA soft error:', errText);
        // Dejarlo como pendiente, actualizar detalle error
        await pool.query(`UPDATE cola_mensajes SET error_detalle = $1 WHERE id = $2`, [errText, cola_id]);
      } else {
        // Éxito, marcar como enviado
        await pool.query(`UPDATE cola_mensajes SET estado = 'ENVIADO', updated_at = NOW() WHERE id = $1`, [cola_id]);
      }
    } catch (fetchErr: any) {
      console.error('WAHA fetch error:', fetchErr.message);
      // Falla de red, WAHA apagado. Se queda como pendiente
      await pool.query(`UPDATE cola_mensajes SET error_detalle = $1 WHERE id = $2`, [fetchErr.message, cola_id]);
    }

    // SIEMPRE retornamos ok: true a la UI para mantener el Optimistic UI
    return NextResponse.json({
      ok: true,
      mensaje: savedMsg.rows[0],
      queued: true
    });

  } catch (err) {
    console.error('Error sending message:', err);
    return NextResponse.json({ error: 'Error interno al procesar mensaje' }, { status: 500 });
  }
}
