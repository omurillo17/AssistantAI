"""Lee y desencripta el refresh token OAuth de Google Calendar guardado en
la tabla google_calendar_credentials (una fila por reclutador, llenada a
mano con scripts/authorize_recruiter.py)."""

from cryptography.fernet import Fernet, InvalidToken

from app.config import ENV
from app.db import get_pool


class CredencialesNoEncontradas(Exception):
    def __init__(self, calendar_id: str):
        self.calendar_id = calendar_id
        super().__init__(
            f"No hay credenciales OAuth para '{calendar_id}'. "
            f"Ejecuta backend/scripts/authorize_recruiter.py --email {calendar_id}"
        )


async def get_refresh_token(calendar_id: str) -> str:
    pool = get_pool()
    row = await pool.fetchrow(
        "SELECT refresh_token_encrypted FROM google_calendar_credentials WHERE calendar_id = $1",
        calendar_id,
    )
    if row is None:
        raise CredencialesNoEncontradas(calendar_id)

    fernet = Fernet(ENV.GOOGLE_TOKEN_ENCRYPTION_KEY.encode())
    try:
        return fernet.decrypt(row["refresh_token_encrypted"].encode()).decode()
    except InvalidToken as exc:
        raise RuntimeError(
            f"No se pudo desencriptar el refresh token de '{calendar_id}': "
            "GOOGLE_TOKEN_ENCRYPTION_KEY no coincide con la usada para guardarlo."
        ) from exc
