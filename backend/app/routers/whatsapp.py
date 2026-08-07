"""Reemplaza el Webhook de entrada de `1_Sofia - Inicio.json`. WAHA le
pega directo a este endpoint (antes le pegaba a n8n). Responde de
inmediato (background task) -- igual que el webhook de n8n, que no
esperaba a que terminara todo el pipeline (workflow 1 -> 2 fire-and-forget,
2 -> 3 síncrono, pero el ACK a WAHA ya había salido desde el webhook
inicial). Si WAHA reintenta por timeout, el dedup de `processed_webhooks`
hace que el reintento sea inofensivo."""

import logging

from fastapi import APIRouter, BackgroundTasks, Request

from app.chat import ingesta

logger = logging.getLogger("whatsapp_router")

router = APIRouter()


async def _procesar_en_background(body: dict) -> None:
    try:
        await ingesta.procesar_webhook(body)
    except Exception:
        logger.exception("whatsapp webhook: fallo procesando body")


@router.post("/webhook/messages")
async def webhook_messages(request: Request, background_tasks: BackgroundTasks) -> dict:
    body = await request.json()
    background_tasks.add_task(_procesar_en_background, body)
    return {"success": True}
