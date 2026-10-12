"""Regresión del filtro de entrada de `app.chat.ingesta`.

WhatsApp entrega estados/historias, mensajes de grupo y canales por el mismo
webhook que los mensajes de un candidato. Sin filtrarlos, cada estado publicado
por un contacto entraba al pipeline: se gastaba una llamada a Gemini (que
reventaba con "Unsupported MIME type: application/mp4" en los estados de video)
y quedaba un candidato basura con teléfono "status" en la base.
"""

import time

from app.chat import ingesta
from app.chat.ingesta import _es_mensaje_valido, _es_remitente_ignorado


def _mensaje(**payload_extra) -> dict:
    payload = {
        "from": "5213323379399@c.us",
        "timestamp": time.time(),
        "type": "chat",
        "fromMe": False,
    }
    payload.update(payload_extra)
    return {"event": "message", "payload": payload}


def test_fix_lid_webjs_y_noweb():
    from app.chat.ingesta import _fix_lid
    # WEBJS
    webjs_resp = {"id": "5213323379399@c.us", "number": "5213323379399"}
    res1 = _fix_lid(webjs_resp)
    assert res1["number"] == "5213323379399"

    # NOWEB con LID
    noweb_lid_resp = {
        "id": "28153510625455@lid",
        "lid": "28153510625455@lid",
        "phoneNumber": "5213323379399@s.whatsapp.net",
        "pushname": "Sofia"
    }
    res2 = _fix_lid(noweb_lid_resp)
    assert res2["number"] == "5213323379399"
    assert res2["lid"] == "28153510625455"


# --- Remitentes que no son un candidato -------------------------------------

def test_ignora_los_estados_de_whatsapp():
    """status@broadcast son las historias de 24 h de los contactos."""
    assert _es_remitente_ignorado("status@broadcast")
    assert not _es_mensaje_valido(_mensaje(from_="x") | {"payload": {
        "from": "status@broadcast", "timestamp": time.time(), "type": "chat", "fromMe": False,
    }})


def test_ignora_mensajes_de_grupo():
    """El bot conversa 1 a 1; en un grupo no debe contestar."""
    assert _es_remitente_ignorado("120363001234567890@g.us")
    assert not _es_mensaje_valido({"event": "message", "payload": {
        "from": "120363001234567890@g.us", "timestamp": time.time(), "type": "chat", "fromMe": False,
    }})


def test_ignora_canales_de_difusion():
    assert _es_remitente_ignorado("1234567890@newsletter")


def test_no_distingue_mayusculas_en_el_remitente():
    assert _es_remitente_ignorado("STATUS@BROADCAST")


def test_remitente_vacio_no_revienta():
    assert not _es_remitente_ignorado("")
    assert not _es_remitente_ignorado(None)  # type: ignore[arg-type]


# --- Un candidato normal sigue pasando --------------------------------------

def test_acepta_el_mensaje_de_un_candidato():
    assert _es_mensaje_valido(_mensaje())


def test_acepta_al_candidato_con_id_lid():
    """WAHA entrega algunos remitentes como @lid; esos sí son personas."""
    assert _es_mensaje_valido(_mensaje(**{"from": "28153510625455@lid"}))


# --- Filtros que ya existían (no deben romperse) ----------------------------

def test_ignora_los_mensajes_propios():
    assert not _es_mensaje_valido(_mensaje(fromMe=True))


def test_ignora_mensajes_viejos():
    """Evita responder a una avalancha al reconectar la sesión."""
    assert not _es_mensaje_valido(_mensaje(timestamp=time.time() - 300))


def test_ignora_eventos_que_no_son_mensajes():
    assert not _es_mensaje_valido({"event": "session.status", "payload": {}})


def test_ignora_notificaciones_de_protocolo():
    assert not _es_mensaje_valido(_mensaje(type="e2e_notification"))


# --- Mapeo LID -> teléfono --------------------------------------------------
# WAHA olvida los LID viejos: de 33 sesiones huérfanas encontradas el
# 19/08/2026, solo 402 de 3853 LID seguían siendo resolubles contra su API.
# Por eso el par se persiste en `lid_telefono` en cuanto se resuelve.

