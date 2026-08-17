"""Puerto 1:1 del nodo 'Leer' de 3_Sofia - Flujo de Chat.json (antes
`/home/node/virgo_files/functions/parse_special_codes.js`). Parsea la
respuesta del agente de IA -- en formato de "special codes" de texto plano
(`CODIGO | valor | ...`) o JSON estructurado (`mensaje_al_usuario`,
`memoria_update`, `etiquetas_internas`) -- y produce el texto final a
mandar por WhatsApp más las actualizaciones de BD/acciones pendientes.

No se "limpia" ni se simplifica esta lógica al portarla: el contrato de
texto que respeta el prompt del agente (chat_prompt.md) depende de estos
mismos patrones exactos, así que cualquier cambio de comportamiento aquí
rompería el chat en producción sin tocar el prompt."""

import json
import re
from datetime import datetime, timezone
from typing import Any

from app.chat.mensajes_comunes import DESCALIFICACION_CIUDAD_MSG

_SPECIAL_CODES = {
    "NAME_UPDATE": {"pattern": re.compile(r"NAME_UPDATE\s*\|\s*([^|]+)\s*\|", re.IGNORECASE), "action": "update_name", "field": "nombre"},
    "VACANTE_UPDATE": {"pattern": re.compile(r"VACANTE_UPDATE\s*\|\s*([^|]+)\s*\|", re.IGNORECASE), "action": "update_vacante", "field": "vacante_interes"},
    "CITA_CONFIRMADA": {"pattern": re.compile(r"CITA_CONFIRMADA\s*\|", re.IGNORECASE), "action": "cita_confirmada", "field": "fecha_cita_detectada"},
    "CON_CV": {"pattern": re.compile(r"CON_CV\s*\|\s*([^|]+)\s*\|", re.IGNORECASE), "action": "cv_recibido", "field": "tiene_cv"},
    "CV_MANUAL": {"pattern": re.compile(r"CV_MANUAL\s*\|\s*(\{[^}]+\})", re.IGNORECASE), "action": "cv_manual", "field": "cv_data", "is_json": True},
    "HUMAN_ALERT": {"pattern": re.compile(r"HUMAN_ALERT\s*\|\s*([^|]+)\s*\|", re.IGNORECASE), "action": "escalate_to_human", "field": "escalation_reason"},
    "MEMORY_UPDATE": {"pattern": re.compile(r"MEMORY_UPDATE\s*\|\s*([^|]+)\s*\|", re.IGNORECASE), "action": "update_memory", "field": "resumen_ia"},
    "CITA_CANCELADA": {"pattern": re.compile(r"CITA_CANCELADA\s*\|", re.IGNORECASE), "action": "cita_cancelada", "field": "estado"},
    "LUGAR_RESIDENCIA": {"pattern": re.compile(r"LUGAR_RESIDENCIA\s*\|\s*([^|]+)\s*\|", re.IGNORECASE), "action": "lugar_residencia", "field": "lugar_residencia"},
    "CIUDAD_NO_APTA": {"pattern": re.compile(r"CIUDAD_NO_APTA\s*\|\s*([^|]+)\s*\|", re.IGNORECASE), "action": "ciudad_no_apta", "field": "lugar_residencia"},
}

_MENSAJE_HUMANO_DEFAULT = (
    "Gracias por explicarme 😊 Voy a compartir tu caso con el equipo de reclutamiento "
    "para que puedan revisarlo y darte seguimiento por este medio."
)

_MUNICIPIOS_ZMG_JALISCO = {
    "GUADALAJARA", "ZAPOPAN", "TLAQUEPAQUE", "TONALA", "TONALÁ", "TLAJOMULCO",
    "EL SALTO", "IXTLAHUACAN", "IXTLAHUACÁN", "ZAPOTLANEJO", "ZMG", "JALISCO",
    "GDL", "CHAPALA", "SAN CRISTOBAL", "TETLAN", "ATEMAJAC", "ANALCO",
    "COLON INDUSTRIAL", "JARDINES DE LA CRUZ", "MANDARINA"
}

