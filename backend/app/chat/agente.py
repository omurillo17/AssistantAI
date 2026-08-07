"""Puerto de `3_Sofia - Flujo de Chat.json`: el agente de IA que conversa
con el candidato. Orquesta memoria (n8n_chat_histories), el turno
rotativo de reclutadores, el loop de tool-calling de Gemini (3
herramientas: revisar_calendario, crear_evento, eliminar_evento), el
parser de special codes (`parser.py`) y el despacho de mensajes/alertas
por WAHA, reusando `/api/webhook/n8n-incoming` (ya implementa la máquina
de estados, upsert y asignación de reclutador -- no se duplica aquí).

DESVIACIÓN DELIBERADA del comportamiento actual de n8n (documentada, no
silenciosa): en el workflow original, el nodo 'AI Chat' solo lee
`JuntarMsj.mensaje_completo` (el texto crudo del webhook) como turno del
usuario -- el `mensaje_usuario` que compone `SepararJSON`/`TranscribirAudio`
(las instrucciones [SISTEMA: ...] tras analizar un documento, o la
transcripción de un audio) NUNCA llega al agente, porque ningún nodo del
workflow 2 escribe en `conversation_history` (confirmado con grep). Aquí
SÍ se usa ese mensaje enriquecido como turno del usuario cuando existe
(`mensaje_override`), porque sin él la transcripción de audio y el
análisis de documentos no tendrían ningún efecto en la conversación --
casi con certeza un hueco de wiring, no una decisión de diseño. El texto
CRUDO de JuntarMsj se sigue mandando tal cual a `/api/webhook/n8n-incoming`
como `mensaje_candidato` (el log de "lo que escribió el usuario" no cambia)."""

import asyncio
import json
import logging
import re
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx

import google.generativeai as genai

from app import gemini_client, waha_client
from app.chat import memoria, parser
from app.config import ENV
from app.db import get_pool
from app.google_calendar import list_events
from app.routers.eventos_calendario import (
    CrearEventoRequest,
    EliminarEventoRequest,
    crear_evento as _crear_evento_endpoint,
    eliminar_evento as _eliminar_evento_endpoint,
)

logger = logging.getLogger("agente")

_MX_TZ = ZoneInfo("America/Mexico_City")
_MAX_TOOL_ROUNDS = 5
_ENTRE_MENSAJES_SEGUNDOS = 3
_DEFAULT_CALENDAR = "talreclutamiento01@gmail.com"
_DEFAULT_TELEFONO_RECLUTADOR = "5213332012658"

# Regla Diamante de chat_prompt.md: "Sofia NO puede rechazar candidatos por
# experiencia, carrera, escolaridad o falta de perfil." El modelo la viola
# ocasionalmente (visto en producción: mensajes de "cartera de talento" /
# "fuera de perfil" enviados al candidato en la etapa de CV, cuando la
# única decisión de rechazo la debe tomar un reclutador humano). Como red
# de seguridad -- mismo patrón que el guard de `evento_creado_ok` de abajo
# -- se detectan frases de rechazo por texto y se le pide al modelo
# reescribir su respuesta antes de mandarla al candidato.
_FRASES_RECHAZO_RE = re.compile(
    r"cartera de talento|fuera de perfil|no se ajustan? (a los requisitos|directamente)"
    r"|no cumples? con el perfil|no continuaremos con tu proceso|no es el perfil que buscamos"
    r"|te deseamos (mucho )?éxito en tu búsqueda|no eres apto|perfil no compatible",
    re.IGNORECASE,
)

_INSTRUCCION_CORRECCION_RECHAZO = (
    "[SISTEMA: ERROR -- tu respuesta anterior rechazó o desalentó al candidato "
    "(p.ej. 'cartera de talento', 'fuera de perfil'). Esto está TERMINANTEMENTE "
    "PROHIBIDO: Sofia nunca rechaza candidatos, solo un reclutador humano decide "
    "eso. Reescribe tu respuesta anterior completa SIN rechazar ni insinuar que "
    "no es apto -- agradece la información y continúa normalmente con el "
    "siguiente paso del flujo. No menciones este mensaje de sistema.]"
)


def _contiene_rechazo(texto: str) -> bool:
    return bool(texto) and bool(_FRASES_RECHAZO_RE.search(texto))


