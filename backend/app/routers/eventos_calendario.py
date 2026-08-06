"""Reemplazo del subworkflow n8n EventosCalendario.json. Replica nodo por
nodo: 'Crear en Google Calendar' -> 'Guardar ID en Base de Datos' y
'Borrar en Google Calendar' -> 'Actualizar DB a Cancelado'. Si la llamada a
Google Calendar falla, el UPDATE de Postgres no se ejecuta (mismo orden
causal que el grafo de n8n original)."""

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.db import get_pool
from app.google_calendar import create_event, delete_event
from app.security import verify_api_key

logger = logging.getLogger("eventos_calendario")

router = APIRouter(
    prefix="/internal/eventos-calendario",
    dependencies=[Depends(verify_api_key)],
)


class CrearEventoRequest(BaseModel):
    start: str
    end: str
    calendar_id: str
    telefono: str
    resumen_ia: str | None = None
    notas_ia: str | None = None
    nombre: str | None = None
    nave_interes: str | None = None
    vacante_interes: str | None = None
    ine_nombre: str | None = None
    ine_curp: str | None = None
    empresa_id: str | None = None


class EliminarEventoRequest(BaseModel):
    calendar_id: str
    telefono: str
    event_id: str


def _build_summary(payload: CrearEventoRequest) -> str:
    nombre = payload.nombre or "Candidato"
    vacante = payload.vacante_interes or "Vacante General"
    return f"{nombre} - {vacante}"


def _build_description(payload: CrearEventoRequest) -> str:
    nombre = payload.nombre or "Desconocido"
    telefono = payload.telefono or "Desconocido"
    vacante = payload.vacante_interes or "General"
    nave = payload.nave_interes or "Pendiente"
    ine_nombre = payload.ine_nombre or "No validado"
    ine_curp = payload.ine_curp or "No validado"
    notas = payload.notas_ia or payload.resumen_ia or ""
    return (
        f"Candidato: {nombre}\n"
        f"Tel: {telefono}\n"
        f"Vacante: {vacante}\n"
        f"Nave/Sucursal: {nave}\n\n"
        f"--- DATOS VERIFICADOS (INE) ---\n"
        f"Nombre: {ine_nombre}\n"
        f"CURP: {ine_curp}\n\n"
        f"--- NOTAS DE IA ---\n"
        f"{notas}"
    )


@router.post("/crear")
async def crear_evento(payload: CrearEventoRequest) -> dict:
    event_id = await create_event(
        calendar_id=payload.calendar_id,
        summary=_build_summary(payload),
        description=_build_description(payload),
        start=payload.start,
        end=payload.end,
    )

    pool = get_pool()
    await pool.execute(
        "UPDATE candidatos SET event_id = $1 "
        "WHERE telefono = $2 AND (NULLIF($3, '') IS NULL OR empresa_id = NULLIF($3, '')::uuid)",
        event_id,
        payload.telefono,
        payload.empresa_id or "",
    )

    return {"success": True, "event_id": event_id}


@router.post("/eliminar")
async def eliminar_evento(payload: EliminarEventoRequest) -> dict:
    await delete_event(calendar_id=payload.calendar_id, event_id=payload.event_id)

    pool = get_pool()
    result = await pool.execute(
        "UPDATE candidatos SET estado = 'CITA_CANCELADA', event_id = NULL WHERE telefono = $1",
        payload.telefono,
    )
    if result == "UPDATE 0":
        logger.warning("eliminar_evento: ningún candidato con telefono=%s", payload.telefono)

    return {"success": True}