def _es_ciudad_no_apta(ciudad_str: str) -> bool:
    if not ciudad_str:
        return False
    norm = str(ciudad_str).upper().strip()
    if not norm or norm in ("PENDIENTE", "DESCONOCIDO", "NONE", "NULL"):
        return False
    if any(m in norm for m in _MUNICIPIOS_ZMG_JALISCO):
        return False
    return True


def _es_nombre_valido(nombre: str | None) -> bool:
    if not nombre:
        return False
    clean = re.sub(r"[{}\[\]\"'|]", "", str(nombre)).strip()
    if not clean or len(clean) < 2:
        return False
    if clean.upper() in ("DESCONOCIDO", "CANDIDATO", "NO REGISTRADO", "PENDIENTE", "USUARIO", "SIN REGISTRAR", "NONE", "NULL"):
        return False
    if clean.isdigit() or re.match(r"^\+?\d+$", clean):
        return False
    return True

_CLEANUP_RE = re.compile(
    r"ACTUALIZAR_(?:NOMBRE|VACANTE|NAVE)\s*\|\s*[^|\n]+(?:\||)"
    r"|LUGAR_RESIDENCIA\s*\|?[^|\n]*(?:\||)"
    r"|CIUDAD_NO_APTA\s*\|?[^|\n]*(?:\||)"
    r"|PRIVACIDAD_ACEPTADA\s*\|?"
    r"|CITA_CONFIRMADA[\s:|]*.*?(?:[|\n]|$)"
    r"|CITA_CANCELADA[\s:|]*.*?(?:[|\n]|$)"
    r"|ENVIAR_UBICACION[\s:|]*.*?(?:[|\n]|$)"
    r"|EXPERIENCIA_ACTIVIDADES[\s:|]*.*?(?:[|\n]|$)"
    r"|```json|```",
    re.IGNORECASE,
)

# Bloque JSON de "cola" que el modelo pega DESPUÉS del texto visible
# (`{"memoria_update": ..., "etiquetas_internas": {...}}`). El corte que ya
# existía abajo solo reaccionaba a `"mensaje_al_usuario"`, así que una cola
# que empieza por `"memoria_update"` se le escapaba y el candidato terminaba
# leyendo el JSON crudo en WhatsApp (visto en producción). `[\s\S]*$` llega
# hasta el final a propósito: cuando Gemini corta la respuesta a la mitad el
# JSON queda truncado (sin llaves de cierre) y json.loads falla, que es
# justo el caso en el que esta limpieza tiene que funcionar igual.
_JSON_COLA_RE = re.compile(
    r'\{\s*"(?:memoria_update|etiquetas_internas|mensaje_al_usuario)"[\s\S]*$'
)

_YAML_COLA_RE = re.compile(
    r'\n?\s*(?:memoria_update|etiquetas_internas)\s*:[\s\S]*$',
    re.IGNORECASE,
)

# Rescate del resumen cuando ese JSON de cola viene truncado: json.loads no
# puede parsearlo, pero `memoria_update` suele estar completo (es la primera
# clave), así que se extrae con regex para no perder la memoria del candidato.
_MEMORIA_UPDATE_RE = re.compile(r'"memoria_update"\s*:\s*"((?:[^"\\]|\\.)*)"')

# Patrón para detectar y limpiar pies de menú (para evitar que se dupliquen si el
# modelo los genera por su cuenta y además el parser los añade cada 3 mensajes).
_MENU_FOOTER_RE = re.compile(
    r'\s*_?\(\s*(?:Escribe\s+)?["“\']?Menú["”\']?[^)]*(?:menú principal|cambiar de nave)[^)]*\)_?',
    re.IGNORECASE,
)


def _extract_code(text: str, code_name: str, code_config: dict) -> dict | None:
    match = code_config["pattern"].search(text)
    if not match:
        return None
    value: Any = match.group(1).strip() if match.lastindex else None
    if code_config.get("is_json") and value:
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return None
    return {"code": code_name, "action": code_config["action"], "field": code_config["field"], "value": value, "raw_match": match.group(0)}


