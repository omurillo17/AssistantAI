"""Autenticación server-to-server (n8n/frontend -> backend) vía header
x-api-key. Falla CERRADO: si PYTHON_SERVICE_API_KEY no está configurada,
todas las llamadas a /internal/* se rechazan (a diferencia de
checkApiKey() en frontend/src/lib/auth.ts, que sí tiene rutas legadas con
llamadas sin header y debe seguir fallando abierto por ahora)."""

import hmac

from fastapi import Header, HTTPException

from app.config import ENV


def _safe_compare(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


def verify_api_key(x_api_key: str | None = Header(default=None)) -> None:
    expected = ENV.PYTHON_SERVICE_API_KEY
    if not expected:
        raise HTTPException(status_code=401, detail="PYTHON_SERVICE_API_KEY no configurada en el servidor")
    if x_api_key is None or not _safe_compare(x_api_key, expected):
        raise HTTPException(status_code=401, detail="No autorizado")
