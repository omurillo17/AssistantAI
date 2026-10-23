"""Getters de variables de entorno que fallan cerrado (mismo patrón que
frontend/src/lib/env.ts): si falta una variable crítica, se lanza al
arrancar en vez de fallar silenciosamente en runtime."""

import os


class _Env:
    @property
    def DATABASE_URL(self) -> str:  # NOSONAR
        val = os.environ.get("DATABASE_URL")
        if not val:
            raise RuntimeError("CRITICAL: DATABASE_URL is missing from environment variables.")
        return val

    @property
    def GOOGLE_TOKEN_ENCRYPTION_KEY(self) -> str:  # NOSONAR
        val = os.environ.get("GOOGLE_TOKEN_ENCRYPTION_KEY")
        if not val:
            raise RuntimeError("CRITICAL: GOOGLE_TOKEN_ENCRYPTION_KEY is missing from environment variables.")
        return val

    @property
    def GOOGLE_OAUTH_CLIENT_ID(self) -> str:  # NOSONAR
        val = os.environ.get("GOOGLE_OAUTH_CLIENT_ID")
        if not val:
            raise RuntimeError("CRITICAL: GOOGLE_OAUTH_CLIENT_ID is missing from environment variables.")
        return val

    @property
    def GOOGLE_OAUTH_CLIENT_SECRET(self) -> str:  # NOSONAR
        val = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET")
        if not val:
            raise RuntimeError("CRITICAL: GOOGLE_OAUTH_CLIENT_SECRET is missing from environment variables.")
        return val

    @property
    def PYTHON_SERVICE_API_KEY(self) -> str | None:  # NOSONAR
        return os.environ.get("PYTHON_SERVICE_API_KEY") or None

    @property
    def FRONTEND_API_BASE(self) -> str:  # NOSONAR
        """URL con la que backend llama a los endpoints /api/cron/* del
        frontend Next.js (reemplaza los scheduleTrigger+httpRequest de
        5_Sofia - Mantenimiento y Errores.json). Mismo patrón por defecto
        que TCI_API_BASE/BACKEND_API_BASE: solo cambia si backend corre
        fuera de Docker."""
        return os.environ.get("FRONTEND_API_BASE") or "http://host.docker.internal:3001"

    @property
    def INTERNAL_API_KEY(self) -> str | None:  # NOSONAR
        """Llave SALIENTE que backend manda como `x-api-key` en TODAS sus
        llamadas al frontend Next.js (/api/webhook/*, /api/upload-cv,
        /api/prompt-context, /api/cron/*, /api/db/*). No confundir con
        PYTHON_SERVICE_API_KEY, que protege la superficie ENTRANTE de backend.

        Acepta los nombres viejos N8N_API_KEY y WEBHOOK_API_KEY como respaldo
        para no romper despliegues que aún no renombran la variable: cuando
        n8n orquestaba el flujo hacían falta dos llaves separadas (n8n no se
        podía redesplegar junto con el frontend); hoy los dos extremos son
        nuestros y se despliegan juntos, así que una sola llave basta."""
        return (
            os.environ.get("INTERNAL_API_KEY")
            or os.environ.get("N8N_API_KEY")
            or os.environ.get("WEBHOOK_API_KEY")
            or None
        )

    @property
    def GEMINI_API_KEY(self) -> str:  # NOSONAR
        val = os.environ.get("GEMINI_API_KEY")
        if not val:
            raise RuntimeError("CRITICAL: GEMINI_API_KEY is missing from environment variables.")
        return val

    @property
    def WAHA_API_KEY(self) -> str:  # NOSONAR
        val = os.environ.get("WAHA_API_KEY")
        if not val:
            raise RuntimeError("CRITICAL: WAHA_API_KEY is missing from environment variables.")
        return val

    @property
    def WAHA_BASE_URL(self) -> str:  # NOSONAR
        return os.environ.get("WAHA_BASE_URL") or "http://waha:3000"

    @property
    def WAHA_SEGUNDOS_ENTRE_MENSAJES(self) -> float:  # NOSONAR
        """Separación mínima entre dos mensajes salientes, en segundos.

        Con 8 s salen como mucho ~7 mensajes por minuto (menos aún con el
        jitter). Meta bloqueó el número de producción por responder a muchos
        de golpe, así que el valor por defecto es deliberadamente conservador:
        más vale que un candidato espere medio minuto a perder la línea.
        Poner 0 (junto con el jitter) desactiva el regulador."""
        try:
            return max(0.0, float(os.environ.get("WAHA_SEGUNDOS_ENTRE_MENSAJES", "8")))
        except ValueError:
            return 8.0

    @property
    def WAHA_JITTER_SEGUNDOS(self) -> float:  # NOSONAR
        """Segundos aleatorios extra que se suman a la separación anterior.
        Un ritmo exacto es tan reconocible como no esperar nada."""
        try:
            return max(0.0, float(os.environ.get("WAHA_JITTER_SEGUNDOS", "7")))
        except ValueError:
            return 7.0

    @property
    def ALERTAS_ADMIN_TELEFONO(self) -> str | None:  # NOSONAR
        """WhatsApp del administrador del sistema (el ROOT). Recibe una copia
        de las alertas de fallo del agente, además del reclutador afectado.

        Va aquí y no en la BD porque es configuración de despliegue: tiene que
        funcionar aunque la base esté vacía o inaccesible, que es justo cuando
        más falta hace enterarse. Formato: solo dígitos, con código de país
        (ej. 5213300000000). Si no se define, solo se avisa al reclutador."""
        valor = (os.environ.get("ALERTAS_ADMIN_TELEFONO") or "").strip()
        return valor or None

    @property
    def VIRGO_FILES_DIR(self) -> str:  # NOSONAR
        """Mismo volumen que monta n8n en /home/node/virgo_files (./virgo_data
        del repo), montado aquí en /app/virgo_files -- para leer
        prompts/chat_prompt.md y data/prompt_context.json tal como hacían
        CargarPrompt/Vacantes en n8n."""
        return os.environ.get("VIRGO_FILES_DIR") or "/app/virgo_files"

    @property
    def META_WA_ACCESS_TOKEN(self) -> str | None:  # NOSONAR
        return os.environ.get("META_WA_ACCESS_TOKEN") or None

    @property
    def META_WA_PHONE_NUMBER_ID(self) -> str | None:  # NOSONAR
        return os.environ.get("META_WA_PHONE_NUMBER_ID") or None

    @property
    def META_WA_WABA_ID(self) -> str | None:  # NOSONAR
        return os.environ.get("META_WA_WABA_ID") or None

    @property
    def META_WA_VERIFY_TOKEN(self) -> str | None:  # NOSONAR
        # Sin valor por defecto: un token conocido públicamente no verifica nada.
        return os.environ.get("META_WA_VERIFY_TOKEN") or None

    @property
    def DEFAULT_RECRUITER_PHONE(self) -> str:  # NOSONAR
        return os.environ.get("DEFAULT_RECRUITER_PHONE", "")

    @property
    def DEFAULT_CALENDAR_ID(self) -> str:  # NOSONAR
        """Calendario de respaldo cuando el equipo no tiene ninguno usable.
        Sin valor por defecto: si falta, no se agenda (falla cerrado) en vez
        de mandar citas al calendario personal de alguien."""
        return os.environ.get("DEFAULT_CALENDAR_ID", "")

    @property
    def TEST_DEV_PHONE(self) -> str:  # NOSONAR
        return os.environ.get("TEST_DEV_PHONE", "")

    @property
    def ENABLE_TEST_COMMANDS(self) -> bool:  # NOSONAR
        """Habilita comandos de prueba por WhatsApp (p.ej. '/reset_sofia'),
        y solo para TEST_DEV_PHONE. Apagado por defecto en producción."""
        return os.environ.get("ENABLE_TEST_COMMANDS", "").strip().lower() in ("1", "true", "yes", "si", "sí")

    @property
    def WAHA_WEBHOOK_HMAC_KEY(self) -> str | None:  # NOSONAR
        """Llave HMAC configurada en el webhook de la sesión de WAHA
        (webhooks[].hmac.key). WAHA firma cada POST con HMAC-SHA512 del cuerpo
        crudo en el header X-Webhook-Hmac. Ver routers/whatsapp.py."""
        return os.environ.get("WAHA_WEBHOOK_HMAC_KEY") or None


ENV = _Env()
