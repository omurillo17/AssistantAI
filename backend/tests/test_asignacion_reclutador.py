"""Regresión de la elección de reclutador en `app.chat.analizador`.

Dos fallos reales: el reclutador de respaldo era `equipo[-1]` (el creado más
recientemente, arbitrario) y podía no tener OAuth de calendario -- entonces
`revisar_calendario` tronaba con CredencialesNoEncontradas y el candidato
recibía "tuvimos un inconveniente técnico". Y cuando la vacante no se podía
resolver se ignoraba `candidatos.asignado_a_id`, así que el CRM decía que el
candidato era de MICHELLE pero su cita se agendaba con otra persona.
"""

from app.chat.analizador import _elegir_gerente, _reclutador_asignado

CON_OAUTH = "elibeth@gmail.com"
SIN_OAUTH = "nueva@gmail.com"

ELIBETH = {"reclutador_id": "r1", "nombre": "ELIBETH", "calendar_id": CON_OAUTH, "es_encargado": True}
MICHELLE = {"reclutador_id": "r2", "nombre": "MICHELLE", "calendar_id": "michelle@gmail.com"}
NUEVA = {"reclutador_id": "r3", "nombre": "SRA PATY", "calendar_id": SIN_OAUTH}


def test_no_elige_a_quien_no_tiene_calendario_autorizado():
    """SRA PATY es la última creada; antes el respaldo caía siempre en ella."""
    equipo = [ELIBETH, MICHELLE, NUEVA]

    elegido = _elegir_gerente(equipo, calendarios_ok={CON_OAUTH, "michelle@gmail.com"})

    assert elegido["nombre"] != "SRA PATY"
    assert elegido["calendar_id"] in {CON_OAUTH, "michelle@gmail.com"}


def test_prefiere_al_encargado_del_equipo():
    equipo = [MICHELLE, ELIBETH]

    elegido = _elegir_gerente(equipo, calendarios_ok={CON_OAUTH, "michelle@gmail.com"})

    assert elegido["nombre"] == "ELIBETH"


def test_respeta_un_gerente_de_reclutamiento_explicito():
    gerente = {"reclutador_id": "r9", "nombre": "Gerente de Reclutamiento", "calendar_id": "g@gmail.com"}
    equipo = [ELIBETH, gerente]

    elegido = _elegir_gerente(equipo, calendarios_ok={CON_OAUTH})

    assert elegido["nombre"] == "Gerente de Reclutamiento"


def test_si_nadie_tiene_oauth_no_se_queda_sin_reclutador():
    """Un despliegue nuevo (nadie autorizado todavía) debe seguir
    respondiendo, aunque el agendamiento falle después."""
    equipo = [MICHELLE, NUEVA]

    elegido = _elegir_gerente(equipo, calendarios_ok=set())

    assert elegido["nombre"] == "MICHELLE"  # el primero por antigüedad


def test_equipo_vacio_devuelve_un_respaldo_utilizable():
    elegido = _elegir_gerente([], calendarios_ok=set())

    assert elegido.get("calendar_id")
    assert elegido.get("telefono")


# --- Reclutador ya asignado al candidato ------------------------------------

def test_respeta_al_reclutador_ya_asignado():
    """El CRM decía que el candidato era de MICHELLE y su cita se agendaba con
    otra persona porque su vacante no se pudo resolver."""
    equipo = [ELIBETH, MICHELLE]

    asignado = _reclutador_asignado(equipo, "r2", {CON_OAUTH, "michelle@gmail.com"})

    assert asignado is not None
    assert asignado["nombre"] == "MICHELLE"


def test_ignora_al_asignado_si_no_tiene_calendario_autorizado():
    """Respetar la asignación no puede llevar a agendar en un calendario que
    va a fallar: en ese caso es mejor el respaldo."""
    equipo = [ELIBETH, NUEVA]

    asignado = _reclutador_asignado(equipo, "r3", {CON_OAUTH})

    assert asignado is None


def test_sin_asignacion_no_devuelve_a_nadie():
    equipo = [ELIBETH, MICHELLE]

    assert _reclutador_asignado(equipo, None, {CON_OAUTH}) is None
    assert _reclutador_asignado(equipo, "", {CON_OAUTH}) is None


def test_compara_el_id_como_texto():
    """`candidatos.asignado_a_id` puede llegar como UUID desde asyncpg y como
    str desde la API; ambos deben coincidir."""
    import uuid

    ident = uuid.UUID("c6778e3c-f694-456b-b3a5-bab21580be13")
    equipo = [{"reclutador_id": str(ident), "nombre": "MICHELLE", "calendar_id": CON_OAUTH}]

    assert _reclutador_asignado(equipo, ident, {CON_OAUTH}) is not None  # type: ignore[arg-type]
