"""Cliente HTTP hacia WAHA (WhatsApp HTTP API), reemplaza los nodos
`@devlikeapro/n8n-nodes-waha.WAHA` (Send Text, Start Typing) y los
httpRequest directos a WAHA (`GetInfo`, `DescargarMedia`) de los 3
workflows de chat. Mismo contrato REST que WAHA ya expone hoy (confirmado
contra la instancia viva: GET /api/contacts, GET /api/sessions)."""

import logging
from urllib.parse import urlsplit

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


META_SESSION_PREFIX = "meta:"
META_SUFFIX = "@meta"
C_US_SUFFIX = "@c.us"


def _headers() -> dict[str, str]:
    return {"X-Api-Key": ENV.WAHA_API_KEY}


async def send_text(session: str, chat_id: str, text: str) -> None:
    """Único punto de salida de mensajes de WhatsApp, aplicando el regulador de ritmo."""
    await throttle.esperar_turno()
    if session.startswith(META_SESSION_PREFIX) or chat_id.endswith(META_SUFFIX):
        from app import meta_client
        pid = session.split(META_SESSION_PREFIX, 1)[1] if session.startswith(META_SESSION_PREFIX) else ENV.META_WA_PHONE_NUMBER_ID
        clean_to = chat_id.replace(C_US_SUFFIX, "").replace(META_SUFFIX, "")
        await meta_client.send_text(pid, clean_to, text)
        return

    url = f"{ENV.WAHA_BASE_URL}/api/sendText"
    client = _get_client()
    target_id = chat_id if ("@" in chat_id) else f"{chat_id}@c.us"
    resp = await client.post(url, headers=_headers(), json={"session": session, "chatId": target_id, "text": text})
    resp.raise_for_status()


async def start_typing(session: str, chat_id: str) -> None:
    if session.startswith(META_SESSION_PREFIX) or chat_id.endswith(META_SUFFIX):
        return

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


_MAX_MEDIA_BYTES = 25 * 1024 * 1024
_PUERTOS_POR_DEFECTO = {"http": 80, "https": 443}


def _origen(url: str) -> tuple[str, str, int | None]:
    partes = urlsplit(url)
    esquema = partes.scheme.lower()
    return esquema, (partes.hostname or "").lower(), partes.port or _PUERTOS_POR_DEFECTO.get(esquema)


def es_url_media_permitida(url: str, base_url: str) -> bool:
    """La URL del adjunto llega en el webhook: solo se le manda la X-Api-Key
    de WAHA si apunta al mismo esquema/host/puerto que WAHA_BASE_URL. Si no,
    cualquiera que mande un webhook podría hacer que el backend le entregue
    la llave (o que pida URLs internas arbitrarias)."""
    try:
        origen = _origen(url)
        return bool(origen[1]) and origen == _origen(base_url)
    except ValueError:  # puerto inválido
        return False


async def download_media(media_url: str) -> tuple[bytes, str]:
    """Descarga el binario de un adjunto de WAHA o Meta Cloud API.
    Lanza ValueError si la URL no es de WAHA o el archivo pasa de 25 MB."""
    if media_url.startswith(META_SESSION_PREFIX):
        from app import meta_client
        media_id = media_url.split(META_SESSION_PREFIX, 1)[1]
        return await meta_client.download_media(media_id)

    fixed_url = media_url.replace("localhost", "waha")
    if not es_url_media_permitida(fixed_url, ENV.WAHA_BASE_URL):
        logger.warning("download_media: URL fuera de WAHA_BASE_URL rechazada (host=%s)", urlsplit(fixed_url).hostname)
        raise ValueError("URL de media fuera de WAHA_BASE_URL")

    client = _get_client()
    async with client.stream("GET", fixed_url, headers=_headers()) as resp:
        resp.raise_for_status()
        largo = resp.headers.get("Content-Length") or ""
        if largo.isdigit() and int(largo) > _MAX_MEDIA_BYTES:
            raise ValueError(f"Adjunto demasiado grande ({largo} bytes)")
        data = bytearray()
        async for chunk in resp.aiter_bytes():
            data += chunk
            if len(data) > _MAX_MEDIA_BYTES:
                raise ValueError("Adjunto demasiado grande (> 25 MB)")
        content_type = resp.headers.get("Content-Type", "application/octet-stream")
    return bytes(data), content_type
