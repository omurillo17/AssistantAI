"""Regresiones de `app.chat.agente`: guardrail anti-rechazo, conversión de
`empresa_id` y las alertas de fallo.
"""

import uuid

from app.chat import agente
from app.routers.eventos_calendario import CrearEventoRequest


# --- Guardrail anti-rechazo -------------------------------------------------
# chat_prompt.md lo marca como regla Diamante ("Sofia NO puede rechazar
# candidatos"), pero el modelo la violó en producción y le mandó al candidato
# un "te mantenemos en nuestra cartera de talento".

def test_detecta_los_rechazos_vistos_en_produccion():
    reales = [
        "Aunque tus habilidades no se ajustan directamente a los requisitos de esta posición, "
        "nos encantaría mantener tu información en nuestra cartera de talentos.",
        "Para la vacante de Checador de Almacén podríamos estar un poco fuera de perfil.",
    ]
    for texto in reales:
        assert agente._contiene_rechazo(texto), f"no detectó el rechazo: {texto[:40]}"


def test_no_marca_como_rechazo_un_mensaje_normal():
    normales = [
        "¡Recibí tu documento y tu perfil está súper bien! 👏 ¿Me compartes tu correo?",
        "¡Listo! Ya tengo tu perfil completo 😊 Envíame una foto de tu INE.",
        "Tu entrevista quedó agendada para el viernes a las 9:00 a.m.",
    ]
    for texto in normales:
        assert not agente._contiene_rechazo(texto), f"falso positivo: {texto[:40]}"


def test_texto_vacio_no_es_rechazo():
    assert not agente._contiene_rechazo("")


# --- empresa_id: UUID de asyncpg -> str -------------------------------------

def test_crear_evento_request_acepta_empresa_id_convertido():
    """asyncpg devuelve las columnas uuid como objetos UUID; Pydantic
    rechazaba el modelo con ValidationError y la cita nunca se creaba."""
    empresa_uuid = uuid.UUID("693defe8-b388-4428-ad19-b3dd9a7ef1a9")

    payload = CrearEventoRequest(
        start="2026-08-09T12:00:00",
        end="2026-08-09T12:30:00",
        calendar_id="cal@gmail.com",
        telefono="5215500000001",
        empresa_id=str(empresa_uuid),
    )

    assert payload.empresa_id == "693defe8-b388-4428-ad19-b3dd9a7ef1a9"


# --- Alertas de fallo -------------------------------------------------------

def test_explica_el_fallo_de_credenciales_con_el_comando_a_correr():
    class CredencialesNoEncontradas(Exception):
        pass

    ayuda = agente._explicar_fallo(
        CredencialesNoEncontradas("No hay credenciales OAuth para 'x@gmail.com'.")
    )

    assert "authorize_recruiter" in ayuda


def test_explica_el_token_revocado_mencionando_el_modo_testing():
    ayuda = agente._explicar_fallo(Exception("invalid_grant: Token has been expired or revoked."))

    assert "autorizar" in ayuda.lower()


def test_fallo_desconocido_no_deja_al_lector_sin_indicacion():
    ayuda = agente._explicar_fallo(Exception("algo raro"))

    assert ayuda.strip()


async def test_la_alerta_no_se_repite_dentro_de_la_ventana(monkeypatch):
    """Una caída sostenida de Google no debe generar una avalancha de
    WhatsApps al reclutador."""
    enviados = []

    async def _fake_send_text(session, chat_id, mensaje):
        enviados.append(chat_id)

    monkeypatch.setattr(agente.waha_client, "send_text", _fake_send_text)
    agente._alertas_fallo_enviadas.clear()

    candidato = {"nombre": "Oscar", "telefono": "521332"}
    reclutador = {"telefono_reclutador": "5213314057808", "calendar_id": "cal@gmail.com"}

    for _ in range(5):
        await agente._alertar_fallo_tool("crear_evento", Exception("boom"), candidato, reclutador)

    assert len(enviados) == 1

    agente._alertas_fallo_enviadas.clear()


