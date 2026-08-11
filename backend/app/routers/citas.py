"""Reemplaza los 4 webhooks de Orquestador.json que sí llama el frontend
(calendario/page.tsx): google-calendar, crm-cancelar-cita,
crm-reagendar-cita y crm-crear-bloqueo. Los otros 3 webhooks del workflow
(crm-candidatos-get/update, crm-chat-history) no los invoca nada en el
repo -- ya fueron reemplazados por /api/db/candidatos, /api/db/candidato,
/api/db/mensajes -- y no se migran.

Bug corregido de paso: el nodo 'Postgres: Reagendar Cita' original hacía
UPDATE ... estado = 'CITA AGENDADA' (con espacio), que no es un valor
válido del CONSTRAINT valid_estado (solo 'CITA_AGENDADA', con guion bajo)
-- ese UPDATE truena en Postgres cada vez que se ejecuta. Aquí se usa el
valor correcto."""

import logging
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.db import get_pool
from app.google_calendar import create_event, delete_event, list_events, update_event
from app.security import verify_api_key

logger = logging.getLogger("citas")

router = APIRouter(
    prefix="/internal/citas",
    dependencies=[Depends(verify_api_key)],
)

_SELECT_CALENDAR_IDS_SQL = (
    "SELECT DISTINCT calendar_id FROM reclutadores "
    "WHERE calendar_id IS NOT NULL AND calendar_id != '' AND calendar_id LIKE '%@%';"
)


class CancelarCitaRequest(BaseModel):
    telefono: str
    event_id: str | None = None
    calendar_id: str | None = None
    motivo: str | None = None
    telefono_reclutador: str | None = None
    nombre_reclutador: str | None = None
    nombre_candidato: str | None = None


class ReagendarCitaRequest(BaseModel):
    telefono: str
    event_id: str
    calendar_id: str
    start: str
    end: str
    motivo: str | None = None
    telefono_reclutador: str | None = None
    nombre_reclutador: str | None = None
    nombre_candidato: str | None = None
    correo: str | None = None


class CrearBloqueoRequest(BaseModel):
    calendar_id: str
    start: str
    end: str
    summary: str
    description: str | None = None


@router.get("/google-calendar")
async def google_calendar(start: datetime, end: datetime) -> list[dict]:
    pool = get_pool()
    rows = await pool.fetch(_SELECT_CALENDAR_IDS_SQL)

    eventos: list[dict] = []
    for row in rows:
        calendar_id = row["calendar_id"]
        try:
            items = await list_events(calendar_id, start, end, max_results=250)
        except Exception:
            logger.exception("google_calendar: list_events falló para calendar_id=%s", calendar_id)
            continue
        for evento in items:
            eventos.append({**evento, "calendarId": calendar_id})

    return eventos


@router.post("/cancelar")
async def cancelar(payload: CancelarCitaRequest) -> dict:
    if payload.event_id and payload.calendar_id:
        try:
            await delete_event(calendar_id=payload.calendar_id, event_id=payload.event_id)
        except Exception:
            logger.exception(
                "cancelar: delete_event falló para telefono=%s event_id=%s (se continúa igual)",
                payload.telefono, payload.event_id,
            )

    pool = get_pool()
    await pool.execute(
        "UPDATE candidatos SET estado = 'CITA_CANCELADA', fecha_entrevista = NULL, "
        "ultima_interaccion = NOW() WHERE telefono = $1",
        payload.telefono,
    )

    # El CRM le promete al reclutador que la cancelación "le enviará un
    # mensaje de WhatsApp al candidato con el motivo y tu número de
    # contacto" (texto literal del modal) -- antes el endpoint no encolaba
    # ningún mensaje, así que esa notificación nunca salía.
    nombre_candidato = payload.nombre_candidato or "Candidato"
    motivo = (payload.motivo or "").strip()
    lineas = [f"Hola {nombre_candidato}, tu entrevista ha sido CANCELADA."]
    if motivo:
        lineas.append(f"Motivo: {motivo}")
    if payload.telefono_reclutador:
        lineas.append(f"Cualquier duda, contáctanos al {payload.telefono_reclutador}.")
    await pool.execute(
        "INSERT INTO cola_mensajes (telefono, texto) VALUES ($1, $2)",
        f"{payload.telefono}@c.us",
        "\n\n".join(lineas),
    )

    return {"success": True, "message": "Cita cancelada correctamente", "telefono": payload.telefono}


@router.post("/reagendar")
async def reagendar(payload: ReagendarCitaRequest) -> dict:
    await update_event(
        calendar_id=payload.calendar_id,
        event_id=payload.event_id,
        start=payload.start,
        end=payload.end,
    )

    pool = get_pool()
    await pool.execute(
        "UPDATE candidatos SET fecha_entrevista = $1, estado = 'CITA_AGENDADA', "
        "ultima_interaccion = NOW() WHERE telefono = $2",
        payload.start,
        payload.telefono,
    )

    fecha = payload.start.split("T")[0]
    hora = payload.start.split("T")[1][:5] if "T" in payload.start else ""
    nombre_candidato = payload.nombre_candidato or "Candidato"
    motivo = (payload.motivo or "").strip()
    # El motivo que el reclutador escribe en el modal de "Reagendar" nunca
    # llegaba aquí (el modelo Pydantic no lo declaraba, así que FastAPI lo
    # descartaba en silencio) y el mensaje al candidato quedaba genérico.
    lineas = [f"Hola {nombre_candidato}, tu entrevista ha sido REAGENDADA para el {fecha} a las {hora}."]
    if motivo:
        lineas.append(f"Motivo: {motivo}")
    if payload.telefono_reclutador:
        lineas.append(f"Cualquier duda, contáctanos al {payload.telefono_reclutador}.")
    await pool.execute(
        "INSERT INTO cola_mensajes (telefono, texto) VALUES ($1, $2)",
        f"{payload.telefono}@c.us",
        "\n\n".join(lineas),
    )

    return {"success": True}


@router.post("/bloqueo")
async def bloqueo(payload: CrearBloqueoRequest) -> dict:
    await create_event(
        calendar_id=payload.calendar_id,
        summary=payload.summary,
        description=payload.description or "",
        start=payload.start,
        end=payload.end,
    )
    return {"success": True}
