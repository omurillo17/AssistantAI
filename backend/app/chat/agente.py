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
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import httpx

import google.generativeai as genai

from app import gemini_client, waha_client
from app.chat import memoria, parser, vacantes
from app.chat.analizador import puede_agendar
from app.chat.vacantes import es_placeholder_vacante, limpiar_vacante
from app.config import ENV
from app.db import get_pool
from app.google_calendar import (
    calcular_slots_disponibles,
    formatear_disponibilidad_para_prompt,
    list_events,
    _formatear_hora_es,
)
from app.internal_api import auth_headers
from app.routers.eventos_calendario import (
    CrearEventoRequest,
    EliminarEventoRequest,
    crear_evento as _crear_evento_endpoint,
    eliminar_evento as _eliminar_evento_endpoint,
)
from app.utils.fechas_es import MESES_ES
from app.utils.phone import enmascarar

logger = logging.getLogger("agente")

_MX_TZ = ZoneInfo("America/Mexico_City")
_MAX_TOOL_ROUNDS = 5
_ENTRE_MENSAJES_SEGUNDOS = 3
_MENSAJE_MULTIMEDIA_FALLBACK = "[Mensaje multimedia]"
_WA_C_US_SUFFIX = "@c.us"

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
        "telefono_reclutador": asignado.get("telefono") or ENV.DEFAULT_RECRUITER_PHONE,
        "calendar_id": asignado.get("calendar_id") or ENV.DEFAULT_CALENDAR_ID,
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
        "  RETURNING content, message_type, media_url, timestamp"
        ") "
        "SELECT STRING_AGG(content, '. ' ORDER BY timestamp, content) AS mensaje_completo, "
        "MAX(message_type) AS message_type, MAX(media_url) AS media_url, "
        # Timestamp real del primer mensaje del lote (no el de cuándo termina de
        # procesar el turno) -- ver `_guardar_mensaje_usuario` / procesar_turno.
        "MIN(timestamp) AS primer_timestamp FROM recolectados",
        telefono,
    )
    if row is None:
        return {"mensaje_completo": None, "message_type": None, "media_url": None, "primer_timestamp": None}
    return dict(row)


async def _guardar_mensaje_usuario(telefono: str, juntado: dict) -> None:
    """Guarda el turno agregado del usuario en `conversation_history` con su
    timestamp REAL (el de cuando llegó por WhatsApp), no el de `NOW()` al
    terminar todo el pipeline (Gemini + envío por WAHA puede tardar varios
    segundos). Sin esto, dos turnos consecutivos del mismo candidato pueden
    quedar en orden invertido en la plataforma si el segundo termina de
    procesarse antes que el primero (visto en producción)."""
    pool = get_pool()
    msg_content = juntado.get("mensaje_completo") or _MENSAJE_MULTIMEDIA_FALLBACK
    msg_type = juntado.get("message_type") or "text"
    media_url = juntado.get("media_url")
    timestamp = juntado.get("primer_timestamp")
    # OJO: sin el cast ::timestamp, Postgres infiere el tipo de $5 a partir de
    # la otra rama del COALESCE (NOW(), que es timestamptz) -- y asyncpg, al
    # mandar un datetime naive como timestamptz, lo interpreta con la
    # zona horaria del SISTEMA del contenedor (TZ=America/Mexico_City en
    # docker-compose), sumando 6h de más al guardarlo. Visto en producción:
    # los mensajes del usuario quedaban con hora futura en la bandeja.
    await pool.execute(
        "INSERT INTO conversation_history (telefono, role, content, message_type, media_url, timestamp) "
        "VALUES ($1, 'user', $2, $3, $4, COALESCE($5::timestamp, NOW()))",
        telefono, msg_content, msg_type, media_url, timestamp,
    )


async def _guardar_mensaje_asistente(telefono: str, texto: str) -> None:
    """Guarda cada mensaje del bot en el momento REAL en que se manda por WAHA
    (no todos juntos al final del turno). Además de arreglar el orden, esto
    evita que se pierdan los mensajes de una respuesta partida ([SPLIT]): antes
    solo se guardaba el primer item de `items` vía n8n-incoming."""
    pool = get_pool()
    await pool.execute(
        "INSERT INTO conversation_history (telefono, role, content, message_type) VALUES ($1, 'assistant', $2, 'text')",
        telefono, texto,
    )


