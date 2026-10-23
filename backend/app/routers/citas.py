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
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.db import get_pool
from app.google_calendar import create_event, delete_event, list_events, update_event
from app.config import ENV
from app.security import verify_api_key
from app.utils.phone import enmascarar, obtener_ultimos_10_digitos

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
    recurrence: list[str] | None = None


@router.get("/google-calendar")
async def google_calendar(start: datetime, end: datetime) -> list[dict]:
    if start.tzinfo is None:
        start = start.replace(tzinfo=ZoneInfo("America/Mexico_City"))
    if end.tzinfo is None:
        end = end.replace(tzinfo=ZoneInfo("America/Mexico_City"))

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

async def _empresa_de_cita(pool, telefono: str, event_id: str | None, calendar_id: str | None):
    """(resuelta, empresa_id) del candidato dueño de la cita: primero por
    event_id, si no por la empresa del reclutador dueño del calendario. Los
    requests del CRM no traen empresa_id; sin esto el UPDATE por teléfono
    tocaba el expediente de ese número en TODAS las empresas."""
    if event_id:
        row = await pool.fetchrow(
            "SELECT empresa_id FROM candidatos WHERE telefono = $1 AND event_id = $2 LIMIT 1",
            telefono, event_id,
        )
        if row:
            return True, row["empresa_id"]
    if calendar_id:
        row = await pool.fetchrow(
            "SELECT empresa_id FROM reclutadores WHERE LOWER(calendar_id) = LOWER($1) LIMIT 1",
            calendar_id,
        )
        if row:
            return True, row["empresa_id"]
    # ponytail: sin event_id ni calendario conocido queda el UPDATE por
    # teléfono como antes; que el CRM mande empresa_id si hace falta cerrarlo.
    return False, None


# $2 = empresa resuelta (bool), $3 = empresa_id. Si no se resolvió, no filtra.
_FILTRO_EMPRESA_SQL = "AND (NOT $2::boolean OR empresa_id IS NOT DISTINCT FROM $3::uuid)"


async def _resolver_destino_notificacion(pool, telefono: str | None) -> str | None:
    if not telefono or telefono.strip() == "No registrado":
        return None
    digitos = "".join(filter(str.isdigit, telefono))
    if len(digitos) < 10:
        return None
    if len(digitos) > 13:
        return f"{digitos}@lid"
    alt = (
        "52" + digitos[3:]
        if digitos.startswith("521") and len(digitos) == 13
        else ("521" + digitos[2:] if digitos.startswith("52") and len(digitos) == 12 else digitos)
    )
    diez = digitos[-10:]
    row = await pool.fetchrow(
        "SELECT lid FROM lid_telefono WHERE telefono = $1 OR telefono = $2 OR telefono = $3 ORDER BY updated_at DESC LIMIT 1",
        digitos,
        alt,
        diez,
    )
    if row and row["lid"]:
        return f"{row['lid']}@lid"
    return f"{digitos}@c.us"


async def _registrar_notificacion_en_historial(pool, telefono: str, texto: str) -> None:
    try:
        cand_id = await pool.fetchval(
            "SELECT id FROM candidatos WHERE telefono = $1 ORDER BY updated_at DESC LIMIT 1",
            telefono,
        )
        if cand_id:
            await pool.execute(
                "INSERT INTO conversation_history (telefono, candidato_id, role, content, message_type, timestamp) "
                "VALUES ($1, $2, 'assistant', $3, 'text', NOW())",
                telefono,
                cand_id,
                texto,
            )
            await pool.execute(
                """
                INSERT INTO mensajes_bandeja (candidato_id, telefono, ultimo_mensaje, ultimo_mensaje_rol, mensajes_no_leidos, activo, ultimo_mensaje_at)
                VALUES ($1, $2, $3, 'assistant', 0, TRUE, NOW())
                ON CONFLICT (candidato_id) DO UPDATE SET
                    ultimo_mensaje = EXCLUDED.ultimo_mensaje,
                    ultimo_mensaje_rol = 'assistant',
                    ultimo_mensaje_at = NOW(),
                    updated_at = NOW()
                """,
                cand_id,
                telefono,
                texto,
            )
    except Exception:
        logger.exception("Error guardando aviso de cita en conversation_history para telefono=%s", telefono)