async def test_un_fallo_distinto_si_genera_su_propia_alerta(monkeypatch):
    enviados = []

    async def _fake_send_text(session, chat_id, mensaje):
        enviados.append(mensaje)

    monkeypatch.setattr(agente.waha_client, "send_text", _fake_send_text)
    agente._alertas_fallo_enviadas.clear()

    candidato = {"nombre": "Oscar", "telefono": "521332"}
    reclutador = {"telefono_reclutador": "5213314057808", "calendar_id": "cal@gmail.com"}

    await agente._alertar_fallo_tool("crear_evento", ValueError("a"), candidato, reclutador)
    await agente._alertar_fallo_tool("crear_evento", KeyError("b"), candidato, reclutador)

    assert len(enviados) == 2

    agente._alertas_fallo_enviadas.clear()


async def test_la_alerta_llega_al_reclutador_y_al_administrador(monkeypatch):
    destinos = []

    async def _fake_send_text(session, chat_id, mensaje):
        destinos.append(chat_id)

    monkeypatch.setattr(agente.waha_client, "send_text", _fake_send_text)
    monkeypatch.setattr(
        type(agente.ENV), "ALERTAS_ADMIN_TELEFONO", property(lambda self: "5215500000001")
    )
    agente._alertas_fallo_enviadas.clear()

    await agente._alertar_fallo_tool(
        "crear_evento",
        Exception("x"),
        {"nombre": "Oscar"},
        {"telefono_reclutador": "5213314057808", "calendar_id": "c@gmail.com"},
    )

    assert destinos == ["5213314057808@c.us", "5215500000001@c.us"]

    agente._alertas_fallo_enviadas.clear()


async def test_no_duplica_si_el_administrador_es_el_reclutador(monkeypatch):
    """El ROOT puede ser además el reclutador de la vacante; no tiene sentido
    mandarle el mismo aviso dos veces."""
    destinos = []

    async def _fake_send_text(session, chat_id, mensaje):
        destinos.append(chat_id)

    monkeypatch.setattr(agente.waha_client, "send_text", _fake_send_text)
    monkeypatch.setattr(
        type(agente.ENV), "ALERTAS_ADMIN_TELEFONO", property(lambda self: "5215500000001")
    )
    agente._alertas_fallo_enviadas.clear()

    await agente._alertar_fallo_tool(
        "crear_evento",
        Exception("x"),
        {"nombre": "Oscar"},
        {"telefono_reclutador": "5215500000001", "calendar_id": "c@gmail.com"},
    )

    assert destinos == ["5215500000001@c.us"]

    agente._alertas_fallo_enviadas.clear()


async def test_sin_administrador_configurado_solo_avisa_al_reclutador(monkeypatch):
    destinos = []

    async def _fake_send_text(session, chat_id, mensaje):
        destinos.append(chat_id)

    monkeypatch.setattr(agente.waha_client, "send_text", _fake_send_text)
    monkeypatch.setattr(
        type(agente.ENV), "ALERTAS_ADMIN_TELEFONO", property(lambda self: None)
    )
    agente._alertas_fallo_enviadas.clear()

    await agente._alertar_fallo_tool(
        "crear_evento", Exception("x"), {}, {"telefono_reclutador": "5213314057808"}
    )

    assert destinos == ["5213314057808@c.us"]

    agente._alertas_fallo_enviadas.clear()


async def test_si_falla_el_envio_a_uno_el_otro_igual_se_entera(monkeypatch):
    """Que WAHA rechace el número del reclutador no puede dejar al
    administrador sin la alerta."""
    entregados = []

    async def _fake_send_text(session, chat_id, mensaje):
        if chat_id.startswith("5213314057808"):
            raise RuntimeError("numero invalido")
        entregados.append(chat_id)

    monkeypatch.setattr(agente.waha_client, "send_text", _fake_send_text)
    monkeypatch.setattr(
        type(agente.ENV), "ALERTAS_ADMIN_TELEFONO", property(lambda self: "5215500000001")
    )
    agente._alertas_fallo_enviadas.clear()

    await agente._alertar_fallo_tool(
        "crear_evento", Exception("x"), {}, {"telefono_reclutador": "5213314057808"}
    )

    assert entregados == ["5215500000001@c.us"]

    agente._alertas_fallo_enviadas.clear()


