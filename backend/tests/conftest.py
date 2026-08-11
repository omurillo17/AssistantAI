"""Configuración común de los tests.

Los módulos de `app` leen su configuración de variables de entorno de forma
perezosa (`app.config.ENV` usa properties), así que basta con poner valores
ficticios ANTES de importarlos para que la suite corra sin `.env`, sin base
de datos y sin red.
"""

import os
import sys
from pathlib import Path

# `backend/` en el path para poder importar `app.*` sin instalar el paquete.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
os.environ.setdefault("GEMINI_API_KEY", "test-key")
os.environ.setdefault("WAHA_API_KEY", "test-key")
os.environ.setdefault("GOOGLE_TOKEN_ENCRYPTION_KEY", "test-key")
os.environ.setdefault("GOOGLE_OAUTH_CLIENT_ID", "test-id")
os.environ.setdefault("GOOGLE_OAUTH_CLIENT_SECRET", "test-secret")
os.environ.setdefault("INTERNAL_API_KEY", "test-internal-key")

# Los tests no deben depender del .env de la máquina donde corren: si el
# entorno real trae un teléfono de administrador configurado, las alertas
# salen a dos destinatarios y los conteos de mensajes cambian según dónde se
# ejecute la suite. Cada test que necesite ese caso lo activa por su cuenta
# con monkeypatch.
os.environ.pop("ALERTAS_ADMIN_TELEFONO", None)
