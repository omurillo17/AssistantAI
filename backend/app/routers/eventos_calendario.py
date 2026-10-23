"""Reemplazo del subworkflow n8n EventosCalendario.json. Replica nodo por
nodo: 'Crear en Google Calendar' -> 'Guardar ID en Base de Datos' y
'Borrar en Google Calendar' -> 'Actualizar DB a Cancelado'. Si la llamada a
Google Calendar falla, el UPDATE de Postgres no se ejecuta (mismo orden
causal que el grafo de n8n original)."""

import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.db import get_pool
from app.google_calendar import create_event, delete_event, obtener_conflictos_calendario
from app.security import verify_api_key

logger = logging.getLogger("eventos_calendario")

_SQL_INSERT_NOTIFICACION = "INSERT INTO notificaciones (reclutador_id, mensaje) VALUES ($1, $2)"

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
    nombre = payload.nombre or "Candidato"
    telefono = payload.telefono or "Desconocido"
    vacante = payload.vacante_interes or "General"
    nave = payload.nave_interes or "Pendiente"
    
    tel_limpio = "".join(filter(str.isdigit, telefono))
    wa_info = f"https://wa.me/{tel_limpio}" if tel_limpio else telefono

    lineas = [
        f"Candidato: {nombre}",
        f"Teléfono: {telefono}" + (f" ({wa_info})" if tel_limpio else ""),
        f"Vacante: {vacante}",
        f"Nave / Sucursal: {nave}",
    ]
    if payload.ine_curp and payload.ine_curp not in ("No validado", "null", "None", ""):
        lineas.append(f"CURP: {payload.ine_curp}")

    return "\n".join(lineas)



@router.post("/crear")
async def crear_evento(payload: CrearEventoRequest) -> dict:
    try:
        start_dt = datetime.fromisoformat(payload.start)
        end_dt = datetime.fromisoformat(payload.end)
    except (ValueError, TypeError):
        return {"success": False, "error": "Formato de fecha inválido en start/end (se requiere ISO 8601)."}

    tz = ZoneInfo("America/Mexico_City")
    if start_dt.tzinfo is None:
        start_dt = start_dt.replace(tzinfo=tz)
    if end_dt.tzinfo is None:
        end_dt = end_dt.replace(tzinfo=tz)

    now = datetime.now(tz)
    if start_dt < now:
        return {"success": False, "error": "No es posible agendar en una fecha u hora pasada."}

    # Domingo cerrado
    if start_dt.weekday() == 6:
        return {"success": False, "error": "No se pueden agendar citas los domingos (oficinas cerradas)."}

    # Validar horario laboral general de la empresa
    hora_ini = start_dt.hour + start_dt.minute / 60.0
    hora_fin = end_dt.hour + end_dt.minute / 60.0
    if start_dt.weekday() < 5:
        if hora_ini < 9.0 or hora_fin > 17.0:
            return {
                "success": False,
                "error": "El horario solicitado está fuera de la jornada laboral oficial (Lunes a Viernes de 09:00 a 17:00 hrs).",
            }
    elif start_dt.weekday() == 5:
        if hora_ini < 9.0 or hora_fin > 12.0:
            return {
                "success": False,
                "error": "El horario solicitado está fuera de la jornada laboral de sábado (09:00 a 12:00 hrs).",
            }

    # Validar colisión con eventos o bloqueos existentes en Google Calendar
    try:
        conflictos = await obtener_conflictos_calendario(payload.calendar_id, start_dt, end_dt)
        if conflictos:
            motivo = conflictos[0].get("summary") or "Evento previo o bloqueo de agenda"
            logger.warning(
                "crear_evento: rechazado para candidato telefono=%s (%s a %s) por colisión con '%s'",
                payload.telefono, payload.start, payload.end, motivo,
            )
            return {
                "success": False,
                "error": f"El horario seleccionado ({payload.start}) no está disponible porque colisiona con '{motivo}'. Por favor solicita al candidato que elija otro horario disponible.",
            }
    except Exception as e:
        logger.exception("crear_evento: error al verificar colisiones en calendario: %s", e)

    event_id = await create_event(
        calendar_id=payload.calendar_id,
        summary=_build_summary(payload),
        description=_build_description(payload),
        start=payload.start,
        end=payload.end,
    )

    pool = get_pool()
    row = await pool.fetchrow(
        """
        UPDATE candidatos SET 
            event_id = $1,
            fecha_entrevista = $4,
            estado = 'CITA_AGENDADA',
            ultima_cita = NOW(),
            total_citas = COALESCE(total_citas, 0) + 1,
            ultima_interaccion = NOW()
        WHERE telefono = $2 AND (NULLIF($3, '') IS NULL OR empresa_id = NULLIF($3, '')::uuid)
        RETURNING id, nombre, vacante_interes, asignado_a_id
        """,
        event_id,
        payload.telefono,
        payload.empresa_id or "",
        payload.start,
    )

    # Notificar en la campana del CRM al reclutador asignado
    if row and row["asignado_a_id"]:
        nombre_c = row["nombre"] or payload.nombre or "Candidato"
        vac_c = row["vacante_interes"] or payload.vacante_interes or "General"
        msg_cita = f"📅 Cita agendada: {nombre_c} para {vac_c}"
        try:
            await pool.execute(
                _SQL_INSERT_NOTIFICACION,
                row["asignado_a_id"], msg_cita,
            )
        except Exception:
            logger.exception("crear_evento: error insertando notificacion en CRM")

    return {"success": True, "event_id": event_id}


