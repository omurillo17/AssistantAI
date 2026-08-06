"""Getters de variables de entorno que fallan cerrado (mismo patrón que
frontend/src/lib/env.ts): si falta una variable crítica, se lanza al
arrancar en vez de fallar silenciosamente en runtime."""

import os


class _Env:
    @property
    def DATABASE_URL(self) -> str:
        val = os.environ.get("DATABASE_URL")
        if not val:
            raise RuntimeError("CRITICAL: DATABASE_URL is missing from environment variables.")
        return val

    @property
    def GOOGLE_TOKEN_ENCRYPTION_KEY(self) -> str:
        val = os.environ.get("GOOGLE_TOKEN_ENCRYPTION_KEY")
        if not val:
            raise RuntimeError("CRITICAL: GOOGLE_TOKEN_ENCRYPTION_KEY is missing from environment variables.")
        return val

    @property
    def GOOGLE_OAUTH_CLIENT_ID(self) -> str:
        val = os.environ.get("GOOGLE_OAUTH_CLIENT_ID")
        if not val:
            raise RuntimeError("CRITICAL: GOOGLE_OAUTH_CLIENT_ID is missing from environment variables.")
        return val

    @property
    def GOOGLE_OAUTH_CLIENT_SECRET(self) -> str:
        val = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET")
        if not val:
            raise RuntimeError("CRITICAL: GOOGLE_OAUTH_CLIENT_SECRET is missing from environment variables.")
        return val

    @property
    def PYTHON_SERVICE_API_KEY(self) -> str | None:
        return os.environ.get("PYTHON_SERVICE_API_KEY") or None

    @property
    def FRONTEND_API_BASE(self) -> str:
        """URL con la que backend llama a los endpoints /api/cron/* del
        frontend Next.js (reemplaza los scheduleTrigger+httpRequest de
        5_Sofia - Mantenimiento y Errores.json). Mismo patrón por defecto
        que TCI_API_BASE/BACKEND_API_BASE: solo cambia si backend corre
        fuera de Docker."""
        return os.environ.get("FRONTEND_API_BASE") or "http://host.docker.internal:3001"

    @property
    def N8N_API_KEY(self) -> str | None:
        """Reutiliza la misma llave que n8n ya le mandaba a estos
        endpoints. No es PYTHON_SERVICE_API_KEY (esa protege la superficie
        ENTRANTE de backend); esta es la llave SALIENTE que backend manda
        hacia el frontend, jugando ahora el mismo rol que jugaba n8n.
        Opcional: si falta, frontend acepta la llamada en modo fail-open
        (ver verifyInternalApiKey en frontend/src/lib/auth.ts)."""
        return os.environ.get("N8N_API_KEY") or None


ENV = _Env()