async def _guardar_mensaje_usuario_escalado(telefono: str, juntado: dict, empresa_id=None) -> None:
    pool = get_pool()
    msg_content = juntado.get("mensaje_completo") or _MENSAJE_MULTIMEDIA_FALLBACK
    msg_type = juntado.get("message_type") or "text"
    media_url = juntado.get("media_url")
    timestamp = juntado.get("primer_timestamp")

    # Mismo fix que `_guardar_mensaje_usuario`: sin esto, el mensaje del
    # candidato se guarda con NOW() de cuando el debounce (hasta 8s) termina
    # de esperar, no de cuando llegó en realidad. Con un candidato escalado,
    # el reclutador puede contestar manualmente (vía "Tomar Control") más
    # rápido que esos 8s -- su respuesta quedaba con timestamp MÁS TEMPRANO
    # que el mensaje del candidato al que respondía (visto en producción).
    await pool.execute(
        "INSERT INTO conversation_history (telefono, role, content, message_type, media_url, timestamp) "
        "VALUES ($1, 'user', $2, $3, $4, COALESCE($5::timestamp, NOW()))",
        telefono,
        msg_content,
        msg_type,
        media_url,
        timestamp,
    )
    await pool.execute(
        "UPDATE candidatos SET ultima_interaccion = NOW() "
        "WHERE telefono = $1 AND empresa_id IS NOT DISTINCT FROM $2::uuid",
        telefono, str(empresa_id) if empresa_id else None,
    )
    cand_id = await pool.fetchval(
        "SELECT id FROM candidatos WHERE telefono = $1 AND empresa_id IS NOT DISTINCT FROM $2::uuid",
        telefono, str(empresa_id) if empresa_id else None,
    )
    if cand_id:
        await pool.execute(
            """
            INSERT INTO mensajes_bandeja (candidato_id, telefono, ultimo_mensaje, ultimo_mensaje_rol, mensajes_no_leidos, activo, ultimo_mensaje_at)
            VALUES ($1, $2, $3, 'user', 1, TRUE, NOW())
            ON CONFLICT (candidato_id) DO UPDATE SET
                ultimo_mensaje = EXCLUDED.ultimo_mensaje,
                ultimo_mensaje_rol = 'user',
                mensajes_no_leidos = mensajes_bandeja.mensajes_no_leidos + 1,
                activo = TRUE,
                ultimo_mensaje_at = NOW(),
                updated_at = NOW()
            """,
            cand_id,
            telefono,
            msg_content,
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

    now = datetime.now(_MX_TZ)
    eventos = await list_events(calendar_id, time_min, time_max, max_results=100)
    slots_por_dia = calcular_slots_disponibles(eventos, time_min, time_max, now)
    resumen_disponibilidad = formatear_disponibilidad_para_prompt(slots_por_dia)

    # Huecos ocupados sin título, nombre ni ID: el modelo no necesita (ni debe
    # poder repetirle al candidato) datos de las citas de otras personas.
    return {
        "resumen_disponibilidad": resumen_disponibilidad,
        "horarios_disponibles": {
            d.isoformat(): [_formatear_hora_es(h, m) for h, m in slots]
            for d, slots in slots_por_dia.items()
        },
        "eventos_ocupados": [
            {
                "start": (e.get("start") or {}).get("dateTime") or (e.get("start") or {}).get("date"),
                "end": (e.get("end") or {}).get("dateTime") or (e.get("end") or {}).get("date"),
            }
            for e in eventos
        ],
    }


_CITA_DURACION_MIN = timedelta(minutes=15)
_CITA_DURACION_MAX = timedelta(hours=2)
_CITA_HORIZONTE = timedelta(days=30)


def validar_horario_cita(start: str | None, end: str | None, ahora: datetime) -> str | None:
    """Valida los argumentos que el modelo le pasa a crear_evento. Devuelve
    el motivo del rechazo (para el modelo) o None si el horario es válido.
    Fechas sin zona se interpretan en America/Mexico_City, igual que en
    google_calendar.create_event."""
    try:
        inicio = datetime.fromisoformat(start or "")
        fin = datetime.fromisoformat(end or "")
    except (TypeError, ValueError):
        return "start/end deben ser fechas ISO 8601 válidas."
    if inicio.tzinfo is None:
        inicio = inicio.replace(tzinfo=_MX_TZ)
    if fin.tzinfo is None:
        fin = fin.replace(tzinfo=_MX_TZ)
    if inicio <= ahora:
        return "No se puede agendar en el pasado. Ofrece un horario futuro."
    if inicio > ahora + _CITA_HORIZONTE:
        return "Solo se puede agendar dentro de los próximos 30 días."
    if not (_CITA_DURACION_MIN <= fin - inicio <= _CITA_DURACION_MAX):
        return "La cita debe durar entre 15 minutos y 2 horas."
    return None


def _extraer_dict_candidato(val: object) -> dict:
    if isinstance(val, dict):
        return val
    if isinstance(val, str):
        try:
            parsed = json.loads(val)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return {}
    return {}


def tiene_cita_vigente(candidato: dict, ahora: datetime) -> bool:
    """Una cita impide agendar otra solo si sigue en pie (CITA_AGENDADA con fecha
    futura). Una cancelada desde el CRM o una ya pasada (no asistió) no obliga a
    cancelar antes: eso sumaba una cancelación y podía terminar en RECHAZADO."""
    if not candidato.get("event_id") or candidato.get("estado") != "CITA_AGENDADA":
        return False
    try:
        fecha = datetime.fromisoformat(str(candidato.get("fecha_entrevista")))
    except ValueError:
        return False
    if fecha.tzinfo is None:
        fecha = fecha.replace(tzinfo=_MX_TZ)
    return fecha > ahora


async def _tool_crear_evento(candidato: dict, reclutador: dict, args: dict) -> dict:
    if tiene_cita_vigente(candidato, datetime.now(_MX_TZ)):
        return {"error": "El candidato ya tiene una cita agendada. Para cambiarla, primero cancélala con eliminar_evento."}
    motivo = validar_horario_cita(args.get("start"), args.get("end"), datetime.now(_MX_TZ))
    if motivo:
        return {"error": motivo}

    datos_ine = _extraer_dict_candidato(candidato.get("datos_ine"))
    datos_rfc = _extraer_dict_candidato(candidato.get("datos_rfc"))

    curp = (
        datos_ine.get("curp")
        or candidato.get("curp_ine")
        or datos_rfc.get("curp")
        or candidato.get("curp_rfc")
        or ""
    )

    payload = CrearEventoRequest(
        start=args.get("start", ""),
        end=args.get("end", ""),
        calendar_id=reclutador.get("calendar_id") or "",
        telefono=candidato.get("telefono") or "",
        resumen_ia=args.get("resumen_corto"),
        nombre=candidato.get("nombre") or "",
        nave_interes=candidato.get("nave_interes") or "",
        vacante_interes=candidato.get("vacante_interes") or "",
        ine_nombre=datos_ine.get("nombre_completo") or candidato.get("nombre") or "",
        ine_curp=curp,
        # asyncpg devuelve las columnas `uuid` de Postgres como uuid.UUID, no str
        # (a diferencia del driver `pg` de Node que usa el frontend) -- sin el
        # str(), Pydantic rechaza el objeto UUID con un ValidationError porque
        # CrearEventoRequest.empresa_id espera str.
        empresa_id=str(candidato["empresa_id"]) if candidato.get("empresa_id") else "",
    )
    res = await _crear_evento_endpoint(payload)
    # Refleja la cita en el dict del turno: un segundo crear_evento en el
    # mismo turno ve que ya existe.
    candidato["event_id"] = res.get("event_id")
    return res


async def _tool_eliminar_evento(candidato: dict, reclutador: dict) -> dict:
    payload = EliminarEventoRequest(
        calendar_id=reclutador.get("calendar_id") or "",
        telefono=candidato.get("telefono") or "",
        event_id=candidato.get("event_id") or "",
        empresa_id=str(candidato["empresa_id"]) if candidato.get("empresa_id") else None,
    )
    res = await _eliminar_evento_endpoint(payload)
    candidato["event_id"] = None
    cancel_count = res.get("cancelaciones", 1)

    # Alerta WhatsApp al reclutador
    tel_rec = (reclutador.get("telefono_reclutador") or "").replace(_WA_C_US_SUFFIX, "").strip()
    if tel_rec:
        nombre_c = candidato.get("nombre") or "Candidato"
        tel_c = candidato.get("telefono") or ""
        vac_c = candidato.get("vacante_interes") or "General"
        try:
            if cancel_count == 3:
                msg_wpp = (
                    f"⚠️ *ALERTA: 3 CANCELACIONES/REAGENDAMIENTOS*\n\n"
                    f"El candidato *{nombre_c}* (📱 wa.me/{tel_c}) "
                    f"ha cancelado/reagendado su cita por 3ª vez para la vacante *{vac_c}*.\n\n"
                    f"Se le permitirá reagendar una última vez antes de ser bloqueado automáticamente al 4º intento."
                )
                await waha_client.send_text("default", f"{tel_rec}{_WA_C_US_SUFFIX}", msg_wpp)
            elif cancel_count >= 4:
                msg_wpp = (
                    f"🚫 *CANDIDATO BLOQUEADO POR CANCELACIONES*\n\n"
                    f"El candidato *{nombre_c}* (📱 wa.me/{tel_c}) "
                    f"ha acumulado 4 cancelaciones/reagendamientos y ha sido bloqueado automáticamente."
                )
                await waha_client.send_text("default", f"{tel_rec}{_WA_C_US_SUFFIX}", msg_wpp)
        except Exception:
            logger.exception("_tool_eliminar_evento: error enviando alerta WhatsApp al reclutador")

    return res


_ALERTA_FALLO_VENTANA_SEGUNDOS = 1800  # 30 min
_alertas_fallo_enviadas: dict[str, float] = {}


def _explicar_fallo(exc: Exception) -> str:
    """Traduce las fallas conocidas a una instrucción accionable. Un
    traceback crudo no le dice nada a quien recibe la alerta por WhatsApp."""
    nombre_exc = type(exc).__name__
    texto = str(exc)
    if nombre_exc == "CredencialesNoEncontradas" or "No hay credenciales OAuth" in texto:
        return ("Ese calendario nunca se autorizó con Google. Corre:\n"
                "cd backend && python -m scripts.authorize_recruiter --email <correo>")
    if "invalid_grant" in texto or "Token has been expired or revoked" in texto:
        return ("Google revocó el permiso del calendario (pasa cada 7 días si la app OAuth "
                "sigue en modo Testing). Hay que volver a autorizar al reclutador.")
    if "Missing time zone" in texto:
        return "Google rechazó la fecha por falta de zona horaria."
    if "quota" in texto.lower() or "rate" in texto.lower():
        return "Se agotó la cuota de la API. Hay que esperar o subir el límite."
    return "Revisa los logs del backend para el detalle."


async def _alertar_fallo_tool(nombre_tool: str, exc: Exception, candidato: dict, reclutador: dict) -> None:
    """Avisa por WhatsApp a la persona responsable cuando una herramienta
    falla. Sin esto el candidato recibe un "tuvimos un inconveniente
    técnico" y nadie más se entera: los fallos de calendario de producción
    solo salieron a la luz porque alguien fue a leer los logs a mano.

    Se deduplica por (tool + tipo de error) durante 30 min para que una
    caída sostenida de Google no genere una avalancha de mensajes."""
    clave = f"{nombre_tool}:{type(exc).__name__}"
    ahora = time.monotonic()
    ultimo = _alertas_fallo_enviadas.get(clave)
    if ultimo is not None and (ahora - ultimo) < _ALERTA_FALLO_VENTANA_SEGUNDOS:
        return
    _alertas_fallo_enviadas[clave] = ahora

    nombre_candidato = candidato.get("nombre") or candidato.get("nombre_chat") or "Candidato"
    telefono_candidato = candidato.get("telefono") or "desconocido"

    mensaje = (
        "⚠️ *FALLA DEL SISTEMA DE AGENDAMIENTO*\n\n"
        f"La herramienta *{nombre_tool}* falló y el candidato recibió un mensaje de disculpa "
        "en vez de su cita.\n\n"
        f"👤 *Candidato:* {nombre_candidato}\n"
        f"📱 wa.me/{telefono_candidato}\n"
        f"📅 *Calendario:* {reclutador.get('calendar_id') or 'no definido'}\n\n"
        f"🔧 *Qué hacer:*\n{_explicar_fallo(exc)}\n\n"
        f"_Detalle: {type(exc).__name__}: {str(exc)[:180]}_\n"
        "_(No se repetirá este aviso por 30 min)_"
    )

    # Al reclutador afectado y al administrador del sistema. Se usa un dict
    # ordenado como conjunto para no mandar dos mensajes iguales cuando el
    # administrador es además el reclutador de esa vacante.
    destinos: dict[str, None] = {}
    reclutador_tel = (reclutador.get("telefono_reclutador") or "").replace(_WA_C_US_SUFFIX, "").strip()
    if reclutador_tel:
        destinos[reclutador_tel] = None
    admin_tel = (ENV.ALERTAS_ADMIN_TELEFONO or "").replace(_WA_C_US_SUFFIX, "").strip()
    if admin_tel:
        destinos[admin_tel] = None

    for destino in destinos:
        # Cada destinatario se envía por separado: que WAHA rechace uno no
        # debe dejar al otro sin enterarse.
        try:
            await waha_client.send_text("default", f"{destino}{_WA_C_US_SUFFIX}", mensaje)
            logger.info("_alertar_fallo_tool: alerta enviada a %s por fallo en %s", destino, nombre_tool)
        except Exception:
            logger.exception("_alertar_fallo_tool: no se pudo avisar a %s del fallo en %s", destino, nombre_tool)


_ERROR_TOOL_GENERICO = "No se pudo completar la operación por un problema técnico."


async def _ejecutar_tool(nombre: str, args: dict, candidato: dict, reclutador: dict) -> dict:
    try:
        if nombre in ("revisar_calendario", "crear_evento") and not reclutador.get("calendar_id"):
            # Falla cerrado: sin calendario del reclutador no se agenda en
            # ningún calendario "de respaldo" ajeno.
            logger.error(
                "_ejecutar_tool: %s sin calendar_id de reclutador (telefono=%s) -- no se agenda",
                nombre, enmascarar(candidato.get("telefono")),
            )
            return {"error": "No hay un calendario disponible para agendar en este momento."}
        if nombre == "revisar_calendario":
            return await _tool_revisar_calendario(reclutador["calendar_id"], args)
        if nombre == "crear_evento":
            # REGLA OBLIGATORIA: solo se crea el evento si el candidato ya entregó INE y RFC
            # (ver analizador.puede_agendar).
            if not puede_agendar(candidato):
                logger.warning(
                    "_ejecutar_tool: se bloqueó crear_evento para candidato telefono=%s (estado=%s) porque no ha completado INE/RFC",
                    enmascarar(candidato.get("telefono")), candidato.get("estado")
                )
                return {
                    "error": "No es posible agendar la cita todavía. El candidato debe primero completar la recepción y validación de su INE y RFC (Estado INE_VALIDADA)."
                }
            return await _tool_crear_evento(candidato, reclutador, args)
        if nombre == "eliminar_evento":
            return await _tool_eliminar_evento(candidato, reclutador)
        return {"error": f"Herramienta desconocida: {nombre}"}
    except Exception as e:
        logger.exception("_ejecutar_tool: fallo en %s", nombre)
        # La alerta nunca debe tumbar el turno: si falla, el candidato igual
        # recibe su mensaje y el error queda en los logs como antes.
        try:
            await _alertar_fallo_tool(nombre, e, candidato, reclutador)
        except Exception:
            logger.exception("_ejecutar_tool: fallo al alertar del fallo en %s", nombre)
        # Al modelo nunca le llega el detalle interno (str(e) trae IDs de
        # calendario, rutas, mensajes de Google): queda en logs y en la alerta.
        return {"error": _ERROR_TOOL_GENERICO}


async def _ejecutar_ronda_tools(
    chat,
    calls,
    candidato: dict,
    reclutador: dict,
    ya_creado: bool = False,
) -> tuple[bool, bool, str | None, object]:
    """`ya_creado`: si en una ronda anterior de este turno ya se creó una cita.
    Se permite UN crear_evento exitoso por turno."""
    evento_creado_ok = False
    evento_eliminado_ok = False
    fecha_evento: str | None = None
    parts = []
    for fc in calls:
        args = dict(fc.args) if fc.args else {}
        if fc.name == "crear_evento" and (ya_creado or evento_creado_ok):
            resultado = {"error": "Ya se agendó una cita en este turno; no se puede crear otra."}
        else:
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
    return evento_creado_ok, evento_eliminado_ok, fecha_evento, response


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
        creado, eliminado, fecha, response = await _ejecutar_ronda_tools(
            chat, calls, candidato, reclutador, ya_creado=evento_creado_ok
        )
        if creado:
            evento_creado_ok = True
            fecha_evento = fecha or fecha_evento
        if eliminado:
            evento_eliminado_ok = True

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

async def _resolver_telefono_reclutador_con_fallback(reclutador: dict, empresa_id: str | None = None) -> tuple[str | None, str]:
    """Obtiene el teléfono del reclutador asignado desde la base de datos.
    Si el reclutador asignado NO tiene teléfono registrado:
    1. Busca en la BD cualquier otro reclutador activo que SÍ tenga teléfono registrado.
    2. Si encuentra un reclutador de respaldo, devuelve su teléfono y una nota aclaratoria.
    3. Si ningún reclutador en la BD tiene teléfono, devuelve (None, "").
    """
    telefono_directo = (reclutador.get("telefono_reclutador") or reclutador.get("telefono") or "").replace(_WA_C_US_SUFFIX, "").strip()
    nombre_original = reclutador.get("nombre_reclutador") or reclutador.get("nombre") or "Reclutador Asignado"

    if telefono_directo and len("".join(filter(str.isdigit, telefono_directo))) >= 10:
        return telefono_directo, ""

    try:
        pool = get_pool()
        row = None
        if empresa_id:
            row = await pool.fetchrow(
                "SELECT nombre, telefono FROM reclutadores WHERE activo = TRUE AND empresa_id = $1::uuid AND telefono IS NOT NULL AND telefono != '' ORDER BY updated_at DESC LIMIT 1",
                empresa_id,
            )
        if not row:
            row = await pool.fetchrow(
                "SELECT nombre, telefono FROM reclutadores WHERE activo = TRUE AND telefono IS NOT NULL AND telefono != '' ORDER BY updated_at DESC LIMIT 1"
            )

        if row and row["telefono"]:
            tel_respaldo = str(row["telefono"]).replace(_WA_C_US_SUFFIX, "").strip()
            nota = (
                f"⚠️ *AVISO AUTOMÁTICO:* No se encontró el número de teléfono registrado del reclutador "
                f"*{nombre_original}*, por lo que esta notificación se te envió a ti ({row['nombre']}) para atención inmediata:\n\n"
            )
            return tel_respaldo, nota
    except Exception:
        logger.exception("_resolver_telefono_reclutador_con_fallback: error buscando reclutador en BD")

    return None, ""


async def _preparar_alerta_humano(candidato: dict, contacto: dict, webhook_payload: dict, reclutador: dict, human_alert_nombre: str | None, human_alert_resumen: str | None) -> dict:
    ultimo_mensaje = webhook_payload.get("body") or "Mensaje multimedia o sin texto"
    nombre = candidato.get("nombre") or human_alert_nombre or "Candidato"
    telefono = candidato.get("telefono") or contacto.get("number") or "0000000000"
    vacante = limpiar_vacante(candidato.get("vacante_interes"))
    if es_placeholder_vacante(vacante):
        vacante = ""
    motivo = human_alert_resumen or "El usuario solicitó hablar con un humano."

    nombre_destino = reclutador.get("nombre_reclutador") or "Equipo de Reclutamiento"
    telefono_destino, nota_fallback = await _resolver_telefono_reclutador_con_fallback(reclutador, candidato.get("empresa_id"))

    cuerpo_alerta = (
        f"🚨 *SOLICITUD DE ATENCIÓN HUMANA*\n\nHola {nombre_destino}, este usuario pide hablar con un reclutador:\n\n"
        f"👤 *{nombre}*\n📱 wa.me/{telefono}\n💼 Interés: {vacante or 'Sin vacante definida'}\n\n"
        f'💬 *Mensaje literal:* "{ultimo_mensaje}"\n\n🤖 *Resumen Sofía:* _{motivo}_'
    )
    mensaje_alerta = f"{nota_fallback}{cuerpo_alerta}"

    return {
        "telefono_destino": telefono_destino,
        "nombre_candidato": nombre,
        "telefono_candidato": telefono,
        "vacante": vacante,
        "empresa_id": candidato.get("empresa_id"),
        "mensaje_alerta": mensaje_alerta,
    }


async def _marcar_escalado(telefono: str, nombre: str, vacante: str, motivo: str | None = None, empresa_id: str | None = None) -> None:
    pool = get_pool()
    # Antes esto era un UPSERT con `ON CONFLICT (telefono)`, pero la única
    # restricción única de `candidatos` es (telefono, empresa_id): Postgres
    # rechazaba la sentencia entera con "no unique or exclusion constraint
    # matching the ON CONFLICT specification", así que TODO escalamiento
    # automático reventaba justo después de avisarle al reclutador y el
    # candidato nunca quedaba marcado como escalado en el CRM.
    # Se hace UPDATE primero (el caso real: quien escala ya venía chateando)
    # y sólo se inserta si de verdad no existe la fila.
    row = await pool.fetchrow(
        """
        UPDATE candidatos SET
            ultima_interaccion = NOW(),
            estado = 'ESCALADO',
            resumen_ia = 'El usuario solicitó hablar con un humano.',
            escalado = TRUE,
            escalated_at = NOW(),
            escalation_reason = $2
        WHERE telefono = $1 AND empresa_id IS NOT DISTINCT FROM $3::uuid
        RETURNING id, asignado_a_id
        """,
        telefono, motivo or "Solicitud de atención humana",
        str(empresa_id) if empresa_id else None,
    )
    if row is None:
        row = await pool.fetchrow(
            """
            INSERT INTO candidatos (telefono, nombre, estado, ultima_interaccion, vacante_interes, resumen_ia, escalado, escalated_at, escalation_reason, empresa_id)
            VALUES ($1, $2, 'ESCALADO', NOW(), NULLIF($3, ''), 'El usuario solicitó hablar con un humano.', TRUE, NOW(), $4, $5::uuid)
            RETURNING id, asignado_a_id
            """,
            telefono, nombre, vacante or "", motivo or "Solicitud de atención humana",
            str(empresa_id) if empresa_id else None,
        )
    if row and row["asignado_a_id"]:
        try:
            msg_notif = f"🚨 Atención humana requerida: {nombre} ({vacante})"
            await pool.execute(
                "INSERT INTO notificaciones (reclutador_id, mensaje) VALUES ($1, $2)",
                row["asignado_a_id"], msg_notif,
            )
        except Exception:
            logger.exception("_marcar_escalado: error insertando notificacion en CRM")


def _formatear_fecha_alerta(fecha_cita: str) -> str:
    if not fecha_cita or "T" not in fecha_cita:
        return fecha_cita or "Fecha por confirmar"
    try:
        fecha_parte, hora_parte = fecha_cita.split("T")
        anio, mes, dia = fecha_parte.split("-")
        hora, minuto = hora_parte.split(":")[:2]
        nombre_mes = MESES_ES[int(mes) - 1]
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


async def _preparar_alerta_cita(candidato: dict, contacto: dict, reclutador: dict, item: dict) -> dict:
    nombre_candidato = candidato.get("nombre_ine") or candidato.get("nombre_chat") or "Candidato"
    telefono_candidato = contacto.get("number") or candidato.get("telefono") or "0000000000"
    fecha_cita = _formatear_fecha_alerta(item.get("fecha_entrevista_detectada") or "")
    nave_candidato = candidato.get("nave_interes") or "No especificada"
    resumen_ia = candidato.get("resumen_ia") or "Sin resumen previo disponible."
    vacante_detectada = limpiar_vacante(item.get("vacante_detectada") or candidato.get("vacante_interes"))
    if es_placeholder_vacante(vacante_detectada):
        vacante_detectada = "Sin vacante definida"

    nombre_reclutador = reclutador.get("nombre_reclutador") or "Equipo de Reclutamiento"
    telefono_destino, nota_fallback = await _resolver_telefono_reclutador_con_fallback(reclutador, candidato.get("empresa_id"))

    experiencia = (candidato.get("experiencia") or "").strip()
    linea_experiencia = f"\n\n💼 *EXPERIENCIA (CV):*\n{experiencia}" if experiencia else ""

    cuerpo_alerta = (
        f"📅 *¡NUEVA ENTREVISTA AGENDADA!* \n\nHola {nombre_reclutador}, el bot acaba de cerrar una cita con éxito:\n\n"
        f"👤 *Candidato:* {nombre_candidato}\n📱 *Tel:* wa.me/{telefono_candidato}\n💼 *Vacante:* {vacante_detectada}\n"
        f"🏢 *Nave/Sucursal:* {nave_candidato}\n⏰ *Fecha:* {fecha_cita}\n\n📝 *RESUMEN DEL CANDIDATO (IA):*\n{resumen_ia}"
        f"{linea_experiencia}\n\n"
        "⚙️ *FILTROS TÉCNICOS:*\n_Todos los documentos (CV, INE, RFC) ya están listos y cargados en la plataforma._"
    )
    mensaje_alerta = f"{nota_fallback}{cuerpo_alerta}"
    return {"telefono_destino": telefono_destino, "mensaje_alerta": mensaje_alerta}


# --- AlmacenarMensajes (reusa /api/webhook/n8n-incoming) --------------------

def _extraer_resumen_n8n_incoming(resumen_generado: str | None) -> str:
    resumen_generado = resumen_generado or ""
    if "MEMORY_UPDATE" in resumen_generado:
        despues = (resumen_generado.split("MEMORY_UPDATE")[1] or "").split("|")
        return (despues[1] if len(despues) > 1 else resumen_generado).strip()
    return resumen_generado


async def _almacenar_mensajes(contacto: dict, candidato: dict, item: dict, juntado: dict, webhook_payload: dict, ultimo_texto: str | None = None) -> None:
    body = {
        "telefono": contacto.get("number"),
        "nombre": item.get("nombre_detectado") or candidato.get("nombre") or "Candidato",
        "nombre_confirmado": bool(item.get("nombre_detectado") or candidato.get("nombre_confirmado")),
        "lugar_residencia": item.get("database_updates", {}).get("lugar_residencia") or item.get("lugar_residencia") or candidato.get("lugar_residencia") or "",
        "cita_creada": bool(item.get("cita_creada") or item.get("fecha_entrevista_detectada")),
        "vacante": (item.get("vacante_detectada") or item.get("vacante_manual") or candidato.get("vacante_interes") or "").strip(),
        "resumen": _extraer_resumen_n8n_incoming(item.get("resumen_generado")),
        "cita_cancelada": bool(item.get("cita_cancelada")),
        "filtros": item.get("respuestas_filtro_detectadas"),
        "experiencia_actividades": item.get("experiencia_actividades"),
        "cv_manual": json.dumps(item["datos_cv_manual"]) if item.get("datos_cv_manual") else None,
        "fecha_entrevista": item.get("fecha_entrevista_detectada"),
        "privacidad": bool(item.get("acepto_privacidad")),
        "nombre_wpp": (webhook_payload.get("_data") or {}).get("notifyName") or "",
        "nave": item.get("nave_detectada") or "",
        "es_cv": bool(item.get("es_cv_manual")),
        # El preview de la bandeja debe reflejar el ÚLTIMO mensaje que
        # realmente se mandó, no el primero de una respuesta partida.
        "mensaje_ia": ultimo_texto or item.get("message_to_user") or "",
        "mensaje_candidato": juntado.get("mensaje_completo") or _MENSAJE_MULTIMEDIA_FALLBACK,
        "message_type": juntado.get("message_type") or "text",
        "media_url": juntado.get("media_url"),
    }
    url = f"{ENV.FRONTEND_API_BASE}/api/webhook/n8n-incoming"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, json=body, headers=auth_headers())
            resp.raise_for_status()
    except Exception:
        logger.exception("_almacenar_mensajes: POST n8n-incoming falló para telefono=%s", contacto.get("number"))