async def _notificar_cancelacion_crm(
    pool,
    cancel_count: int,
    candidato_nombre: str,
    vacante: str,
    reclutador_id: str | None,
) -> None:
    if not reclutador_id:
        return
    if cancel_count == 3:
        msg_notif = f"⚠️ 3 cancelaciones/reagendamientos: {candidato_nombre} ({vacante})"
    elif cancel_count >= 4:
        msg_notif = f"🚫 Candidato bloqueado (4 cancelaciones): {candidato_nombre} ({vacante})"
    else:
        return

    try:
        await pool.execute(_SQL_INSERT_NOTIFICACION, reclutador_id, msg_notif)
    except Exception:
        logger.exception("eliminar_evento: error insertando notificacion en CRM")


@router.post("/eliminar")
async def eliminar_evento(payload: EliminarEventoRequest) -> dict:
    if payload.event_id:
        try:
            await delete_event(calendar_id=payload.calendar_id, event_id=payload.event_id)
        except Exception as e:
            logger.warning("eliminar_evento: error al borrar de Google Calendar (%s), continuando", e)

    pool = get_pool()
    row = await pool.fetchrow(
        """
        UPDATE candidatos 
        SET estado = CASE 
                WHEN COALESCE(cancelaciones, 0) + 1 >= 4 THEN 'RECHAZADO' 
                ELSE 'CITA_CANCELADA' 
            END,
            cancelaciones = COALESCE(cancelaciones, 0) + 1,
            event_id = NULL, 
            fecha_entrevista = NULL,
            resumen_ia = CASE 
                WHEN COALESCE(cancelaciones, 0) + 1 >= 4 THEN 'Bloqueado automáticamente por acumular 4 cancelaciones/reagendamientos.'
                ELSE resumen_ia 
            END,
            ultima_interaccion = NOW()
        WHERE telefono = $1
        RETURNING id, cancelaciones, asignado_a_id, nombre, vacante_interes, telefono
        """,
        payload.telefono,
    )

    if not row:
        logger.warning("eliminar_evento: ningún candidato con telefono=%s", payload.telefono)
        return {"success": True, "cancelaciones": 1, "bloqueado": False}

    cancel_count = row["cancelaciones"] or 1
    candidato_nombre = row["nombre"] or "Candidato"
    vacante = row["vacante_interes"] or "General"
    reclutador_id = row["asignado_a_id"]

    await _notificar_cancelacion_crm(pool, cancel_count, candidato_nombre, vacante, reclutador_id)

    return {
        "success": True, 
        "cancelaciones": cancel_count, 
        "bloqueado": cancel_count >= 4
    }