# --- Turno rotativo (If5 / TurnoReclutador / ResolverReclutador) -----------

async def resolver_reclutador(agenda: dict) -> dict:
    if not agenda.get("grupo_turno"):
        return agenda

    pool = get_pool()
    row = await pool.fetchrow(
        "INSERT INTO reclutadores_turno (grupo, ultimo_index) VALUES ($1, 0) "
        "ON CONFLICT (grupo) DO UPDATE "
        "SET ultimo_index = (reclutadores_turno.ultimo_index + 1) % $2, updated_at = NOW() "
        "RETURNING ultimo_index",
        agenda["grupo_turno"], agenda["turno_total"],
    )
    turno_index = row["ultimo_index"] if row else 0
    candidatos_turno = json.loads(agenda["candidatos_turno"])
    asignado = candidatos_turno[turno_index % len(candidatos_turno)]

    return {
        "nombre_reclutador": asignado.get("nombre") or "Reclutador",
        "telefono_reclutador": asignado.get("telefono") or "5213323379399",
        "calendar_id": asignado.get("calendar_id") or _DEFAULT_CALENDAR,
        "vacante_detectada": agenda.get("vacante_detectada"),
        "nave_candidato": agenda.get("nave_candidato"),
        "grupo_turno": agenda.get("grupo_turno"),
        "turno_index": turno_index,
    }


# --- JuntarMsj ---------------------------------------------------------------

async def _juntar_mensajes(telefono: str) -> dict:
    pool = get_pool()
    row = await pool.fetchrow(
        "WITH recolectados AS ("
        "  DELETE FROM conversation_history WHERE telefono = $1 AND role = 'user_temp' "
        "  RETURNING content, message_type, media_url"
        ") "
        "SELECT STRING_AGG(content, '. ') AS mensaje_completo, "
        "MAX(message_type) AS message_type, MAX(media_url) AS media_url FROM recolectados",
        telefono,
    )
    if row is None:
        return {"mensaje_completo": None, "message_type": None, "media_url": None}
    return dict(row)


async def _guardar_mensaje_usuario_escalado(telefono: str, juntado: dict) -> None:
    pool = get_pool()
    await pool.execute(
        "INSERT INTO conversation_history (telefono, role, content, message_type, media_url) VALUES ($1, 'user', $2, $3, $4)",
        telefono,
        juntado.get("mensaje_completo") or "[Mensaje multimedia]",
        juntado.get("message_type") or "text",
        juntado.get("media_url"),
    )


# --- Tools del agente --------------------------------------------------------

async def _tool_revisar_calendario(calendar_id: str, args: dict) -> dict:
    after = args.get("after")
    before = args.get("before")
    try:
        time_min = datetime.fromisoformat(after)
        time_max = datetime.fromisoformat(before)
    except (TypeError, ValueError):
        return {"error": "after/before deben ser fechas ISO 8601 válidas"}
    if time_min.tzinfo is None:
        time_min = time_min.replace(tzinfo=_MX_TZ)
    if time_max.tzinfo is None:
        time_max = time_max.replace(tzinfo=_MX_TZ)
    eventos = await list_events(calendar_id, time_min, time_max, max_results=10)
    return {"eventos_ocupados": [
        {"id": e.get("id"), "summary": e.get("summary"), "start": e.get("start"), "end": e.get("end")}
        for e in eventos
    ]}


async def _tool_crear_evento(candidato: dict, reclutador: dict, args: dict) -> dict:
    datos_ine = candidato.get("datos_ine") or {}
    if isinstance(datos_ine, str):
        try:
            datos_ine = json.loads(datos_ine)
        except json.JSONDecodeError:
            datos_ine = {}
    payload = CrearEventoRequest(
        start=args.get("start", ""),
        end=args.get("end", ""),
        calendar_id=reclutador.get("calendar_id") or "",
        telefono=candidato.get("telefono") or "",
        resumen_ia=args.get("resumen_corto"),
        nombre=candidato.get("nombre") or "",
        nave_interes=candidato.get("nave_interes") or "",
        vacante_interes=candidato.get("vacante_interes") or "",
        ine_nombre=datos_ine.get("nombre_completo") or "",
        ine_curp=datos_ine.get("curp") or "",
        # asyncpg devuelve las columnas `uuid` de Postgres como uuid.UUID, no str
        # (a diferencia del driver `pg` de Node que usa el frontend) -- sin el
        # str(), Pydantic rechaza el objeto UUID con un ValidationError porque
        # CrearEventoRequest.empresa_id espera str.
        empresa_id=str(candidato["empresa_id"]) if candidato.get("empresa_id") else "",
    )
    return await _crear_evento_endpoint(payload)


