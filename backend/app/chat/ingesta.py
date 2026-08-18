"""Puerto de `1_Sofia - Inicio.json`: filtro de entrada, dedup, filtro de
equipo interno, migración de LID, rate limiting y gate de 3 faltas. Es el
punto de entrada real del webhook de WAHA -- orquesta también la llamada
a `analizador.py` y `agente.py` (en n8n eran subflujos separados vía
`executeWorkflow`; en Python son funciones normales en el mismo proceso).

Nota deliberada (documentada, no corregida en esta migración): igual que
el original, `MigrarLID`/`ObtenerDatosCandidato`/`rate_limiting` no
filtran por `empresa_id` -- gap multi-tenant preexistente, fuera de
alcance de esta fase."""

import asyncio
import logging
import time
import uuid

import httpx

from app import waha_client
from app.chat import agente, analizador
from app.config import ENV
from app.db import get_pool
from app.internal_api import auth_headers

logger = logging.getLogger("ingesta")

_TEST_PHONE = "5213323379399"
_DEBOUNCE_SECONDS = 8.0
_debounce_deadlines: dict[str, float] = {}
_debounce_lock = asyncio.Lock()


async def _procesar_con_debounce(telefono: str, tarea, al_primero=None) -> None:
    async with _debounce_lock:
        ya_pendiente = telefono in _debounce_deadlines
        _debounce_deadlines[telefono] = time.monotonic() + _DEBOUNCE_SECONDS

    if not ya_pendiente and al_primero is not None:
        try:
            await al_primero()
        except Exception:
            logger.exception("_procesar_con_debounce: al_primero() falló para telefono=%s", telefono)

    if ya_pendiente:
        return  # ya hay otra tarea esperando por este teléfono, no dupliques

    while True:
        async with _debounce_lock:
            objetivo = _debounce_deadlines.get(telefono)
        if objetivo is None:
            return
        espera = objetivo - time.monotonic()
        if espera <= 0:
            break
        await asyncio.sleep(espera)

    async with _debounce_lock:
        _debounce_deadlines.pop(telefono, None)

    await tarea()

_MENSAJE_3_FALTAS = (
    "Hola. 🚨 Hemos notado en nuestros registros que no te has presentado a tus últimas 3 entrevistas "
    "programadas. Por políticas de Talentos Creativos e Innovación, no es posible agendar una nueva cita "
    "en este momento. Agradecemos tu interés y te deseamos mucho éxito en tu búsqueda."
)

_MENSAJE_4_CANCELACIONES = (
    "Hola. 🚨 Hemos registrado en nuestro sistema que has alcanzado el límite máximo de cancelaciones "
    "y reagendamientos permitidos (4 cancelaciones). Por políticas de la empresa, no es posible agendar "
    "una nueva entrevista en este momento. Agradecemos tu tiempo y te deseamos mucho éxito."
)



# Remitentes que no son un candidato escribiéndole al bot. WhatsApp entrega
# todo por el mismo webhook, así que sin este filtro los estados/historias que
# publican los contactos entraban al pipeline como si fueran mensajes: se
# gastaba una llamada a Gemini por cada uno (que además reventaba con
# "Unsupported MIME type: application/mp4" en los estados de video) y se creaba
# un candidato basura con teléfono "status".
_SUFIJOS_REMITENTE_IGNORADO = (
    "@broadcast",    # status@broadcast: estados/historias de 24 h
    "@g.us",         # grupos: el bot conversa 1 a 1, no en grupos
    "@newsletter",   # canales de difusión
)


def _es_remitente_ignorado(remitente: str) -> bool:
    remitente = (remitente or "").lower()
    return any(remitente.endswith(sufijo) for sufijo in _SUFIJOS_REMITENTE_IGNORADO)


def _es_mensaje_valido(body: dict) -> bool:
    payload = body.get("payload") or {}
    if "message" not in (body.get("event") or ""):
        return False
    timestamp = payload.get("timestamp")
    if timestamp is None or (time.time() - timestamp) >= 120:
        return False
    if payload.get("type") in ("protocol", "e2e_notification"):
        return False
    if payload.get("fromMe"):
        return False
    if _es_remitente_ignorado(payload.get("from") or ""):
        logger.debug("mensaje ignorado por remitente: %s", payload.get("from"))
        return False
    return True


