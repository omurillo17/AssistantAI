"""Wrapper de la API de Google Calendar. El cliente oficial
(google-api-python-client) es síncrono, así que cada llamada corre en un
hilo aparte (asyncio.to_thread) para no bloquear el event loop de FastAPI."""

import asyncio
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from app.config import ENV
from app.oauth_store import get_refresh_token
from app.utils.fechas_es import DIAS_ES, MESES_ES

_TOKEN_URI = "https://oauth2.googleapis.com/token"
_SCOPES = ["https://www.googleapis.com/auth/calendar"]

# Google exige saber la zona horaria de start/end: si `dateTime` viene sin
# offset (naive), la API responde 400 "Missing time zone definition for start
# time." El agente de chat arma esas fechas con Gemini y a veces las manda
# desnudas ("2026-08-09T12:00:00"), así que se declara la zona del negocio
# explícitamente. Cuando el string SÍ trae offset, Google lo respeta y usa
# este campo solo como zona de referencia -- es seguro mandarlo siempre.
_CALENDAR_TZ = "America/Mexico_City"


async def _build_service(calendar_id: str):
    refresh_token = await get_refresh_token(calendar_id)
    creds = Credentials(
        None,
        refresh_token=refresh_token,
        token_uri=_TOKEN_URI,
        client_id=ENV.GOOGLE_OAUTH_CLIENT_ID,
        client_secret=ENV.GOOGLE_OAUTH_CLIENT_SECRET,
        scopes=_SCOPES,
    )

    def _refresh_and_build():
        creds.refresh(GoogleAuthRequest())
        return build("calendar", "v3", credentials=creds, cache_discovery=False)

    return await asyncio.to_thread(_refresh_and_build)


async def create_event(
    calendar_id: str,
    summary: str,
    description: str,
    start: str,
    end: str,
    recurrence: list[str] | None = None,
) -> str:
    service = await _build_service(calendar_id)
    body: dict = {
        "summary": summary,
        "description": description,
        "start": {"dateTime": start, "timeZone": _CALENDAR_TZ},
        "end": {"dateTime": end, "timeZone": _CALENDAR_TZ},
    }
    if recurrence:
        body["recurrence"] = recurrence

    def _insert():
        return service.events().insert(calendarId=calendar_id, body=body).execute()

    created = await asyncio.to_thread(_insert)
    return created["id"]


async def delete_event(calendar_id: str, event_id: str) -> None:
    service = await _build_service(calendar_id)

    def _delete():
        service.events().delete(calendarId=calendar_id, eventId=event_id).execute()

    await asyncio.to_thread(_delete)


async def update_event(calendar_id: str, event_id: str, start: str, end: str) -> None:
    """Reemplaza el nodo 'Reagendar en Google Calendar' de Orquestador.json
    (operation=update con updateFields parciales: solo start/end). Usa
    patch en vez de update para no pisar summary/description, igual que
    hacía el nodo de n8n al mandar solo esos dos campos en updateFields."""
    service = await _build_service(calendar_id)
    body = {
        "start": {"dateTime": start, "timeZone": _CALENDAR_TZ},
        "end": {"dateTime": end, "timeZone": _CALENDAR_TZ},
    }

    def _patch():
        service.events().patch(calendarId=calendar_id, eventId=event_id, body=body).execute()

    await asyncio.to_thread(_patch)


async def list_events(
    calendar_id: str,
    time_min: datetime,
    time_max: datetime,
    max_results: int = 20,
) -> list[dict]:
    """Reemplaza el nodo 'BuscarEventosDinamico' de
    4_Sofia - Recordatorios.json (y, con paginación, 'GCal Dinamico' de
    Orquestador.json, que usaba returnAll=true). time_min/time_max deben
    ser datetime *aware* (con tzinfo) -- a diferencia del string naive que
    producía la consulta SQL original (que el nodo googleCalendar de n8n
    toleraba pero una llamada REST directa via google-api-python-client
    no)."""
    service = await _build_service(calendar_id)

    def _list_page(page_token: str | None):
        return (
            service.events()
            .list(
                calendarId=calendar_id,
                timeMin=time_min.isoformat(),
                timeMax=time_max.isoformat(),
                maxResults=max_results,
                singleEvents=True,
                orderBy="startTime",
                pageToken=page_token,
            )
            .execute()
        )

    items: list[dict] = []
    page_token: str | None = None
    while True:
        result = await asyncio.to_thread(_list_page, page_token)
        items.extend(result.get("items", []))
        page_token = result.get("nextPageToken")
        if not page_token:
            break
    return items


def parse_google_datetime(val: dict | str | None, is_end: bool = False) -> datetime | None:
    """Parsea una fecha/hora proveniente de Google Calendar (dateTime o date para eventos de todo el día)."""
    if not val:
        return None
    tz = ZoneInfo(_CALENDAR_TZ)
    if isinstance(val, dict):
        if val.get("dateTime"):
            dt = datetime.fromisoformat(val["dateTime"])
            return dt if dt.tzinfo else dt.replace(tzinfo=tz)
        if val.get("date"):
            d = datetime.fromisoformat(val["date"]).date()
            if is_end:
                return datetime.combine(d, time.max, tzinfo=tz)
            return datetime.combine(d, time.min, tzinfo=tz)
    elif isinstance(val, str):
        try:
            dt = datetime.fromisoformat(val)
            return dt if dt.tzinfo else dt.replace(tzinfo=tz)
        except ValueError:
            return None
    return None