async def _tool_eliminar_evento(candidato: dict, reclutador: dict) -> dict:
    payload = EliminarEventoRequest(
        calendar_id=reclutador.get("calendar_id") or "",
        telefono=candidato.get("telefono") or "",
        event_id=candidato.get("event_id") or "",
    )
    return await _eliminar_evento_endpoint(payload)


async def _ejecutar_tool(nombre: str, args: dict, candidato: dict, reclutador: dict) -> dict:
    try:
        if nombre == "revisar_calendario":
            return await _tool_revisar_calendario(reclutador.get("calendar_id") or _DEFAULT_CALENDAR, args)
        if nombre == "crear_evento":
            return await _tool_crear_evento(candidato, reclutador, args)
        if nombre == "eliminar_evento":
            return await _tool_eliminar_evento(candidato, reclutador)
        return {"error": f"Herramienta desconocida: {nombre}"}
    except Exception as e:
        logger.exception("_ejecutar_tool: fallo en %s", nombre)
        return {"error": str(e)}


async def _ejecutar_agente(system_prompt: str, historial: list[dict], mensaje_usuario: str, candidato: dict, reclutador: dict) -> dict:
    """Devuelve el texto final más lo que REALMENTE pasó con las tools en
    este turno:

    - `evento_creado_ok` / `evento_eliminado_ok`: la tool corrió y devolvió
      éxito. Red de seguridad para cuando el modelo redacta el mensaje de
      confirmación sin haber llamado la herramienta (visto en producción:
      el texto decía "cita agendada" pero `candidatos.event_id` seguía vacío).
    - `fecha_evento`: el `start` con el que se creó la cita. Es la fuente de
      verdad de la fecha -- el parser la sacaba del texto con un regex que
      también enganchaba la clave JSON `"cita_confirmada"` y guardaba basura
      (`": "2026-08-08T09:00:00"}}`) en `candidatos.fecha_entrevista`.
    """
    chat = await gemini_client.iniciar_chat(system_prompt, historial, datetime.now(_MX_TZ))
    response = await gemini_client.enviar_mensaje(chat, mensaje_usuario)

    evento_creado_ok = False
    evento_eliminado_ok = False
    fecha_evento: str | None = None
    for _ in range(_MAX_TOOL_ROUNDS):
        calls = gemini_client.extraer_function_calls(response)
        if not calls:
            break
        parts = []
        for fc in calls:
            args = dict(fc.args) if fc.args else {}
            resultado = await _ejecutar_tool(fc.name, args, candidato, reclutador)
            exito = isinstance(resultado, dict) and resultado.get("success") and not resultado.get("error")
            if fc.name == "crear_evento" and exito:
                evento_creado_ok = True
                fecha_evento = args.get("start") or fecha_evento
            if fc.name == "eliminar_evento" and exito:
                evento_eliminado_ok = True
            parts.append(genai.protos.Part(function_response=genai.protos.FunctionResponse(
                name=fc.name, response={"result": resultado},
            )))
        response = await gemini_client.enviar_mensaje(chat, parts)

    texto_final = gemini_client.extraer_texto(response)

    if _contiene_rechazo(texto_final):
        logger.warning(
            "_ejecutar_agente: la IA rechazó/desalentó al candidato telefono=%s -- pidiendo reescritura",
            candidato.get("telefono"),
        )
        response = await gemini_client.enviar_mensaje(chat, _INSTRUCCION_CORRECCION_RECHAZO)
        texto_final = gemini_client.extraer_texto(response)

    return {
        "texto": texto_final,
        "evento_creado_ok": evento_creado_ok,
        "evento_eliminado_ok": evento_eliminado_ok,
        "fecha_evento": fecha_evento,
    }


