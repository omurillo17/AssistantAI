import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

import { pool } from '@/lib/db';
import { enviarMensajeCandidato, enviarImagenCandidato } from '@/lib/waha';
import { getSession } from '@/lib/auth';
import { getCandidateDisplayName } from '@/lib/formatters';

// ─── GET /api/db/mensajes/[telefono] ──────────────────────
// Devuelve historial de conversation_history para ese candidato
// y resetea mensajes_no_leidos a 0
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ telefono: string }> }
) {
  if (!(await getSession(_request))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
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
       ORDER BY conversation_history.timestamp ASC, conversation_history.id ASC
       LIMIT 200`,
      [telefono]
    );

    // Info del candidato
    const candRes = await pool.query(
      // Nombres crudos: el que se muestra lo arma getCandidateDisplayName()
      // más abajo, igual que en la bandeja (ver /api/db/mensajes).
      `SELECT c.id as candidato_id, c.telefono,
              c.nombre_ine, c.nombre_solicitud, c.nombre_constancia, c.nombre_chat, c.nombre,
              c.estado, c.escalado, c.escalation_reason, c.vacante_interes, c.nave_interes, c.correo,
              COALESCE(mb.asignado_a_id, c.asignado_a_id) AS asignado_a_id
       FROM candidatos c
       LEFT JOIN mensajes_bandeja mb ON mb.candidato_id = c.id
       WHERE c.telefono = $1 ORDER BY c.updated_at DESC LIMIT 1`,
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

    const candidato = candRes.rows[0]
      ? { ...candRes.rows[0], nombre: getCandidateDisplayName(candRes.rows[0]) }
      : null;

    return NextResponse.json({
      candidato,
      mensajes: histRes.rows,
    });
  } catch (err) {
    console.error('Error fetching chat history:', err);
    return NextResponse.json({ error: 'Error al obtener historial' }, { status: 500 });
  }
}

// ─── POST /api/db/mensajes/[telefono] ─────────────────────
// Envía un mensaje de WhatsApp via WAHA y lo guarda en conversation_history y la cola (Outbox)
// Body: { texto, asignado_a_id? }
export async function POST(
  request: Request,
  { params }: { params: Promise<{ telefono: string }> }
) {
  if (!(await getSession(request))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
  const { telefono } = await params;

  try {
    const body = await request.json();
    const { texto, media_url, asignado_a_id } = body;

    if (!texto?.trim() && !media_url?.trim()) {
      return NextResponse.json({ error: 'El mensaje no puede estar vacío' }, { status: 400 });
    }

    let savedMsg;
    try {
      if (media_url?.trim()) {
        savedMsg = await enviarImagenCandidato(telefono, media_url, texto || '📷 Imagen adjunta', asignado_a_id);
      } else {
        savedMsg = await enviarMensajeCandidato(telefono, texto, asignado_a_id);
      }
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
