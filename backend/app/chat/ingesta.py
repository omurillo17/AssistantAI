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

from app import waha_client
from app.chat import agente, analizador
from app.config import ENV
from app.db import get_pool

logger = logging.getLogger("ingesta")

_DEBOUNCE_SECONDS = 8.0
_debounce_deadlines: dict[str, float] = {}
_debounce_lock = asyncio.Lock()

# Un turno en vuelo por candidato. El debounce de arriba solo agrupa lo que
# llega MIENTRAS SE ESPERA: en cuanto empieza `tarea()` se borra el deadline,
# así que un mensaje que entra durante el turno arranca un ciclo nuevo y su
# `tarea()` corría EN PARALELO con la anterior.
#
# Eso rompía la conversación, porque un turno lee el historial al empezar
# (memoria.cargar_historial) y no lo escribe hasta el final
# (memoria.guardar_turno, después de mandar por WAHA). Entre esos dos momentos
# hay Gemini más el regulador de ritmo, que por diseño espera
# WAHA_SEGUNDOS_ENTRE_MENSAJES (~8-15 s) por mensaje: una ventana enorme. El
# segundo turno cargaba un historial sin lo que el bot acababa de contestar y
# el modelo, al no verlo, lo repetía.
#
# Visto en producción: el candidato respondió "Si" al aviso de privacidad y
# Sofía le mandó el aviso otra vez, palabra por palabra.
_turno_locks: dict[str, asyncio.Lock] = {}
# Cuántas tareas tienen o esperan el lock de cada teléfono. Sin esto el
# diccionario crece para siempre; y borrar la entrada sin contar dejaría al que
# espera con un lock huérfano, sin exclusión frente a los turnos siguientes.
_turno_en_espera: dict[str, int] = {}


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

    async with _debounce_lock:
        lock = _turno_locks.get(telefono)
        if lock is None:
            lock = asyncio.Lock()
            _turno_locks[telefono] = lock
        _turno_en_espera[telefono] = _turno_en_espera.get(telefono, 0) + 1

    if lock.locked():
        logger.info(
            "_procesar_con_debounce: ya hay un turno en curso para telefono=%s; se espera a que termine",
            telefono,
        )
    try:
        async with lock:
            await tarea()
    finally:
        async with _debounce_lock:
            restantes = _turno_en_espera.get(telefono, 1) - 1
            if restantes <= 0:
                _turno_en_espera.pop(telefono, None)
                _turno_locks.pop(telefono, None)
            else:
                _turno_en_espera[telefono] = restantes

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

_MENSAJE_FALLBACK_ERROR = (
    "Disculpa, tuve un inconveniente momentáneo de conexión al procesar tu mensaje. "
    "¿Podrías enviármelo nuevamente en un momento, por favor? 🙏"
)



# Remitentes que no son un candidato escribiéndole al bot. WhatsApp entrega
# la totalidad de eventos por el mismo webhook, así que sin este filtro los estados/historias que
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


def _es_mensaje_valido(body: dict, ahora: float | None = None) -> bool:
    """`ahora`: hora de recepción del webhook. Si el router lo encoló detrás
    del semáforo, la antigüedad se mide contra cuando llegó, no contra cuando
    se procesa."""
    payload = body.get("payload") or {}
    if "message" not in (body.get("event") or ""):
        return False
    timestamp = payload.get("timestamp")
    if timestamp is None or ((ahora or time.time()) - timestamp) >= 120:
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


def _puede_usar_comandos_prueba(telefono: str | None) -> bool:
    """Los comandos de prueba borran datos: solo con ENABLE_TEST_COMMANDS
    encendido y solo para TEST_DEV_PHONE (comparando los últimos 10 dígitos).
    Cualquier otro remitente los manda como texto normal."""
    if not ENV.ENABLE_TEST_COMMANDS:
        return False
    dev = obtener_ultimos_10_digitos(ENV.TEST_DEV_PHONE)
    return len(dev) == 10 and obtener_ultimos_10_digitos(telefono) == dev