async def _dedup(message_id: str | None) -> bool:
    if not message_id:
        return False
    pool = get_pool()
    row = await pool.fetchrow(
        "INSERT INTO processed_webhooks (message_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING message_id",
        message_id,
    )
    return row is not None


async def _reset_sofia_test() -> None:
    """Comando de prueba '/reset_sofia': borra todo rastro del número de
    prueba hardcodeado. Solo se activa si alguien manda ese comando exacto
    -- utilidad de debug, no ruta de negocio real."""
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM n8n_chat_histories WHERE session_id = $1", f"{_TEST_PHONE}@c.us")
            await conn.execute("DELETE FROM conversation_history WHERE telefono = $1", _TEST_PHONE)
            await conn.execute("DELETE FROM rate_limiting WHERE telefono = $1", _TEST_PHONE)
            await conn.execute("DELETE FROM candidatos WHERE telefono = $1", _TEST_PHONE)
    await waha_client.send_text("default", f"{_TEST_PHONE}@c.us", "Resteo listo")


async def _es_reclutador(remitente_id: str) -> bool:
    try:
        url = f"{ENV.FRONTEND_API_BASE}/api/db/reclutador_vacantes"
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=auth_headers())
            if resp.status_code != 200:
                return False
            equipo = resp.json()
    except Exception:
        logger.exception("_es_reclutador: fetch reclutador_vacantes falló")
        return False

    for reclutador in equipo if isinstance(equipo, list) else []:
        telefono = (reclutador or {}).get("telefono")
        if telefono and telefono.strip()[-10:] in remitente_id:
            return True
    return False


def _fix_lid(get_info_result: dict, payload: dict | None = None) -> dict:
    """Extrae el número telefónico real (dígitos) o el LID si no hay teléfono disponible,
    soportando tanto WEBJS como NOWEB de WAHA."""
    result = dict(get_info_result or {})
    payload = payload or {}
    _data = payload.get("_data") or {}
    key = _data.get("key") or {}

    remitente = result.get("id") or payload.get("from") or ""

    lid_val = None
    if remitente and "@" in remitente and remitente.endswith("@lid"):
        lid_val = remitente.split("@")[0]
        result["lid"] = lid_val
    elif result.get("lid") and "@lid" in str(result.get("lid")):
        lid_val = str(result["lid"]).split("@")[0]
        result["lid"] = lid_val

    # 1. Intentar obtener la parte numérica del teléfono desde varias fuentes prioritarias de WAHA
    phone_raw = (
        key.get("remoteJidAlt")
        or _data.get("remoteJidAlt")
        or payload.get("remoteJidAlt")
        or key.get("pnJid")
        or _data.get("pnJid")
        or payload.get("pnJid")
        or result.get("phoneNumber")
        or result.get("number")
        or payload.get("author")
        or _data.get("author")
        or (_data.get("contact") or {}).get("number")
        or (_data.get("contact") or {}).get("phoneNumber")
        or ""
    )

    clean_digits = ""
    if phone_raw:
        if "@" in phone_raw:
            phone_num = phone_raw.split("@")[0]
        else:
            phone_num = phone_raw
        clean_digits = "".join(filter(str.isdigit, phone_num))

    if not clean_digits and remitente and "@" in remitente and not remitente.endswith("@lid"):
        from_digits = "".join(filter(str.isdigit, remitente.split("@")[0]))
        if from_digits:
            clean_digits = from_digits

    # Si no pudimos resolver el teléfono de dígitos pero tenemos LID, usar LID como identificador provisional
    if not clean_digits and lid_val:
        clean_digits = lid_val

    result["number"] = clean_digits
    result["chat_id"] = remitente if "@" in remitente else (f"{clean_digits}@c.us" if clean_digits.isdigit() else f"{clean_digits}@lid")
    return result


