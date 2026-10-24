"""Migración a `google-genai`: declaraciones de tools, partes de resultado y
parseo de respuestas, todo offline (sin red ni API key real)."""

from datetime import datetime
from unittest.mock import AsyncMock

import pytest
from google.genai import types

from app import gemini_client


def _respuesta(parts, finish="STOP", block=None):
    return types.GenerateContentResponse(
        candidates=[types.Candidate(content=types.Content(role="model", parts=parts), finish_reason=finish)],
        prompt_feedback=types.GenerateContentResponsePromptFeedback(block_reason=block) if block else None,
    )


def test_tools_conservan_nombres_y_requeridos():
    tool = gemini_client.build_tool_declarations(datetime(2026, 10, 23, 10, 0))
    decl = {d.name: d for d in tool.function_declarations}
    assert list(decl) == ["revisar_calendario", "crear_evento", "eliminar_evento"]
    assert decl["revisar_calendario"].parameters.required == ["after", "before"]
    assert decl["crear_evento"].parameters.required == ["start", "end", "resumen_corto"]
    assert decl["crear_evento"].parameters.properties["start"].type == types.Type.STRING
    assert decl["eliminar_evento"].parameters.type == types.Type.OBJECT
    assert not decl["eliminar_evento"].parameters.properties
    assert "2026-10-23T10:00:00" in decl["revisar_calendario"].description
    # Serializa como lo mandaría el SDK (sin `properties: {}` vacío).
    assert "properties" not in decl["eliminar_evento"].parameters.model_dump(exclude_none=True)


def test_parte_respuesta_tool():
    parte = gemini_client.parte_respuesta_tool("crear_evento", {"success": True})
    assert parte.function_response.name == "crear_evento"
    assert parte.function_response.response == {"result": {"success": True}}


def test_extraer_function_calls_y_texto():
    r = _respuesta([types.Part(function_call=types.FunctionCall(name="crear_evento", args={"start": "x"}))])
    calls = gemini_client.extraer_function_calls(r)
    assert [c.name for c in calls] == ["crear_evento"]
    assert dict(calls[0].args) == {"start": "x"}

    r = _respuesta([types.Part.from_text(text="Hola")])
    assert gemini_client.extraer_function_calls(r) == []
    assert gemini_client.extraer_texto(r) == "Hola"


async def test_iniciar_chat_y_enviar_mensaje_offline(monkeypatch):
    monkeypatch.setattr(gemini_client, "_client", None)
    historial = [{"role": "user", "parts": [{"text": "hola"}]}, {"role": "model", "parts": [{"text": "qué tal"}]}]
    chat = await gemini_client.iniciar_chat("prompt", historial, datetime(2026, 10, 23))
    assert chat._config.temperature == 0.6
    assert chat._config.automatic_function_calling.disable is True
    assert [c.role for c in chat.get_history()] == ["user", "model"]

    monkeypatch.setattr(chat, "send_message", AsyncMock(return_value=_respuesta([types.Part.from_text(text="ok")])))
    r = await gemini_client.enviar_mensaje(chat, "hola")
    assert gemini_client.extraer_texto(r) == "ok"

    # Igual que el SDK viejo: un candidato detenido por seguridad es excepción.
    chat.send_message.return_value = _respuesta([types.Part.from_text(text="")], finish="SAFETY")
    with pytest.raises(RuntimeError):
        await gemini_client.enviar_mensaje(chat, "hola")
    chat.send_message.return_value = _respuesta([], block="SAFETY")
    with pytest.raises(RuntimeError):
        await gemini_client.enviar_mensaje(chat, "hola")
