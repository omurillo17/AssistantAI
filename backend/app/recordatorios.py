"""Reemplaza 4_Sofia - Recordatorios.json: dos scheduleTrigger de n8n.

- RecordatorioEntrevista (diario 20:00 America/Mexico_City): revisa las
  citas de mañana en el Google Calendar de cada reclutador y avisa por
  WhatsApp tanto al reclutador como al candidato.
- Vigilante (cada 1 minuto): detecta candidatos que dejaron de responder
  antes de aceptar privacidad/elegir vacante/agendar cita, y les manda un
  recordatorio.

Mismo espíritu fail-soft que scheduler.py: cada job tiene su propio
try/except de nivel superior (uno que falla se loguea pero no debe tumbar
el scheduler), y dentro de RecordatorioEntrevista cada llamada a Google
Calendar por reclutador también está aislada (si el calendario de un
reclutador falla, los demás se siguen procesando).

Ambos jobs encolan en cola_mensajes en vez de llamarle a WAHA
directamente, igual que ya se hizo para el resto del backend -- así el
reintento (hasta 5 veces, cada 2 min, via job_process_outbox) protege
contra fallos transitorios de WAHA en vez de reintentar disparando el
nodo entero de nuevo."""

import logging
import re
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from app.db import get_pool
from app.google_calendar import list_events

logger = logging.getLogger("recordatorios")

_MX_TZ = ZoneInfo("America/Mexico_City")

# --- Branch A: RecordatorioEntrevista -------------------------------------

_TEL_RE = re.compile(r"Tel[:\s]*([0-9]{10,13})", re.IGNORECASE)
_NOMBRE_RE = re.compile(r"Nombre[:\s]*([^\n]+)", re.IGNORECASE)

_DEFAULT_NOMBRE_RECLUTADOR = "Tu equipo"
_DEFAULT_EMOJI_RECLUTADOR = "📅"
_DEFAULT_TEL_RECLUTADOR = "5213323379399"

_DIAS_ES = {
    0: "lunes", 1: "martes", 2: "miércoles", 3: "jueves",
    4: "viernes", 5: "sábado", 6: "domingo",
}
_MESES_ES = {
    1: "enero", 2: "febrero", 3: "marzo", 4: "abril", 5: "mayo", 6: "junio",
    7: "julio", 8: "agosto", 9: "septiembre", 10: "octubre",
    11: "noviembre", 12: "diciembre",
}

_SELECT_RECLUTADORES_SQL = (
    "SELECT nombre AS nombre_reclutador, calendar_id, telefono AS telefono_reclutador "
    "FROM reclutadores "
    "WHERE calendar_id IS NOT NULL AND calendar_id != '' AND calendar_id LIKE '%@%';"
)


def _formatear_fecha_es(dt: datetime) -> str:
    """Equivalente manual de:
    fecha.toLocaleString('es-MX', {timeZone:'America/Mexico_City',
    weekday:'long', day:'numeric', month:'long', hour:'2-digit',
    minute:'2-digit', hour12:true})
    Python no trae locale es-MX de fábrica; en vez de sumar una dependencia
    (babel/pytz) solo para esto, se resuelve a mano con dos diccionarios.
    dt debe llegar ya convertido a America/Mexico_City."""
    dia_semana = _DIAS_ES[dt.weekday()]
    mes = _MESES_ES[dt.month]
    hora_12 = dt.hour % 12 or 12
    ampm = "a. m." if dt.hour < 12 else "p. m."
    return f"{dia_semana}, {dt.day} de {mes}, {hora_12:02d}:{dt.minute:02d} {ampm}"


