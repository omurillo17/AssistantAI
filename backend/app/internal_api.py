"""Cabeceras de autenticación para las llamadas SALIENTES de backend hacia el
frontend Next.js.

Todas las rutas internas del frontend (/api/webhook/*, /api/upload-cv,
/api/prompt-context, /api/cron/*, /api/db/reclutador_vacantes,
/api/db/encargados-por-nave) validan el mismo header `x-api-key` contra
INTERNAL_API_KEY (ver frontend/src/lib/auth.ts). Centralizar aquí la
construcción del header evita el problema que hubo mientras n8n y Python
convivían: cada call site armaba el header por su cuenta y tres de ellos se
quedaron sin mandarlo, así que activar la llave los tumbaba con 401 en
silencio.
"""

import logging

from app.config import ENV

logger = logging.getLogger("internal_api")

_warned = False


def auth_headers() -> dict[str, str]:
    """Header `x-api-key` para llamar al frontend. Devuelve {} si la llave no
    está configurada: el frontend responde en modo fail-open y avisa por su
    cuenta, así que un despliegue sin la variable sigue funcionando (sin
    autenticación) en vez de romperse."""
    global _warned
    key = ENV.INTERNAL_API_KEY
    if not key:
        if not _warned:
            logger.warning(
                "INTERNAL_API_KEY no está configurada: las llamadas a %s saldrán "
                "sin header x-api-key y sus endpoints quedan sin autenticación.",
                ENV.FRONTEND_API_BASE,
            )
            _warned = True
        return {}
    return {"x-api-key": key}