# --- Orquestador principal ---------------------------------------------------

def _session_id_memoria(numero: str | None, chat_id: str) -> str:
    """Clave estable de la memoria del candidato.

    Se prefiere `{numero}@c.us` para que los turnos que llegan por LID caigan en
    la misma sesión que los que llegan por número. Si el número no se pudo
    resolver, se cae a `chat_id` para no perder el turno.
    """
    digitos = "".join(filter(str.isdigit, str(numero or "")))
    if digitos:
        return f"{digitos}{_WA_C_US_SUFFIX}"
    return chat_id


def _rescatar_residencia(candidato: dict, items: list[dict], mensaje_usuario: str) -> str | None:
    """Municipio a guardar cuando el modelo no etiquetó la residencia, o None.

    `etiquetas_internas.lugar_residencia` es opcional en el prompt y el modelo
    la omite casi siempre: redacta "¡Zapopan está dentro de nuestra cobertura!"
    sin emitirla. El campo se queda vacío, la regla Diamante de residencia ve
    LUGAR_RESIDENCIA="Pendiente" y vuelve a pedir la ciudad; al turno siguiente
    pasa lo mismo y la conversación entra en bucle sin salida posible (visto en
    producción desde el 13/08/2026).

    Solo actúa cuando no hay nada guardado y el modelo tampoco etiquetó nada, así
    que nunca pisa un dato bueno ni contradice al modelo.
    """
    if (candidato.get("lugar_residencia") or "").strip():
        return None
    ya_etiquetado = any(
        (item.get("database_updates", {}).get("lugar_residencia") or "").strip()
        for item in items
    )
    if ya_etiquetado:
        return None
    return parser.detectar_municipio_zmg(mensaje_usuario)


