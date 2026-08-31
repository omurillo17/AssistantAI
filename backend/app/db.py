"""Pool de Postgres compartido por la app (equivalente a
frontend/src/lib/db.ts, que usa un único pg.Pool con DATABASE_URL)."""

from datetime import datetime, timezone

import asyncpg

from app.config import ENV

_pool: asyncpg.Pool | None = None


async def init_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            dsn=ENV.DATABASE_URL,
            min_size=5,
            max_size=20,
            command_timeout=60.0,
        )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("El pool de Postgres no está inicializado (init_pool no se llamó todavía).")
    return _pool


def as_utc(dt: datetime) -> datetime:
    """asyncpg devuelve datetimes 'naive' para columnas TIMESTAMP (sin tz).
    Igual que el setTypeParser(1114, ...) de frontend/src/lib/db.ts, se
    asume que esos valores son UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt
