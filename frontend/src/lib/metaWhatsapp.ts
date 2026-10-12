/**
 * Cliente para Meta Cloud API (WhatsApp Business Platform Oficial) en el frontend.
 * Permite enviar mensajes de texto e imágenes directamente a la Graph API de Meta.
 */

export function normalizarNumeroMexico(telefono: string): string {
  const digits = telefono.replace(/\D/g, '');
  if (digits.startsWith('521') && digits.length === 13) {
    return '52' + digits.slice(3);
  }
  return digits;
}

export async function enviarMensajeMeta(
  toPhone: string,
  text: string,
  phoneNumberId?: string,
  accessToken?: string
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const token = accessToken || process.env.META_WA_ACCESS_TOKEN;
  const phoneId = phoneNumberId || process.env.META_WA_PHONE_NUMBER_ID;

  if (!token || !phoneId) {
    return { ok: false, error: 'Credenciales de Meta Cloud API no configuradas en frontend' };
  }

  const cleanTo = normalizarNumeroMexico(toPhone);
  const url = `https://graph.facebook.com/v22.0/${phoneId}/messages`;

  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanTo,
    type: 'text',
    text: { preview_url: false, body: text.trim() },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[metaWhatsapp] Error enviando mensaje a ${cleanTo}:`, errText);
      return { ok: false, error: errText };
    }

    const data = await res.json();
    const msgId = data?.messages?.[0]?.id;
    return { ok: true, messageId: msgId };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[metaWhatsapp] Excepción enviando a ${cleanTo}:`, msg);
    return { ok: false, error: msg };
  }
}

export async function enviarImagenMeta(
  toPhone: string,
  imageUrl: string,
  caption?: string,
  phoneNumberId?: string,
  accessToken?: string
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const token = accessToken || process.env.META_WA_ACCESS_TOKEN;
  const phoneId = phoneNumberId || process.env.META_WA_PHONE_NUMBER_ID;

  if (!token || !phoneId) {
    return { ok: false, error: 'Credenciales de Meta Cloud API no configuradas en frontend' };
  }

  const cleanTo = normalizarNumeroMexico(toPhone);
  const url = `https://graph.facebook.com/v22.0/${phoneId}/messages`;

  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanTo,
    type: 'image',
    image: {
      link: imageUrl,
      caption: caption || '',
    },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[metaWhatsapp] Error enviando imagen a ${cleanTo}:`, errText);
      return { ok: false, error: errText };
    }

    const data = await res.json();
    const msgId = data?.messages?.[0]?.id;
    return { ok: true, messageId: msgId };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[metaWhatsapp] Excepción enviando imagen a ${cleanTo}:`, msg);
    return { ok: false, error: msg };
  }
}
