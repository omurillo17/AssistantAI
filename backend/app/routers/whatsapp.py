"""Reemplaza el Webhook de entrada de `1_Sofia - Inicio.json`. WAHA le
pega directo a este endpoint (antes le pegaba a n8n). Responde de
inmediato (background task) -- igual que el webhook de n8n, que no
esperaba a que terminara todo el pipeline (workflow 1 -> 2 fire-and-forget,
2 -> 3 síncrono, pero el ACK a WAHA ya había salido desde el webhook
inicial). Si WAHA reintenta por timeout, el dedup de `processed_webhooks`
hace que el reintento sea inofensivo.

Autenticación: WAHA firma cada POST con HMAC-SHA512 (hex) del cuerpo crudo
en el header `X-Webhook-Hmac` cuando el webhook de la sesión tiene
`hmac.key` configurada. Se verifica contra WAHA_WEBHOOK_HMAC_KEY."""

import asyncio
import hashlib
import hmac
import json
import logging
import time

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request

from app.chat import ingesta
from app.config import ENV

logger = logging.getLogger("whatsapp_router")

router = APIRouter()

# Tope de turnos procesándose a la vez y de webhooks aceptados en espera.
# Sin esto, una ráfaga (o alguien inundando el endpoint) abre una tarea por
# POST sin límite: conexiones a la BD, llamadas a Gemini y memoria.
_MAX_CONCURRENTES = 20
_MAX_PENDIENTES = 200
_semaforo = asyncio.Semaphore(_MAX_CONCURRENTES)
_pendientes = 0
_aviso_sin_hmac_emitido = False


def verificar_hmac(cuerpo: bytes, firma: str | None, clave: str) -> bool:
    """True si `firma` es el HMAC-SHA512 (hex) de `cuerpo` con `clave`."""
    if not firma:
        return False
    esperada = hmac.new(clave.encode(), cuerpo, hashlib.sha512).hexdigest()
    return hmac.compare_digest(esperada, firma.strip().lower())


async def _procesar_en_background(body: dict, recibido_en: float) -> None:
    global _pendientes
    try:
        async with _semaforo:
            await ingesta.procesar_webhook(body, recibido_en=recibido_en)
    except Exception:
        logger.exception("whatsapp webhook: fallo procesando body")
    finally:
        _pendientes -= 1


@router.post("/webhook/messages")
async def webhook_messages(
    request: Request,
    background_tasks: BackgroundTasks,
    x_webhook_hmac: str | None = Header(default=None),
) -> dict:
    global _pendientes, _aviso_sin_hmac_emitido
    cuerpo = await request.body()

    clave = ENV.WAHA_WEBHOOK_HMAC_KEY
    if clave:
        if not verificar_hmac(cuerpo, x_webhook_hmac, clave):
            logger.warning("whatsapp webhook: firma HMAC inválida o ausente, se rechaza")
            raise HTTPException(status_code=401, detail="No autorizado")
    elif not _aviso_sin_hmac_emitido:
        # TRANSITORIO: se acepta sin firma solo para no tumbar producción
        # mientras se configura `hmac.key` en el webhook de WAHA. En cuanto
        # esté, DEBE definirse WAHA_WEBHOOK_HMAC_KEY: sin ella cualquiera que
        # alcance este endpoint puede inyectar mensajes falsos al bot.
        logger.warning("whatsapp webhook: WAHA_WEBHOOK_HMAC_KEY no configurada -- se aceptan webhooks SIN verificar")
        _aviso_sin_hmac_emitido = True

    try:
        body = json.loads(cuerpo)
    except ValueError:
        raise HTTPException(status_code=400, detail="JSON inválido")
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="JSON inválido")

    if _pendientes >= _MAX_PENDIENTES:
        logger.warning("whatsapp webhook: %s webhooks en espera, se responde 503", _pendientes)
        raise HTTPException(status_code=503, detail="Saturado, reintenta más tarde")

    _pendientes += 1
    # La hora de recepción viaja con el body: la antigüedad del mensaje se
    # mide contra ella y no contra cuándo se libera el semáforo, para que un
    # mensaje que esperó turno no se descarte como "viejo".
    background_tasks.add_task(_procesar_en_background, body, time.time())
    return {"success": True}
