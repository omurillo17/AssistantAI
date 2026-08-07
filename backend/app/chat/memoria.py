"""Reemplaza el nodo 'Postgres Chat Memory' (memoryPostgresChat,
contextWindowLength=8) de 3_Sofia - Flujo de Chat.json. Sigue usando la
MISMA tabla `n8n_chat_histories` con el mismo formato jsonb que ya
escribía n8n (compatible con LangChain) -- si algún día hay que revertir
a n8n, la memoria de conversación no se pierde.

Solo se persiste el turno final (mensaje del usuario + texto final del
agente), no los pasos intermedios de tool-calling -- igual que hacía el
nodo original, que solo veía la entrada/salida del agente, no sus
llamadas a herramientas internas."""

import json

from app.db import get_pool

CONTEXT_WINDOW = 8


async def cargar_historial(session_id: str) -> list[dict]:
    """Devuelve los últimos CONTEXT_WINDOW turnos en formato del SDK de
    Gemini: [{"role": "user"|"model", "parts": [{"text": "..."}]}, ...],
    en orden cronológico."""
    pool = get_pool()
    rows = await pool.fetch(
        "SELECT message FROM n8n_chat_histories WHERE session_id = $1 "
        "ORDER BY id DESC LIMIT $2",
        session_id,
        CONTEXT_WINDOW,
    )
    historial = []
    for row in reversed(rows):
        msg = row["message"]
        if isinstance(msg, str):
            msg = json.loads(msg)
        tipo = msg.get("type")
        contenido = (msg.get("data") or {}).get("content", "")
        if not contenido:
            continue
        role = "model" if tipo == "ai" else "user"
        historial.append({"role": role, "parts": [{"text": contenido}]})
    return historial


async def guardar_turno(session_id: str, mensaje_usuario: str, respuesta_ia: str) -> None:
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "INSERT INTO n8n_chat_histories (session_id, message) VALUES ($1, $2::jsonb)",
                session_id,
                _human_message(mensaje_usuario),
            )
            await conn.execute(
                "INSERT INTO n8n_chat_histories (session_id, message) VALUES ($1, $2::jsonb)",
                session_id,
                _ai_message(respuesta_ia),
            )


def _human_message(content: str) -> str:
    return json.dumps({"type": "human", "data": {"content": content, "additional_kwargs": {}, "response_metadata": {}}})


def _ai_message(content: str) -> str:
    return json.dumps({"type": "ai", "data": {"content": content, "additional_kwargs": {}, "response_metadata": {}, "tool_calls": [], "invalid_tool_calls": []}})
