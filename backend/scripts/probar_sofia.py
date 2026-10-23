"""Chat interactivo de consola para probar chat_prompt.md SIN Docker,
SIN Postgres y SIN WAHA -- el unico servicio externo que toca es la API
de Gemini (misma GEMINI_API_KEY del .env real: solo consumo de cuota,
cero impacto en produccion).

Reconstruye el system prompt en CADA turno igual que hace produccion
(app/chat/analizador.cargar_prompt + agente._ejecutar_agente), leyendo
SIEMPRE virgo_data/prompts/chat_prompt.md de ESTE worktree -- para
probar cambios solo edita ese archivo y vuelve a correr el script.

Uso:
    cd /home/sdvirgo/proyectos/AssistantAI-test-sofia
    backend/.venv/bin/python backend/scripts/probar_sofia.py
    (si no existe backend/.venv en el worktree, usa el del repo principal:
     /home/sdvirgo/proyectos/AssistantAI/backend/.venv/bin/python backend/scripts/probar_sofia.py)

Comandos dentro del chat:
    /estado     -> muestra el estado actual del candidato simulado
    /set campo=valor  -> fuerza un campo (ej: /set nave_interes=DULCERIA)
    /doc <ruta_del_archivo>  -> simula enviar una foto/PDF (CV, INE, RFC/CSF).
                                 Toma cualquier .pdf/.jpg/.jpeg/.png/.webp que
                                 ya tengas en tu disco (ej. una captura de tu
                                 propia INE, o cualquier PDF de prueba) y lo
                                 manda por el MISMO analizador de documentos
                                 que usa produccion (Gemini clasifica y
                                 extrae datos), luego alimenta el resultado
                                 al agente de chat como si el candidato lo
                                 hubiera enviado por WhatsApp.
    /tools ok|fail  -> hace que crear_evento/eliminar_evento (simuladas)
                        tengan éxito (default) o fallen a propósito, para
                        probar ambos caminos del agendamiento.
    /reset      -> reinicia la conversacion desde cero
    /salir      -> termina
"""
import asyncio
import json
import os
import sys
from datetime import datetime

import google.generativeai as genai

WORKTREE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MAIN_REPO = "/home/sdvirgo/proyectos/AssistantAI"

sys.path.insert(0, os.path.join(WORKTREE, "backend"))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(os.path.join(MAIN_REPO, ".env"))

# Aislamiento total de produccion: el prompt y el catalogo se leen SOLO
# de archivos locales de este worktree/repo, nunca de la API del
# frontend, nunca de Postgres, nunca de WAHA.
os.environ["VIRGO_FILES_DIR"] = os.path.join(WORKTREE, "virgo_data")

from app import gemini_client  # noqa: E402
from app.chat import analizador, parser  # noqa: E402
from app.google_calendar import (  # noqa: E402
    calcular_slots_disponibles,
    formatear_disponibilidad_para_prompt,
    _formatear_hora_es,
)

CONTEXT_WINDOW = 8


async def _catalogo_sin_prompt_db(_empresa_id):
    """Evita pegarle a la API del frontend (no alcanzable fuera de
    Docker) y evita usar el 'prompt_base' cacheado en prompt_context.json
    -- asi cargar_prompt() SIEMPRE usa el chat_prompt.md de este worktree."""
    ctx_path = os.path.join(MAIN_REPO, "virgo_data", "data", "prompt_context.json")
    with open(ctx_path, "r", encoding="utf-8") as f:
        ctx = json.load(f)
    ctx.pop("prompt_base", None)
    return ctx


analizador._prompt_context_api = _catalogo_sin_prompt_db


def _estado_inicial() -> dict:
    return {
        "nombre_chat": None,
        "nave_interes": None,
        "estado": "NUEVO",
        "vacante_interes": None,
        "lugar_residencia": None,
        "empresa_id": None,
        "nombre_confirmado": False,
        "event_id": None,
        "event_start": None,
        "event_end": None,
        "event_resumen": None,
    }


def _texto_a_json(texto: str) -> dict | None:
    limpio = texto.strip()
    limpio = limpio.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        return json.loads(limpio)
    except json.JSONDecodeError:
        return None


