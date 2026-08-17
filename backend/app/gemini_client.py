"""Wrapper del SDK de Google Gemini (`google-generativeai`). El SDK es
síncrono, así que cada llamada corre en un hilo aparte (`asyncio.to_thread`),
mismo patrón que `google_calendar.py`.

Reemplaza 3 nodos LangChain de n8n:
- `Analyze document` (`googleGemini`, resource=document) -> `analizar_documento`
- `TranscribirAudio` (`googleGemini`, resource=audio) -> `transcribir_audio`
- `AI Chat` (`@n8n/n8n-nodes-langchain.agent`, con `IA CHAT`=lmChatGoogleGemini,
  temperature=0.6) -> `iniciar_chat`/`enviar_mensaje`, con tool-calling manual
  (no se usa "automatic function calling" del SDK porque las 3 tools reales
  son async -- llamadas a Postgres/Google Calendar -- y el modo automático
  del SDK solo soporta funciones Python síncronas)."""

import asyncio
import logging
from datetime import datetime

import google.generativeai as genai
from google.generativeai.types import FunctionDeclaration, Tool

from app.config import ENV
from app.utils.fechas_es import DIAS_ES

logger = logging.getLogger("gemini_client")

MODEL_NAME = "models/gemini-2.5-flash"
_CHAT_TEMPERATURE = 0.6

_configured = False


def _ensure_configured() -> None:
    global _configured
    if not _configured:
        genai.configure(api_key=ENV.GEMINI_API_KEY)
        _configured = True


async def analizar_documentos(archivos: list[dict], prompt: str) -> str:
    """Envía uno o varios documentos (imágenes/PDFs) + prompt de validación a Gemini.
    Cada elemento en `archivos` debe ser: {"mime_type": str, "data": bytes}.
    Gemini analiza todos los archivos juntos en un único turno multimodal."""
    _ensure_configured()

    def _call() -> str:
        model = genai.GenerativeModel(MODEL_NAME)
        contents = [{"mime_type": a["mime_type"], "data": a["data"]} for a in archivos]
        contents.append(prompt)
        response = model.generate_content(contents)
        return response.text

    return await asyncio.to_thread(_call)


async def analizar_documento(data: bytes, mime_type: str, prompt: str) -> str:
    """Wrapper retrocompatible para un único archivo."""
    return await analizar_documentos([{"mime_type": mime_type, "data": data}], prompt)


async def transcribir_audio(data: bytes, mime_type: str) -> str:
    """Puerto de 'TranscribirAudio': sin prompt custom (igual que el nodo
    original), Gemini transcribe el audio a texto plano."""
    _ensure_configured()

    def _call() -> str:
        model = genai.GenerativeModel(MODEL_NAME)
        response = model.generate_content([{"mime_type": mime_type, "data": data}])
        return response.text

    return await asyncio.to_thread(_call)


