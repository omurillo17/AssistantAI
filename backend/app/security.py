"""Autenticación server-to-server (n8n -> backend) vía header x-api-key,
port de checkApiKey() en frontend/src/lib/auth.ts: falla abierto (permite el
acceso y registra una advertencia una sola vez) si PYTHON_SERVICE_API_KEY no
está configurada, para no bloquear pruebas locales antes de cablear todo."""

import hmac

from fastapi import Header, HTTPException

from app.config import ENV

_warned = False


def _safe_compare(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


async def verify_api_key(x_api_key: str | None = Header(default=None)) -> None:
    global _warned
    expected = ENV.PYTHON_SERVICE_API_KEY
    if not expected:
        if not _warned:
            print(
                "[seguridad] PYTHON_SERVICE_API_KEY no está configurada: "
                "los endpoints de backend quedan sin autenticación. Configúrala "
                "en .env y asegúrate de que n8n mande el header x-api-key con el mismo valor."
            )
            _warned = True
        return
    if x_api_key is None or not _safe_compare(x_api_key, expected):
        raise HTTPException(status_code=401, detail="No autorizado")