async def _reset_sofia_test(session: str, chat_id: str, telefono: str) -> None:
    """Comando de prueba '/reset_sofia': borra el historial y candidato del remitente que ejecuta el comando.

    Solo `candidatos` tiene empresa_id; el webhook no trae empresa, así que el
    alcance real lo pone `_puede_usar_comandos_prueba` (solo el teléfono de dev)."""
    if not telefono:
        return
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM n8n_chat_histories WHERE session_id = $1", f"{telefono}@c.us")
            await conn.execute("DELETE FROM conversation_history WHERE telefono = $1", telefono)
            await conn.execute("DELETE FROM rate_limiting WHERE telefono = $1", telefono)
            await conn.execute("DELETE FROM candidatos WHERE telefono = $1", telefono)
    await waha_client.send_text(session, chat_id, "Reseteo listo")


from app.utils.phone import clave_lista_negra as _clave_lista_negra, limpiar_digitos as _clean_digits, obtener_ultimos_10_digitos


async def _es_reclutador(*numeros: str | None) -> bool:
    """Comprueba si el remitente es un reclutador registrado en la BD.
    Compara los últimos 10 dígitos de los números provistos contra los
    teléfonos de reclutadores activos en PostgreSQL (directo en BD, sin HTTP)."""
    claves = _clave_lista_negra(*numeros)
    if not claves:
        return False
    try:
        pool = get_pool()
        row = await pool.fetchrow(
            """
            SELECT telefono FROM reclutadores 
            WHERE activo = TRUE 
              AND telefono IS NOT NULL 
              AND RIGHT(regexp_replace(telefono, '[^0-9]', '', 'g'), 10) = ANY($1::text[])
            """,
            claves,
        )
        return row is not None
    except Exception:
        logger.exception("_es_reclutador: consulta falló para %s", claves)
        return False


async def _es_numero_ignorado(*numeros: str | None) -> bool:
    """Lista negra manual de `numeros_ignorados`: reclutadoras, jefes y demás
    gente interna que le escribe al WhatsApp del bot. `_es_reclutador()` ya
    cubre al equipo dado de alta en `reclutadores`; esta es la manija para el
    resto, sin tener que darlos de alta como reclutadores."""
    claves = _clave_lista_negra(*numeros)
    if not claves:
        return False
    try:
        pool = get_pool()
        row = await pool.fetchrow(
            "SELECT telefono FROM numeros_ignorados WHERE activo = TRUE AND telefono = ANY($1::text[])",
            claves,
        )
        return row is not None
    except Exception:
        # Fail-soft: si la consulta truena, se prefiere contestarle a alguien
        # de la lista antes que dejar de contestarle a todos los candidatos.
        logger.exception("_es_numero_ignorado: consulta falló para %s", claves)
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
    if "@" in remitente:
        result["chat_id"] = remitente
    elif clean_digits.isdigit():
        result["chat_id"] = f"{clean_digits}@c.us"
    else:
        result["chat_id"] = f"{clean_digits}@lid"
    return result


def _debe_guardar_lid(lid: str | None, telefono: str | None) -> bool:
    """Si el par LID -> teléfono vale la pena persistir.

    Se descarta el caso `lid == telefono`, que es como queda `number` cuando la
    resolución falló y se usó el LID como identificador provisional: guardarlo
    haría creer que ese LID ya está resuelto y bloquearía el intento real.
    """
    if not lid or not telefono:
        return False
    if lid == telefono:
        return False
    # Mismo criterio que usa _resolver_contacto para decidir si `number` sigue
    # siendo un LID: un móvil mexicano llega a 13 dígitos (521 + 10), un LID pasa
    # de ahí.
    return len(str(telefono)) <= 13


async def _leer_lid_guardado(lid: str) -> str | None:
    """Teléfono ya conocido para ese LID, o None."""
    pool = get_pool()
    return await pool.fetchval("SELECT telefono FROM lid_telefono WHERE lid = $1", lid)


async def _guardar_lid(lid: str | None, telefono: str | None) -> None:
    """Persiste el par LID -> teléfono para no depender de WAHA la próxima vez.

    WAHA olvida los LID viejos: de 33 sesiones huérfanas encontradas el
    19/08/2026, 17 ya no aparecían en su lista de chats y su mapeo se perdió.
    """
    if not _debe_guardar_lid(lid, telefono):
        return
    pool = get_pool()
    await pool.execute(
        "INSERT INTO lid_telefono (lid, telefono) VALUES ($1, $2) "
        "ON CONFLICT (lid) DO UPDATE SET telefono = EXCLUDED.telefono, updated_at = NOW()",
        lid,
        telefono,
    )