# --- Notificaciones a reclutadores ------------------------------------------

def _preparar_alerta_humano(candidato: dict, contacto: dict, webhook_payload: dict, reclutador: dict, human_alert_nombre: str | None, human_alert_resumen: str | None) -> dict:
    ultimo_mensaje = webhook_payload.get("body") or "Mensaje multimedia o sin texto"
    nombre = candidato.get("nombre") or human_alert_nombre or "Candidato"
    telefono = candidato.get("telefono") or contacto.get("number") or "0000000000"
    vacante = candidato.get("vacante_interes") or "General"
    motivo = human_alert_resumen or "El usuario solicitó hablar con un humano."

    nombre_destino = reclutador.get("nombre_reclutador") or "Equipo de Reclutamiento"
    telefono_destino = (reclutador.get("telefono_reclutador") or "5213323379399").replace("@c.us", "")

    mensaje_alerta = (
        f"🚨 *SOLICITUD DE ATENCIÓN HUMANA*\n\nHola {nombre_destino}, este usuario pide hablar con un reclutador:\n\n"
        f"👤 *{nombre}*\n📱 wa.me/{telefono}\n💼 Interés: {vacante}\n\n"
        f'💬 *Mensaje literal:* "{ultimo_mensaje}"\n\n🤖 *Resumen Sofía:* _{motivo}_'
    )
    return {"telefono_destino": telefono_destino, "nombre_candidato": nombre, "telefono_candidato": telefono, "vacante": vacante, "mensaje_alerta": mensaje_alerta}


async def _marcar_escalado(telefono: str, nombre: str, vacante: str) -> None:
    pool = get_pool()
    await pool.execute(
        "INSERT INTO candidatos (telefono, nombre, estado, ultima_interaccion, vacante_interes, resumen_ia, escalado, escalated_at) "
        "VALUES ($1, $2, 'ESCALADO', NOW(), $3, 'El usuario solicitó hablar con un humano (Opción Menú).', TRUE, NOW()) "
        "ON CONFLICT (telefono) DO UPDATE SET "
        "ultima_interaccion = NOW(), estado = 'ESCALADO', "
        "resumen_ia = 'El usuario solicitó hablar con un humano (Opción Menú).', escalado = TRUE, escalated_at = NOW()",
        telefono, nombre, vacante,
    )


def _formatear_fecha_alerta(fecha_cita: str) -> str:
    if not fecha_cita or "T" not in fecha_cita:
        return fecha_cita or "Fecha por confirmar"
    try:
        fecha_parte, hora_parte = fecha_cita.split("T")
        anio, mes, dia = fecha_parte.split("-")
        hora, minuto = hora_parte.split(":")[:2]
        meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
        nombre_mes = meses[int(mes) - 1]
        hora_int = int(hora)
        ampm = "AM"
        if hora_int >= 12:
            ampm = "PM"
            if hora_int > 12:
                hora_int -= 12
        if hora_int == 0:
            hora_int = 12
        return f"{int(dia)} de {nombre_mes} de {anio} a las {hora_int}:{minuto} {ampm}"
    except (ValueError, IndexError):
        return fecha_cita


def _preparar_alerta_cita(candidato: dict, contacto: dict, reclutador: dict, item: dict) -> dict:
    nombre_candidato = candidato.get("nombre_ine") or candidato.get("nombre_chat") or "Candidato"
    telefono_candidato = contacto.get("number") or candidato.get("telefono") or "0000000000"
    fecha_cita = _formatear_fecha_alerta(item.get("fecha_entrevista_detectada") or "")
    nave_candidato = candidato.get("nave_interes") or "No especificada"
    resumen_ia = candidato.get("resumen_ia") or "Sin resumen previo disponible."
    vacante_detectada = (item.get("vacante_detectada") or candidato.get("vacante_interes") or "General").strip()

    nombre_reclutador = reclutador.get("nombre_reclutador") or "Equipo de Reclutamiento"
    telefono_destino = (reclutador.get("telefono_reclutador") or "5213332012658").replace("@c.us", "")

    experiencia = (candidato.get("experiencia") or "").strip()
    linea_experiencia = f"\n\n💼 *EXPERIENCIA (CV):*\n{experiencia}" if experiencia else ""

    mensaje_alerta = (
        f"📅 *¡NUEVA ENTREVISTA AGENDADA!* \n\nHola {nombre_reclutador}, el bot acaba de cerrar una cita con éxito:\n\n"
        f"👤 *Candidato:* {nombre_candidato}\n📱 *Tel:* wa.me/{telefono_candidato}\n💼 *Vacante:* {vacante_detectada}\n"
        f"🏢 *Nave/Sucursal:* {nave_candidato}\n⏰ *Fecha:* {fecha_cita}\n\n📝 *RESUMEN DEL CANDIDATO (IA):*\n{resumen_ia}"
        f"{linea_experiencia}\n\n"
        "⚙️ *FILTROS TÉCNICOS:*\n_Todos los documentos (CV, INE, RFC) ya están listos y cargados en la plataforma._"
    )
    return {"telefono_destino": telefono_destino, "mensaje_alerta": mensaje_alerta}


