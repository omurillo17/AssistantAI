"""Regresión de `app.google_calendar`.

Google respondía 400 "Missing time zone definition for start time." y la cita
nunca se creaba: Gemini arma las fechas como texto ISO sin offset
("2026-08-09T12:00:00") y el body no declaraba la zona por ningún lado.
"""

import app.google_calendar as gcal


class _FakeExecutable:
    def __init__(self, registro, resultado):
        self._registro = registro
        self._resultado = resultado

    def execute(self):
        return self._resultado


class _FakeEvents:
    def __init__(self, registro):
        self._registro = registro

    def insert(self, calendarId, body):
        self._registro["insert"] = {"calendarId": calendarId, "body": body}
        return _FakeExecutable(self._registro, {"id": "evento-fake-123"})

    def patch(self, calendarId, eventId, body):
        self._registro["patch"] = {"calendarId": calendarId, "eventId": eventId, "body": body}
        return _FakeExecutable(self._registro, {})


class _FakeService:
    def __init__(self, registro):
        self._registro = registro

    def events(self):
        return _FakeEvents(self._registro)


async def _fake_build_service(_calendar_id):
    return _FakeService(_fake_build_service.registro)


async def test_create_event_declara_la_zona_horaria(monkeypatch):
    registro = {}
    _fake_build_service.registro = registro
    monkeypatch.setattr(gcal, "_build_service", _fake_build_service)

    event_id = await gcal.create_event(
        calendar_id="reclutador@gmail.com",
        summary="Oscar - CHECADOR DE ALMACÉN",
        description="...",
        start="2026-08-09T12:00:00",  # naive, tal como lo manda el modelo
        end="2026-08-09T12:30:00",
    )

    body = registro["insert"]["body"]
    assert event_id == "evento-fake-123"
    assert body["start"]["timeZone"] == "America/Mexico_City"
    assert body["end"]["timeZone"] == "America/Mexico_City"


async def test_update_event_tambien_declara_la_zona(monkeypatch):
    """Reagendar pasa por patch() y sufría exactamente el mismo 400."""
    registro = {}
    _fake_build_service.registro = registro
    monkeypatch.setattr(gcal, "_build_service", _fake_build_service)

    await gcal.update_event(
        calendar_id="reclutador@gmail.com",
        event_id="evt-1",
        start="2026-08-10T09:00:00",
        end="2026-08-10T09:30:00",
    )

    body = registro["patch"]["body"]
    assert body["start"]["timeZone"] == "America/Mexico_City"
    assert body["end"]["timeZone"] == "America/Mexico_City"


async def test_no_se_pisan_summary_ni_description_al_reagendar(monkeypatch):
    """Se usa patch y no update justamente para no perder esos campos."""
    registro = {}
    _fake_build_service.registro = registro
    monkeypatch.setattr(gcal, "_build_service", _fake_build_service)

    await gcal.update_event("cal@gmail.com", "evt-1", "2026-08-10T09:00:00", "2026-08-10T09:30:00")

    body = registro["patch"]["body"]
    assert set(body.keys()) == {"start", "end"}