async def _resolver_contacto(session: str, remitente_raw: str, payload: dict) -> dict:
    if session.startswith("meta:") or payload.get("provider") == "meta":
        clean_digits = "".join(filter(str.isdigit, remitente_raw.split("@")[0]))
        contact_name = (payload.get("_data") or {}).get("notifyName") or "Candidato"
        return {
            "id": remitente_raw,
            "number": clean_digits,
            "pushname": contact_name,
            "name": contact_name,
            "chat_id": f"{clean_digits}@meta",
            "provider": "meta",
        }

    get_info = await waha_client.get_contact(session, remitente_raw)
    contacto = _fix_lid(get_info, payload)

    lid_val = contacto.get("lid")
    number = contacto.get("number") or ""

    if lid_val and (number == lid_val or len(number) > 13 or not number.startswith("52")):
        # Primero lo que ya sabemos: evita traer los ~4000 chats de WAHA (1.5 MB)
        # en cada mensaje que llega por LID, y sigue funcionando aunque WAHA esté
        # reiniciándose o ya haya olvidado ese LID.
        guardado = await _leer_lid_guardado(lid_val)
        if guardado:
            contacto["number"] = guardado
            return contacto

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

    await _guardar_lid(lid_val, contacto.get("number"))
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


async def procesar_webhook(body: dict, recibido_en: float | None = None) -> None:
    if not _es_mensaje_valido(body, recibido_en):
        return

    payload = body["payload"]

    if not await _dedup(payload.get("id")):
        return

    session = body.get("session") or "default"
    remitente_raw = payload.get("from") or ""
    contacto = await _resolver_contacto(session, remitente_raw, payload)
    remitente_original = contacto.get("id") or remitente_raw
    numero_resuelto = contacto.get("number")
    chat_id = contacto.get("chat_id") or remitente_raw

    if payload.get("body") == "/reset_sofia" and _puede_usar_comandos_prueba(numero_resuelto):
        await _reset_sofia_test(session, chat_id, numero_resuelto)
        return
    # Todos los identificadores posibles para listas de exclusión
    ids_remitente = (
        numero_resuelto,
        remitente_original,
        remitente_raw,
        contacto.get("lid"),
        payload.get("author"),
        payload.get("participant"),
    )

    if await _es_numero_ignorado(*ids_remitente):
        logger.info(
            "procesar_webhook: remitente en numeros_ignorados (%s), no se responde",
            numero_resuelto or remitente_raw,
        )
        return

    if await _es_reclutador(*ids_remitente):
        logger.info(
            "procesar_webhook: remitente es reclutador (%s), no se responde",
            numero_resuelto or remitente_raw,
        )
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
        candidato_fresco = candidato
        try:
            # Se relee el expediente AQUÍ, no el de arriba: entre aquel SELECT y
            # este punto pasaron el debounce y, si el candidato ya tenía un
            # turno en curso, la espera del lock. El turno anterior pudo dejar
            # el expediente en otro estado (privacidad aceptada, CV recibido,
            # cita creada), y con la copia vieja cargar_prompt() arma el
            # system prompt con datos caducos: el modelo vuelve a pedir lo que
            # el candidato acaba de dar. Visto en producción con el aviso de
            # privacidad mandado dos veces.
            candidato_fresco = await _obtener_candidato(number) or candidato
            await analizador_y_chat(body, contacto, candidato_fresco)
        except Exception:
            logger.exception("procesar_webhook: fallo en analizador_y_chat para telefono=%s", number)
            if not (candidato_fresco or {}).get("escalado"):
                try:
                    juntado = await agente._juntar_mensajes(number)
                    if juntado.get("mensaje_completo"):
                        await agente._guardar_mensaje_usuario(number, juntado)
                    await waha_client.send_text(session, chat_id, _MENSAJE_FALLBACK_ERROR)
                    await agente._guardar_mensaje_asistente(number, _MENSAJE_FALLBACK_ERROR)
                except Exception:
                    logger.exception("procesar_webhook: fallo enviando mensaje de error fallback a %s", number)

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
