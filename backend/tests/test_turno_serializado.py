"""Regresión: dos mensajes seguidos del mismo candidato no deben procesarse en
paralelo.

El debounce de `ingesta` solo agrupa lo que llega mientras se espera; en cuanto
arranca la tarea, el deadline se borra y un mensaje nuevo abría un ciclo propio.
Como un turno lee el historial al empezar y lo escribe al final —con Gemini y el
regulador de ritmo (~8-15 s por mensaje) en medio—, el segundo turno cargaba un
historial sin la última respuesta del bot y el modelo la repetía.

En producción: la candidata contestó "Si" al aviso de privacidad y Sofía le
mandó el aviso otra vez, idéntico.
"""

import asyncio

import pytest

from app.chat import ingesta


@pytest.fixture(autouse=True)
def _limpiar_estado():
    ingesta._debounce_deadlines.clear()
    ingesta._turno_locks.clear()
    ingesta._turno_en_espera.clear()
    yield
    ingesta._debounce_deadlines.clear()
    ingesta._turno_locks.clear()
    ingesta._turno_en_espera.clear()


@pytest.fixture(autouse=True)
def _sin_espera(monkeypatch):
    """El debounce real espera 8 s; en el test no aporta nada."""
    monkeypatch.setattr(ingesta, "_DEBOUNCE_SECONDS", 0.0)


async def test_los_turnos_del_mismo_telefono_no_se_solapan():
    en_curso = 0
    solapamiento = False
    terminados = []

    async def tarea():
        nonlocal en_curso, solapamiento
        en_curso += 1
        if en_curso > 1:
            solapamiento = True
        # Cede el control: si no hubiera exclusión, el otro turno entraría aquí.
        await asyncio.sleep(0.05)
        en_curso -= 1
        terminados.append(True)

    await asyncio.gather(
        ingesta._procesar_con_debounce("521111", tarea),
        ingesta._procesar_con_debounce("521111", tarea),
    )

    assert len(terminados) == 2, "el test no reprodujo los dos turnos"
    assert not solapamiento, "dos turnos del mismo candidato corrieron a la vez"


async def test_el_segundo_turno_ve_lo_que_dejo_el_primero():
    """Lo que de verdad importa: el turno que espera debe leer el estado ya
    escrito por el anterior, que es justo lo que fallaba con el aviso de
    privacidad."""
    expediente = {"privacidad_aceptada": False}
    leidos = []

    async def turno():
        leidos.append(expediente["privacidad_aceptada"])
        await asyncio.sleep(0.05)
        expediente["privacidad_aceptada"] = True

    await asyncio.gather(
        ingesta._procesar_con_debounce("521222", turno),
        ingesta._procesar_con_debounce("521222", turno),
    )

    assert len(leidos) == 2, "el test no reprodujo los dos turnos"
    assert leidos[1] is True, "el segundo turno leyó el expediente sin lo que dejó el primero"


async def test_telefonos_distintos_si_corren_en_paralelo():
    """La exclusión es por candidato: serializar todo el bot lo haría inusable."""
    en_curso = 0
    hubo_paralelo = False

    async def tarea():
        nonlocal en_curso, hubo_paralelo
        en_curso += 1
        if en_curso > 1:
            hubo_paralelo = True
        await asyncio.sleep(0.05)
        en_curso -= 1

    await asyncio.gather(
        ingesta._procesar_con_debounce("521333", tarea),
        ingesta._procesar_con_debounce("521444", tarea),
    )

    assert hubo_paralelo, "candidatos distintos quedaron serializados entre sí"


async def test_no_deja_locks_colgados():
    """El diccionario de locks crece con cada candidato que escribe."""

    async def tarea():
        await asyncio.sleep(0)

    for i in range(5):
        await ingesta._procesar_con_debounce(f"5215{i}", tarea)

    assert ingesta._turno_locks == {}
    assert ingesta._turno_en_espera == {}


async def test_un_fallo_libera_el_lock():
    """Si un turno revienta, el siguiente mensaje del candidato no puede quedar
    esperando para siempre."""

    async def explota():
        raise RuntimeError("Gemini se cayó")

    with pytest.raises(RuntimeError):
        await ingesta._procesar_con_debounce("521999", explota)

    assert ingesta._turno_locks == {}
    assert ingesta._turno_en_espera == {}

    corrio = False

    async def siguiente():
        nonlocal corrio
        corrio = True

    await ingesta._procesar_con_debounce("521999", siguiente)
    assert corrio
