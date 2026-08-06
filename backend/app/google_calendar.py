"""Wrapper de la API de Google Calendar. El cliente oficial
(google-api-python-client) es síncrono, así que cada llamada corre en un
hilo aparte (asyncio.to_thread) para no bloquear el event loop de FastAPI."""

import asyncio
from datetime import datetime

from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from app.config import ENV
from app.oauth_store import get_refresh_token

_TOKEN_URI = "https://oauth2.googleapis.com/token"
_SCOPES = ["https://www.googleapis.com/auth/calendar"]


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


async def create_event(calendar_id: str, summary: str, description: str, start: str, end: str) -> str:
    service = await _build_service(calendar_id)
    body = {
        "summary": summary,
        "description": description,
        "start": {"dateTime": start},
        "end": {"dateTime": end},
    }

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
    body = {"start": {"dateTime": start}, "end": {"dateTime": end}}

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
