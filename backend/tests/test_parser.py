"""Regresiones de `app.chat.parser`.

Cada test de aquí corresponde a un fallo real observado en producción: el
candidato veía JSON crudo en WhatsApp, la fecha de la entrevista se guardaba
con comillas y llaves pegadas, o la vacante quedaba atorada en el placeholder
'GENERAL' y su cita terminaba con el reclutador equivocado.
"""

from app.chat import parser

CANDIDATO = {"nombre_chat": "Oscar", "mensajes_bot_enviados": 1}


def _primer_mensaje(respuesta_ia, candidato=None):
    items = parser.procesar_respuesta_ia(respuesta_ia, candidato or CANDIDATO)
    return items[0]["message_to_user"]


# --- Fuga del bloque JSON interno hacia el candidato ------------------------

def test_no_filtra_json_de_cola_truncado():
    """Gemini corta la respuesta a la mitad y el JSON queda sin cerrar, así
    que json.loads falla y el texto se trataba como mensaje normal."""
    respuesta = (
        "¡Listo, Oscar! Tu cita quedó agendada. 🎉\n"
        '{"memoria_update": "Nombre: Oscar. Cita: agendada.", "etiquetas_internas": {"'
    )
    mensaje = _primer_mensaje(respuesta)

    assert "memoria_update" not in mensaje
    assert "etiquetas_internas" not in mensaje
    assert mensaje.startswith("¡Listo, Oscar!")


def test_no_filtra_json_de_cola_bien_formado():
    respuesta = (
        "Gracias por tu paciencia 😊\n"
        '{"memoria_update": "Etapa: documentos", "etiquetas_internas": {"actualizar_nave": "CEDIS"}}'
    )
    mensaje = _primer_mensaje(respuesta)

    assert "memoria_update" not in mensaje
    assert "{" not in mensaje


def test_rescata_el_resumen_aunque_el_json_venga_truncado():
    """Si se descarta el JSON roto sin más, se pierde la memoria del
    candidato: el resumen sí suele venir completo (es la primera clave)."""
    respuesta = (
        "Perfecto 😊\n"
        '{"memoria_update": "Nombre: Oscar. Etapa: INE recibido.", "etiquetas_internas": {"'
    )
    items = parser.procesar_respuesta_ia(respuesta, CANDIDATO)

    assert items[0]["resumen_generado"] == "Nombre: Oscar. Etapa: INE recibido."


# --- Fecha de la entrevista -------------------------------------------------

def test_fecha_entrevista_ignora_la_clave_json_y_extrae_la_iso():
    """El patrón de CITA_CONFIRMADA es case-insensitive y también enganchaba
    la clave JSON "cita_confirmada", guardando `": "2026-08-08T09:00:00"}}`
    tal cual en candidatos.fecha_entrevista."""
    respuesta = (
        "¡Tu entrevista quedó agendada!\n"
        '{"memoria_update": "ok", "etiquetas_internas": {"cita_confirmada": "2026-08-08T09:00:00"}}'
    )
    items = parser.procesar_respuesta_ia(respuesta, CANDIDATO)

    assert items[0]["fecha_entrevista_detectada"] == "2026-08-08T09:00:00"


def test_fecha_entrevista_se_descarta_si_no_hay_marca_de_tiempo():
    """Mejor sin fecha que con basura: el guard de evento_creado_ok en
    agente.py ya cubre el caso de una confirmación sin cita real."""
    items = parser.procesar_respuesta_ia("CITA_CONFIRMADA | por confirmar |", CANDIDATO)

    assert not items[0].get("fecha_entrevista_detectada")


def test_fecha_entrevista_acepta_el_formato_de_texto_plano():
    items = parser.procesar_respuesta_ia(
        "Confirmada. CITA_CONFIRMADA | 2026-09-01T10:30:00 |", CANDIDATO
    )

    assert items[0]["fecha_entrevista_detectada"] == "2026-09-01T10:30:00"


# --- Placeholders de vacante ------------------------------------------------

def test_general_no_se_toma_como_vacante_elegida():
    """'General' es el valor que el modelo ecoa mientras el candidato no ha
    elegido nada. Guardado literal, definir_agenda lo lee como vacante
    desconocida y manda la cita al reclutador de respaldo."""
    respuesta = '{"mensaje_al_usuario": "Hola", "etiquetas_internas": {"actualizar_vacante": "General"}}'
    items = parser.procesar_respuesta_ia(respuesta, CANDIDATO)

    assert not items[0].get("vacante_detectada")


def test_ninguna_tampoco_se_toma_como_vacante():
    respuesta = '{"mensaje_al_usuario": "Hola", "etiquetas_internas": {"actualizar_vacante": "Ninguna"}}'
    items = parser.procesar_respuesta_ia(respuesta, CANDIDATO)

    assert not items[0].get("vacante_detectada")


def test_una_vacante_real_si_se_registra():
    respuesta = (
        '{"mensaje_al_usuario": "Perfecto", '
        '"etiquetas_internas": {"actualizar_vacante": "CHECADOR DE ALMACÉN"}}'
    )
    items = parser.procesar_respuesta_ia(respuesta, CANDIDATO)

    assert items[0]["vacante_detectada"] == "CHECADOR DE ALMACÉN"


# --- [SPLIT] ----------------------------------------------------------------

def test_split_produce_un_item_por_mensaje():
    """La regla 3.7 del prompt manda los detalles y las actividades en dos
    mensajes; ambos tienen que salir como items separados para que
    procesar_turno los envíe y los guarde completos en la memoria."""
    respuesta = "Detalles de la vacante[SPLIT]📋 Actividades a realizar: ..."
    items = parser.procesar_respuesta_ia(respuesta, CANDIDATO)

    assert len(items) == 2
    assert items[0]["message_to_user"] == "Detalles de la vacante"
    assert items[1]["message_to_user"].startswith("📋 Actividades")


def test_sin_split_devuelve_un_solo_mensaje():
    items = parser.procesar_respuesta_ia("Un solo mensaje", CANDIDATO)

    assert len(items) == 1
