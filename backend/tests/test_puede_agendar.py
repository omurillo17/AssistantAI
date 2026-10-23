from app.chat.analizador import puede_agendar

DOCS = {"curp_ine": "PELJ900101HJCRPN01", "curp_rfc": "PELJ900101HJCRPN01"}


def test_documentos_completos_agendan_aunque_el_estado_haya_regresado():
    assert puede_agendar({"estado": "CV_RECIBIDO", **DOCS})


def test_estados_que_ya_agendaban_siguen_agendando():
    assert puede_agendar({"estado": "INE_VALIDADA"})
    assert puede_agendar({"estado": "CITA_CANCELADA"})


def test_falta_un_documento():
    assert not puede_agendar({"estado": "CV_RECIBIDO", "curp_ine": "X"})


def test_estados_de_descarte_no_agendan():
    for estado in ("RECHAZADO", "DOCUMENTOS_NO_COINCIDEN", "OTRA_CIUDAD", "INACTIVO"):
        assert not puede_agendar({"estado": estado, **DOCS})