def build_tool_declarations(now: datetime) -> Tool:
    """Declaraciones de las 3 tools del agente 'AI Chat': RevisarCalendario
    (solo lectura), Crear Evento, Eliminar Evento -- mismos nombres/params
    que exponían los nodos googleCalendarTool/httpRequestTool en n8n, para
    que el prompt (que ya menciona estas herramientas) siga siendo válido.

    `now` (America/Mexico_City) se re-interpola en la descripción de
    revisar_calendario en cada turno -- igual que hacía n8n con
    `{{ $now... }}` dentro del toolDescription, evaluado en cada
    invocación del nodo, no una sola vez al definir la tool."""
    return Tool(function_declarations=[
        FunctionDeclaration(
            name="revisar_calendario",
            description=(
                "Usa esta herramienta ÚNICAMENTE para verificar disponibilidad de horarios "
                "antes de ofrecer una cita nueva con crear_evento. Devuelve la lista de "
                "eventos OCUPADOS con sus detalles e IDs.\n\n"
                "NO la uses para cancelaciones: eliminar_evento no necesita ningún ID ni "
                "búsqueda previa, el sistema ya sabe internamente cuál es la cita del "
                "candidato -- si quiere cancelar, llama a eliminar_evento directamente.\n\n"
                "¡ALERTA CRÍTICA!: SI LA HERRAMIENTA DEVUELVE UNA LISTA VACÍA (0 EVENTOS), "
                "SIGNIFICA QUE TODO EL CALENDARIO ESTÁ TOTALMENTE LIBRE Y DISPONIBLE. NO "
                "SIGNIFICA QUE NO HAYA HORARIOS. EN ESE CASO, OFRECE CUALQUIER HORARIO "
                "DENTRO DE LA JORNADA OFICIAL.\n\n"
                "CONTEXTO TEMPORAL CRÍTICO:\n"
                f"- La fecha y hora actual EXACTA es: {now.isoformat()}\n"
                f"- El día de la semana es: {DIAS_ES[now.weekday()]}\n"
                f"- El año actual es: {now.year}\n\n"
                "INSTRUCCIONES:\n"
                "1. Calcula todas las fechas relativas (\"mañana\", \"el viernes\", \"próxima "
                "semana\") basándote en la FECHA ACTUAL de arriba.\n"
                "2. JAMÁS agendes citas en el pasado.\n"
                "3. Si el usuario dice \"viernes\" y hoy es lunes 16, el viernes es 20 (del "
                "mismo mes y año)."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "after": {"type": "string", "description": "Fecha/hora ISO 8601 desde la cual buscar (America/Mexico_City)."},
                    "before": {"type": "string", "description": "Fecha/hora ISO 8601 hasta la cual buscar (America/Mexico_City)."},
                },
                "required": ["after", "before"],
            },
        ),
        FunctionDeclaration(
            name="crear_evento",
            description="Crea una cita de entrevista en el calendario del reclutador asignado y actualiza el expediente del candidato.",
            parameters={
                "type": "object",
                "properties": {
                    "start": {"type": "string", "description": "Fecha de inicio en formato ISO."},
                    "end": {"type": "string", "description": "Fecha de fin en formato ISO."},
                    "resumen_corto": {"type": "string", "description": "Resumen corto de la cita."},
                },
                "required": ["start", "end", "resumen_corto"],
            },
        ),
        FunctionDeclaration(
            name="eliminar_evento",
            description=(
                "Cancela/borra la cita de entrevista actualmente agendada del candidato. "
                "No recibe parámetros -- el sistema ya identifica internamente cuál es su "
                "cita. Llámala DIRECTAMENTE en cuanto el candidato confirme que quiere "
                "cancelar; NO llames antes a revisar_calendario, es un paso innecesario."
            ),
            parameters={"type": "object", "properties": {}},
        ),
    ])


async def iniciar_chat(system_prompt: str, history: list[dict], now: datetime):
    """`history` en formato SDK: [{"role": "user"|"model", "parts": [...]}, ...]
    (ver chat/memoria.py para la conversión desde n8n_chat_histories)."""
    _ensure_configured()

    def _call():
        model = genai.GenerativeModel(
            MODEL_NAME,
            system_instruction=system_prompt,
            tools=[build_tool_declarations(now)],
            generation_config={"temperature": _CHAT_TEMPERATURE},
        )
        return model.start_chat(history=history)

    return await asyncio.to_thread(_call)


async def enviar_mensaje(chat, contenido):
    """`contenido` puede ser un string (turno de usuario) o una lista de
    `genai.protos.Part(function_response=...)` (resultado de tools)."""
    def _call():
        return chat.send_message(contenido)

    return await asyncio.to_thread(_call)


def extraer_function_calls(response) -> list:
    """Devuelve las llamadas a función pendientes en la última respuesta
    (lista vacía si el modelo ya dio una respuesta final de texto)."""
    calls = []
    try:
        for part in response.candidates[0].content.parts:
            fc = getattr(part, "function_call", None)
            if fc and fc.name:
                calls.append(fc)
    except (IndexError, AttributeError):
        pass
    return calls


def extraer_texto(response) -> str:
    try:
        return response.text
    except Exception:
        logger.warning("extraer_texto: respuesta sin texto plano, se usa str() como fallback")
        return str(response)