def _sincronizar_items_con_tools(items: list[dict], ejecucion: dict, numero: str) -> list[dict]:
    evento_creado_ok = ejecucion["evento_creado_ok"]
    if evento_creado_ok and ejecucion["fecha_evento"]:
        for item in items:
            item["fecha_entrevista_detectada"] = ejecucion["fecha_evento"]
            item["cita_creada"] = True
    # Igual que cita_creada: la cancelación solo cuenta si eliminar_evento
    # corrió con éxito. Un "CITA_CANCELADA" escrito por el modelo (o inducido
    # por el candidato) no basta para mover el expediente.
    for item in items:
        item["cita_cancelada"] = bool(ejecucion["evento_eliminado_ok"])

    primero = items[0]
    if primero.get("fecha_entrevista_detectada") and not evento_creado_ok:
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
    return items


async def _despachar_alerta_humano(
    session: str,
    chat_id: str,
    numero: str,
    primero: dict,
    candidato: dict,
    contacto: dict,
    payload: dict,
    reclutador: dict,
    motivo_escalamiento: str | None,
) -> list[str]:
    enviados: list[str] = []
    if primero.get("message_to_user"):
        await waha_client.send_text(session, chat_id, primero["message_to_user"])
        await _guardar_mensaje_asistente(numero, primero["message_to_user"])
        enviados.append(primero["message_to_user"])
    alerta = await _preparar_alerta_humano(candidato, contacto, payload, reclutador, primero.get("human_alert_nombre"), motivo_escalamiento)
    if alerta.get("telefono_destino"):
        await waha_client.send_text(session, f"{alerta['telefono_destino']}{_WA_C_US_SUFFIX}", alerta["mensaje_alerta"])
    else:
        logger.warning("procesar_turno: no hay ningún teléfono de reclutador en BD para enviar la alerta")
    await _marcar_escalado(
        alerta["telefono_candidato"],
        alerta["nombre_candidato"],
        alerta["vacante"],
        motivo_escalamiento,
        alerta.get("empresa_id"),
    )
    logger.info(
        "procesar_turno: candidato telefono=%s escalado a %s (motivo=%s)",
        numero, alerta.get("telefono_destino"), motivo_escalamiento,
    )
    return enviados


