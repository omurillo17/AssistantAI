"""Wrapper del SDK de Google Gemini (`google-genai`). Se usa la API async del
cliente (`client.aio`), así que ninguna llamada bloquea el event loop. Es el
ÚNICO módulo que importa el SDK: el resto de la app pasa por estas funciones.

Reemplaza 3 nodos LangChain de n8n:
- `Analyze document` (`googleGemini`, resource=document) -> `analizar_documento`
- `TranscribirAudio` (`googleGemini`, resource=audio) -> `transcribir_audio`
- `AI Chat` (`@n8n/n8n-nodes-langchain.agent`, con `IA CHAT`=lmChatGoogleGemini,
  temperature=0.6) -> `iniciar_chat`/`enviar_mensaje`, con tool-calling manual
  (no se usa "automatic function calling" del SDK porque las 3 tools reales
  son async -- llamadas a Postgres/Google Calendar -- y el modo automático
  del SDK solo soporta funciones Python síncronas)."""

import logging
from datetime import datetime

from google import genai
from google.genai import types

from app.config import ENV
from app.utils.fechas_es import DIAS_ES

logger = logging.getLogger("gemini_client")

MODEL_NAME = "models/gemini-2.5-flash"
_CHAT_TEMPERATURE = 0.6

_client: genai.Client | None = None

# Igual que `ChatSession._check_response` del SDK viejo: cualquier fin de
# candidato fuera de estos se consideraba error (SAFETY, RECITATION,
# MALFORMED_FUNCTION_CALL...) y `send_message` lanzaba excepción. El SDK nuevo
# devuelve la respuesta sin texto, así que lo replicamos a mano.
_FIN_OK = {None, types.FinishReason.FINISH_REASON_UNSPECIFIED, types.FinishReason.STOP, types.FinishReason.MAX_TOKENS}


def _cliente() -> genai.Client:
    """Cliente perezoso: `ENV.GEMINI_API_KEY` truena si falta la variable, y
    eso no debe pasar al importar el módulo (tests, scripts)."""
    global _client
    if _client is None:
        _client = genai.Client(api_key=ENV.GEMINI_API_KEY)
    return _client


def _texto_o_error(response) -> str:
    """El SDK viejo lanzaba ValueError en `response.text` si no había texto
    (p. ej. bloqueo por seguridad); el nuevo devuelve None. Los callers de
    analizar/transcribir esperan str o excepción, así que se conserva."""
    texto = response.text
    if texto is None:
        raise ValueError(f"Gemini no devolvió texto: {response.prompt_feedback or response.candidates}")
    return texto


def _verificar_respuesta(response) -> None:
    if response.prompt_feedback and response.prompt_feedback.block_reason:
        raise RuntimeError(f"Gemini bloqueó el prompt: {response.prompt_feedback}")
    if not response.candidates:
        raise RuntimeError("Gemini devolvió una respuesta sin candidatos")
    fin = response.candidates[0].finish_reason
    if fin not in _FIN_OK:
        raise RuntimeError(f"Gemini detuvo el candidato: finish_reason={fin}")


async def analizar_documentos(archivos: list[dict], prompt: str) -> str:
    """Envía uno o varios documentos (imágenes/PDFs) + prompt de validación a Gemini.
    Cada elemento en `archivos` debe ser: {"mime_type": str, "data": bytes}.
    Gemini analiza todos los archivos juntos en un único turno multimodal."""
    contents: list = [types.Part.from_bytes(data=a["data"], mime_type=a["mime_type"]) for a in archivos]
    contents.append(prompt)
    response = await _cliente().aio.models.generate_content(model=MODEL_NAME, contents=contents)
    return _texto_o_error(response)


async def analizar_documento(data: bytes, mime_type: str, prompt: str) -> str:
    """Wrapper retrocompatible para un único archivo."""
    return await analizar_documentos([{"mime_type": mime_type, "data": data}], prompt)


async def transcribir_audio(data: bytes, mime_type: str) -> str:
    """Puerto de 'TranscribirAudio': sin prompt custom (igual que el nodo
    original), Gemini transcribe el audio a texto plano."""
    response = await _cliente().aio.models.generate_content(
        model=MODEL_NAME, contents=[types.Part.from_bytes(data=data, mime_type=mime_type)],
    )
    return _texto_o_error(response)