# --- AlmacenarMensajes (reusa /api/webhook/n8n-incoming) --------------------

def _extraer_resumen_n8n_incoming(resumen_generado: str | None) -> str:
    resumen_generado = resumen_generado or ""
    if "MEMORY_UPDATE" in resumen_generado:
        despues = (resumen_generado.split("MEMORY_UPDATE")[1] or "").split("|")
        return (despues[1] if len(despues) > 1 else resumen_generado).strip()
    return resumen_generado


async def _almacenar_mensajes(contacto: dict, candidato: dict, item: dict, juntado: dict, webhook_payload: dict) -> None:
    body = {
        "telefono": contacto.get("number"),
        "nombre": item.get("nombre_detectado") or "Candidato",
        "cita_creada": bool(item.get("cita_creada") or item.get("fecha_entrevista_detectada")),
        "vacante": (item.get("vacante_detectada") or item.get("vacante_manual") or candidato.get("vacante_interes") or "").strip(),
        "resumen": _extraer_resumen_n8n_incoming(item.get("resumen_generado")),
        "cita_cancelada": bool(item.get("cita_cancelada")),
        "filtros": item.get("respuestas_filtro_detectadas"),
        "cv_manual": json.dumps(item["datos_cv_manual"]) if item.get("datos_cv_manual") else None,
        "fecha_entrevista": item.get("fecha_entrevista_detectada"),
        "privacidad": bool(item.get("acepto_privacidad")),
        "nombre_wpp": (webhook_payload.get("_data") or {}).get("notifyName") or "",
        "nave": item.get("nave_detectada") or "",
        "es_cv": bool(item.get("es_cv_manual")),
        "mensaje_ia": item.get("message_to_user") or "",
        "mensaje_candidato": juntado.get("mensaje_completo") or "[Mensaje multimedia]",
        "message_type": juntado.get("message_type") or "text",
        "media_url": juntado.get("media_url"),
    }
    url = f"{ENV.FRONTEND_API_BASE}/api/webhook/n8n-incoming"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, json=body)
            resp.raise_for_status()
    except Exception:
        logger.exception("_almacenar_mensajes: POST n8n-incoming falló para telefono=%s", contacto.get("number"))


# --- Orquestador principal ---------------------------------------------------

