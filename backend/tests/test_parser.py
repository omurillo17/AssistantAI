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


def test_rescate_vacante_desde_memoria_update():
    respuesta = (
        '{"mensajes_al_usuario": ["Para continuar, ¿me compartes tu nombre?"], '
        '"memoria_update": "Nombre: Candidato. Vacante: OPERADOR DE ALMACEN. Etapa: Nombre.", '
        '"etiquetas_internas": {}}'
    )
    items = parser.procesar_respuesta_ia(respuesta, CANDIDATO)

    assert items[0]["vacante_detectada"] == "OPERADOR DE ALMACEN"
    assert items[0]["database_updates"]["vacante_interes"] == "OPERADOR DE ALMACEN"


def test_rescate_vacante_desde_frase_conversacional_ia():
    respuesta = (
        '{"mensajes_al_usuario": ["¡Excelente opción! Para continuar con tu postulación a Operador de Almacén, ¿me podrías compartir tu nombre completo? ✨"], '
        '"memoria_update": "Etapa: nombre", '
        '"etiquetas_internas": {}}'
    )
    items = parser.procesar_respuesta_ia(respuesta, CANDIDATO)

    assert items[0]["vacante_detectada"] == "OPERADOR DE ALMACÉN"
    assert items[0]["database_updates"]["vacante_interes"] == "OPERADOR DE ALMACÉN"


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


# --- Pie de menú / Navegación -----------------------------------------------

def test_pie_de_menu_no_se_duplica_cuando_ia_lo_incluye():
    """Si la IA escribe el pie de menú y además coincide con el turno % 3 == 0,
    el parser debe limpiarlo antes y añadirlo exactamente una sola vez."""
    candidato_tercer_mensaje = {"nombre_chat": "Oscar", "mensajes_bot_enviados": 3}
    respuesta = (
        '{"mensaje_al_usuario": "Gracias por responder.\\n\\n'
        '(Escribe \\"Menú\\" para volver al menú principal o \\"Cambiar sucursal\\" para cambiar de nave)"}'
    )
    items = parser.procesar_respuesta_ia(respuesta, candidato_tercer_mensaje)

    assert len(items) == 1
    msg = items[0]["message_to_user"]
    # Debe aparecer exactamente 1 vez
    assert msg.count("volver al menú principal") == 1


def test_pie_de_menu_se_elimina_en_turnos_intermedios_si_ia_lo_escribe():
    """En turnos que NO son múltiplo de 3, si la IA escribe el pie de menú,
    se elimina para respetar la regla de enviarlo solo cada 3 mensajes."""
    candidato_turno_1 = {"nombre_chat": "Oscar", "mensajes_bot_enviados": 1}
    respuesta = (
        '{"mensaje_al_usuario": "Hola Oscar.\\n\\n'
        '_(Escribe \\"Menú\\" para volver al menú principal o \\"Cambiar sucursal\\" para cambiar de nave)_"}'
    )
    items = parser.procesar_respuesta_ia(respuesta, candidato_turno_1)

    assert len(items) == 1
    assert "volver al menú principal" not in items[0]["message_to_user"]


# --- Bucle de la ciudad (residencia sin etiquetar) --------------------------
# El modelo redactaba "¡Zapopan está dentro de nuestra cobertura!" pero omitía
# `etiquetas_internas.lugar_residencia`. El campo quedaba vacío, la regla
# Diamante de residencia volvía a pedir la ciudad y la conversación entraba en
# bucle (producción, 13/08/2026 en adelante).


def test_detecta_municipio_zmg_en_respuesta_suelta():
    assert parser.detectar_municipio_zmg("Zapopan") == "ZAPOPAN"
    assert parser.detectar_municipio_zmg("zapopan") == "ZAPOPAN"


def test_detecta_municipio_zmg_dentro_de_una_frase():
    assert parser.detectar_municipio_zmg("vivo en Tonalá desde hace años") == "TONALA"
    assert parser.detectar_municipio_zmg("Soy de El Salto") == "EL SALTO"


def test_detecta_municipio_zmg_ignora_acentos_y_mayusculas():
    assert parser.detectar_municipio_zmg("ixtlahuacán") == "IXTLAHUACAN"


def test_no_detecta_municipio_fuera_de_la_zona():
    assert parser.detectar_municipio_zmg("Villahermosa, Tabasco") is None
    assert parser.detectar_municipio_zmg("Monterrey") is None


def test_no_detecta_municipio_cuando_no_hay_ciudad():
    assert parser.detectar_municipio_zmg("hola, me interesa el trabajo") is None
    assert parser.detectar_municipio_zmg("") is None
    assert parser.detectar_municipio_zmg(None) is None


def test_no_confunde_municipio_incrustado_en_otra_palabra():
    """El match es por palabra completa: 'TONALA' no debe salir de 'TONALADA'."""
    assert parser.detectar_municipio_zmg("trabajé cargando una tonalada") is None


def test_la_etiqueta_del_modelo_sigue_teniendo_prioridad():
    """Cuando el modelo SÍ etiqueta, el parser la respeta tal cual."""
    respuesta = (
        '{"mensaje_al_usuario": "¡Excelente!", '
        '"etiquetas_internas": {"lugar_residencia": "Tlaquepaque"}}'
    )
    items = parser.procesar_respuesta_ia(respuesta, CANDIDATO)
    assert items[0]["database_updates"]["lugar_residencia"] == "Tlaquepaque"
