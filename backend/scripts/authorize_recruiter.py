"""Script local (NO corre en Docker) para autorizar el acceso OAuth de
backend al Google Calendar de un reclutador. Requiere que el navegador
del equipo donde se ejecuta pueda completar el consentimiento con la
cuenta de Google de ese reclutador.

Uso:
    cd backend
    python -m scripts.authorize_recruiter --email reclutador@gmail.com

Requiere en el .env de la raíz del repo:
    GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET (OAuth Client ID tipo
    "Desktop app" creado una vez en Google Cloud Console para todo el
    proyecto), GOOGLE_TOKEN_ENCRYPTION_KEY (generar una vez con:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")
    y DB_POSTGRESDB_USER/PASSWORD/DATABASE (ya usadas por docker-compose;
    el script arma la conexión apuntando a localhost:5433, el puerto que
    docker-compose.yml ya expone).
"""

import argparse
import asyncio
import os
from pathlib import Path

import asyncpg
from cryptography.fernet import Fernet
from dotenv import load_dotenv
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/calendar"]

# .env vive en la raíz del repo, no dentro de backend/. override=True para
# que el .env siempre gane sobre una variable ya presente en la sesión de
# la terminal (si no, un $env:... viejo de una prueba anterior queda pegado
# y load_dotenv lo ignora silenciosamente).
load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=True)


def _run_oauth_flow(client_id: str, client_secret: str) -> str:
    client_config = {
        "installed": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"],
        }
    }
    flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
    # prompt="consent" fuerza a Google a reemitir el refresh_token incluso
    # si el reclutador ya autorizó antes (Google solo lo manda la primera vez
    # por defecto).
    credentials = flow.run_local_server(port=0, access_type="offline", prompt="consent")
    if not credentials.refresh_token:
        raise RuntimeError(
            "Google no devolvió un refresh_token. Revoca el acceso previo en "
            "https://myaccount.google.com/permissions y vuelve a correr el script."
        )
    return credentials.refresh_token


def _resolve_database_url() -> str:
    """El .env de la raíz del repo normalmente NO trae DATABASE_URL (esa vive
    en frontend/.env.local) — solo trae las DB_POSTGRESDB_* que usa
    docker-compose. Si no hay DATABASE_URL explícita, la armamos apuntando
    al puerto ya mapeado en docker-compose.yml (localhost:5433)."""
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]

    user = os.environ["DB_POSTGRESDB_USER"]
    password = os.environ["DB_POSTGRESDB_PASSWORD"]
    database = os.environ["DB_POSTGRESDB_DATABASE"]
    host = os.environ.get("DB_POSTGRESDB_HOST_LOCAL", "localhost")
    port = os.environ.get("DB_POSTGRESDB_PORT_LOCAL", "5433")
    return f"postgresql://{user}:{password}@{host}:{port}/{database}"


async def _guardar_credenciales(email: str, refresh_token_encrypted: str) -> None:
    database_url = _resolve_database_url()
    conn = await asyncpg.connect(dsn=database_url)
    try:
        await conn.execute(
            """
            INSERT INTO google_calendar_credentials (calendar_id, refresh_token_encrypted, authorized_by)
            VALUES ($1, $2, $3)
            ON CONFLICT (calendar_id)
            DO UPDATE SET refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
                          updated_at = NOW()
            """,
            email,
            refresh_token_encrypted,
            os.environ.get("USERNAME", "") or os.environ.get("USER", ""),
        )
    finally:
        await conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True, help="Cuenta de Google del reclutador (reclutadores.calendar_id)")
    args = parser.parse_args()

    client_id = os.environ["GOOGLE_OAUTH_CLIENT_ID"]
    client_secret = os.environ["GOOGLE_OAUTH_CLIENT_SECRET"]
    encryption_key = os.environ["GOOGLE_TOKEN_ENCRYPTION_KEY"]

    # Validar la key ANTES de abrir el navegador: si está mal, que falle rápido
    # y sin obligar a repetir el login de Google por nada.
    try:
        fernet = Fernet(encryption_key.encode())
    except ValueError as exc:
        raise SystemExit(
            f"GOOGLE_TOKEN_ENCRYPTION_KEY inválida (longitud actual: {len(encryption_key)}, "
            "debe ser 44 caracteres terminando en '='). Revisa que el .env tenga la key completa "
            "y que no haya quedado una vieja pegada en la sesión de la terminal."
        ) from exc

    print(f"Abriendo el navegador para autorizar '{args.email}'...")
    refresh_token = _run_oauth_flow(client_id, client_secret)
    refresh_token_encrypted = fernet.encrypt(refresh_token.encode()).decode()

    asyncio.run(_guardar_credenciales(args.email, refresh_token_encrypted))
    print(f"Listo: credenciales de '{args.email}' guardadas en google_calendar_credentials.")


if __name__ == "__main__":
    main()
