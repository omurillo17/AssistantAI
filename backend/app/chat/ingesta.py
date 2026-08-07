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
        headers = {"x-api-key": ENV.N8N_API_KEY} if ENV.N8N_API_KEY else {}
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
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


def _fix_lid(get_info_result: dict) -> dict:
    """Puerto del 'FIX WAHA' de IgnorarEquipo: si `id` viene en formato
    xxxx@algo (LID corrupto), rescata el number real desde `id`."""
    remitente = get_info_result.get("id") or ""
    result = dict(get_info_result)
    if remitente and "@" in remitente:
        result["lid"] = result.get("number")
        result["number"] = remitente.split("@")[0]
    return result


async def _migrar_lid(number: str, lid: str | None) -> None:
    if not number or not lid or lid == number:
        return
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "UPDATE conversation_history SET telefono = $1 WHERE telefono = $2 AND $2 != '' AND $1 != $2",
                number, lid,
            )
            await conn.execute(
                "UPDATE candidatos SET telefono = $1 WHERE telefono = $2 AND $2 != '' AND $1 != $2 "
                "AND NOT EXISTS (SELECT 1 FROM candidatos WHERE telefono = $1)",
                number, lid,
            )
            await conn.execute(
                "DELETE FROM candidatos WHERE telefono = $2 AND $2 != '' AND $1 != $2",
                number, lid,
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
    get_info = await waha_client.get_contact(session, payload.get("from"))
    contacto = _fix_lid(get_info)
    remitente_original = get_info.get("id") or ""

    if await _es_reclutador(remitente_original):
        return

    await _migrar_lid(contacto.get("number"), contacto.get("lid"))
    await _actualizar_rate_limiting(contacto.get("number") or payload.get("from", "").split("@")[0])

    number = contacto.get("number")
    if not number:
        return

    pool = get_pool()
    await pool.execute("UPDATE candidatos SET ultima_ejecucion_id = $1 WHERE telefono = $2", str(uuid.uuid4()), number)
    await _guardar_mensaje_temporal(number, payload)

    candidato = await _obtener_candidato(number)

    if (candidato.get("Faltas") or 0) >= 3:
        await waha_client.send_text(session, f"{number}@c.us", _MENSAJE_3_FALTAS)
        return

    async def _tarea():
        try:
            await analizador_y_chat(body, contacto, candidato)
        except Exception:
            logger.exception("procesar_webhook: fallo en analizador_y_chat para telefono=%s", number)

    async def _avisar_escribiendo():
        await waha_client.start_typing(session, f"{number}@c.us")

    await _procesar_con_debounce(number, _tarea, al_primero=_avisar_escribiendo)


async def analizador_y_chat(body: dict, contacto: dict, candidato: dict) -> None:
    """Encadena analizador.py (workflow 2) -> agente.py (workflow 3),
    igual que hacía el 'Ejecutar Subflujo' -> 'Ejecutar Subflujo'
    original, pero como llamadas directas en el mismo proceso."""
    payload = body["payload"]

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

    system_prompt = analizador.cargar_prompt(payload, contacto, candidato)
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