def _mostrar_turno(texto_crudo: str, items: list[dict]) -> None:
    ancho = 78
    print("\n" + "─" * ancho)

    data = _texto_a_json(texto_crudo)
    if data is not None:
        print("📋 JSON del modelo (crudo):")
        print(json.dumps(data, indent=2, ensure_ascii=False))
    else:
        print("⚠️  Gemini NO devolvió JSON válido este turno (pasa a veces, sobre todo")
        print("   en el primer mensaje o con temperature=0.6 -- producción ya tiene")
        print("   lógica de rescate para esto en parser.py). Texto crudo recibido:")
        print(f"   {texto_crudo!r}")

    print("\n💬 Lo que vería el candidato en WhatsApp:")
    for item in items:
        print(f"   Sofia» {item['message_to_user']}")

    print("─" * ancho)


_MAX_TOOL_ROUNDS = 5


# Controla si las tools simuladas de agendamiento "tienen éxito" o fallan.
# Por defecto tienen éxito (para poder ver el mensaje de confirmación real);
# usa /tools fail para forzar el camino de error y validar que Sofia NUNCA
# confirma una cita sin que CrearEvento haya respondido éxito (sección 6.7).
_TOOL_MODE = {"exito": True}


def _tool_stub(nombre: str, args: dict, candidato: dict) -> dict:
    """Simulación local de las 3 tools de calendario -- NUNCA toca Google
    Calendar real. Recuerda el evento "creado" en candidato['event_id'],
    igual que hace producción en Postgres (agente._tool_eliminar_evento lee
    candidato.get('event_id'), NO recibe el id como argumento del modelo --
    la tool eliminar_evento no tiene parámetros)."""
    if nombre == "revisar_calendario":
        eventos = []
        if candidato.get("event_id"):
            eventos = [{
                "id": candidato["event_id"],
                "summary": candidato.get("event_resumen") or "Entrevista",
                "start": candidato.get("event_start"),
                "end": candidato.get("event_end"),
            }]
        # Calcular slots libres simulados
        after_str = args.get("after")
        before_str = args.get("before")
        now = datetime.now()
        t_min = datetime.fromisoformat(after_str) if after_str else now
        t_max = datetime.fromisoformat(before_str) if before_str else now
        slots = calcular_slots_disponibles(eventos, t_min, t_max, now)
        resumen = formatear_disponibilidad_para_prompt(slots)
        print(f"   🔧 [SIMULADO] llamó a revisar_calendario({args}) -> {len(eventos)} evento(s) ocupados")
        return {
            "success": True,
            "resumen_disponibilidad": resumen,
            "horarios_disponibles": {
                d.isoformat(): [_formatear_hora_es(h, m) for h, m in horas]
                for d, horas in slots.items()
            },
            "eventos_ocupados": eventos,
        }
    if nombre == "crear_evento":
        if _TOOL_MODE["exito"]:
            eid = f"evento-simulado-{abs(hash((args.get('start'), args.get('end')))) % 10000}"
            candidato["event_id"] = eid
            candidato["event_start"] = args.get("start")
            candidato["event_end"] = args.get("end")
            candidato["event_resumen"] = args.get("resumen_corto")
            print(f"   🔧 [SIMULADO] llamó a crear_evento({args}) -> ÉXITO, event_id={eid} (no se crea nada real)")
            return {"success": True, "event_id": eid}
        print(f"   🔧 [SIMULADO] llamó a crear_evento({args}) -> forzado a FALLAR (/tools fail)")
        return {"success": False, "error": "Modo prueba: fallo forzado con /tools fail."}
    if nombre == "eliminar_evento":
        if _TOOL_MODE["exito"] and candidato.get("event_id"):
            print(f"   🔧 [SIMULADO] llamó a eliminar_evento() -> ÉXITO, canceló event_id={candidato['event_id']} (simulado)")
            candidato["event_id"] = None
            candidato["event_start"] = None
            candidato["event_end"] = None
            candidato["event_resumen"] = None
            return {"success": True}
        if not candidato.get("event_id"):
            print("   🔧 [SIMULADO] llamó a eliminar_evento() -> no hay event_id guardado, nada que cancelar")
            return {"success": False, "error": "No se encontró una cita agendada para este candidato."}
        print(f"   🔧 [SIMULADO] llamó a eliminar_evento() -> forzado a FALLAR (/tools fail)")
        return {"success": False, "error": "Modo prueba: fallo forzado con /tools fail."}
    return {"success": False, "error": f"Tool desconocida: {nombre}"}