async def _resolver_telefono_reclutador(
    pool, telefono_candidato: str | None, calendar_id: str | None = None, tel_fallback: str | None = None
) -> str | None:
    if telefono_candidato:
        # 1. Por reclutador asignado directamente al candidato
        tel = await pool.fetchval(
            """
            SELECT r.telefono 
            FROM candidatos c
            JOIN reclutadores r ON c.asignado_a_id = r.id
            WHERE c.telefono = $1 AND r.activo = TRUE AND r.telefono IS NOT NULL AND r.telefono != ''
            ORDER BY c.updated_at DESC LIMIT 1
            """,
            telefono_candidato,
        )
        if tel:
            return tel

        # 2. Por vacante de interés del candidato
        tel = await pool.fetchval(
            """
            SELECT r.telefono 
            FROM candidatos c
            JOIN vacantes_def v ON UPPER(TRIM(c.vacante_interes)) = UPPER(TRIM(v.nombre))
            JOIN reclutadores r ON v.reclutador_id = r.id
            WHERE c.telefono = $1 AND r.activo = TRUE AND r.telefono IS NOT NULL AND r.telefono != ''
            ORDER BY c.updated_at DESC LIMIT 1
            """,
            telefono_candidato,
        )
        if tel:
            return tel

    # 3. Por calendar_id del reclutador
    if calendar_id:
        tel = await pool.fetchval(
            """
            SELECT telefono 
            FROM reclutadores 
            WHERE LOWER(calendar_id) = LOWER($1) AND activo = TRUE AND telefono IS NOT NULL AND telefono != ''
            LIMIT 1
            """,
            calendar_id,
        )
        if tel:
            return tel

    # 4. Fallback si se pasó un teléfono explícito y no es el número de dev
    dev = obtener_ultimos_10_digitos(ENV.TEST_DEV_PHONE)
    if tel_fallback and not (len(dev) == 10 and obtener_ultimos_10_digitos(tel_fallback) == dev):
        return tel_fallback

    return None


@router.post("/cancelar")
async def cancelar(payload: CancelarCitaRequest) -> dict:
    if payload.event_id and payload.calendar_id:
        try:
            await delete_event(calendar_id=payload.calendar_id, event_id=payload.event_id)
        except Exception:
            logger.exception(
                "cancelar: delete_event falló para telefono=%s event_id=%s (se continúa igual)",
                enmascarar(payload.telefono), payload.event_id,
            )

    pool = get_pool()
    if payload.telefono and payload.telefono != "No registrado":
        resuelta, empresa_id = await _empresa_de_cita(pool, payload.telefono, payload.event_id, payload.calendar_id)
        # event_id = NULL: el evento ya se borró de Google; si se queda, el bot
        # cree que sigue habiendo cita y no deja agendar otra.
        await pool.execute(
            "UPDATE candidatos SET estado = 'CITA_CANCELADA', fecha_entrevista = NULL, event_id = NULL, "
            f"ultima_interaccion = NOW() WHERE telefono = $1 {_FILTRO_EMPRESA_SQL}",
            payload.telefono, resuelta, empresa_id,
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
    tel_reclutador = await _resolver_telefono_reclutador(
        pool, payload.telefono, payload.calendar_id, payload.telefono_reclutador
    )
    if tel_reclutador:
        lineas.append(f"Cualquier duda, contáctanos al {tel_reclutador}.")
    destino = await _resolver_destino_notificacion(pool, payload.telefono)
    if destino:
        texto_notif = "\n\n".join(lineas)
        await pool.execute(
            "INSERT INTO cola_mensajes (telefono, texto) VALUES ($1, $2)",
            destino,
            texto_notif,
        )
        await _registrar_notificacion_en_historial(pool, payload.telefono, texto_notif)

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
    resuelta, empresa_id = await _empresa_de_cita(pool, payload.telefono, payload.event_id, payload.calendar_id)
    await pool.execute(
        "UPDATE candidatos SET fecha_entrevista = $4, estado = 'CITA_AGENDADA', "
        f"ultima_interaccion = NOW() WHERE telefono = $1 {_FILTRO_EMPRESA_SQL}",
        payload.telefono,
        resuelta,
        empresa_id,
        payload.start,
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
    tel_reclutador = await _resolver_telefono_reclutador(
        pool, payload.telefono, payload.calendar_id, payload.telefono_reclutador
    )
    if tel_reclutador:
        lineas.append(f"Cualquier duda, contáctanos al {tel_reclutador}.")
    destino = await _resolver_destino_notificacion(pool, payload.telefono)
    if destino:
        texto_notif = "\n\n".join(lineas)
        await pool.execute(
            "INSERT INTO cola_mensajes (telefono, texto) VALUES ($1, $2)",
            destino,
            texto_notif,
        )
        await _registrar_notificacion_en_historial(pool, payload.telefono, texto_notif)

    return {"success": True}


@router.post("/bloqueo")
async def bloqueo(payload: CrearBloqueoRequest) -> dict:
    event_id = await create_event(
        calendar_id=payload.calendar_id,
        summary=payload.summary,
        description=payload.description or "",
        start=payload.start,
        end=payload.end,
        recurrence=payload.recurrence,
    )
    return {"success": True, "event_id": event_id}