async def _resolver_contacto(session: str, remitente_raw: str, payload: dict) -> dict:
    get_info = await waha_client.get_contact(session, remitente_raw)
    contacto = _fix_lid(get_info, payload)

    lid_val = contacto.get("lid")
    number = contacto.get("number") or ""

    # Si 'number' sigue siendo un LID largo y no un teléfono normal, consultar chats de WAHA
    if lid_val and (number == lid_val or len(number) > 13 or not number.startswith("52")):
        try:
            chats = await waha_client.get_chats(session)
            target_lid = f"{lid_val}@lid"
            for c in chats:
                if c.get("accountLid") == target_lid:
                    cid = c.get("id") or ""
                    pn = c.get("pnJid") or ""
                    phone_src = cid if ("@s.whatsapp.net" in cid or "@c.us" in cid) else pn
                    if phone_src:
                        digits = "".join(filter(str.isdigit, phone_src.split("@")[0]))
                        if digits and len(digits) >= 10:
                            contacto["number"] = digits
                            break
        except Exception:
            logger.debug("_resolver_contacto: no se pudo resolver LID %s vía chats", lid_val)

    return contacto


async def _migrar_lid(number: str, lid: str | None) -> None:
    if not number or not lid or lid == number:
        return
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            # 1. conversation_history
            await conn.execute(
                "UPDATE conversation_history SET telefono = $1 WHERE telefono = $2 AND $2 != '' AND $1 != $2",
                number, lid,
            )
            # 2. candidatos
            c_existe = await conn.fetchval("SELECT 1 FROM candidatos WHERE telefono = $1", number)
            if not c_existe:
                await conn.execute(
                    "UPDATE candidatos SET telefono = $1 WHERE telefono = $2 AND $2 != '' AND $1 != $2",
                    number, lid,
                )
            else:
                await conn.execute(
                    """
                    UPDATE candidatos c
                    SET nombre = COALESCE(NULLIF(c.nombre, 'Candidato'), l.nombre, c.nombre),
                        estado = CASE WHEN c.estado = 'RECORDATORIO_ENVIADO' THEN l.estado ELSE c.estado END,
                        vacante_interes = COALESCE(NULLIF(c.vacante_interes, ''), l.vacante_interes, c.vacante_interes),
                        nave_interes = COALESCE(NULLIF(c.nave_interes, ''), l.nave_interes, c.nave_interes),
                        ultima_interaccion = GREATEST(c.ultima_interaccion, l.ultima_interaccion)
                    FROM candidatos l
                    WHERE c.telefono = $1 AND l.telefono = $2
                    """,
                    number, lid,
                )
                await conn.execute(
                    "DELETE FROM candidatos WHERE telefono = $2 AND $2 != '' AND $1 != $2",
                    number, lid,
                )
            # 3. mensajes_bandeja
            mb_existe = await conn.fetchval("SELECT 1 FROM mensajes_bandeja WHERE telefono = $1", number)
            if not mb_existe:
                await conn.execute(
                    "UPDATE mensajes_bandeja SET telefono = $1 WHERE telefono = $2 AND $2 != '' AND $1 != $2",
                    number, lid,
                )
            else:
                await conn.execute(
                    "DELETE FROM mensajes_bandeja WHERE telefono = $2 AND $2 != '' AND $1 != $2",
                    number, lid,
                )
            # 4. n8n_chat_histories
            await conn.execute(
                "UPDATE n8n_chat_histories SET session_id = $1 WHERE session_id = $2 OR session_id = $3",
                f"{number}@c.us", f"{lid}@c.us", f"{lid}@lid",
            )
            # 5. rate_limiting
            await conn.execute(
                "DELETE FROM rate_limiting WHERE telefono = $1",
                lid,
            )


async def _actualizar_rate_limiting(telefono: str) -> None:
    pool = get_pool()
    await pool.execute(
        "INSERT INTO rate_limiting (telefono, last_message_at) VALUES ($1, NOW()) "
        "ON CONFLICT (telefono) DO UPDATE SET last_message_at = NOW()",
        telefono,
    )


async def _guardar_mensaje_temporal(telefono: str, payload: dict) -> None:
    pool = get_pool()
    await pool.execute(
        "INSERT INTO conversation_history (telefono, role, content, message_type, media_url) "
        "VALUES ($1, 'user_temp', $2, $3, $4)",
        telefono,
        payload.get("body") or "[Mensaje multimedia]",
        payload.get("type") or "text",
        (payload.get("media") or {}).get("url"),
    )


async def _obtener_candidato(telefono: str) -> dict:
    pool = get_pool()
    row = await pool.fetchrow("SELECT * FROM candidatos WHERE telefono = $1", telefono)
    return dict(row) if row else {}


