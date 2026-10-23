from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo
import pytest

from app.routers import eventos_calendario
from app.routers.eventos_calendario import CrearEventoRequest

MX_TZ = ZoneInfo("America/Mexico_City")


@pytest.mark.asyncio
async def test_crear_evento_rechaza_fuera_de_horario_laboral():
    # Intento de cita a las 20:00 (fuera de la jornada 09:00 - 17:00)
    now = datetime.now(MX_TZ)
    dias_al_lunes = (7 - now.weekday()) % 7
    if dias_al_lunes == 0:
        dias_al_lunes = 7
    lunes_futuro = (now + timedelta(days=dias_al_lunes)).replace(hour=20, minute=0, second=0, microsecond=0)
    lunes_fin = lunes_futuro + timedelta(hours=1)

    req = CrearEventoRequest(
        start=lunes_futuro.isoformat(),
        end=lunes_fin.isoformat(),
        calendar_id="paty@gmail.com",
        telefono="5213312345678",
    )

    res = await eventos_calendario.crear_evento(req)
    assert res["success"] is False
    assert "fuera de la jornada laboral oficial" in res["error"]


@pytest.mark.asyncio
async def test_crear_evento_rechaza_bloqueo_comida_personalizado_del_reclutador():
    # Cita en la hora que este reclutador tiene bloqueada como su comida
    now = datetime.now(MX_TZ)
    dias_al_lunes = (7 - now.weekday()) % 7
    if dias_al_lunes == 0:
        dias_al_lunes = 7
    lunes_futuro = (now + timedelta(days=dias_al_lunes)).replace(hour=13, minute=30, second=0, microsecond=0)
    lunes_fin = lunes_futuro + timedelta(hours=1)

    req = CrearEventoRequest(
        start=lunes_futuro.isoformat(),
        end=lunes_fin.isoformat(),
        calendar_id="paty@gmail.com",
        telefono="5213312345678",
    )

    with patch("app.routers.eventos_calendario.obtener_conflictos_calendario", new_callable=AsyncMock) as mock_conf:
        mock_conf.return_value = [{"id": "ev-comida", "summary": "Hora de Comida - Paty Gama"}]
        res = await eventos_calendario.crear_evento(req)
        assert res["success"] is False
        assert "ya está ocupado" in res["error"]
        assert "Paty Gama" not in res["error"]  # no filtra el título del evento


@pytest.mark.asyncio
async def test_crear_evento_rechaza_domingo():
    now = datetime.now(MX_TZ)
    # Buscamos el próximo domingo
    dias_al_dom = (6 - now.weekday()) % 7
    if dias_al_dom == 0:
        dias_al_dom = 7
    dom_futuro = (now + timedelta(days=dias_al_dom)).replace(hour=10, minute=0, second=0, microsecond=0)
    dom_fin = dom_futuro + timedelta(hours=1)

    req = CrearEventoRequest(
        start=dom_futuro.isoformat(),
        end=dom_fin.isoformat(),
        calendar_id="paty@gmail.com",
        telefono="5213312345678",
    )

    res = await eventos_calendario.crear_evento(req)
    assert res["success"] is False
    assert "domingo" in res["error"].lower()


@pytest.mark.asyncio
async def test_crear_evento_rechaza_colision_gcal():
    now = datetime.now(MX_TZ)
    dias_al_lunes = (7 - now.weekday()) % 7
    if dias_al_lunes == 0:
        dias_al_lunes = 7
    lunes_futuro = (now + timedelta(days=dias_al_lunes)).replace(hour=10, minute=0, second=0, microsecond=0)
    lunes_fin = lunes_futuro + timedelta(hours=1)

    req = CrearEventoRequest(
        start=lunes_futuro.isoformat(),
        end=lunes_fin.isoformat(),
        calendar_id="paty@gmail.com",
        telefono="5213312345678",
    )

    with patch("app.routers.eventos_calendario.obtener_conflictos_calendario", new_callable=AsyncMock) as mock_conf:
        mock_conf.return_value = [{"id": "ev1", "summary": "Junta General"}]
        res = await eventos_calendario.crear_evento(req)
        assert res["success"] is False
        assert "ya está ocupado" in res["error"]


@pytest.mark.asyncio
async def test_crear_evento_exitoso_si_horario_libre():
    now = datetime.now(MX_TZ)
    dias_al_lunes = (7 - now.weekday()) % 7
    if dias_al_lunes == 0:
        dias_al_lunes = 7
    lunes_futuro = (now + timedelta(days=dias_al_lunes)).replace(hour=10, minute=0, second=0, microsecond=0)
    lunes_fin = lunes_futuro + timedelta(hours=1)

    req = CrearEventoRequest(
        start=lunes_futuro.isoformat(),
        end=lunes_fin.isoformat(),
        calendar_id="paty@gmail.com",
        telefono="5213312345678",
        nombre="Candidato Prueba",
    )

    mock_pool = AsyncMock()
    mock_pool.fetchrow.return_value = {"id": 1, "nombre": "Candidato Prueba", "vacante_interes": "General", "asignado_a_id": "r1"}

    with patch("app.routers.eventos_calendario.obtener_conflictos_calendario", new_callable=AsyncMock) as mock_conf, \
         patch("app.routers.eventos_calendario.create_event", new_callable=AsyncMock) as mock_create, \
         patch("app.routers.eventos_calendario.get_pool", return_value=mock_pool):
        mock_conf.return_value = []
        mock_create.return_value = "evento-gcal-999"

        res = await eventos_calendario.crear_evento(req)
        assert res["success"] is True
        assert res["event_id"] == "evento-gcal-999"