def test_guarda_el_par_lid_telefono_resuelto():
    assert ingesta._debe_guardar_lid("151226570248433", "5213322475557")


def test_no_guarda_cuando_el_numero_sigue_siendo_el_lid():
    """`number` se queda igual al LID cuando la resolución falla; guardarlo
    haría creer que ya está resuelto y bloquearía el intento real después."""
    assert not ingesta._debe_guardar_lid("151226570248433", "151226570248433")


def test_no_guarda_un_lid_sin_telefono_ni_al_reves():
    assert not ingesta._debe_guardar_lid("151226570248433", None)
    assert not ingesta._debe_guardar_lid(None, "5213322475557")
    assert not ingesta._debe_guardar_lid("", "")


def test_no_guarda_si_el_telefono_tiene_pinta_de_lid():
    assert not ingesta._debe_guardar_lid("151226570248433", "259312979075083")


# --- Lista negra manual (`numeros_ignorados`) -------------------------------
# Reclutadoras, jefes y demás gente interna que le escribe al WhatsApp del bot
# y a la que Sofía no debe contestarle. La comparación es por los últimos 10
# dígitos porque el mismo número llega como 5213312345678, 523312345678 o
# 3312345678 según el dispositivo y la versión de WAHA.

def test_lista_negra_normaliza_todos_los_formatos_al_mismo_numero():
    assert ingesta._clave_lista_negra("5213312345678") == ["3312345678"]
    assert ingesta._clave_lista_negra("523312345678") == ["3312345678"]
    assert ingesta._clave_lista_negra("3312345678") == ["3312345678"]
    assert ingesta._clave_lista_negra("+52 1 33 1234 5678") == ["3312345678"]
    assert ingesta._clave_lista_negra("5213312345678@c.us") == ["3312345678"]


def test_lista_negra_descarta_identificadores_que_no_son_telefono():
    """Sin esto, 'status' o un chat_id de grupo consultarían la tabla en balde."""
    assert ingesta._clave_lista_negra(None, "", "status@broadcast", "123") == []


def test_lista_negra_deduplica_las_variantes_del_mismo_remitente():
    """procesar_webhook pasa number, id y from, que suelen ser el mismo número
    escrito de tres formas: la consulta debe llevar una sola clave."""
    claves = ingesta._clave_lista_negra(
        "5213312345678", "5213312345678@c.us", "5213312345678"
    )
    assert claves == ["3312345678"]




async def test_es_reclutador_detecta_por_clave_10_digitos(monkeypatch):
    class FakePool:
        async def fetchrow(self, query, params):
            # Simula que 3314057808 es reclutadora (Michelle)
            if "3314057808" in params:
                return {"telefono": "5213314057808"}
            return None

    monkeypatch.setattr(ingesta, "get_pool", lambda: FakePool())

    # Llega por LID pero con number resuelto
    assert await ingesta._es_reclutador("5213314057808", "256688904994915@lid", "256688904994915@lid")
    # Llega como @c.us
    assert await ingesta._es_reclutador("5213314057808@c.us")
    # Candidato normal no coincide
    assert not await ingesta._es_reclutador("5213399999999", "123456@lid")


