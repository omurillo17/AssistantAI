"""Cliente HTTP hacia WAHA (WhatsApp HTTP API), reemplaza los nodos
`@devlikeapro/n8n-nodes-waha.WAHA` (Send Text, Start Typing) y los
httpRequest directos a WAHA (`GetInfo`, `DescargarMedia`) de los 3
workflows de chat. Mismo contrato REST que WAHA ya expone hoy (confirmado
contra la instancia viva: GET /api/contacts, GET /api/sessions)."""

import logging

import httpx

from app import throttle
from app.config import ENV

logger = logging.getLogger("waha_client")


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
    return {"X-Api-Key": ENV.WAHA_API_KEY}


async def send_text(session: str, chat_id: str, text: str) -> None:
    """Único punto de salida de mensajes de WhatsApp, y por eso el sitio donde
    se aplica el regulador de ritmo (ver app/throttle.py): así ninguna ruta
    -- chat, recordatorios, alertas -- puede saltarse el límite por olvido."""
    await throttle.esperar_turno()
    url = f"{ENV.WAHA_BASE_URL}/api/sendText"
    client = _get_client()
    resp = await client.post(url, headers=_headers(), json={"session": session, "chatId": chat_id, "text": text})
    resp.raise_for_status()


async def start_typing(session: str, chat_id: str) -> None:
    url = f"{ENV.WAHA_BASE_URL}/api/startTyping"
    try:
        client = _get_client()
        resp = await client.post(url, headers=_headers(), json={"session": session, "chatId": chat_id}, timeout=10.0)
        resp.raise_for_status()
    except Exception:
        logger.exception("start_typing falló para session=%s chat_id=%s (no crítico)", session, chat_id)


async def get_contact(session: str, contact_id: str) -> dict:
    url = f"{ENV.WAHA_BASE_URL}/api/contacts"
    try:
        client = _get_client()
        resp = await client.get(url, headers=_headers(), params={"contactId": contact_id, "session": session}, timeout=15.0)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.warning("get_contact falló para session=%s contact_id=%s: %s (se usa fallback)", session, contact_id, e)
        return {"id": contact_id}


async def get_chats(session: str = "default", limit: int = 10000) -> list[dict]:
    url = f"{ENV.WAHA_BASE_URL}/api/{session}/chats"
    try:
        client = _get_client()
        resp = await client.get(url, headers=_headers(), params={"limit": limit}, timeout=15.0)
        if resp.status_code == 200:
            return resp.json()
        # Fallback para endpoint /api/chats
        fallback_url = f"{ENV.WAHA_BASE_URL}/api/chats"
        resp_fb = await client.get(fallback_url, headers=_headers(), params={"limit": limit, "session": session}, timeout=15.0)
        if resp_fb.status_code == 200:
            return resp_fb.json()
        return []
    except Exception as e:
        logger.warning("get_chats falló para session=%s: %s", session, e)
        return []


async def download_media(media_url: str) -> tuple[bytes, str]:
    """Descarga el binario de un adjunto de WAHA. Replica el nodo
    `DescargarMedia`: sustituye 'localhost' por el hostname real del
    contenedor WAHA (media.url que manda WAHA en el webhook apunta a
    localhost, válido solo dentro del propio contenedor de WAHA)."""
    fixed_url = media_url.replace("localhost", "waha")
    client = _get_client()
    resp = await client.get(fixed_url, headers=_headers())
    resp.raise_for_status()
    content_type = resp.headers.get("Content-Type", "application/octet-stream")
    return resp.content, content_type