async def procesar_turno(webhook_body: dict, contacto: dict, candidato: dict, system_prompt_base: str, agenda: dict, mensaje_override: str | None) -> None:
    payload = webhook_body["payload"]
    session = webhook_body.get("session") or "default"
    numero = contacto.get("number")
    chat_id = f"{numero}@c.us"

    reclutador = await resolver_reclutador(agenda)
    system_prompt = system_prompt_base.replace("{{RECLUTADOR_ASIGNADO}}", reclutador.get("nombre_reclutador") or "Tu equipo")

    juntado = await _juntar_mensajes(numero)
    if not juntado.get("mensaje_completo"):
        return  # ¿HayMensajes? -- nada que procesar (carrera/reintento raro)

    if candidato.get("escalado"):
        await _guardar_mensaje_usuario_escalado(numero, juntado)
        return

    mensaje_para_ia = mensaje_override or juntado["mensaje_completo"] or "[Mensaje sin texto]"

    session_id = chat_id
    historial = await memoria.cargar_historial(session_id)

    ejecucion = await _ejecutar_agente(system_prompt, historial, mensaje_para_ia, candidato, reclutador)
    texto_ia = ejecucion["texto"]
    evento_creado_ok = ejecucion["evento_creado_ok"]

    items = parser.procesar_respuesta_ia(texto_ia, candidato)
    if not items:
        return
    primero = items[0]
    es_human_alert = any(c.get("code") == "HUMAN_ALERT" for c in primero.get("detected_codes", []))

    # Lo que hicieron las tools manda sobre lo que el modelo haya escrito: el
    # marcador de texto (CITA_CONFIRMADA / CITA_CANCELADA) se pierde cuando
    # Gemini trunca el JSON de cola, y entonces la cita quedaba creada o
    # borrada en Google Calendar pero sin registrarse en el expediente.
    if evento_creado_ok and ejecucion["fecha_evento"]:
        for item in items:
            item["fecha_entrevista_detectada"] = ejecucion["fecha_evento"]
            item["cita_creada"] = True
    if ejecucion["evento_eliminado_ok"]:
        for item in items:
            item["cita_cancelada"] = True

    if primero.get("fecha_entrevista_detectada") and not evento_creado_ok:
        # El modelo redactó una confirmación de cita (CITA_CONFIRMADA /
        # fecha_entrevista_detectada) sin haber llamado con éxito a la tool
        # crear_evento en este turno -- no existe el evento real en Google
        # Calendar. No se confía en el texto de la IA: se sobreescribe con un
        # mensaje honesto y se evita notificar al reclutador una cita falsa.
        logger.warning(
            "procesar_turno: la IA reportó cita confirmada sin llamar crear_evento (telefono=%s) -- se corrige",
            numero,
        )
        for item in items:
            item["fecha_entrevista_detectada"] = None
            item["cita_creada"] = False
        items = [items[0]]
        primero = items[0]
        primero["message_to_user"] = (
            "¡Ya casi! 😊 Tuvimos un problema técnico al confirmar tu horario en el calendario. "
            "Dame un momento e intenta decirme de nuevo qué día y hora te gustaría, por favor. 🙏"
        )

    # Se registra lo que REALMENTE se le mandó al candidato para guardarlo
    # completo en la memoria (ver guardar_turno al final): antes solo se
    # guardaba `items[0]`, así que en una respuesta partida con [SPLIT] el
    # historial perdía todo lo posterior al primer mensaje. El modelo, al no
    # verlo en su historial, creía que nunca lo había dicho y lo repetía en el
    # siguiente turno (visto en producción con el bloque de actividades).
    enviados: list[str] = []

    if es_human_alert:
        if primero.get("message_to_user"):
            await waha_client.send_text(session, chat_id, primero["message_to_user"])
            enviados.append(primero["message_to_user"])
        alerta = _preparar_alerta_humano(candidato, contacto, payload, reclutador, primero.get("human_alert_nombre"), primero.get("human_alert_resumen"))
        await waha_client.send_text(session, f"{alerta['telefono_destino']}@c.us", alerta["mensaje_alerta"])
        await _marcar_escalado(alerta["telefono_candidato"], alerta["nombre_candidato"], alerta["vacante"])
    elif primero.get("es_cv_manual"):
        if primero.get("message_to_user"):
            await waha_client.send_text(session, chat_id, primero["message_to_user"])
            enviados.append(primero["message_to_user"])
    elif primero.get("message_to_user"):
        for i, item in enumerate(items):
            if item.get("message_to_user"):
                await waha_client.send_text(session, chat_id, item["message_to_user"])
                enviados.append(item["message_to_user"])
            if i < len(items) - 1:
                await asyncio.sleep(_ENTRE_MENSAJES_SEGUNDOS)

    if primero.get("fecha_entrevista_detectada"):
        alerta_cita = _preparar_alerta_cita(candidato, contacto, reclutador, primero)
        await waha_client.send_text(session, f"{alerta_cita['telefono_destino']}@c.us", alerta_cita["mensaje_alerta"])

    await memoria.guardar_turno(
        session_id,
        mensaje_para_ia,
        "\n\n".join(enviados) or primero.get("message_to_user") or "",
    )
    await _almacenar_mensajes(contacto, candidato, primero, juntado, payload)
