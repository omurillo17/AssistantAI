/**
 * Servicio Centralizado de Mensajería de WhatsApp (Meta Cloud API + Fallback WAHA).
 * Unifica el envío de texto, imágenes, outbox y notificaciones a reclutadores
 * eliminando código repetido en toda la aplicación.
 */

import { pool } from '@/lib/db';
import { firmarRutaUpload } from '@/lib/uploadToken';
import { enviarMensajeMeta, enviarImagenMeta, normalizarNumeroMexico } from '@/lib/metaWhatsapp';

export const getWahaBase = () => process.env.WAHA_BASE_URL || process.env.WAHA_URL || 'http://localhost:3000';
export const getWahaApiKey = () => process.env.WAHA_API_KEY || '';
export const getWahaSession = () => process.env.WAHA_SESSION || 'default';

export const WAHA_BASE = getWahaBase();
export const WAHA_API_KEY = getWahaApiKey();
export const WAHA_SESSION = getWahaSession();

export interface EnvioResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  provider: 'meta' | 'waha' | 'none';
}

export function normalizarChatIdWaha(telefono: string): string {
  let raw = telefono.trim();
  let suffix = '@c.us';
  if (raw.includes('@')) {
    const parts = raw.split('@');
    raw = parts[0];
    suffix = `@${parts[1]}`;
  }
  const digits = raw.replace(/\D/g, '');
  if (suffix === '@lid' || digits.length > 13) {
    return `${digits}@lid`;
  }
  if (digits.length === 10) {
    return `521${digits}@c.us`;
  }
  if (digits.startsWith('52') && digits.length === 12 && !digits.startsWith('521')) {
    return `521${digits.slice(2)}@c.us`;
  }
  return `${digits}@c.us`;
}

export async function resolverChatIdDestino(telefono: string): Promise<string> {
  const base = normalizarChatIdWaha(telefono);
  if (base.endsWith('@lid')) {
    return base;
  }
  const digits = telefono.replace(/\D/g, '');
  if (!digits || digits.length < 10) return base;

  const alt = digits.startsWith('521') && digits.length === 13
    ? '52' + digits.slice(3)
    : digits.startsWith('52') && digits.length === 12
    ? '521' + digits.slice(2)
    : digits;
  const diez = digits.slice(-10);

  try {
    const res = await pool.query(
      `SELECT lid FROM lid_telefono WHERE telefono IN ($1, $2, $3) ORDER BY updated_at DESC LIMIT 1`,
      [digits, alt, diez]
    );
    if (res.rows.length > 0 && res.rows[0].lid) {
      return `${res.rows[0].lid}@lid`;
    }
  } catch (err) {
    console.warn('[messagingService] Error consultando lid_telefono:', err);
  }
  return base;
}

/**
 * POST a WAHA con timeout. Devuelve el resultado si WAHA aceptó el envío, o
 * null si falló (el llamador decide si cae a Meta).
 */
