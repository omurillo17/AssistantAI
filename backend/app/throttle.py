"""Regulador de ritmo de los mensajes SALIENTES de WhatsApp.

Meta baneó el número de producción por contestar demasiados mensajes en un
minuto. Con WAHA (WhatsApp Web, canal no oficial) la única defensa es no
parecer un bot: mandar pocos mensajes por minuto y con separaciones
irregulares.

Por qué un limitador global y no un retraso aleatorio por mensaje: repartir
al azar no acota la tasa. Si tras un corte de luz entran 100 mensajes y cada
uno espera entre 0 y 4 minutos, siguen saliendo ~25 por minuto -- justo la
ráfaga que provoca el bloqueo. Aquí TODOS los envíos pasan por un mismo
cuello de botella que garantiza una separación mínima, pase lo que pase.

El retraso entre mensajes es `WAHA_SEGUNDOS_ENTRE_MENSAJES` más un extra
aleatorio de hasta `WAHA_JITTER_SEGUNDOS`. La parte aleatoria importa: un
mensaje cada exactamente 8.000 s es un patrón tan delator como no esperar.

Es un limitador en memoria, por proceso. Sirve porque hoy solo el backend
manda mensajes; si algún día hay varias réplicas habría que moverlo a
Postgres o Redis para que el límite sea global de verdad.
"""

import asyncio
import logging
import random
import time

from app.config import ENV

logger = logging.getLogger("throttle")

_lock = asyncio.Lock()
_ultimo_envio: float = 0.0


async def esperar_turno() -> float:
    """Bloquea hasta que sea seguro mandar el siguiente mensaje.

    Devuelve los segundos que se esperó (0.0 si no hubo que esperar), para
    poder registrarlo. El lock se mantiene durante la espera a propósito: así
    las llamadas concurrentes se ordenan en fila en vez de despertar todas a
    la vez y salir juntas.
    """
    global _ultimo_envio

    base = ENV.WAHA_SEGUNDOS_ENTRE_MENSAJES
    jitter = ENV.WAHA_JITTER_SEGUNDOS
    if base <= 0 and jitter <= 0:
        return 0.0  # regulador desactivado (útil en pruebas)

    async with _lock:
        objetivo = _ultimo_envio + base + random.uniform(0, jitter)
        ahora = time.monotonic()
        espera = objetivo - ahora
        if espera > 0:
            logger.info("throttle: esperando %.1fs antes del siguiente mensaje", espera)
            await asyncio.sleep(espera)
            _ultimo_envio = objetivo
        else:
            espera = 0.0
            _ultimo_envio = ahora
        return espera


def reiniciar() -> None:
    """Olvida el último envío. Solo para los tests."""
    global _ultimo_envio
    _ultimo_envio = 0.0
