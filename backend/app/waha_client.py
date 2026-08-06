"""Cliente HTTP hacia WAHA (WhatsApp HTTP API), reemplaza los nodos
`@devlikeapro/n8n-nodes-waha.WAHA` (Send Text, Start Typing) y los
httpRequest directos a WAHA (`GetInfo`, `DescargarMedia`) de los 3
workflows de chat. Mismo contrato REST que WAHA ya expone hoy (confirmado
contra la instancia viva: GET /api/contacts, GET /api/sessions)."""

import logging

import httpx

from app.config import ENV

logger = logging.getLogger("waha_client")


def _headers() -> dict[str, str]:
    return {"X-Api-Key": ENV.WAHA_API_KEY}


async def send_text(session: str, chat_id: str, text: str) -> None:
    url = f"{ENV.WAHA_BASE_URL}/api/sendText"
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, headers=_headers(), json={"session": session, "chatId": chat_id, "text": text})
        resp.raise_for_status()


async def start_typing(session: str, chat_id: str) -> None:
    url = f"{ENV.WAHA_BASE_URL}/api/startTyping"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, headers=_headers(), json={"session": session, "chatId": chat_id})
            resp.raise_for_status()
    except Exception:
        logger.exception("start_typing falló para session=%s chat_id=%s (no crítico)", session, chat_id)


async def get_contact(session: str, contact_id: str) -> dict:
    url = f"{ENV.WAHA_BASE_URL}/api/contacts"
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url, headers=_headers(), params={"contactId": contact_id, "session": session})
        resp.raise_for_status()
        return resp.json()


async def download_media(media_url: str) -> tuple[bytes, str]:
    """Descarga el binario de un adjunto de WAHA. Replica el nodo
    `DescargarMedia`: sustituye 'localhost' por el hostname real del
    contenedor WAHA (media.url que manda WAHA en el webhook apunta a
    localhost, válido solo dentro del propio contenedor de WAHA)."""
    fixed_url = media_url.replace("localhost", "waha")
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(fixed_url, headers=_headers())
        resp.raise_for_status()
        content_type = resp.headers.get("Content-Type", "application/octet-stream")
        return resp.content, content_type
