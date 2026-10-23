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
    monkeypatch.setattr(_fake_build_service, "registro", registro, raising=False)
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
    monkeypatch.setattr(_fake_build_service, "registro", registro, raising=False)
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
    monkeypatch.setattr(_fake_build_service, "registro", registro, raising=False)
    monkeypatch.setattr(gcal, "_build_service", _fake_build_service)

    await gcal.update_event("cal@gmail.com", "evt-1", "2026-08-10T09:00:00", "2026-08-10T09:30:00")

    body = registro["patch"]["body"]
    assert set(body.keys()) == {"start", "end"}


def test_calcular_slots_disponibles_descarta_hora_comida():
    from datetime import datetime
    from zoneinfo import ZoneInfo
    tz = ZoneInfo("America/Mexico_City")

    # Miércoles 7 de Octubre 2026: Paty tiene Hora de Comida 13:30 - 15:30
    start_dt = datetime(2026, 10, 7, 8, 0, tzinfo=tz)
    end_dt = datetime(2026, 10, 7, 19, 0, tzinfo=tz)
    now = datetime(2026, 10, 7, 8, 0, tzinfo=tz)

    eventos = [
        {
            "id": "comida-paty",
            "summary": "Hora de Comida - Paty Gama",
            "start": {"dateTime": "2026-10-07T13:30:00-06:00"},
            "end": {"dateTime": "2026-10-07T15:30:00-06:00"},
        },
        {
            "id": "cita-10am",
            "summary": "Candidato Previo",
            "start": {"dateTime": "2026-10-07T10:00:00-06:00"},
            "end": {"dateTime": "2026-10-07T11:00:00-06:00"},
        },
    ]

    slots = gcal.calcular_slots_disponibles(eventos, start_dt, end_dt, now)
    dia_slots = slots[start_dt.date()]

    # 10:00 ocupado por cita previa
    assert (10, 0) not in dia_slots
    # 09:00, 11:00, 12:00 libres
    assert (9, 0) in dia_slots
    assert (11, 0) in dia_slots
    assert (12, 0) in dia_slots
    # Jamás se ofrecen horas de comida ni fuera de horario
    assert (13, 0) not in dia_slots
    assert (13, 30) not in dia_slots
    assert (14, 0) not in dia_slots
    assert (14, 30) not in dia_slots
    assert (15, 0) not in dia_slots
    # Tarde: 15:30 y 16:00 libres
    assert (15, 30) in dia_slots
    assert (16, 0) in dia_slots


def test_calcular_slots_disponibles_bloqueos_individuales_por_reclutador():
    from datetime import datetime
    from zoneinfo import ZoneInfo
    tz = ZoneInfo("America/Mexico_City")

    start_dt = datetime(2026, 10, 7, 8, 0, tzinfo=tz)
    end_dt = datetime(2026, 10, 7, 19, 0, tzinfo=tz)
    now = datetime(2026, 10, 7, 8, 0, tzinfo=tz)

    # Caso 1: Reclutador sin bloqueo a la 1:00 o 2:00 (ej. Michelle o Elibeth)
    slots_libres = gcal.calcular_slots_disponibles([], start_dt, end_dt, now)
    dia_libres = slots_libres[start_dt.date()]
    assert (13, 0) in dia_libres
    assert (14, 0) in dia_libres
    assert (15, 0) in dia_libres

    # Caso 2: Reclutador que come de 14:00 a 15:00
    eventos_comida_2pm = [
        {
            "id": "comida-2pm",
            "summary": "Comida Reclutador",
            "start": {"dateTime": "2026-10-07T14:00:00-06:00"},
            "end": {"dateTime": "2026-10-07T15:00:00-06:00"},
        }
    ]
    slots_2pm = gcal.calcular_slots_disponibles(eventos_comida_2pm, start_dt, end_dt, now)
    dia_2pm = slots_2pm[start_dt.date()]
    assert (13, 0) in dia_2pm
    assert (14, 0) not in dia_2pm  # Bloqueado solo 14:00
    assert (15, 0) in dia_2pm


def test_calcular_slots_disponibles_ignora_domingos():
    from datetime import datetime
    from zoneinfo import ZoneInfo
    tz = ZoneInfo("America/Mexico_City")

    # Domingo 11 de Octubre 2026
    start_dt = datetime(2026, 10, 11, 8, 0, tzinfo=tz)
    end_dt = datetime(2026, 10, 11, 19, 0, tzinfo=tz)
    now = datetime(2026, 10, 11, 8, 0, tzinfo=tz)

    slots = gcal.calcular_slots_disponibles([], start_dt, end_dt, now)
    assert slots[start_dt.date()] == []


def test_calcular_slots_disponibles_sabado():
    from datetime import datetime
    from zoneinfo import ZoneInfo
    tz = ZoneInfo("America/Mexico_City")

    # Sábado 10 de Octubre 2026
    start_dt = datetime(2026, 10, 10, 8, 0, tzinfo=tz)
    end_dt = datetime(2026, 10, 10, 19, 0, tzinfo=tz)
    now = datetime(2026, 10, 10, 8, 0, tzinfo=tz)

    slots = gcal.calcular_slots_disponibles([], start_dt, end_dt, now)
    sab_slots = slots[start_dt.date()]
    # Sábados solo 9, 10 y 11
    assert sab_slots == [(9, 0), (10, 0), (11, 0)]


def test_formatear_disponibilidad_para_prompt():
    from datetime import date
    slots = {
        date(2026, 10, 7): [(9, 0), (11, 0), (15, 30)],
        date(2026, 10, 11): [],
    }
    texto = gcal.formatear_disponibilidad_para_prompt(slots)
    assert "*Miércoles, 7 de octubre de 2026*" in texto
    assert "- 9:00 a.m." in texto
    assert "- 11:00 a.m." in texto
    assert "- 3:30 p.m." in texto
    assert "*Domingo, 11 de octubre de 2026*" in texto
    assert "_Sin horarios disponibles_" in texto


async def test_obtener_conflictos_detecta_colision(monkeypatch):
    from datetime import datetime
    from zoneinfo import ZoneInfo
    tz = ZoneInfo("America/Mexico_City")

    async def mock_list(cal_id, s, e, max_results=50):
        return [
            {
                "id": "comida",
                "summary": "Hora de Comida",
                "start": {"dateTime": "2026-10-07T13:30:00-06:00"},
                "end": {"dateTime": "2026-10-07T15:30:00-06:00"},
            }
        ]

    monkeypatch.setattr(gcal, "list_events", mock_list)

    # Intento de cita a las 13:30
    conf = await gcal.obtener_conflictos_calendario(
        "cal@gmail.com",
        datetime(2026, 10, 7, 13, 30, tzinfo=tz),
        datetime(2026, 10, 7, 14, 30, tzinfo=tz),
    )
    assert len(conf) == 1
    assert conf[0]["summary"] == "Hora de Comida"

    # Intento de cita a las 13:00 (termina 14:00, invade 30 min)
    conf2 = await gcal.obtener_conflictos_calendario(
        "cal@gmail.com",
        datetime(2026, 10, 7, 13, 0, tzinfo=tz),
        datetime(2026, 10, 7, 14, 0, tzinfo=tz),
    )
    assert len(conf2) == 1