async def _enviar_con_tools(chat, mensaje_usuario: str, candidato: dict) -> str:
    """Replica el loop de tool-calling de agente._ejecutar_agente pero con
    tools simuladas (sin Postgres/Google Calendar reales)."""
    response = await gemini_client.enviar_mensaje(chat, mensaje_usuario)
    for _ in range(_MAX_TOOL_ROUNDS):
        calls = gemini_client.extraer_function_calls(response)
        if not calls:
            break
        parts = []
        for fc in calls:
            args = dict(fc.args) if fc.args else {}
            resultado = _tool_stub(fc.name, args, candidato)
            parts.append(genai.protos.Part(function_response=genai.protos.FunctionResponse(
                name=fc.name, response={"result": resultado},
            )))
        response = await gemini_client.enviar_mensaje(chat, parts)
    return gemini_client.extraer_texto(response)


def _mostrar_estado(candidato: dict) -> None:
    print("\n--- estado actual del candidato simulado ---")
    for k, v in candidato.items():
        print(f"  {k}: {v}")
    print("---------------------------------------------\n")


async def _turno_agente(candidato: dict, historial: list[dict], contacto: dict, webhook: dict, mensaje_usuario: str) -> list[dict]:
    """Un turno completo del agente de chat (mismo camino para mensajes de
    texto normales y para el mensaje_usuario sintético que genera un
    documento analizado). Devuelve el historial actualizado."""
    system_prompt = await analizador.cargar_prompt(webhook, contacto, candidato)
    chat = await gemini_client.iniciar_chat(system_prompt, historial, datetime.now())
    texto_crudo = await _enviar_con_tools(chat, mensaje_usuario, candidato)

    items = parser.procesar_respuesta_ia(texto_crudo, candidato)
    _mostrar_turno(texto_crudo, items)

    updates = {}
    for item in items:
        updates.update(item.get("database_updates") or {})
        if item.get("nave_detectada"):
            updates["nave_interes"] = item["nave_detectada"]
    if updates:
        campo_map = {"nombre": "nombre_chat"}
        for k, v in updates.items():
            candidato[campo_map.get(k, k)] = v
        print("  cambios de estado (db_updates):")
        for k, v in updates.items():
            print(f"    - {k}: {v}")
        print()

    historial.append({"role": "user", "parts": [{"text": mensaje_usuario}]})
    historial.append({"role": "model", "parts": [{"text": texto_crudo}]})
    return historial[-CONTEXT_WINDOW:]


_MIME_POR_EXT = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