def build_tool_declarations(now: datetime) -> types.Tool:
    """Declaraciones de las 3 tools del agente 'AI Chat': RevisarCalendario
    (solo lectura), Crear Evento, Eliminar Evento -- mismos nombres/params
    que exponían los nodos googleCalendarTool/httpRequestTool en n8n, para
    que el prompt (que ya menciona estas herramientas) siga siendo válido.

    `now` (America/Mexico_City) se re-interpola en la descripción de
    revisar_calendario en cada turno -- igual que hacía n8n con
    `{{ $now... }}` dentro del toolDescription, evaluado en cada
    invocación del nodo, no una sola vez al definir la tool."""
    return types.Tool(function_declarations=[
        types.FunctionDeclaration(
            name="revisar_calendario",
            description=(
                "Usa esta herramienta ÚNICAMENTE para verificar disponibilidad de horarios "
                "antes de ofrecer una cita nueva con crear_evento. Devuelve 'resumen_disponibilidad' "
                "(la lista oficial de horarios libres calculados determinísticamente descartando "
                "eventos ocupados y bloqueos de agenda de cada reclutador), 'horarios_disponibles' "
                "y 'eventos_ocupados' (solo inicio y fin).\n\n"
                "REGLA OBLIGATORIA: Ofrece al candidato ÚNICAMENTE los horarios que aparecen en "
                "'resumen_disponibilidad'. Cada reclutador gestiona sus propios bloqueos y horas de comida "
                "en su agenda. Está terminantemente prohibido ofrecer horarios no disponibles o fuera de la jornada oficial.\n\n"
                "NO la uses para cancelaciones: eliminar_evento no necesita ningún ID ni "
                "búsqueda previa, el sistema ya sabe internamente cuál es la cita del "
                "candidato -- si quiere cancelar, llama a eliminar_evento directamente.\n\n"
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
        types.FunctionDeclaration(
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
        types.FunctionDeclaration(
            name="eliminar_evento",
            description=(
                "Cancela/borra la cita de entrevista actualmente agendada del candidato. "
                "No recibe parámetros -- el sistema ya identifica internamente cuál es su "
                "cita. Llámala DIRECTAMENTE en cuanto el candidato confirme que quiere "
                "cancelar; NO llames antes a revisar_calendario, es un paso innecesario."
            ),
            # Sin `properties`: el SDK viejo (protobuf) no mandaba el mapa vacío
            # y la API rechaza OBJECT con `properties: {}`.
            parameters={"type": "object"},
        ),
    ])


async def iniciar_chat(system_prompt: str, history: list[dict], now: datetime):
    """`history` en formato SDK: [{"role": "user"|"model", "parts": [...]}, ...]
    (ver chat/memoria.py para la conversión desde n8n_chat_histories).
    El SDK valida cada dict como `types.Content`."""
    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
        tools=[build_tool_declarations(now)],
        temperature=_CHAT_TEMPERATURE,
        # Las tools se ejecutan a mano en rondas (agente._ejecutar_ronda_tools).
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )
    return _cliente().aio.chats.create(model=MODEL_NAME, config=config, history=history)


async def enviar_mensaje(chat, contenido):
    """`contenido` puede ser un string (turno de usuario) o una lista de
    partes de `parte_respuesta_tool` (resultado de tools)."""
    response = await chat.send_message(contenido)
    _verificar_respuesta(response)
    return response


def parte_respuesta_tool(nombre: str, resultado) -> types.Part:
    """Parte con el resultado de una tool para devolverlo al modelo. Se
    envuelve en {"result": ...} como antes (`response` debe ser un dict)."""
    return types.Part.from_function_response(name=nombre, response={"result": resultado})


def extraer_function_calls(response) -> list:
    """Devuelve las llamadas a función pendientes en la última respuesta
    (lista vacía si el modelo ya dio una respuesta final de texto)."""
    return [fc for fc in (response.function_calls or []) if fc.name]


def extraer_texto(response) -> str:
    texto = response.text
    if texto is None:
        logger.warning("extraer_texto: respuesta sin texto plano, se usa str() como fallback")
        return str(response)
    return texto