def _parse_evento_datetime(start: dict) -> datetime | None:
    """event.start.dateTime (con hora) o event.start.date (todo el día),
    llevado a America/Mexico_City."""
    dt_str = start.get("dateTime")
    if dt_str:
        dt = datetime.fromisoformat(dt_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(_MX_TZ)

    date_str = start.get("date")
    if date_str:
        dt = datetime.fromisoformat(date_str).replace(tzinfo=timezone.utc)
        return dt.astimezone(_MX_TZ)

    return None


def _match_reclutador(evento: dict, reclutadores: list[dict]) -> dict | None:
    """Busca por organizer.email / creator.email / attendees[].email contra
    TODOS los reclutadores cargados (no solo el dueño del calendario
    consultado) -- así corría el Code node original, sobre el batch
    completo de eventos de todos los reclutadores."""
    organizer_email = (evento.get("organizer") or {}).get("email")
    creator_email = (evento.get("creator") or {}).get("email")
    attendee_emails = {a.get("email") for a in (evento.get("attendees") or [])}

    for r in reclutadores:
        cid = r["calendar_id"]
        if cid == organizer_email or cid == creator_email or cid in attendee_emails:
            return r
    return reclutadores[0] if reclutadores else None


def _preparar_aviso(evento: dict, reclutadores: list[dict]) -> dict | None:
    """Puerto 1:1 del Code node 'PrepararAvisoDinamico' para UN evento ya
    deduplicado. Devuelve None si el evento no trae teléfono en la
    descripción (filtro duro: 'no es una cita lista')."""
    descripcion = evento.get("description") or ""

    tel_match = _TEL_RE.search(descripcion)
    if not tel_match:
        return None
    telefono_candidato = tel_match.group(1)

    nombre_match = _NOMBRE_RE.search(descripcion)
    nombre_candidato = nombre_match.group(1).strip() if nombre_match else "Nombre"

    dt = _parse_evento_datetime(evento.get("start") or {})
    hora_formateada = _formatear_fecha_es(dt) if dt else "hora por confirmar"

    reclutador = _match_reclutador(evento, reclutadores)
    nombre_reclutador = _DEFAULT_NOMBRE_RECLUTADOR
    emoji_reclutador = _DEFAULT_EMOJI_RECLUTADOR
    telefono_reclutador = _DEFAULT_TEL_RECLUTADOR
    if reclutador:
        nombre_reclutador = reclutador.get("nombre_reclutador") or nombre_reclutador
        telefono_reclutador = reclutador.get("telefono_reclutador") or telefono_reclutador
        # emoji_reclutador queda siempre en el default: la tabla
        # reclutadores nunca tuvo columna "emoji", así que el nodo
        # original también leía esto como undefined.

    mensaje_reclutador = (
        f"⏰ *¡RECORDATORIO DE ENTREVISTA MAÑANA!* {emoji_reclutador}\n\n"
        f"Hola {nombre_reclutador}, tienes una cita programada:\n\n"
        f"👤 *Candidato:* {nombre_candidato}\n"
        f"📱 *Tel:* wa.me/{telefono_candidato}\n"
        f"🕒 *Cuando:* {hora_formateada}\n\n"
        f"📝 _Evento: {evento.get('summary') or 'Entrevista'}_"
    )
    mensaje_candidato = (
        f"Hola {nombre_candidato}, te recordamos que mañana tienes tu entrevista:\n\n"
        f"🕒 {hora_formateada}\n\n"
        "Te esperamos. Cualquier duda, escríbenos. ✨"
    )

    return {
        "mensaje_reclutador": mensaje_reclutador,
        "telefono_reclutador": telefono_reclutador,
        "mensaje_candidato": mensaje_candidato,
        "telefono_candidato": telefono_candidato,
    }


async def _enqueue_mensaje(conn_or_pool, telefono: str, texto: str) -> None:
    """INSERT en cola_mensajes (outbox), en vez de llamarle a WAHA
    directamente como hacían los nodos WAHA originales."""
    await conn_or_pool.execute(
        "INSERT INTO cola_mensajes (telefono, texto) VALUES ($1, $2)",
        telefono,
        texto,
    )


def _ventana_de_manana() -> tuple[datetime, datetime]:
    hoy_mx = datetime.now(_MX_TZ).date()
    manana: date = hoy_mx + timedelta(days=1)
    time_min = datetime.combine(manana, time(0, 0, 0), tzinfo=_MX_TZ)
    time_max = datetime.combine(manana, time(23, 59, 0), tzinfo=_MX_TZ)
    return time_min, time_max


async def job_recordatorio_entrevista() -> None:
    try:
        pool = get_pool()
        rows = await pool.fetch(_SELECT_RECLUTADORES_SQL)
        reclutadores = [dict(r) for r in rows]

        time_min, time_max = _ventana_de_manana()

        eventos: list[dict] = []
        vistos: set[str] = set()
        for r in reclutadores:
            try:
                items = await list_events(r["calendar_id"], time_min, time_max, max_results=20)
            except Exception:
                logger.exception(
                    "job_recordatorio_entrevista: list_events falló para calendar_id=%s",
                    r["calendar_id"],
                )
                continue
            for evento in items:
                evento_id = evento.get("id")
                if not evento_id or evento_id in vistos:
                    continue
                vistos.add(evento_id)
                eventos.append(evento)

        enviados = 0
        for evento in eventos:
            aviso = _preparar_aviso(evento, reclutadores)
            if aviso is None:
                continue  # sin teléfono en la descripción: no es una cita lista

            # El mensaje al reclutador SIEMPRE se encola, sin condición
            # (igual que el nodo NotificarReclutador, que no tenía IF).
            await _enqueue_mensaje(
                pool, f"{aviso['telefono_reclutador']}@c.us", aviso["mensaje_reclutador"]
            )
            if aviso["telefono_candidato"]:
                await _enqueue_mensaje(
                    pool, f"{aviso['telefono_candidato']}@c.us", aviso["mensaje_candidato"]
                )
            enviados += 1

        logger.info(
            "job_recordatorio_entrevista OK: %s reclutadores, %s eventos únicos, %s avisos encolados",
            len(reclutadores), len(eventos), enviados,
        )
    except Exception:
        logger.exception("job_recordatorio_entrevista falló")


# --- Branch B: Vigilante ----------------------------------------------------

_SELECT_VIGILANTE_SQL = (
    "SELECT * FROM candidatos "
    "WHERE estado IN ('NUEVO', 'INTERESADO') "
    "AND ultima_interaccion < (NOW() - INTERVAL '30 minutes') "
    "AND COALESCE(privacidad_aceptada, false) = false "
    "AND COALESCE(vacante_interes, '') = '' "
    "AND COALESCE(fecha_entrevista, '') = '';"
)

# Texto fijo que se guarda en conversation_history -- a propósito NO incluye
# el nombre del candidato (a diferencia del texto real que se manda por
# WhatsApp). Esa asimetría ya existía en el nodo CambiarEstado original;
# se preserva tal cual, no se "corrige".
_MENSAJE_RECORDATORIO_GENERICO = (
    "Hola, notamos que dejaste de responder. ¿Sigues disponible para continuar tu proceso?"
)


async def job_vigilante() -> None:
    try:
        pool = get_pool()
        rows = await pool.fetch(_SELECT_VIGILANTE_SQL)

        procesados = 0
        for row in rows:
            telefono = row["telefono"]
            if not telefono:
                continue

            nombre = row["nombre"] or ""
            texto_candidato = (
                f"Hola {nombre}, notamos que dejaste de responder. "
                "¿Sigues disponible para continuar tu proceso?"
            )

            async with pool.acquire() as conn:
                async with conn.transaction():
                    await _enqueue_mensaje(conn, f"{telefono}@c.us", texto_candidato)
                    await conn.execute(
                        "UPDATE candidatos SET estado = 'RECORDATORIO_ENVIADO' WHERE telefono = $1",
                        telefono,
                    )
                    await conn.execute(
                        "INSERT INTO conversation_history (telefono, role, content) "
                        "VALUES ($1, 'assistant', $2)",
                        telefono,
                        _MENSAJE_RECORDATORIO_GENERICO,
                    )
            procesados += 1

        logger.info("job_vigilante OK: %s candidatos procesados de %s seleccionados", procesados, len(rows))
    except Exception:
        logger.exception("job_vigilante falló")