async def _procesar_documento(candidato: dict, contacto: dict, ruta: str) -> str | None:
    """Simula el envío de una foto/PDF (CV, INE o Constancia/RFC) SIN WAHA:
    lee el archivo local y lo manda al MISMO pipeline de análisis que usa
    producción (analizador._ANALYZE_DOCUMENT_PROMPT_TEMPLATE + Gemini +
    analizador.separar_json). Actualiza el candidato simulado con lo
    extraído y devuelve el mensaje_usuario sintético (el mismo
    '[SISTEMA: ...]' que en producción se le pasa al agente de chat como
    si fuera lo que escribió el candidato)."""
    ruta = os.path.expanduser(ruta.strip().strip('"').strip("'"))
    ext = os.path.splitext(ruta)[1].lower()
    mime = _MIME_POR_EXT.get(ext)
    if not mime:
        print(f"[extensión no soportada: '{ext}'. Usa .pdf .jpg .jpeg .png .webp]\n")
        return None
    if not os.path.isfile(ruta):
        print(f"[no encontré el archivo: {ruta}]\n")
        return None

    with open(ruta, "rb") as f:
        data = f.read()

    detalle_vacantes = await analizador.obtener_detalle_vacantes(
        candidato.get("nave_interes"), candidato.get("empresa_id")
    )
    prompt = analizador._ANALYZE_DOCUMENT_PROMPT_TEMPLATE.format(
        detalle_vacantes=detalle_vacantes,
        vacante_interes=candidato.get("vacante_interes") or "General",
    )

    print("[analizando documento con Gemini, un momento...]")
    gemini_text = await gemini_client.analizar_documentos([{"mime_type": mime, "data": data}], prompt)
    resultado = analizador.separar_json(gemini_text, contacto.get("number", ""), "Candidato", "", candidato)

    tipo = resultado["tipo_origen"]
    print("\n" + "═" * 78)
    print("📄 Resultado del análisis de documento:")
    print(f"   tipo_origen : {tipo}")
    print(f"   veredicto   : {resultado.get('veredicto')}")
    print(f"   motivo      : {resultado.get('motivo')}")
    if resultado.get("curp_ine"):
        print(f"   curp_ine    : {resultado['curp_ine']}")
    if resultado.get("curp_rfc"):
        print(f"   curp_rfc    : {resultado['curp_rfc']}")
    if resultado.get("identidad_bloqueada"):
        print(f"   ⚠️  identidad BLOQUEADA: {resultado['identidad_motivo']}")
    elif resultado.get("identidad_alerta"):
        print(f"   ⚠️  identidad en revisión: {resultado['identidad_motivo']}")
    print(f"\n   mensaje_usuario sintético que recibirá el agente (como si")
    print(f"   el candidato lo hubiera escrito):")
    print(f"   {resultado['mensaje_usuario']!r}")
    print("═" * 78)

    if tipo in ("INE", "AMBOS_DOCS"):
        candidato["datos_ine"] = resultado["cv_manual"]
        candidato["curp_ine"] = resultado["curp_ine"]
    if tipo in ("CONSTANCIA", "CSF", "RFC", "AMBOS_DOCS"):
        candidato["datos_rfc"] = resultado["cv_manual"]
        candidato["curp_rfc"] = resultado["curp_rfc"]
    if tipo in ("CV", "SOLICITUD"):
        candidato["tiene_cv"] = True
    if resultado.get("correo"):
        candidato["correo"] = resultado["correo"]

    return resultado["mensaje_usuario"]


async def main() -> None:
    candidato = _estado_inicial()
    historial: list[dict] = []
    contacto = {"number": "5213000000000"}
    webhook = {"_data": {"notifyName": "Candidato"}}

    print("Chat de prueba de Sofia (worktree de pruebas, sin Docker/Postgres/WAHA).")
    print("Escribe tu mensaje como si fueras el candidato.")
    print("Comandos: /estado /set campo=valor /doc <ruta_archivo> /tools ok|fail /reset /salir\n")

    while True:
        try:
            mensaje_usuario = input("Tú: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break

        if not mensaje_usuario:
            continue
        if mensaje_usuario == "/salir":
            break
        if mensaje_usuario == "/estado":
            _mostrar_estado(candidato)
            continue
        if mensaje_usuario in ("/tools ok", "/tools fail"):
            _TOOL_MODE["exito"] = mensaje_usuario.endswith("ok")
            print(f"[tools simuladas ahora {'tienen éxito' if _TOOL_MODE['exito'] else 'fallan a propósito'}]\n")
            continue
        if mensaje_usuario == "/reset":
            candidato = _estado_inicial()
            historial = []
            print("[conversación reiniciada]\n")
            continue
        if mensaje_usuario.startswith("/set "):
            try:
                campo, valor = mensaje_usuario[5:].split("=", 1)
                candidato[campo.strip()] = valor.strip()
                print(f"[{campo.strip()} = {valor.strip()}]\n")
            except ValueError:
                print("Uso: /set campo=valor\n")
            continue
        if mensaje_usuario.startswith("/doc "):
            mensaje_para_agente = await _procesar_documento(candidato, contacto, mensaje_usuario[5:])
            if mensaje_para_agente:
                historial = await _turno_agente(candidato, historial, contacto, webhook, mensaje_para_agente)
            continue

        historial = await _turno_agente(candidato, historial, contacto, webhook, mensaje_usuario)


if __name__ == "__main__":
    asyncio.run(main())
