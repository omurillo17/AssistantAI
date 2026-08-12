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

# Rescate del resumen cuando ese JSON de cola viene truncado: json.loads no
# puede parsearlo, pero `memoria_update` suele estar completo (es la primera
# clave), así que se extrae con regex para no perder la memoria del candidato.
_MEMORIA_UPDATE_RE = re.compile(r'"memoria_update"\s*:\s*"((?:[^"\\]|\\.)*)"')


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
    """Puerto de la 'LÓGICA DEL NODO' completa (secciones 1-6 del código
    original). Devuelve una lista de items (uno por segmento [SPLIT])
    listos para mandar por WhatsApp en orden, cada uno con el `result`
    completo del parser (para poder aplicar database_updates una sola vez
    con el último item, igual que hacía n8n al pasar el mismo `result`
    con distinto `message_to_user` en cada item)."""

    # 1. Obtener rawInput (soporta objeto JSON directo o texto string)
    raw_input: Any = raw_response
    if isinstance(raw_input, dict):
        if isinstance(raw_input.get("output"), str):
            raw_input = raw_input["output"]
        elif isinstance(raw_input.get("text"), str):
            raw_input = raw_input["text"]
        elif isinstance(raw_input.get("message"), str):
            raw_input = raw_input["message"]

    input_for_parser: Any = raw_input
    json_parsed: dict | None = None

    if isinstance(raw_input, str):
        trimmed = raw_input.strip()
        if trimmed.startswith("{"):
            try:
                json_parsed = json.loads(trimmed)
                input_for_parser = json_parsed
            except json.JSONDecodeError:
                json_parsed = None

        if not json_parsed:
            key_idx = trimmed.find('"mensaje_al_usuario"')
            if key_idx != -1:
                start_brace = trimmed.rfind("{", 0, key_idx)
                if start_brace != -1:
                    depth = 0
                    end_idx = -1
                    for i in range(start_brace, len(trimmed)):
                        if trimmed[i] == "{":
                            depth += 1
                        elif trimmed[i] == "}":
                            depth -= 1
                            if depth == 0:
                                end_idx = i
                                break
                    if end_idx != -1:
                        try:
                            json_parsed = json.loads(trimmed[start_brace:end_idx + 1])
                            input_for_parser = json_parsed
                        except json.JSONDecodeError:
                            json_parsed = None
    elif isinstance(raw_input, dict):
        json_parsed = raw_input
        input_for_parser = raw_input

    # 3. Ejecutar parser
    result = _parse_special_codes(input_for_parser)

    if json_parsed:
        if json_parsed.get("mensaje_al_usuario"):
            result["message_to_user"] = json_parsed["mensaje_al_usuario"]
            result["text_para_whatsapp"] = json_parsed["mensaje_al_usuario"]
        if json_parsed.get("memoria_update"):
            result["resumen_generado"] = json_parsed["memoria_update"]
            result["database_updates"] = result.get("database_updates") or {}
            result["database_updates"]["resumen_ia"] = json_parsed["memoria_update"]

        et = json_parsed.get("etiquetas_internas", json_parsed)
        et_vacante = et.get("actualizar_vacante") or et.get("vacante_interes") or et.get("vacante")
        if et_vacante and str(et_vacante).strip().upper() not in ("GENERAL", "NINGUNA"):
            # "General"/"Ninguna" es el placeholder que el modelo ecoa mientras el
            # candidato no ha elegido vacante todavia (ver VACANTE_INTERES en
            # chat_prompt.md) -- no es una vacante "detectada" de verdad. Sin este
            # filtro (que el fallback de regex de abajo SI tiene), se guardaba como
            # si fuera valida y candidatos.vacante_interes quedaba atorado en
            # 'GENERAL' para siempre (el UPSERT de n8n-incoming solo sobreescribe
            # con un valor no vacio), rompiendo el match de vacante->reclutador.
            result["vacante_detectada"] = str(et_vacante).strip().upper()
        if et.get("actualizar_nave") or et.get("nave_interes") or et.get("nave"):
            result["nave_detectada"] = str(et.get("actualizar_nave") or et.get("nave_interes") or et.get("nave")).strip().upper()
        if et.get("actualizar_nombre") or et.get("nombre"):
            result["nombre_detectado"] = str(et.get("actualizar_nombre") or et.get("nombre")).strip()

    # 4. PARCHES Y ETIQUETAS SECRETAS
    ai_response_str = json.dumps(raw_input) if isinstance(raw_input, dict) else str(raw_input or "")

    if result.get("message_to_user") and isinstance(result["message_to_user"], str):
        result["message_to_user"] = result["message_to_user"].split("MEMORY_UPDATE")[0].strip()

    def _strip_quotes_pipes(s: str) -> str:
        s = re.sub(r'^["\s|]+', "", s)
        s = re.sub(r'["\s|]+$', "", s)
        return s

    vac_match = re.search(r'(?:ACTUALIZAR_VACANTE|"actualizar_vacante"|"vacante_interes")\s*[:|^"]\s*([^"|\n,}]+)', ai_response_str, re.IGNORECASE)
    if vac_match and vac_match.group(1):
        val = _strip_quotes_pipes(vac_match.group(1).strip())
        if val and val.upper() not in ("GENERAL", "NINGUNA"):
            result["vacante_detectada"] = val.upper()

    nave_match = re.search(r'(?:ACTUALIZAR_NAVE|"actualizar_nave"|"nave_interes")\s*[:|^"]\s*([^"|\n,}]+)', ai_response_str, re.IGNORECASE)
    if nave_match and nave_match.group(1):
        val = _strip_quotes_pipes(nave_match.group(1).strip())
        if val and val.upper() != "PENDIENTE":
            result["nave_detectada"] = val.upper()

    nom_match = re.search(r'(?:ACTUALIZAR_NOMBRE|"actualizar_nombre")\s*[:|^"]\s*([^"|\n,}]+)', ai_response_str, re.IGNORECASE)
    if nom_match and nom_match.group(1):
        val = _strip_quotes_pipes(nom_match.group(1).strip())
        if val and val not in ("Desconocido", "Candidato"):
            result["nombre_detectado"] = val

    # Resumen desde un JSON de cola truncado (json.loads ya falló arriba, así
    # que `resumen_generado` viene vacío aunque el modelo sí mandó memoria).
    if not result.get("resumen_generado"):
        mem_match = _MEMORIA_UPDATE_RE.search(ai_response_str)
        if mem_match and mem_match.group(1):
            try:
                resumen_rescatado = json.loads(f'"{mem_match.group(1)}"')
            except json.JSONDecodeError:
                resumen_rescatado = mem_match.group(1)
            if resumen_rescatado.strip():
                result["resumen_generado"] = resumen_rescatado
                result["database_updates"] = result.get("database_updates") or {}
                result["database_updates"]["resumen_ia"] = resumen_rescatado

    if "PRIVACIDAD_ACEPTADA" in ai_response_str:
        result["acepto_privacidad"] = True
    if "CITA_CANCELADA" in ai_response_str:
        result["cita_cancelada"] = True
    if "ENVIAR_UBICACION" in ai_response_str:
        result["enviar_ubicacion"] = True

    cita_match = re.search(r"CITA_CONFIRMADA[\s:|]*(.*?)([|\n]|$)", ai_response_str, re.IGNORECASE)
    if cita_match and cita_match.group(1):
        crudo = cita_match.group(1).replace("|", "").strip()
        # El patrón de arriba es IGNORECASE, así que también engancha la CLAVE
        # JSON `"cita_confirmada": "2026-08-08T09:00:00"}}` y se lleva de paso
        # las comillas y llaves de alrededor -- en producción eso acabó
        # guardado tal cual en candidatos.fecha_entrevista. Se extrae solo la
        # marca de tiempo ISO del fragmento capturado; si no hay ninguna, se
        # descarta (mejor sin fecha que con basura, y el guard de
        # evento_creado_ok en agente.py ya cubre ese caso).
        iso = re.search(r"\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?", crudo)
        if iso:
            result["fecha_entrevista_detectada"] = iso.group(0)

    # HUMAN_ALERT
    human_alert_parts = re.split(r"HUMAN_ALERT", ai_response_str, flags=re.IGNORECASE)
    if len(human_alert_parts) > 1:
        fragmento = re.split(r"MEMORY_UPDATE", human_alert_parts[1], flags=re.IGNORECASE)[0].strip()
        fragmento = re.sub(r"^\s*\|\s*", "", fragmento).strip()
        partes_raw = [p.strip() for p in fragmento.split("|")]

        nombre_candidato_fallback = (
            candidato.get("nombre_chat") or candidato.get("nombre_ine") or candidato.get("nombre_solicitud") or "Candidato"
        )

        primer_campo = partes_raw[0] if partes_raw else ""
        primer_campo_parece_resumen = bool(re.search(
            r"candidato|documento|constancia|rfc|ine|cv|solicit|agend|conflict|no cuenta|no tiene",
            primer_campo, re.IGNORECASE,
        ))

        if len(partes_raw) >= 3 and not primer_campo_parece_resumen:
            nombre = partes_raw[0]
            resumen = partes_raw[1]
            mensaje_visible = " | ".join(partes_raw[2:]).strip()
        elif len(partes_raw) >= 2 and primer_campo_parece_resumen:
            nombre = nombre_candidato_fallback
            resumen = partes_raw[0]
            mensaje_visible = " | ".join(partes_raw[1:]).strip()
        elif len(partes_raw) >= 2:
            nombre = partes_raw[0]
            resumen = partes_raw[1]
            mensaje_visible = _MENSAJE_HUMANO_DEFAULT
        else:
            nombre = nombre_candidato_fallback
            resumen = "El candidato solicitó apoyo de reclutamiento humano."
            mensaje_visible = _MENSAJE_HUMANO_DEFAULT

        if (
            not mensaje_visible
            or re.match(r"^el candidato", mensaje_visible, re.IGNORECASE)
            or re.search(r"impidiendo el agendamiento", mensaje_visible, re.IGNORECASE)
            or re.search(r"solicitó escalamiento", mensaje_visible, re.IGNORECASE)
        ):
            mensaje_visible = _MENSAJE_HUMANO_DEFAULT

        result["human_alert_nombre"] = nombre.strip()
        result["human_alert_resumen"] = resumen.strip()
        result["message_to_user"] = mensaje_visible.strip()

    # CV_MANUAL
    cv_manual_match = re.search(r"CV_MANUAL[\s:|]*(\{[\s\S]*?\})", ai_response_str, re.IGNORECASE)
    if cv_manual_match and cv_manual_match.group(1):
        try:
            json_limpio = cv_manual_match.group(1)
            json_limpio = re.sub(r"```json", "", json_limpio, flags=re.IGNORECASE)
            json_limpio = re.sub(r"```", "", json_limpio)
            json_limpio = re.sub(r"[\n\r\t]", " ", json_limpio).strip()
            cv_data = json.loads(json_limpio)
            result["experiencia_manual"] = cv_data.get("experiencia")
            result["vacante_manual"] = cv_data.get("vacante")
            result["datos_cv_manual"] = cv_data
            result["es_cv_manual"] = True
            if cv_data.get("nombre") and cv_data["nombre"] != "Desconocido":
                result["nombre_detectado"] = cv_data["nombre"]
        except (json.JSONDecodeError, AttributeError):
            result["datos_cv_manual"] = {"error": "La IA formateó mal el JSON", "experiencia": "Candidato llenó solicitud manual por chat."}
            result["es_cv_manual"] = True

    # EXPERIENCIA_ACTIVIDADES -- lo que contestó cuando Sofia le leyó las
    # actividades del puesto. Se acepta la etiqueta de texto plano y la clave
    # del JSON de etiquetas internas, igual que el resto de marcadores.
    exp_match = re.search(
        r'(?:EXPERIENCIA_ACTIVIDADES\s*\|\s*|"experiencia_actividades"\s*:\s*")([^"|\n]+)',
        ai_response_str,
        re.IGNORECASE,
    )
    if exp_match and exp_match.group(1):
        experiencia_act = _strip_quotes_pipes(exp_match.group(1).strip())
        if experiencia_act:
            result["experiencia_actividades"] = experiencia_act

    # RESPUESTAS_FILTRO
    filtro_match = re.search(r"RESPUESTAS_FILTRO[\s:|]*([\s\S]*?)(?=\n[A-Z_]+\s*\||$)", ai_response_str, re.IGNORECASE)
    if filtro_match and filtro_match.group(1):
        result["respuestas_filtro_detectadas"] = filtro_match.group(1).replace("|", "").strip()

    # 5. LIMPIEZA VISUAL PROFUNDA
    if result.get("message_to_user") and isinstance(result["message_to_user"], str):
        json_key_idx = result["message_to_user"].find('"mensaje_al_usuario"')
        if json_key_idx != -1:
            start_b = result["message_to_user"].rfind("{", 0, json_key_idx)
            if start_b != -1:
                result["message_to_user"] = result["message_to_user"][:start_b]

        result["message_to_user"] = _JSON_COLA_RE.sub("", result["message_to_user"])

        result["message_to_user"] = _CLEANUP_RE.sub("", result["message_to_user"]).strip()

        if result.get("fecha_entrevista_detectada"):
            result["message_to_user"] = result["message_to_user"].replace(result["fecha_entrevista_detectada"], "").replace("|", "").strip()

        msg = result["message_to_user"]
        if (
            re.match(r"^el candidato", msg, re.IGNORECASE)
            or "impidiendo el agendamiento" in msg
            or "Solicitó escalamiento" in msg
            or "solicitó escalamiento" in msg
        ):
            result["message_to_user"] = _MENSAJE_HUMANO_DEFAULT

        if "|" in result["message_to_user"]:
            partes = [p.strip() for p in result["message_to_user"].split("|") if p.strip()]
            result["message_to_user"] = partes[-1] if partes else _MENSAJE_HUMANO_DEFAULT

        result["message_to_user"] = re.sub(r"^[|\s]+", "", result["message_to_user"]).strip()

    if not result.get("message_to_user") or not isinstance(result["message_to_user"], str) or result["message_to_user"].strip() == "":
        result["message_to_user"] = "¡Hola! 😊 ¿En qué puedo ayudarte hoy o qué duda tienes sobre nuestras vacantes?"

    # 6. SPLIT DE MENSAJES Y MENÚ CADA 3 MENSAJES
    if "[SPLIT]" in result["message_to_user"].upper():
        mensajes = [m.strip() for m in re.split(r"\[SPLIT\]", result["message_to_user"], flags=re.IGNORECASE) if m.strip() != ""]
    else:
        mensajes = [result["message_to_user"]]

    output = [{**result, "message_to_user": msg} for msg in mensajes]

    mensajes_enviados = candidato.get("mensajes_bot_enviados") or 0
    if mensajes_enviados % 3 == 0 and output:
        output[-1]["message_to_user"] += '\n\n_(Escribe "Menú" para volver al menú principal o "Cambiar sucursal" para cambiar de nave)_'

    return output