def _clean_message(text: str, detected_codes: list[dict]) -> str:
    if not detected_codes:
        return text.strip() if isinstance(text, str) else ""
    cleaned = text if isinstance(text, str) else ""
    for code in detected_codes:
        cleaned = cleaned.replace(code["raw_match"], "", 1)
    return cleaned.strip()


def _generate_database_updates(detected_codes: list[dict]) -> tuple[dict, list[dict]]:
    updates: dict = {}
    actions: list[dict] = []
    now_iso = datetime.now(timezone.utc).isoformat()
    for code in detected_codes:
        action = code["action"]
        value = code["value"]
        if action == "update_name":
            updates["nombre"] = value
            updates["nombre_confirmado"] = True
            actions.append({"type": "database_update", "table": "candidatos", "field": "nombre", "value": value})
        elif action == "update_vacante":
            updates["vacante_interes"] = value
            updates["estado"] = "INTERESADO"
            actions.append({"type": "database_update", "table": "candidatos", "field": "vacante_interes", "value": value})
        elif action == "cita_confirmada":
            updates["estado"] = "CITA_AGENDADA"
            updates["fecha_ultima_cita"] = now_iso
            actions.append({"type": "database_update", "table": "candidatos", "field": "estado", "value": "CITA_AGENDADA"})
            actions.append({"type": "send_confirmation", "channel": "whatsapp"})
        elif action == "cv_recibido":
            updates["tiene_cv"] = True
            updates["estado"] = "CV_RECIBIDO"
            updates["vacante_cv"] = value
            actions.append({"type": "database_update", "table": "candidatos", "field": "tiene_cv", "value": True})
        elif action == "cv_manual":
            cv_manual_str = json.dumps(value)
            updates["cv_manual"] = cv_manual_str
            updates["cv_manual_obj"] = value
            updates["tiene_cv"] = True
            updates["estado"] = "CV_MANUAL"
            actions.append({"type": "database_update", "table": "candidatos", "field": "cv_manual", "value": cv_manual_str})
        elif action == "escalate_to_human":
            updates["estado"] = "ESCALADO"
            updates["escalation_reason"] = value
            updates["escalated_at"] = now_iso
            actions.append({"type": "alert_human", "priority": "high", "reason": value})
        elif action == "update_memory":
            updates["resumen_ia"] = value
            updates["ultima_actualizacion"] = now_iso
            actions.append({"type": "database_update", "table": "candidatos", "field": "resumen_ia", "value": value})
        elif action == "cita_cancelada":
            updates["estado"] = "INTERESADO"
            actions.append({"type": "database_update", "table": "candidatos", "field": "estado", "value": "INTERESADO"})
        elif action == "lugar_residencia":
            updates["lugar_residencia"] = value
            if _es_ciudad_no_apta(value):
                updates["estado"] = "OTRA_CIUDAD"
                updates["resumen_ia"] = f"Descalificado automáticamente: Radica en otra ciudad ({value})"
                actions.append({"type": "database_update", "table": "candidatos", "field": "lugar_residencia", "value": value})
                actions.append({"type": "database_update", "table": "candidatos", "field": "estado", "value": "OTRA_CIUDAD"})
            else:
                actions.append({"type": "database_update", "table": "candidatos", "field": "lugar_residencia", "value": value})
        elif action == "ciudad_no_apta":
            updates["lugar_residencia"] = value
            updates["estado"] = "OTRA_CIUDAD"
            updates["resumen_ia"] = f"Descalificado automáticamente: Radica en otra ciudad ({value})"
            actions.append({"type": "database_update", "table": "candidatos", "field": "lugar_residencia", "value": value})
            actions.append({"type": "database_update", "table": "candidatos", "field": "estado", "value": "OTRA_CIUDAD"})
    return updates, actions