async def test_si_falla_el_envio_de_la_alerta_no_se_propaga(monkeypatch):
    """El turno del candidato no se puede caer porque la alerta falle."""
    async def _boom(session, chat_id, mensaje):
        raise RuntimeError("WAHA caído")

    monkeypatch.setattr(agente.waha_client, "send_text", _boom)
    agente._alertas_fallo_enviadas.clear()

    await agente._alertar_fallo_tool("crear_evento", Exception("x"), {}, {})

    agente._alertas_fallo_enviadas.clear()


# --- Bucle de la ciudad -----------------------------------------------------
# El modelo confirmaba la ciudad en el texto pero no la etiquetaba, el campo
# quedaba vacío y la regla Diamante de residencia la volvía a pedir turno tras
# turno. Producción, del 13/08/2026 en adelante.

def test_rescata_la_ciudad_que_el_modelo_no_etiqueto():
    items = [{"message_to_user": "¡Excelente! Zapopan está dentro de la zona.", "database_updates": {}}]
    assert agente._rescatar_residencia({}, items, "Zapopan") == "ZAPOPAN"


def test_no_rescata_si_el_candidato_ya_tiene_residencia_guardada():
    items = [{"database_updates": {}}]
    assert agente._rescatar_residencia({"lugar_residencia": "GUADALAJARA"}, items, "Zapopan") is None


def test_no_rescata_si_el_modelo_ya_etiqueto_la_residencia():
    """La etiqueta del modelo manda: el rescate no debe contradecirla."""
    items = [{"database_updates": {"lugar_residencia": "Tlaquepaque"}}]
    assert agente._rescatar_residencia({}, items, "Zapopan") is None


def test_no_rescata_una_ciudad_fuera_de_la_zona():
    """Descalificar por ciudad es decisión del modelo (ciudad_no_apta), no de aquí."""
    items = [{"database_updates": {}}]
    assert agente._rescatar_residencia({}, items, "vivo en Villahermosa") is None


def test_no_rescata_cuando_el_mensaje_no_trae_ciudad():
    items = [{"database_updates": {}}]
    assert agente._rescatar_residencia({}, items, "sí, me interesa mucho") is None


# --- Memoria partida por LID ------------------------------------------------
# WhatsApp entrega el remitente como LID a veces; `chat_id` conserva ese LID
# porque es la dirección de respuesta, pero usarlo como clave de memoria dejaba
# el turno en una sesión aparte y el modelo arrancaba sin historial. En la BD
# quedaron 33 sesiones "@lid" sueltas, casi todas de un solo turno.

def test_la_memoria_usa_el_telefono_aunque_el_turno_llegue_por_lid():
    session_id = agente._session_id_memoria("5213322475557", "151226570248433@lid")
    assert session_id == "5213322475557@c.us"


def test_el_turno_por_numero_y_el_turno_por_lid_caen_en_la_misma_sesion():
    por_numero = agente._session_id_memoria("5213322475557", "5213322475557@c.us")
    por_lid = agente._session_id_memoria("5213322475557", "151226570248433@lid")
    assert por_numero == por_lid


def test_la_memoria_cae_al_chat_id_si_no_hay_numero_resuelto():
    """Sin teléfono no se inventa una clave: se conserva el turno donde se pueda."""
    assert agente._session_id_memoria(None, "151226570248433@lid") == "151226570248433@lid"
    assert agente._session_id_memoria("", "151226570248433@lid") == "151226570248433@lid"


def test_el_lid_sin_resolver_usa_la_forma_que_consolida_migrar_lid():
    """_migrar_lid (ingesta.py) busca '{lid}@c.us' para consolidar la sesión."""
    assert agente._session_id_memoria("151226570248433", "151226570248433@lid") == "151226570248433@c.us"
