"""Cliente HTTP hacia Meta Cloud API (WhatsApp Business Platform / Graph API).
Permite enviar mensajes de texto y descargar multimedia usando las credenciales
oficiales de Meta."""

from __future__ import annotations

import logging
import httpx

from app import throttle
from app.config import ENV

logger = logging.getLogger("meta_client")

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=30.0)
    return _client


async def close_client() -> None:
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
        _client = None


def _headers() -> dict[str, str]:
    token = ENV.META_WA_ACCESS_TOKEN
    if not token:
        logger.error("META_WA_ACCESS_TOKEN no configurado en entorno")
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


from app.utils.phone import normalizar_numero_meta


async def send_text(phone_number_id: str | None, to_phone: str, text: str) -> dict:
    """Envía un mensaje de texto por Meta Cloud API aplicando el regulador de ritmo."""
    await throttle.esperar_turno()

    pid = phone_number_id or ENV.META_WA_PHONE_NUMBER_ID
    if not pid:
        raise ValueError("No se especificó phone_number_id para enviar por Meta API")

    clean_to = normalizar_numero_meta(to_phone)

    url = f"https://graph.facebook.com/v22.0/{pid}/messages"
    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": clean_to,
        "type": "text",
        "text": {"preview_url": False, "body": text},
    }

    client = _get_client()
    logger.info("meta_client.send_text: enviando mensaje a %s (original=%s) via phone_number_id=%s", clean_to, to_phone, pid)
    resp = await client.post(url, headers=_headers(), json=payload)
    if resp.status_code >= 400:
        logger.error("meta_client.send_text falló [%d]: %s", resp.status_code, resp.text)
        resp.raise_for_status()
    return resp.json()


async def download_media(media_id: str) -> tuple[bytes, str]:
    """Obtiene y descarga un archivo multimedia desde Meta Cloud API."""
    client = _get_client()
    url = f"https://graph.facebook.com/v22.0/{media_id}"
    resp = await client.get(url, headers=_headers())
    resp.raise_for_status()
    data = resp.json()
    download_url = data.get("url")
    mime_type = data.get("mime_type", "application/octet-stream")
    if not download_url:
        raise ValueError(f"Meta no devolvió URL de descarga para media_id={media_id}")

    media_resp = await client.get(download_url, headers=_headers())
    media_resp.raise_for_status()
    return media_resp.content, mime_type