async def obtener_conflictos_calendario(
    calendar_id: str,
    start: datetime,
    end: datetime,
    exclude_event_id: str | None = None,
) -> list[dict]:
    """Retorna la lista de eventos que se sobrelapan con el intervalo [start, end).
    Ignora eventos marcados como 'transparent' (disponibles) y el evento exclude_event_id (para reagendas)."""
    tz = ZoneInfo(_CALENDAR_TZ)
    if start.tzinfo is None:
        start = start.replace(tzinfo=tz)
    if end.tzinfo is None:
        end = end.replace(tzinfo=tz)

    eventos = await list_events(calendar_id, start, end, max_results=50)
    conflictos: list[dict] = []
    for ev in eventos:
        if exclude_event_id and ev.get("id") == exclude_event_id:
            continue
        if ev.get("transparency") == "transparent":
            continue
        ev_start = parse_google_datetime(ev.get("start"))
        ev_end = parse_google_datetime(ev.get("end"), is_end=True)
        if ev_start and ev_end:
            if start < ev_end and end > ev_start:
                conflictos.append(ev)
    return conflictos


HORARIOS_OFICIALES_LV = [
    (9, 0),
    (10, 0),
    (11, 0),
    (12, 0),
    (13, 0),
    (14, 0),
    (15, 0),
    (15, 30),
    (16, 0),
]
HORARIOS_OFICIALES_SAB = [(9, 0), (10, 0), (11, 0)]


def calcular_slots_disponibles(
    eventos: list[dict],
    start_dt: datetime,
    end_dt: datetime,
    now: datetime | None = None,
) -> dict[date, list[tuple[int, int]]]:
    """Calcula determinísticamente los slots libres de 1 hora según la jornada oficial,
    descartando colisiones con eventos existentes o bloqueos (como horas de comida)."""
    tz = ZoneInfo(_CALENDAR_TZ)
    if now is None:
        now = datetime.now(tz)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=tz)

    if start_dt.tzinfo is None:
        start_dt = start_dt.replace(tzinfo=tz)
    if end_dt.tzinfo is None:
        end_dt = end_dt.replace(tzinfo=tz)

    parsed_events: list[tuple[datetime, datetime, str]] = []
    for ev in eventos:
        if ev.get("transparency") == "transparent":
            continue
        ev_s = parse_google_datetime(ev.get("start"))
        ev_e = parse_google_datetime(ev.get("end"), is_end=True)
        if ev_s and ev_e:
            parsed_events.append((ev_s, ev_e, ev.get("summary") or ""))

    slots_por_dia: dict[date, list[tuple[int, int]]] = {}
    curr = start_dt.date()
    end_date = end_dt.date()

    while curr <= end_date:
        wd = curr.weekday()
        if wd == 6:  # Domingo no laborable
            slots_por_dia[curr] = []
            curr += timedelta(days=1)
            continue

        horas = HORARIOS_OFICIALES_SAB if wd == 5 else HORARIOS_OFICIALES_LV
        libres: list[tuple[int, int]] = []
        for h, m in horas:
            s_dt = datetime(curr.year, curr.month, curr.day, h, m, tzinfo=tz)
            e_dt = s_dt + timedelta(hours=1)

            if s_dt <= now:
                continue

            # Verificar choque con eventos o bloqueos existentes
            choca = False
            for ev_s, ev_e, _ in parsed_events:
                if s_dt < ev_e and e_dt > ev_s:
                    choca = True
                    break
            if not choca:
                libres.append((h, m))

        slots_por_dia[curr] = libres
        curr += timedelta(days=1)

    return slots_por_dia


def _formatear_hora_es(hora: int, minuto: int) -> str:
    ampm = "a.m." if hora < 12 else "p.m."
    h12 = hora % 12
    if h12 == 0:
        h12 = 12
    return f"{h12}:{minuto:02d} {ampm}"


def formatear_disponibilidad_para_prompt(slots_por_dia: dict[date, list[tuple[int, int]]]) -> str:
    """Formatea la lista de slots libres en el formato Markdown que espera el prompt de Sofía."""
    lineas = []
    for d, slots in slots_por_dia.items():
        nom_dia = DIAS_ES[d.weekday()].capitalize()
        nom_mes = MESES_ES[d.month - 1]
        encabezado = f"*{nom_dia}, {d.day} de {nom_mes} de {d.year}*"
        if not slots:
            lineas.append(f"{encabezado}\n_Sin horarios disponibles_")
        else:
            items_str = "\n".join(f"- {_formatear_hora_es(h, m)}" for h, m in slots)
            lineas.append(f"{encabezado}\n{items_str}")
    return "\n\n".join(lineas)