async function postWaha(endpoint: 'sendText' | 'sendImage', payload: Record<string, unknown>): Promise<EnvioResult | null> {
  try {
    const wahaRes = await fetch(`${WAHA_BASE}/api/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': WAHA_API_KEY,
      },
      body: JSON.stringify({ session: WAHA_SESSION, ...payload }),
      signal: AbortSignal.timeout(15000),
    });

    if (wahaRes.ok) {
      const data = await wahaRes.json().catch(() => ({}));
      return { ok: true, messageId: data?.id, provider: 'waha' };
    }
    const errText = await wahaRes.text().catch(() => '');
    console.warn(`[messagingService] WAHA ${endpoint} error:`, errText);
  } catch (wahaErr) {
    console.warn(`[messagingService] WAHA ${endpoint} fetch error:`, wahaErr);
  }
  return null;
}

/**
 * Envío de bajo nivel de mensaje de texto a cualquier destinatario (WAHA o Meta Cloud API).
 */
export async function enviarMensajeDirecto(
  telefono: string,
  texto: string,
  options?: { phoneNumberId?: string; preferWaha?: boolean }
): Promise<EnvioResult> {
  const textoLimpio = texto.trim();
  const cleanTo = normalizarNumeroMexico(telefono);
  const chatId = await resolverChatIdDestino(telefono);

  const provider = (process.env.WHATSAPP_PROVIDER || 'waha').toLowerCase();
  const useWahaFirst = options?.preferWaha || provider === 'waha' || !process.env.META_WA_ACCESS_TOKEN;

  if (useWahaFirst && WAHA_BASE) {
    const wahaRes = await postWaha('sendText', { chatId, text: textoLimpio });
    if (wahaRes) return wahaRes;
  }

  if (process.env.META_WA_ACCESS_TOKEN && (options?.phoneNumberId || process.env.META_WA_PHONE_NUMBER_ID)) {
    const metaRes = await enviarMensajeMeta(cleanTo, textoLimpio, options?.phoneNumberId);
    if (metaRes.ok) {
      return { ok: true, messageId: metaRes.messageId, provider: 'meta' };
    }
    console.error(`[messagingService] Meta error enviando texto a ${cleanTo}:`, metaRes.error);
    if (useWahaFirst) {
      return { ok: false, error: metaRes.error, provider: 'meta' };
    }
  }

  if (!useWahaFirst && WAHA_BASE) {
    const wahaRes = await postWaha('sendText', { chatId, text: textoLimpio });
    if (wahaRes) return wahaRes;
  }

  return { ok: false, error: 'Credenciales no configuradas o servicio de mensajería no disponible', provider: 'none' };
}

/**
 * Envío de bajo nivel de imagen con caption a cualquier destinatario vía WAHA o Meta Cloud API.
 */
export async function enviarImagenDirecta(
  telefono: string,
  mediaUrl: string,
  caption?: string,
  options?: { phoneNumberId?: string; preferWaha?: boolean }
): Promise<EnvioResult> {
  const cleanTo = normalizarNumeroMexico(telefono);
  const chatId = await resolverChatIdDestino(telefono);

  // Las rutas de /uploads exigen sesión (src/proxy.ts) salvo con token firmado
  // en `?t=`; ni WAHA ni Meta llevan cookie, así que ambos necesitan la ruta
  // firmada (antes WAHA la pedía sin token y recibía el redirect al login).
  let fullMediaUrl = mediaUrl;
  let wahaMediaUrl = mediaUrl;
  if (mediaUrl.startsWith('/')) {
    const token = await firmarRutaUpload(mediaUrl);
    if (!token) {
      throw new Error('Falta INTERNAL_API_KEY o JWT_SECRET para firmar ruta de adjunto');
    }
    const rutaFirmada = `${mediaUrl}?t=${encodeURIComponent(token)}`;
    const publicBase = process.env.PUBLIC_APP_URL || 'https://sofia-virgo.seventeencorp.com';
    fullMediaUrl = `${publicBase}${rutaFirmada}`;
    wahaMediaUrl = `http://frontend:3001${rutaFirmada}`;
  }
  const wahaPayload = { chatId, file: { url: wahaMediaUrl }, caption: caption || '' };

  const provider = (process.env.WHATSAPP_PROVIDER || 'waha').toLowerCase();
  const useWahaFirst = options?.preferWaha || provider === 'waha' || !process.env.META_WA_ACCESS_TOKEN;

  if (useWahaFirst && WAHA_BASE) {
    const wahaRes = await postWaha('sendImage', wahaPayload);
    if (wahaRes) return wahaRes;
  }

  if (process.env.META_WA_ACCESS_TOKEN && (options?.phoneNumberId || process.env.META_WA_PHONE_NUMBER_ID)) {
    const metaRes = await enviarImagenMeta(cleanTo, fullMediaUrl, caption, options?.phoneNumberId);
    if (metaRes.ok) {
      return { ok: true, messageId: metaRes.messageId, provider: 'meta' };
    }
    console.error(`[messagingService] Meta sendImage error para ${cleanTo}:`, metaRes.error);
    if (useWahaFirst) {
      return { ok: false, error: metaRes.error, provider: 'meta' };
    }
  }

  if (!useWahaFirst && WAHA_BASE) {
    const wahaRes = await postWaha('sendImage', wahaPayload);
    if (wahaRes) return wahaRes;
  }

  return { ok: false, error: 'Credenciales de mensajería no disponibles para enviar imagen', provider: 'none' };
}

/**
 * Notificación interna para reclutadores.
 * Envía por WhatsApp y registra en la tabla de notificaciones.
 */
export async function enviarNotificacionReclutador(
  telefonoReclutador: string,
  mensaje: string,
  reclutadorId?: string | null
): Promise<EnvioResult> {
  if (reclutadorId) {
    try {
      await pool.query(
        'INSERT INTO notificaciones (reclutador_id, mensaje) VALUES ($1, $2)',
        [reclutadorId, mensaje]
      );
    } catch (dbErr) {
      console.error('[messagingService] Error guardando notificación en BD:', dbErr);
    }
  }

  if (!telefonoReclutador) {
    return { ok: false, error: 'Teléfono de reclutador vacío', provider: 'none' };
  }

  return enviarMensajeDirecto(telefonoReclutador, mensaje);
}

/**
 * Envío de mensaje a un candidato desde el CRM o workflows.
 * Registra historial en conversation_history, actualiza bandeja y maneja la cola (Outbox).
 */
export async function enviarMensajeCandidato(telefono: string, texto: string, asignadoA?: string | null) {
  const textoLimpio = texto.trim();
  const chatId = normalizarChatIdWaha(telefono);

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

  const result = await enviarMensajeDirecto(telefono, textoLimpio);
  if (result.ok) {
    await pool.query(`UPDATE cola_mensajes SET estado = 'ENVIADO', updated_at = NOW() WHERE id = $1`, [cola_id]);
  } else {
    await pool.query(`UPDATE cola_mensajes SET error_detalle = $1 WHERE id = $2`, [result.error || 'Error desconocido', cola_id]);
  }

  return savedMsg.rows[0];
}

/**
 * Envío de imagen a un candidato desde el CRM.
 */
export async function enviarImagenCandidato(telefono: string, mediaUrl: string, caption?: string, asignadoA?: string | null) {
  const candRes = await pool.query(
    `SELECT id FROM candidatos WHERE telefono = $1 ORDER BY updated_at DESC LIMIT 1`,
    [telefono]
  );
  const candidato_id = candRes.rows[0]?.id || null;
  if (!candidato_id) {
    throw new Error('Candidato no encontrado en la base de datos');
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

  await enviarImagenDirecta(telefono, mediaUrl, caption);
  return savedMsg.rows[0];
}
