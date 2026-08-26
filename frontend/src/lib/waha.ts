import { pool } from '@/lib/db';
import { firmarRutaUpload } from '@/lib/uploadToken';

// Configuración única de WAHA para todo el backend.
// La API key SIEMPRE debe venir del entorno; no hay valor de respaldo.
export const WAHA_BASE = process.env.WAHA_BASE_URL || process.env.WAHA_URL || 'http://localhost:3000';
export const WAHA_API_KEY = process.env.WAHA_API_KEY || '';
export const WAHA_SESSION = process.env.WAHA_SESSION || 'default';

if (!WAHA_API_KEY) {
  console.warn('[seguridad] WAHA_API_KEY no está configurada; las llamadas a WAHA fallarán si el servicio exige API key.');
}

// Envía un mensaje de WhatsApp a un candidato via WAHA y lo registra en
// conversation_history / mensajes_bandeja / cola_mensajes (Outbox pattern).
// Compartido por el endpoint de mensajes manuales y por acciones automáticas del CRM.
export async function enviarMensajeCandidato(telefono: string, texto: string, asignadoA?: string | null) {
  const textoLimpio = texto.trim();
  const chatId = telefono.includes('@') ? telefono : `${telefono}@c.us`;

  const candRes = await pool.query(
    `SELECT id FROM candidatos WHERE telefono = $1 ORDER BY updated_at DESC LIMIT 1`,
    [telefono]
  );
  const candidato_id = candRes.rows[0]?.id || null;
  if (!candidato_id) {
    throw new Error('Candidato no encontrado en la base de datos');
  }

  const savedMsg = await pool.query(
    `INSERT INTO conversation_history (telefono, candidato_id, role, content, message_type, timestamp)
     VALUES ($1, $2, 'assistant', $3, 'text', NOW())
     RETURNING id, role, content, message_type, timestamp`,
    [telefono, candidato_id, textoLimpio]
  );

  await pool.query(
    `INSERT INTO mensajes_bandeja (candidato_id, telefono, ultimo_mensaje, ultimo_mensaje_rol, asignado_a_id, mensajes_no_leidos, activo)
     VALUES ($1, $2, $3, 'assistant', $4, 0, TRUE)
     ON CONFLICT (candidato_id) DO UPDATE SET
       ultimo_mensaje = $3,
       ultimo_mensaje_rol = 'assistant',
       ultimo_mensaje_at = NOW(),
       asignado_a_id = COALESCE($4, mensajes_bandeja.asignado_a_id),
       updated_at = NOW()`,
    [candidato_id, telefono, textoLimpio, asignadoA || null]
  );

  const colaRes = await pool.query(
    `INSERT INTO cola_mensajes (telefono, texto, asignado_a, estado)
     VALUES ($1, $2, $3, 'PENDIENTE')
     RETURNING id`,
    [chatId, textoLimpio, asignadoA || null]
  );
  const cola_id = colaRes.rows[0].id;

  try {
    const wahaRes = await fetch(`${WAHA_BASE}/api/sendText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': WAHA_API_KEY,
      },
      body: JSON.stringify({ session: WAHA_SESSION, chatId, text: textoLimpio }),
    });

    if (!wahaRes.ok) {
      const errText = await wahaRes.text();
      console.error('WAHA soft error:', errText);
      await pool.query(`UPDATE cola_mensajes SET error_detalle = $1 WHERE id = $2`, [errText, cola_id]);
    } else {
      await pool.query(`UPDATE cola_mensajes SET estado = 'ENVIADO', updated_at = NOW() WHERE id = $1`, [cola_id]);
    }
  } catch (fetchErr: unknown) {
    const message = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    console.error('WAHA fetch error:', message);
    await pool.query(`UPDATE cola_mensajes SET error_detalle = $1 WHERE id = $2`, [message, cola_id]);
  }

  return savedMsg.rows[0];
}

export async function enviarImagenCandidato(telefono: string, mediaUrl: string, caption?: string, asignadoA?: string | null) {
  const chatId = telefono.includes('@') ? telefono : `${telefono}@c.us`;

  const candRes = await pool.query(
    `SELECT id FROM candidatos WHERE telefono = $1 ORDER BY updated_at DESC LIMIT 1`,
    [telefono]
  );
  const candidato_id = candRes.rows[0]?.id || null;
  if (!candidato_id) {
    throw new Error('Candidato no encontrado en la base de datos');
  }

  // Si la URL es relativa (/uploads/...), la convertimos a absoluta accesible
  // internamente por WAHA o frontend. Se le añade un token firmado de vida
  // corta porque /uploads ya no es público: WAHA descarga el archivo sin
  // cookie, y sin el token proxy.ts lo mandaría a /login (ver uploadToken.ts).
  let fullMediaUrl = mediaUrl;
  if (mediaUrl.startsWith('/')) {
    const token = await firmarRutaUpload(mediaUrl);
    if (!token) {
      throw new Error(
        'No se puede firmar la URL del adjunto: falta INTERNAL_API_KEY (o JWT_SECRET) en el entorno del frontend.'
      );
    }
    fullMediaUrl = `http://frontend:3001${mediaUrl}?t=${encodeURIComponent(token)}`;
  }

  const savedMsg = await pool.query(
    `INSERT INTO conversation_history (telefono, candidato_id, role, content, message_type, media_url, timestamp)
     VALUES ($1, $2, 'assistant', $3, 'image', $4, NOW())
     RETURNING id, role, content, message_type, media_url, timestamp`,
    [telefono, candidato_id, caption || '📷 Imagen adjunta', mediaUrl]
  );

  await pool.query(
    `INSERT INTO mensajes_bandeja (candidato_id, telefono, ultimo_mensaje, ultimo_mensaje_rol, asignado_a_id, mensajes_no_leidos, activo)
     VALUES ($1, $2, $3, 'assistant', $4, 0, TRUE)
     ON CONFLICT (candidato_id) DO UPDATE SET
       ultimo_mensaje = $3,
       ultimo_mensaje_rol = 'assistant',
       ultimo_mensaje_at = NOW(),
       asignado_a_id = COALESCE($4, mensajes_bandeja.asignado_a_id),
       updated_at = NOW()`,
    [candidato_id, telefono, caption || '📷 Imagen adjunta', asignadoA || null]
  );

  try {
    const wahaRes = await fetch(`${WAHA_BASE}/api/sendImage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': WAHA_API_KEY,
      },
      body: JSON.stringify({
        session: WAHA_SESSION,
        chatId,
        file: { url: fullMediaUrl },
        caption: caption || ""
      }),
    });

    if (!wahaRes.ok) {
      console.error('WAHA sendImage soft error:', await wahaRes.text());
    }
  } catch (fetchErr: unknown) {
    console.error('WAHA sendImage fetch error:', fetchErr);
  }

  return savedMsg.rows[0];
}