def _parse_special_codes(ai_response: Any) -> dict:
    if not ai_response:
        return {"message_to_user": "", "has_special_codes": False, "detected_codes": [], "pending_actions": []}

    json_obj: dict | None = None
    if isinstance(ai_response, dict):
        json_obj = ai_response
        text_to_parse = json.dumps(ai_response)
    elif isinstance(ai_response, str):
        clean_str = re.sub(r"```json", "", ai_response, flags=re.IGNORECASE)
        clean_str = re.sub(r"```", "", clean_str).strip()
        text_to_parse = clean_str
        if clean_str.startswith("{") and clean_str.endswith("}"):
            try:
                json_obj = json.loads(clean_str)
            except json.JSONDecodeError:
                json_obj = None
    else:
        text_to_parse = str(ai_response)

    detected_codes = []
    for code_name, code_config in _SPECIAL_CODES.items():
        extracted = _extract_code(text_to_parse, code_name, code_config)
        if extracted:
            detected_codes.append(extracted)

    cleaned_message = _clean_message(text_to_parse, detected_codes)
    if json_obj and json_obj.get("mensaje_al_usuario"):
        cleaned_message = json_obj["mensaje_al_usuario"]

    updates, actions = _generate_database_updates(detected_codes)

    if json_obj and json_obj.get("memoria_update"):
        updates["resumen_ia"] = json_obj["memoria_update"]
        actions.append({"type": "database_update", "table": "candidatos", "field": "resumen_ia", "value": json_obj["memoria_update"]})

    return {
        "message_to_user": cleaned_message,
        "detected_codes": [{"code": c["code"], "action": c["action"], "value": c["value"]} for c in detected_codes],
        "database_updates": updates,
        "pending_actions": actions,
        "text_para_whatsapp": cleaned_message,
        "nombre_detectado": updates.get("nombre"),
        "vacante_detectada": updates.get("vacante_interes"),
        "cita_creada": any(a["type"] == "send_confirmation" for a in actions),
        "cita_cancelada": any(c["action"] == "cita_cancelada" for c in detected_codes),
        "motivo_final": updates.get("escalation_reason"),
        "es_cv_manual": bool(updates.get("cv_manual")),
        "datos_cv_manual": updates.get("cv_manual_obj"),
        "resumen_generado": updates.get("resumen_ia"),
        "has_special_codes": len(detected_codes) > 0 or bool(json_obj and json_obj.get("memoria_update")),
        "processed_at": datetime.now(timezone.utc).isoformat(),
        "_original_response": ai_response,
    }