async def test_fallback_error_envia_mensaje_amable_si_falla_analizador(monkeypatch):
    mensajes_enviados = []
    asistente_guardado = []

    async def fake_send_text(session, chat_id, texto):
        mensajes_enviados.append((chat_id, texto))

    async def fake_guardar_asistente(telefono, texto):
        asistente_guardado.append((telefono, texto))

    async def fake_analizador_y_chat(body, contacto, candidato):
        raise RuntimeError("Simulated Gemini API error")

    async def fake_juntar_mensajes(telefono):
        return {"mensaje_completo": "Hola vacante"}

    async def fake_guardar_usuario(telefono, juntado):
        pass

    async def fake_obtener_candidato(tel):
        return {"telefono": tel, "escalado": False}

    async def fake_dedup(message_id):
        return True

    async def fake_false(*args):
        return False

    async def fake_async_noop(*args, **kwargs):
        return None

    monkeypatch.setattr(ingesta, "_dedup", fake_dedup)
    monkeypatch.setattr(ingesta.waha_client, "send_text", fake_send_text)
    monkeypatch.setattr(ingesta.agente, "_guardar_mensaje_asistente", fake_guardar_asistente)
    monkeypatch.setattr(ingesta.agente, "_juntar_mensajes", fake_juntar_mensajes)
    monkeypatch.setattr(ingesta.agente, "_guardar_mensaje_usuario", fake_guardar_usuario)
    monkeypatch.setattr(ingesta, "analizador_y_chat", fake_analizador_y_chat)
    monkeypatch.setattr(ingesta, "_obtener_candidato", fake_obtener_candidato)
    monkeypatch.setattr(ingesta, "_es_reclutador", fake_false)
    monkeypatch.setattr(ingesta, "_es_numero_ignorado", fake_false)
    monkeypatch.setattr(ingesta, "_migrar_lid", fake_async_noop)
    monkeypatch.setattr(ingesta, "_actualizar_rate_limiting", fake_async_noop)
    monkeypatch.setattr(ingesta, "_guardar_mensaje_temporal", fake_async_noop)

    class FakePool:
        async def execute(self, *args, **kwargs):
            return None

    monkeypatch.setattr(ingesta, "get_pool", lambda: FakePool())

    # Ejecutar tarea directamente mockeando debounce
    async def fake_debounce(tel, tarea, al_primero=None):
        await tarea()

    monkeypatch.setattr(ingesta, "_procesar_con_debounce", fake_debounce)

    body = {
        "event": "message",
        "session": "default",
        "payload": {
            "id": "msg_test_123",
            "from": "5213323379399@c.us",
            "type": "chat",
            "body": "Hola vacante",
            "timestamp": time.time(),
            "fromMe": False,
        }
    }
    await ingesta.procesar_webhook(body)

    assert len(mensajes_enviados) == 1
    assert "Disculpa, tuve un inconveniente momentáneo" in mensajes_enviados[0][1]
    assert len(asistente_guardado) == 1
    assert asistente_guardado[0][0] == "5213323379399"


async def test_fallback_error_no_responde_si_candidato_escalado(monkeypatch):
    mensajes_enviados = []

    async def fake_send_text(session, chat_id, texto):
        mensajes_enviados.append((chat_id, texto))

    async def fake_analizador_y_chat(body, contacto, candidato):
        raise RuntimeError("Simulated Gemini API error")

    async def fake_obtener_candidato_escalado(tel):
        return {"telefono": tel, "escalado": True}

    async def fake_async_noop(*args, **kwargs):
        return None

    async def fake_dedup(message_id):
        return True

    async def fake_false(*args):
        return False

    monkeypatch.setattr(ingesta, "_dedup", fake_dedup)
    monkeypatch.setattr(ingesta.waha_client, "send_text", fake_send_text)
    monkeypatch.setattr(ingesta, "analizador_y_chat", fake_analizador_y_chat)
    monkeypatch.setattr(ingesta, "_obtener_candidato", fake_obtener_candidato_escalado)
    monkeypatch.setattr(ingesta, "_es_reclutador", fake_false)
    monkeypatch.setattr(ingesta, "_es_numero_ignorado", fake_false)
    monkeypatch.setattr(ingesta, "_migrar_lid", fake_async_noop)
    monkeypatch.setattr(ingesta, "_actualizar_rate_limiting", fake_async_noop)
    monkeypatch.setattr(ingesta, "_guardar_mensaje_temporal", fake_async_noop)

    class FakePool:
        async def execute(self, *args, **kwargs):
            return None

    monkeypatch.setattr(ingesta, "get_pool", lambda: FakePool())

    async def fake_debounce(tel, tarea, al_primero=None):
        await tarea()

    monkeypatch.setattr(ingesta, "_procesar_con_debounce", fake_debounce)

    body = {
        "event": "message",
        "session": "default",
        "payload": {
            "id": "msg_test_456",
            "from": "5213323379399@c.us",
            "type": "chat",
            "body": "Hola vacante",
            "timestamp": time.time(),
            "fromMe": False,
        }
    }
    await ingesta.procesar_webhook(body)

    # NO debe enviar ningún mensaje al candidato si está escalado
    assert len(mensajes_enviados) == 0

