from unittest.mock import AsyncMock

from app.recordatorios import _preparar_aviso, _solo_citas_del_bot

RECLUTADORES = [
    {"nombre_reclutador": "Ana", "calendar_id": "ana@x.com", "telefono_reclutador": "5211111111111"},
    {"nombre_reclutador": "Luis", "calendar_id": "luis@x.com", "telefono_reclutador": "5222222222222"},
]


def test_aviso_con_descripcion_del_bot():
    # Formato que escribe routers/eventos_calendario.py::_build_description
    evento = {
        "description": "Candidato: Juan Pérez\nTeléfono: 5213312345678 (https://wa.me/5213312345678)\nVacante: Operador",
        "start": {"dateTime": "2026-10-24T16:00:00+00:00"},
        "organizer": {"email": "luis@x.com"},
    }
    aviso = _preparar_aviso(evento, RECLUTADORES)
    assert aviso is not None
    assert aviso["telefono_candidato"] == "5213312345678"
    assert aviso["mensaje_candidato"].startswith("Hola Juan Pérez,")
    assert aviso["telefono_reclutador"] == "5222222222222"


def test_aviso_con_descripcion_manual():
    evento = {"description": "Nombre: Maria\nTel: 3312345678", "start": {}}
    aviso = _preparar_aviso(evento, RECLUTADORES)
    assert aviso["telefono_candidato"] == "3312345678"
    assert aviso["mensaje_candidato"].startswith("Hola Maria,")


def test_sin_coincidencia_usa_dueno_del_calendario_no_el_primero():
    evento = {
        "description": "Tel: 3312345678",
        "start": {},
        "organizer": {"email": "otro@x.com"},
        "_reclutador_calendario": RECLUTADORES[1],
    }
    assert _preparar_aviso(evento, RECLUTADORES)["telefono_reclutador"] == "5222222222222"


def test_sin_telefono_no_hay_aviso():
    assert _preparar_aviso({"description": "Bloqueo de horario", "start": {}}, RECLUTADORES) is None


async def test_solo_avisa_de_eventos_que_son_cita_de_un_candidato():
    """Una invitación externa con 'Tel:' en la descripción no debe disparar
    WhatsApps: solo los eventos cuyo id está en candidatos.event_id."""
    pool = AsyncMock()
    pool.fetch.return_value = [{"event_id": "cita_bot"}]
    eventos = [{"id": "cita_bot"}, {"id": "invitacion_externa"}, {"summary": "sin id"}]

    assert await _solo_citas_del_bot(pool, eventos) == [{"id": "cita_bot"}]


async def test_sin_eventos_no_consulta_la_bd():
    pool = AsyncMock()
    assert await _solo_citas_del_bot(pool, []) == []
    pool.fetch.assert_not_called()
