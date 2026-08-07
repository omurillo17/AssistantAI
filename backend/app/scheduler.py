"""Arranca los jobs que reemplazan los scheduleTrigger de n8n del workflow
5_Sofia - Mantenimiento y Errores.json. Cada job corre aislado con su
propio try/except: uno que falla se loguea pero no debe tumbar el
scheduler ni el resto de jobs (mismo espíritu fail-soft que verify_api_key
con PYTHON_SERVICE_API_KEY sin configurar, ver security.py).

No se duplica lógica de negocio aquí: process-outbox (envío/reintento de
WhatsApp) y limpiar-archivos (borra archivos del filesystem del host, algo
que este contenedor no tiene montado) siguen viviendo en Next.js. Este
módulo solo es el "reloj" que las llama en el horario correcto, en vez de
que lo haga n8n."""

import logging

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from app.config import ENV
from app.db import get_pool
from app.recordatorios import job_recordatorio_entrevista, job_vigilante

logger = logging.getLogger("scheduler")

_TZ = "America/Mexico_City"

# Mismas 3 sentencias que el nodo "LimpiarBD" de
# 5_Sofia - Mantenimiento y Errores.json. asyncpg ejecuta varias sentencias
# separadas por ';' en una sola llamada cuando no hay parámetros, igual que
# hacía el nodo postgres de n8n.
_DELETE_SQL = (
    "DELETE FROM system_logs WHERE timestamp < NOW() - INTERVAL '30 days';\n"
    "DELETE FROM conversation_history WHERE timestamp < NOW() - INTERVAL '60 days';\n"
    "DELETE FROM processed_webhooks WHERE processed_at < NOW() - INTERVAL '24 hours';"
)

_warned_no_key = False


def _headers() -> dict[str, str]:
    global _warned_no_key
    key = ENV.N8N_API_KEY
    if not key:
        if not _warned_no_key:
            logger.warning(
                "N8N_API_KEY no está configurada: las llamadas del scheduler a "
                "%s/api/cron/* saldrán sin header X-Api-Key (el frontend las "
                "acepta en modo fail-open, con su propia advertencia).",
                ENV.FRONTEND_API_BASE,
            )
            _warned_no_key = True
        return {}
    return {"X-Api-Key": key}


async def job_process_outbox() -> None:
    url = f"{ENV.FRONTEND_API_BASE}/api/cron/process-outbox"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url, headers=_headers())
            resp.raise_for_status()
        logger.info("process_outbox OK: %s", resp.text)
    except Exception:
        logger.exception("process_outbox falló al llamar %s", url)


async def job_limpiar_archivos() -> None:
    url = f"{ENV.FRONTEND_API_BASE}/api/cron/limpiar-archivos"
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.get(url, headers=_headers())
            resp.raise_for_status()
        logger.info("limpiar_archivos OK: %s", resp.text)
    except Exception:
        logger.exception("limpiar_archivos falló al llamar %s", url)


async def job_limpiar_bd() -> None:
    try:
        pool = get_pool()
        await pool.execute(_DELETE_SQL)
        logger.info("limpiar_bd OK")
    except Exception:
        logger.exception("limpiar_bd falló")


_JOBS = {
    "process_outbox": job_process_outbox,
    "limpiar_archivos": job_limpiar_archivos,
    "limpiar_bd": job_limpiar_bd,
    "recordatorio_entrevista": job_recordatorio_entrevista,
    "vigilante": job_vigilante,
}

_scheduler: AsyncIOScheduler | None = None


def start_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler is not None:
        return _scheduler

    scheduler = AsyncIOScheduler(timezone=_TZ)
    scheduler.add_job(
        job_process_outbox,
        trigger=IntervalTrigger(minutes=2),
        id="process_outbox",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        job_limpiar_archivos,
        trigger=CronTrigger(day_of_week="sun", hour=3, minute=0, timezone=_TZ),
        id="limpiar_archivos",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        job_limpiar_bd,
        trigger=CronTrigger(day_of_week="sun", hour=3, minute=0, timezone=_TZ),
        id="limpiar_bd",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        job_recordatorio_entrevista,
        trigger=CronTrigger(hour=20, minute=0, timezone=_TZ),
        id="recordatorio_entrevista",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        job_vigilante,
        trigger=IntervalTrigger(minutes=1),
        id="vigilante",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    _scheduler = scheduler
    for job in scheduler.get_jobs():
        logger.info("scheduler: job '%s' -> próxima ejecución: %s", job.id, job.next_run_time)
    return scheduler


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
