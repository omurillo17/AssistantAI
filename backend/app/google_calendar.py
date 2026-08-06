"""Wrapper de la API de Google Calendar. El cliente oficial
(google-api-python-client) es síncrono, así que cada llamada corre en un
hilo aparte (asyncio.to_thread) para no bloquear el event loop de FastAPI."""

import asyncio

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
