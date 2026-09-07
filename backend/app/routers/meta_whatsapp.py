import logging
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse

from app.chat import ingesta
from app.config import ENV

logger = logging.getLogger("meta_whatsapp_router")

router = APIRouter()


@router.get("/webhook/meta", responses={403: {"description": "Verification failed"}})
async def verify_meta_webhook(
    hub_mode: str | None = Query(None, alias="hub.mode"),
    hub_verify_token: str | None = Query(None, alias="hub.verify_token"),
    hub_challenge: str | None = Query(None, alias="hub.challenge"),
):
    """Handshake de verificación del Webhook de Meta."""
    expected_token = ENV.META_WA_VERIFY_TOKEN
    if hub_mode == "subscribe" and hub_verify_token == expected_token:
        logger.info("Meta Webhook handshake verificado exitosamente")
        return PlainTextResponse(hub_challenge or "")

    logger.warning(
        "Meta Webhook handshake falló: mode=%s token=%s (esperado=%s)",
        hub_mode,
        hub_verify_token,
        expected_token,
    )
    raise HTTPException(status_code=403, detail="Verification failed")


async def _procesar_meta_background(body: dict) -> None:
    try:
        await ingesta.procesar_webhook_meta(body)
    except Exception:
        logger.exception("meta webhook: fallo procesando body")


@router.post("/webhook/meta")
async def webhook_meta_messages(request: Request, background_tasks: BackgroundTasks) -> dict:
    body = await request.json()
    background_tasks.add_task(_procesar_meta_background, body)
    return {"success": True}