async def _despachar_mensajes_normales(
    session: str,
    chat_id: str,
    numero: str,
    items: list[dict],
) -> list[str]:
    enviados: list[str] = []
    for i, item in enumerate(items):
        if item.get("message_to_user"):
            await waha_client.send_text(session, chat_id, item["message_to_user"])
            await _guardar_mensaje_asistente(numero, item["message_to_user"])
            enviados.append(item["message_to_user"])
        if i < len(items) - 1:
            await asyncio.sleep(_ENTRE_MENSAJES_SEGUNDOS)
    return enviados


async def _notificar_cita_si_aplica(
    session: str,
    primero: dict,
    candidato: dict,
    contacto: dict,
    reclutador: dict,
) -> None:
    if primero.get("fecha_entrevista_detectada"):
        alerta_cita = await _preparar_alerta_cita(candidato, contacto, reclutador, primero)
        if alerta_cita.get("telefono_destino"):
            await waha_client.send_text(session, f"{alerta_cita['telefono_destino']}{_WA_C_US_SUFFIX}", alerta_cita["mensaje_alerta"])
        else:
            logger.warning("procesar_turno: no hay teléfono de reclutador en BD para enviar alerta de cita")


async def procesar_turno(webhook_body: dict, contacto: dict, candidato: dict, system_prompt_base: str, agenda: dict, mensaje_override: str | None) -> None:
    payload = webhook_body["payload"]
    session = webhook_body.get("session") or "default"
    numero = contacto.get("number")
    chat_id = contacto.get("chat_id") or (f"{numero}{_WA_C_US_SUFFIX}" if str(numero).isdigit() else f"{numero}@lid")

    reclutador = await resolver_reclutador(agenda)
    system_prompt = system_prompt_base.replace("{{RECLUTADOR_ASIGNADO}}", reclutador.get("nombre_reclutador") or "Tu equipo")

    juntado = await _juntar_mensajes(numero)
    if not juntado.get("mensaje_completo"):
        return  # ¿HayMensajes? -- nada que procesar (carrera/reintento raro)

    if candidato.get("escalado"):
        await _guardar_mensaje_usuario_escalado(numero, juntado, candidato.get("empresa_id"))
        return

    # Se guarda YA (con su timestamp real), no hasta que termine todo el
    # pipeline -- ver docstring de `_guardar_mensaje_usuario`.
    await _guardar_mensaje_usuario(numero, juntado)

    mensaje_para_ia = mensaje_override or juntado["mensaje_completo"] or "[Mensaje sin texto]"
    session_id = _session_id_memoria(numero, chat_id)
    historial = await memoria.cargar_historial(session_id)

    ejecucion = await _ejecutar_agente(system_prompt, historial, mensaje_para_ia, candidato, reclutador)
    texto_ia = ejecucion["texto"]

    catalogo_vacs, sinonimos_vacs = await vacantes.obtener_catalogo_vacantes_db(candidato.get("empresa_id"))
    items = parser.procesar_respuesta_ia(texto_ia, candidato, catalogo=catalogo_vacs, sinonimos=sinonimos_vacs)
    if not items:
        return
    primero = items[0]

    municipio_rescatado = _rescatar_residencia(candidato, items, mensaje_para_ia)
    if municipio_rescatado:
        logger.info(
            "procesar_turno: el modelo no etiquetó la residencia; se detectó "
            "'%s' en el mensaje del candidato (telefono=%s)",
            municipio_rescatado,
            numero,
        )
        primero.setdefault("database_updates", {})["lugar_residencia"] = municipio_rescatado
        primero["lugar_residencia"] = municipio_rescatado

    es_human_alert = any(
        c.get("code") == "HUMAN_ALERT" for c in primero.get("detected_codes", [])
    ) or any(
        a.get("type") == "alert_human" for a in primero.get("pending_actions", [])
    )
    motivo_escalamiento = primero.get("human_alert_resumen") or primero.get("motivo_final")

    items = _sincronizar_items_con_tools(items, ejecucion, numero)
    primero = items[0]

    enviados: list[str] = []
    if es_human_alert:
        enviados = await _despachar_alerta_humano(
            session, chat_id, numero, primero, candidato, contacto, payload, reclutador, motivo_escalamiento
        )
    elif primero.get("message_to_user"):
        enviados = await _despachar_mensajes_normales(session, chat_id, numero, items)

    await _notificar_cita_si_aplica(session, primero, candidato, contacto, reclutador)

    await memoria.guardar_turno(
        session_id,
        mensaje_para_ia,
        "\n\n".join(enviados) or primero.get("message_to_user") or "",
    )
    await _almacenar_mensajes(contacto, candidato, primero, juntado, payload, ultimo_texto=(enviados[-1] if enviados else None))