async def procesar_webhook(body: dict) -> None:
    if not _es_mensaje_valido(body):
        return

    payload = body["payload"]

    if not await _dedup(payload.get("id")):
        return

    if payload.get("body") == "/reset_sofia":
        await _reset_sofia_test()
        return

    session = body.get("session") or "default"
    remitente_raw = payload.get("from") or ""
    contacto = await _resolver_contacto(session, remitente_raw, payload)
    remitente_original = contacto.get("id") or remitente_raw

    if await _es_reclutador(remitente_original):
        return

    await _migrar_lid(contacto.get("number"), contacto.get("lid"))
    await _actualizar_rate_limiting(contacto.get("number") or remitente_raw.split("@")[0])

    number = contacto.get("number")
    if not number:
        logger.debug("procesar_webhook: remitente sin identificador válido (%r), se ignora", number)
        return

    chat_id = contacto.get("chat_id") or (remitente_original if "@" in remitente_original else f"{number}@c.us")

    pool = get_pool()
    await pool.execute("UPDATE candidatos SET ultima_ejecucion_id = $1 WHERE telefono = $2", str(uuid.uuid4()), number)
    await _guardar_mensaje_temporal(number, payload)

    candidato = await _obtener_candidato(number)

    if (candidato.get("Faltas") or 0) >= 3:
        await waha_client.send_text(session, chat_id, _MENSAJE_3_FALTAS)
        return

    if (candidato.get("cancelaciones") or 0) >= 4:
        await waha_client.send_text(session, chat_id, _MENSAJE_4_CANCELACIONES)
        return

    async def _tarea():
        try:
            await analizador_y_chat(body, contacto, candidato)
        except Exception:
            logger.exception("procesar_webhook: fallo en analizador_y_chat para telefono=%s", number)

    async def _avisar_escribiendo():
        await waha_client.start_typing(session, chat_id)

    await _procesar_con_debounce(number, _tarea, al_primero=_avisar_escribiendo)


async def analizador_y_chat(body: dict, contacto: dict, candidato: dict) -> None:
    """Encadena analizador.py (workflow 2) -> agente.py (workflow 3),
    igual que hacía el 'Ejecutar Subflujo' -> 'Ejecutar Subflujo'
    original, pero como llamadas directas en el mismo proceso."""
    payload = body["payload"]
    numero = contacto.get("number")

    # Releer el candidato fresco de BD tras el debounce (evita usar datos obsoletos si hubo mensajes previos recientes)
    if numero:
        candidato = await _obtener_candidato(numero) or candidato

    if candidato and candidato.get("estado") in ("OTRA_CIUDAD", "RECHAZADO", "INACTIVO"):
        logger.info("Candidato telefono=%s está en estado %s -- se omite procesamiento para ahorrar tokens", contacto.get("number"), candidato.get("estado"))
        return

    resultado_media = await analizador.analizar_mensaje(payload, contacto, candidato)
    if resultado_media["detuvo_flujo"]:
        return

    mensaje_override = resultado_media["mensaje_para_agente"]

    # analizar_mensaje() puede haber actualizado el expediente (p.ej. estado ->
    # CV_RECIBIDO) en este mismo turno -- si no se relee, cargar_prompt() arma
    # el system prompt con el ESTADO_ACTUAL de ANTES del documento recién
    # recibido, y el modelo vuelve a pedir el CV/solicitud que el candidato
    # acaba de mandar (visto en producción: bucle de "mándame tu CV" incluso
    # después del adjunto).
    if resultado_media["mensaje_para_agente"] is not None:
        candidato = await _obtener_candidato(contacto.get("number")) or candidato

    system_prompt = await analizador.cargar_prompt(payload, contacto, candidato)
    agenda = await analizador.definir_agenda(
        candidato.get("nave_interes"),
        candidato.get("vacante_interes"),
        candidato.get("empresa_id"),
        candidato.get("asignado_a_id"),
    )

    await agente.procesar_turno(
        webhook_body=body,
        contacto=contacto,
        candidato=candidato,
        system_prompt_base=system_prompt,
        agenda=agenda,
        mensaje_override=mensaje_override,
    )
