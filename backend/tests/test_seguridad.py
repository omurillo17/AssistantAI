"""Regresiones de los blindajes de seguridad: firma HMAC del webhook de WAHA,
validación de los argumentos de crear_evento, origen permitido de los
adjuntos y cancelación de cita solo cuando la herramienta corrió de verdad."""

import hashlib
import hmac
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.chat.agente import _sincronizar_items_con_tools, tiene_cita_vigente, validar_horario_cita
from app.routers.whatsapp import verificar_hmac
from app.waha_client import es_url_media_permitida

MX = ZoneInfo("America/Mexico_City")
AHORA = datetime(2026, 10, 23, 10, 0, tzinfo=MX)


# --- HMAC del webhook --------------------------------------------------------

def _firma(cuerpo: bytes, clave: str) -> str:
    return hmac.new(clave.encode(), cuerpo, hashlib.sha512).hexdigest()


def test_hmac_valido():
    cuerpo = b'{"event":"message"}'
    assert verificar_hmac(cuerpo, _firma(cuerpo, "k"), "k")
    assert verificar_hmac(cuerpo, _firma(cuerpo, "k").upper(), "k")


def test_hmac_invalido_o_ausente():
    cuerpo = b'{"event":"message"}'
    assert not verificar_hmac(cuerpo, _firma(cuerpo, "otra"), "k")
    assert not verificar_hmac(cuerpo + b" ", _firma(cuerpo, "k"), "k")
    assert not verificar_hmac(cuerpo, None, "k")
    assert not verificar_hmac(cuerpo, "", "k")


# --- crear_evento --------------------------------------------------------------

def _iso(dt: datetime) -> str:
    return dt.replace(tzinfo=None).isoformat()


def test_horario_valido():
    inicio = AHORA + timedelta(days=1)
    assert validar_horario_cita(_iso(inicio), _iso(inicio + timedelta(hours=1)), AHORA) is None


def test_horario_en_el_pasado():
    inicio = AHORA - timedelta(hours=1)
    assert validar_horario_cita(_iso(inicio), _iso(inicio + timedelta(hours=1)), AHORA)


def test_horario_demasiado_lejano():
    inicio = AHORA + timedelta(days=31)
    assert validar_horario_cita(_iso(inicio), _iso(inicio + timedelta(hours=1)), AHORA)


def test_duracion_fuera_de_rango():
    inicio = AHORA + timedelta(days=1)
    assert validar_horario_cita(_iso(inicio), _iso(inicio + timedelta(minutes=10)), AHORA)
    assert validar_horario_cita(_iso(inicio), _iso(inicio + timedelta(hours=3)), AHORA)
    assert validar_horario_cita(_iso(inicio), _iso(inicio - timedelta(hours=1)), AHORA)


def test_fechas_invalidas():
    assert validar_horario_cita("mañana", "", AHORA)
    assert validar_horario_cita(None, None, AHORA)


def test_respeta_la_zona_horaria_explicita():
    # 16:00Z = 10:00 en CDMX: igual a "ahora", no es futuro.
    assert validar_horario_cita("2026-10-23T16:00:00+00:00", "2026-10-23T17:00:00+00:00", AHORA)


# --- download_media ------------------------------------------------------------

def test_url_media_de_waha_permitida():
    base = "http://waha:3000"
    assert es_url_media_permitida("http://waha:3000/api/files/default/a.oga", base)


def test_url_media_ajena_rechazada():
    base = "http://waha:3000"
    assert not es_url_media_permitida("http://evil.com/api/files/a.oga", base)
    assert not es_url_media_permitida("http://waha:3001/api/files/a.oga", base)
    assert not es_url_media_permitida("https://waha:3000/api/files/a.oga", base)
    assert not es_url_media_permitida("http://waha.evil.com:3000/a", base)
    assert not es_url_media_permitida("http://waha:notaport/a", base)
    assert not es_url_media_permitida("file:///etc/passwd", base)


def test_url_media_puerto_por_defecto():
    assert es_url_media_permitida("https://waha.example.com/a", "https://waha.example.com:443")


# --- cita_cancelada ------------------------------------------------------------

def _ejecucion(eliminado: bool) -> dict:
    return {"evento_creado_ok": False, "evento_eliminado_ok": eliminado, "fecha_evento": None}


def test_cita_cancelada_solo_si_corrio_eliminar_evento():
    items = [{"cita_cancelada": True, "message_to_user": "Listo, cancelé tu cita"}]
    assert _sincronizar_items_con_tools(items, _ejecucion(False), "521")[0]["cita_cancelada"] is False

    items = [{"cita_cancelada": False, "message_to_user": "Listo"}]
    assert _sincronizar_items_con_tools(items, _ejecucion(True), "521")[0]["cita_cancelada"] is True


# --- Cita vigente ------------------------------------------------------------

def test_cita_futura_bloquea_otra():
    cand = {"event_id": "e1", "estado": "CITA_AGENDADA", "fecha_entrevista": (AHORA + timedelta(days=1)).isoformat()}
    assert tiene_cita_vigente(cand, AHORA)


def test_cita_pasada_o_cancelada_no_bloquea():
    pasada = {"event_id": "e1", "estado": "CITA_AGENDADA", "fecha_entrevista": (AHORA - timedelta(days=1)).isoformat()}
    cancelada = {"event_id": "e1", "estado": "CITA_CANCELADA", "fecha_entrevista": (AHORA + timedelta(days=1)).isoformat()}
    assert not tiene_cita_vigente(pasada, AHORA)
    assert not tiene_cita_vigente(cancelada, AHORA)
    assert not tiene_cita_vigente({"estado": "CITA_AGENDADA"}, AHORA)
