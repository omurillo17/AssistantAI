"""Regulador de ritmo de salida (app/throttle.py).

Existe porque Meta bloqueó el número de producción por contestar demasiados
mensajes en un minuto. Lo que se comprueba aquí es la propiedad que de verdad
importa: por muchas respuestas que se disparen a la vez, entre una salida y la
siguiente hay siempre una separación mínima.
"""

import asyncio
import time

from app import throttle
from app.config import ENV


def _fijar_ritmo(monkeypatch, base: float, jitter: float = 0.0) -> None:
    """Ritmo en milisegundos para que la suite siga siendo rápida."""
    monkeypatch.setattr(type(ENV), "WAHA_SEGUNDOS_ENTRE_MENSAJES", property(lambda self: base))
    monkeypatch.setattr(type(ENV), "WAHA_JITTER_SEGUNDOS", property(lambda self: jitter))
    throttle.reiniciar()


async def test_separa_los_envios_consecutivos(monkeypatch):
    _fijar_ritmo(monkeypatch, base=0.05)

    inicio = time.monotonic()
    for _ in range(4):
        await throttle.esperar_turno()
    transcurrido = time.monotonic() - inicio

    # 4 turnos => al menos 3 esperas entre ellos
    assert transcurrido >= 0.05 * 3


async def test_las_rafagas_concurrentes_tambien_se_ordenan(monkeypatch):
    """El caso del apagón: al volver la luz llegan muchos mensajes juntos y
    todas las respuestas se disparan a la vez. Sin el lock saldrían todas de
    golpe, que es exactamente lo que provocó el bloqueo."""
    _fijar_ritmo(monkeypatch, base=0.05)

    inicio = time.monotonic()
    await asyncio.gather(*(throttle.esperar_turno() for _ in range(5)))
    transcurrido = time.monotonic() - inicio

    assert transcurrido >= 0.05 * 4


async def test_el_primer_mensaje_no_espera(monkeypatch):
    """Un candidato que escribe cuando no hay tráfico debe ser atendido al
    momento; el regulador solo debe notarse cuando hay cola."""
    _fijar_ritmo(monkeypatch, base=30.0)
    # Sin envíos previos, el reloj interno está en 0 y ya pasó el intervalo.
    espera = await asyncio.wait_for(throttle.esperar_turno(), timeout=1.0)

    assert espera == 0.0


async def test_el_jitter_mantiene_el_minimo(monkeypatch):
    """La parte aleatoria solo puede AÑADIR tiempo, nunca acortar la
    separación mínima."""
    _fijar_ritmo(monkeypatch, base=0.05, jitter=0.05)

    inicio = time.monotonic()
    await throttle.esperar_turno()
    await throttle.esperar_turno()
    transcurrido = time.monotonic() - inicio

    assert transcurrido >= 0.05


async def test_se_puede_desactivar(monkeypatch):
    """Con todo en 0 no hay espera: útil en pruebas y en desarrollo local."""
    _fijar_ritmo(monkeypatch, base=0.0, jitter=0.0)

    inicio = time.monotonic()
    for _ in range(20):
        await throttle.esperar_turno()

    assert time.monotonic() - inicio < 0.1


async def test_send_text_pasa_por_el_regulador(monkeypatch):
    """Blindaje: si alguien envía por otro camino que no sea send_text, el
    límite se lo salta. Este test falla si se quita esa llamada."""
    from app import meta_client, waha_client

    _fijar_ritmo(monkeypatch, base=0.05)
    llamadas = []

    async def _fake_esperar_turno():
        llamadas.append(True)
        return 0.0

    class _FakeResp:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {"messages": [{"id": "wamid.123"}]}

    class _FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            return _FakeResp()

    monkeypatch.setattr(type(ENV), "META_WA_PHONE_NUMBER_ID", property(lambda self: "123456789"))
    monkeypatch.setattr(throttle, "esperar_turno", _fake_esperar_turno)
    monkeypatch.setattr(meta_client, "_get_client", lambda: _FakeClient())
    monkeypatch.setattr(waha_client.httpx, "AsyncClient", lambda **k: _FakeClient())

    await waha_client.send_text("default", "521@c.us", "hola")

    assert llamadas, "send_text debe pedir turno al regulador antes de enviar"
