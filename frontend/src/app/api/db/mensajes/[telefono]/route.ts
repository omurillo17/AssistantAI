import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

import { pool } from '@/lib/db';
import { enviarMensajeCandidato } from '@/lib/waha';

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

    let savedMsg;
    try {
      savedMsg = await enviarMensajeCandidato(telefono, texto, asignado_a);
    } catch (sendErr) {
      const message = sendErr instanceof Error ? sendErr.message : String(sendErr);
      if (message === 'Candidato no encontrado en la base de datos') {
        return NextResponse.json({ error: message }, { status: 404 });
      }
      throw sendErr;
    }

    // SIEMPRE retornamos ok: true a la UI para mantener el Optimistic UI
    return NextResponse.json({
      ok: true,
      mensaje: savedMsg,
      queued: true
    });

  } catch (err) {
    console.error('Error sending message:', err);
    return NextResponse.json({ error: 'Error interno al procesar mensaje' }, { status: 500 });
  }
}