def procesar_respuesta_ia(raw_response: Any, candidato: dict) -> list[dict]:
    """Procesa la respuesta del agente de IA. Soporta:
    1. Formato JSON estructurado (mensajes_al_usuario: list[str], memoria_update, etiquetas_internas).
    2. Formato JSON estándar (mensaje_al_usuario: str con [SPLIT]).
    3. Fallback retrocompatible para respuestas de texto plano con special codes.
    
    Devuelve una lista de items (uno por cada mensaje a enviar por WhatsApp)."""

    raw_input: Any = raw_response
    if isinstance(raw_input, dict):
        if isinstance(raw_input.get("output"), (str, dict)):
            raw_input = raw_input["output"]
        elif isinstance(raw_input.get("text"), (str, dict)):
            raw_input = raw_input["text"]
        elif isinstance(raw_input.get("message"), (str, dict)):
            raw_input = raw_input["message"]

    json_parsed: dict | None = None
    ai_response_str: str = ""

    if isinstance(raw_input, dict):
        json_parsed = raw_input
        ai_response_str = json.dumps(raw_input, ensure_ascii=False)
    elif isinstance(raw_input, str):
        ai_response_str = raw_input
        trimmed = raw_input.strip()
        clean_str = re.sub(r"^```json\s*", "", trimmed, flags=re.IGNORECASE)
        clean_str = re.sub(r"```\s*$", "", clean_str).strip()
        
        try:
            parsed = json.loads(clean_str)
            if isinstance(parsed, dict):
                json_parsed = parsed
        except json.JSONDecodeError:
            json_parsed = None

        if not json_parsed:
            key_idx = clean_str.find('"mensaje_al_usuario"')
            if key_idx == -1:
                key_idx = clean_str.find('"mensajes_al_usuario"')
            if key_idx == -1:
                key_idx = clean_str.find('"memoria_update"')
            if key_idx != -1:
                start_brace = clean_str.rfind("{", 0, key_idx)
                if start_brace != -1:
                    depth = 0
                    end_idx = -1
                    for i in range(start_brace, len(clean_str)):
                        if clean_str[i] == "{":
                            depth += 1
                        elif clean_str[i] == "}":
                            depth -= 1
                            if depth == 0:
                                end_idx = i
                                break
                    if end_idx != -1:
                        try:
                            parsed = json.loads(clean_str[start_brace:end_idx + 1])
                            if isinstance(parsed, dict):
                                json_parsed = parsed
                        except json.JSONDecodeError:
                            json_parsed = None

    result = _parse_special_codes(json_parsed if json_parsed else raw_input)
    mensajes_candidato: list[str] = []

    if json_parsed:
        # A) Extraer lista de mensajes al usuario
        if "mensajes_al_usuario" in json_parsed:
            raw_msgs = json_parsed["mensajes_al_usuario"]
            if isinstance(raw_msgs, list):
                for m in raw_msgs:
                    if m and str(m).strip():
                        mensajes_candidato.append(str(m).strip())
            elif isinstance(raw_msgs, str) and raw_msgs.strip():
                mensajes_candidato.append(raw_msgs.strip())

        if not mensajes_candidato and "mensaje_al_usuario" in json_parsed:
            raw_msg = json_parsed["mensaje_al_usuario"]
            if isinstance(raw_msg, str) and raw_msg.strip():
                if "[SPLIT]" in raw_msg.upper():
                    mensajes_candidato = [s.strip() for s in re.split(r"\[SPLIT\]", raw_msg, flags=re.IGNORECASE) if s.strip()]
                else:
                    mensajes_candidato = [raw_msg.strip()]
            elif isinstance(raw_msg, list):
                for m in raw_msg:
                    if m and str(m).strip():
                        mensajes_candidato.append(str(m).strip())

        # B) Resumen de memoria
        resumen = json_parsed.get("memoria_update") or json_parsed.get("resumen_memoria")
        if resumen and str(resumen).strip():
            resumen_str = str(resumen).strip()
            result["resumen_generado"] = resumen_str
            result["database_updates"]["resumen_ia"] = resumen_str

        # C) Etiquetas internas / actualizaciones
        et = json_parsed.get("etiquetas_internas") or json_parsed.get("actualizaciones")
        if not isinstance(et, dict):
            et = json_parsed

        if isinstance(et, dict):
            # Nombre
            nom = et.get("actualizar_nombre") or et.get("nombre")
            if nom and _es_nombre_valido(str(nom)):
                clean_nom = re.sub(r"[{}\[\]\"'|]", "", str(nom)).strip()
                result["nombre_detectado"] = clean_nom
                result["database_updates"]["nombre"] = clean_nom
                result["database_updates"]["nombre_confirmado"] = True

            # Vacante
            vac = et.get("actualizar_vacante") or et.get("vacante_interes") or et.get("vacante")
            if vac:
                vac_clean = str(vac).strip().upper()
                if vac_clean not in ("GENERAL", "NINGUNA", "PENDIENTE"):
                    result["vacante_detectada"] = vac_clean
                    result["database_updates"]["vacante_interes"] = vac_clean
                    result["database_updates"]["estado"] = "INTERESADO"

            # Nave
            nav = et.get("actualizar_nave") or et.get("nave_interes") or et.get("nave")
            if nav:
                nav_clean = str(nav).strip().upper()
                if nav_clean != "PENDIENTE":
                    result["nave_detectada"] = nav_clean

            # Residencia
            lugar_res = et.get("lugar_residencia")
            ciudad_no_apta = et.get("ciudad_no_apta")
            if ciudad_no_apta:
                c_str = str(ciudad_no_apta).strip()
                result["lugar_residencia"] = c_str
                result["database_updates"]["lugar_residencia"] = c_str
                result["database_updates"]["estado"] = "OTRA_CIUDAD"
                result["database_updates"]["resumen_ia"] = f"Descalificado automáticamente: Radica en otra ciudad ({c_str})"
            elif lugar_res:
                l_str = str(lugar_res).strip()
                result["lugar_residencia"] = l_str
                result["database_updates"]["lugar_residencia"] = l_str
                if _es_ciudad_no_apta(l_str):
                    result["database_updates"]["estado"] = "OTRA_CIUDAD"
                    result["database_updates"]["resumen_ia"] = f"Descalificado automáticamente: Radica en otra ciudad ({l_str})"

            # Privacidad
            if et.get("privacidad_aceptada") is True:
                result["acepto_privacidad"] = True

            # Cita confirmada
            cita_val = et.get("cita_confirmada")
            if cita_val:
                iso_match = re.search(r"\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?", str(cita_val))
                if iso_match:
                    result["fecha_entrevista_detectada"] = iso_match.group(0)
                    result["cita_creada"] = True

            # Cita cancelada
            if et.get("cita_cancelada") is True:
                result["cita_cancelada"] = True
                result["database_updates"]["estado"] = "INTERESADO"

            # Experiencia en actividades
            exp_act = et.get("experiencia_actividades")
            if exp_act and str(exp_act).strip():
                result["experiencia_actividades"] = str(exp_act).strip()

            # Respuestas filtro
            rf = et.get("respuestas_filtro")
            if rf:
                result["respuestas_filtro_detectadas"] = json.dumps(rf) if isinstance(rf, dict) else str(rf)

            # CV Manual
            cv_man = et.get("cv_manual")
            if cv_man and isinstance(cv_man, dict):
                result["datos_cv_manual"] = cv_man
                result["es_cv_manual"] = True
                result["database_updates"]["tiene_cv"] = True
                result["database_updates"]["estado"] = "CV_MANUAL"
                result["database_updates"]["cv_manual"] = json.dumps(cv_man)
                if _es_nombre_valido(cv_man.get("nombre")):
                    nom_cv = re.sub(r"[{}\[\]\"'|]", "", str(cv_man["nombre"])).strip()
                    result["nombre_detectado"] = nom_cv
                    result["database_updates"]["nombre"] = nom_cv
                    result["database_updates"]["nombre_confirmado"] = True

            # Human alert
            ha = et.get("human_alert")
            if ha:
                motivo = (ha.get("resumen_interno") if isinstance(ha, dict) else str(ha)) or "Solicitó atención humana"
                result["motivo_final"] = motivo
                result["database_updates"]["estado"] = "ESCALADO"
                result["database_updates"]["escalation_reason"] = motivo
                result["database_updates"]["escalated_at"] = datetime.now(timezone.utc).isoformat()
                result["pending_actions"].append({"type": "alert_human", "priority": "high", "reason": motivo})
                if isinstance(ha, dict) and ha.get("mensaje_visible"):
                    mensajes_candidato = [str(ha["mensaje_visible"]).strip()]

    def _strip_quotes_pipes(s: str) -> str:
        s = re.sub(r'^["\s|]+', "", s)
        s = re.sub(r'["\s|]+$', "", s)
        return s

    if not result.get("vacante_detectada"):
        vac_match = re.search(r'(?:ACTUALIZAR_VACANTE|"actualizar_vacante"|"vacante_interes")\s*[:|^"]\s*([^"|\n,}]+)', ai_response_str, re.IGNORECASE)
        if vac_match and vac_match.group(1):
            val = _strip_quotes_pipes(vac_match.group(1).strip())
            if val and val.upper() not in ("GENERAL", "NINGUNA", "PENDIENTE"):
                result["vacante_detectada"] = val.upper()
                result["database_updates"]["vacante_interes"] = val.upper()
                result["database_updates"]["estado"] = "INTERESADO"

    if not result.get("nave_detectada"):
        nave_match = re.search(r'(?:ACTUALIZAR_NAVE|"actualizar_nave"|"nave_interes")\s*[:|^"]\s*([^"|\n,}]+)', ai_response_str, re.IGNORECASE)
        if nave_match and nave_match.group(1):
            val = _strip_quotes_pipes(nave_match.group(1).strip())
            if val and val.upper() != "PENDIENTE":
                result["nave_detectada"] = val.upper()

    if not result.get("nombre_detectado"):
        nom_match = re.search(r'(?:ACTUALIZAR_NOMBRE|"actualizar_nombre")\s*[:|^"]\s*([^"|\n,}]+)', ai_response_str, re.IGNORECASE)
        if nom_match and nom_match.group(1):
            val = _strip_quotes_pipes(nom_match.group(1).strip())
            val_clean = re.sub(r"[{}\[\]\"'|]", "", val).strip()
            if _es_nombre_valido(val_clean):
                result["nombre_detectado"] = val_clean
                result["database_updates"]["nombre"] = val_clean
                result["database_updates"]["nombre_confirmado"] = True

    if not result.get("resumen_generado"):
        mem_match = _MEMORIA_UPDATE_RE.search(ai_response_str)
        if mem_match and mem_match.group(1):
            try:
                resumen_rescatado = json.loads(f'"{mem_match.group(1)}"')
            except json.JSONDecodeError:
                resumen_rescatado = mem_match.group(1)
            if resumen_rescatado.strip():
                result["resumen_generado"] = resumen_rescatado
                result["database_updates"]["resumen_ia"] = resumen_rescatado

    if "PRIVACIDAD_ACEPTADA" in ai_response_str:
        result["acepto_privacidad"] = True
    if "CITA_CANCELADA" in ai_response_str:
        result["cita_cancelada"] = True
        result["database_updates"]["estado"] = "INTERESADO"

    if not result.get("fecha_entrevista_detectada"):
        cita_match = re.search(r"CITA_CONFIRMADA[\s:|]*(.*?)([|\n]|$)", ai_response_str, re.IGNORECASE)
        if cita_match and cita_match.group(1):
            crudo = cita_match.group(1).replace("|", "").strip()
            iso = re.search(r"\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?", crudo)
            if iso:
                result["fecha_entrevista_detectada"] = iso.group(0)
                result["cita_creada"] = True

    # 5. Limpieza de mensajes a usuario
    if not mensajes_candidato:
        base_msg = result.get("message_to_user") or ""
        if isinstance(base_msg, str) and base_msg.strip():
            if "[SPLIT]" in base_msg.upper():
                mensajes_candidato = [s.strip() for s in re.split(r"\[SPLIT\]", base_msg, flags=re.IGNORECASE) if s.strip()]
            else:
                mensajes_candidato = [base_msg.strip()]
        else:
            mensajes_candidato = ["¡Hola! 😊 ¿En qué puedo ayudarte hoy o qué duda tienes sobre nuestras vacantes?"]

    mensajes_limpios: list[str] = []
    for msg in mensajes_candidato:
        m = str(msg).strip()
        m = _JSON_COLA_RE.sub("", m)
        m = _YAML_COLA_RE.sub("", m)
        m = _CLEANUP_RE.sub("", m).strip()
        m = _MENU_FOOTER_RE.sub("", m).strip()
        if "|" in m:
            partes = [p.strip() for p in m.split("|") if p.strip()]
            m = partes[-1] if partes else ""
        m = re.sub(r"^[|\s]+", "", m).strip()

        if (
            re.match(r"^el candidato", m, re.IGNORECASE)
            or "impidiendo el agendamiento" in m
            or "solicitó escalamiento" in m
        ):
            m = _MENSAJE_HUMANO_DEFAULT

        if m:
            mensajes_limpios.append(m)

    if result.get("database_updates", {}).get("estado") == "OTRA_CIUDAD":
        mensajes_limpios = [DESCALIFICACION_CIUDAD_MSG]

    if not mensajes_limpios:
        mensajes_limpios = ["¡Hola! 😊 ¿En qué puedo ayudarte hoy o qué duda tienes sobre nuestras vacantes?"]

    output = [{**result, "message_to_user": msg} for msg in mensajes_limpios]

    mensajes_enviados = candidato.get("mensajes_bot_enviados") or 0
    if mensajes_enviados % 3 == 0 and output:
        output[-1]["message_to_user"] += '\n\n_(Escribe "Menú" para volver al menú principal o "Cambiar sucursal" para cambiar de nave)_'

    return output
