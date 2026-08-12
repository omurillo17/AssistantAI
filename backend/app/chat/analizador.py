"""Puerto de `2_Sofia - Analizador CV-Audio.json`: clasifica el mensaje
entrante (texto/audio/documento), llama a Gemini para analizar
documentos/transcribir audio, sube el archivo y actualiza el expediente
del candidato reusando los endpoints Next.js ya existentes (no se
duplica esa lógica de negocio -- state machine, upsert, alertas -- que ya
vive en `frontend/src/app/api/{upload-cv,webhook/expediente}`), arma el
system prompt del agente y resuelve el reclutador asignado."""

import json
import logging
import os
import re
import unicodedata
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import httpx

from app import gemini_client, waha_client
from app.config import ENV
from app.db import get_pool
from app.internal_api import auth_headers

logger = logging.getLogger("analizador")

_MX_TZ = ZoneInfo("America/Mexico_City")

_ANALYZE_DOCUMENT_PROMPT_TEMPLATE = """Eres el Reclutador Experto de Grupo Virgo y, por encima de todo, un ANALISTA DE SEGURIDAD Y VALIDACIÓN DE DOCUMENTOS.
Tu prioridad es doble y en este orden:
1. Rechazar con firmeza cualquier meme, personaje de ficción, animal, objeto o imagen que claramente NO sea un intento de documento oficial.
2. Ser MUY TOLERANTE con fotos reales de documentos reales que tengan problemas de calidad. Una foto imperfecta de un documento real NO es lo mismo que un documento falso — NO las trates igual.
REGLA DE ORO: Si puedes leer el nombre de la persona Y al menos un dato más (número de credencial, CURP, RFC, texto institucional, foto de rostro humano), clasifica como VALIDO aunque la foto no sea perfecta. La calidad imperfecta de la foto NO es motivo suficiente para REVISAR_MANUAL si los datos clave son legibles.
Catálogo completo de vacantes disponibles:
{detalle_vacantes}
💼 LA VACANTE QUE EL CANDIDATO SOLICITÓ ES: {vacante_interes}
--- NORMAS DE VALIDACIÓN ---
1. INE (Credencial de Elector Mexicana):
   - Marcadores: (a) texto "Instituto Nacional Electoral"/"INE"/"Elector" aunque sea parcial, (b) fotografía de un rostro humano real, (c) estructura típica de credencial.
   - VALIDO: cumple 2 de 3 marcadores Y se puede leer el nombre. Foto imperfecta con nombre legible = VALIDO.
   - REVISAR_MANUAL: se intuye claramente que es una INE (hay foto de rostro + algo de estructura) pero el nombre es completamente ilegible por calidad de foto muy baja.
   - INVALIDO: es evidentemente un personaje de ficción, animal, objeto, meme, sticker, o no hay NINGÚN marcador de credencial oficial.
2. CONSTANCIA (Constancia de Situación Fiscal / Cédula de Identificación Fiscal del SAT):
   - Marcadores: (a) mención de "SAT", "Hacienda", "Situación Fiscal" o "Cédula de Identificación Fiscal", (b) un RFC con formato reconocible, (c) estructura de documento oficial.
   - VALIDO: cumple 2 de 3 marcadores. RFC parcialmente legible + membrete del SAT = VALIDO.
   - REVISAR_MANUAL: claramente es un documento del SAT pero el RFC es completamente ilegible.
   - INVALIDO: hoja en blanco, objeto random, personaje de ficción, o ningún marcador presente.
3. SOLICITUD (Formato preimpreso de papelería):
   - Marcadores: (a) estructura de formulario preimpreso con cuadrículas, (b) texto manuscrito rellenando el formato, (c) se lee o se intuye "Solicitud de Empleo" o similar.
   - VALIDO/REVISAR_MANUAL/INVALIDO con la misma lógica: si los datos básicos son legibles = VALIDO.
4. CV (Currículum Vitae digital o impreso):
   - Marcadores: (a) estructura de CV (secciones tipo Experiencia/Educación/Habilidades), (b) texto técnico legible, (c) datos de contacto visibles.
   - VALIDO si se pueden leer al menos nombre + una sección de contenido.
5. ANUNCIO: cartel o captura de pantalla ofreciendo una vacante con sueldo/requisitos — clasificación directa, sin candado de calidad.
⛔ REGLA DE ORO DE RECHAZO: memes, capturas de series/películas, personajes de caricatura, animales, objetos, paisajes, comida, o imágenes totalmente ilegibles donde NO hay ningún intento reconocible de documento oficial → INVALIDO siempre, sin excepción.
✅ REGLA ANTI-BUCLE: Si ya clasificaste este tipo de documento como REVISAR_MANUAL anteriormente para este candidato, en esta segunda oportunidad clasifica como VALIDO si hay cualquier dato legible. No pidas la foto más de una vez por tipo de documento.
--- FORMATO DE SALIDA (JSON ESTRICTO, sin bloques de código) ---
{{
  "tipo_documento": "INE, CV, SOLICITUD, ANUNCIO, CONSTANCIA o INVALIDO",
  "estado_validacion": "VALIDO, REVISAR_MANUAL o INVALIDO",
  "calidad_imagen": "buena, borrosa, oscura, reflejo, recortada, ilegible o null",
  "nombre_completo": "Si es visible aunque sea parcialmente. Si es INVALIDO, null.",
  "correo": "Visible en CV/Solicitud. Si no, null.",
  "institucion": "SAT, INE, SOLICITUD o null.",
  "clave_elector": "Visible en INE. Si no, null.",
  "curp": "Visible en INE/Constancia. OBLIGATORIO: La CURP mexicana DEBE contener EXACTAMENTE 18 caracteres alfanuméricos. Si lees más de 18 caracteres, revisa con cuidado y ajusta solo a los 18 caracteres oficiales.",
  "rfc": "Visible en Constancia/RFC. Si no, null.",
  "veredicto": "VIABLE, CARTERA_GENERAL, RECHAZADO o null (sobre el perfil del candidato en CV/Solicitud, NO sobre autenticidad del documento)",
  "experiencia": "Visible en CV/Solicitud. Si no, null.",
  "motivo": "Explica brevemente el estado_validacion, sobre todo si es REVISAR_MANUAL o INVALIDO.",
  "mensaje_usuario": "Aquí va el mensaje según las reglas de abajo (si aplica)."
}}
--- REGLAS DE MENSAJES (mensaje_usuario) ---
1. Si estado_validacion es INVALIDO (documento evidentemente falso/broma): "¡Hola! Oye, estuve revisando la foto que me enviaste pero fíjate que no pude identificarla como un documento oficial válido (INE, RFC o Solicitud). 🧐 ¿Podrías apoyarme mandando de nuevo una foto clara de tu documento real por favor? ¡Así podré agilizar tu trámite! 😊"
2. Si estado_validacion es REVISAR_MANUAL (foto muy baja calidad, datos clave ilegibles): "¡Gracias por la foto! 📸 Solo que no logro leer bien los datos porque se ve muy [usa calidad_imagen: borrosa/oscura/con reflejo/recortada]. ¿Me la puedes mandar de nuevo con buena luz y que se vea el documento completo? Es la última vez que te la pido, prometo que con eso es suficiente. 🙏"
3. Si estado_validacion es VALIDO y el veredicto es VIABLE/CARTERA_GENERAL/RECHAZADO: mantén tus reglas de mensajes estándar para CV y Solicitudes.
4. Si el documento es CONSTANCIA (SAT) o INE con estado_validacion VALIDO: pon null en el mensaje, el sistema se encargará."""

_PLACEHOLDER_RE_TEMPLATE = "{{{name}}}"


# --- Clasificación de contenido -------------------------------------------

def clasificar_media(webhook_payload: dict) -> str:
    """'texto' | 'audio' | 'word' | 'documento'. Puerto de
    '¿Texto o Media?'/'¿Es Audio?'/'¿Es Word?'."""
    if not webhook_payload.get("hasMedia"):
        return "texto"
    mimetype = ((webhook_payload.get("media") or {}).get("mimetype") or "").lower()
    if "audio" in mimetype:
        return "audio"
    if "word" in mimetype:
        return "word"
    return "documento"


# --- Levenshtein / validación cruzada de CURP ------------------------------

def _distancia_levenshtein(a: str, b: str) -> int:
    if not a:
        return len(b or "")
    if not b:
        return len(a)
    matrix = [[0] * (len(a) + 1) for _ in range(len(b) + 1)]
    for i in range(len(b) + 1):
        matrix[i][0] = i
    for j in range(len(a) + 1):
        matrix[0][j] = j
    for i in range(1, len(b) + 1):
        for j in range(1, len(a) + 1):
            if b[i - 1] == a[j - 1]:
                matrix[i][j] = matrix[i - 1][j - 1]
            else:
                matrix[i][j] = min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
    return matrix[len(b)][len(a)]


def _evaluar_curps(c1_raw: str | None, c2_raw: str | None) -> dict:
    if not c1_raw or not c2_raw:
        return {"tipo": "OK"}
    c1 = re.sub(r"[^A-Z0-9]", "", str(c1_raw).upper())
    c2 = re.sub(r"[^A-Z0-9]", "", str(c2_raw).upper())
    if not c1 or not c2:
        return {"tipo": "OK"}
    if c1 == c2:
        return {"tipo": "OK"}
    dist = _distancia_levenshtein(c1, c2)
    core_match = len(c1) >= 10 and len(c2) >= 10 and c1[:10] == c2[:10]
    if dist <= 2 or core_match:
        return {"tipo": "REVISION_HUMANA", "distancia": dist, "c1": c1, "c2": c2}
    return {"tipo": "GRAVE", "distancia": dist, "c1": c1, "c2": c2}


# --- Vacantes (catálogo para el prompt de análisis de documento) -----------

async def _prompt_context_api(empresa_id: str | None) -> dict | None:
    """Catálogo desde GET /api/prompt-context (lo arma el frontend leyendo
    PostgreSQL). Devuelve None si la llamada falla."""
    try:
        url = f"{ENV.FRONTEND_API_BASE}/api/prompt-context"
        params = {"empresa_id": empresa_id} if empresa_id else {}
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, params=params, headers=auth_headers())
            if resp.status_code == 200:
                ctx = resp.json()
                if isinstance(ctx, dict):
                    # Actualizar caché en disco como respaldo ante caídas de la BD
                    try:
                        ctx_path = os.path.join(ENV.VIRGO_FILES_DIR, "data", "prompt_context.json")
                        os.makedirs(os.path.dirname(ctx_path), exist_ok=True)
                        with open(ctx_path, "w", encoding="utf-8") as f:
                            json.dump(ctx, f, ensure_ascii=False, indent=2)
                    except Exception:
                        logger.debug("no se pudo guardar caché local de prompt_context.json")
                    return ctx
            logger.warning("prompt-context respondió %s", resp.status_code)
    except Exception:
        logger.exception("_prompt_context_api: fetch prompt-context falló")
    return None


def _prompt_context_archivo() -> dict | None:
    """Catálogo desde virgo_data/data/prompt_context.json, que el frontend
    reescribe en cada alta/edición de vacante (ver syncPromptContext.ts).
    Devuelve None si no existe o no se puede parsear."""
    ctx_path = os.path.join(ENV.VIRGO_FILES_DIR, "data", "prompt_context.json")
    try:
        with open(ctx_path, "r", encoding="utf-8") as f:
            ctx = json.load(f)
        return ctx if isinstance(ctx, dict) else None
    except FileNotFoundError:
        logger.info("prompt_context.json no existe todavía (%s); se usará la API", ctx_path)
    except (OSError, json.JSONDecodeError):
        logger.exception("no se pudo leer/parsear %s", ctx_path)
    return None


async def obtener_prompt_context(empresa_id: str | None) -> dict:
    """Catálogo de vacantes para los prompts. Se consulta la API (que lee de la BD
    en tiempo real) y si no responde se cae al archivo de caché local."""
    return await _prompt_context_api(empresa_id) or _prompt_context_archivo() or {}


async def obtener_detalle_vacantes(nave_interes: str | None, empresa_id: str | None) -> str:
    """Puerto de 'Vacantes': catálogo de vacantes para el PROMPT DE ANÁLISIS
    DE DOCUMENTO (Gemini). Distinto de cargar_prompt(), que arma el system
    prompt del AGENTE DE CHAT -- son dos prompts separados en el original y
    se preservan separados aquí, aunque hoy compartan el mismo catálogo."""
    nave_actual = str(nave_interes or "1").strip()
    ctx = await _prompt_context_api(empresa_id) or _prompt_context_archivo() or {}
    detalle_txt = ctx.get("detalle_vacantes") or "Informacion no disponible."

    if nave_actual and nave_actual != "Pendiente":
        detalle_txt = _extraer_seccion_nave(detalle_txt, nave_actual)
    return detalle_txt


# --- SepararJSON ------------------------------------------------------------

def separar_json(gemini_text: str, telefono: str, nombre_whatsapp: str, caption_usuario: str, candidato: dict) -> dict:
    """Puerto de 'SepararJSON'."""
    json_match = re.search(r"\{[\s\S]*\}", gemini_text or "")
    clean_json = json_match.group(0) if json_match else re.sub(r"```json|```", "", gemini_text or "").strip()
    try:
        datos = json.loads(clean_json)
    except json.JSONDecodeError:
        datos = {}

    tipo = (datos.get("tipo_documento") or "GENERICO").upper()
    nombre_original = datos.get("nombre_completo") or "Candidato"
    nombre_limpio = unicodedata.normalize("NFD", nombre_original)
    nombre_limpio = "".join(c for c in nombre_limpio if unicodedata.category(c) != "Mn")
    nombre_limpio = re.sub(r"[^a-zA-Z0-9 ]", "", nombre_limpio)
    nombre_limpio = re.sub(r"\s+", "_", nombre_limpio)
    vacante_anuncio = datos.get("vacante_anuncio") or "General"

    edad_calculada = None
    fecha_nac = datos.get("fecha_nacimiento")
    if fecha_nac and fecha_nac not in ("No visible", "null"):
        m = re.search(r"\d{4}", fecha_nac)
        if m:
            edad_calculada = f"{datetime.now().year - int(m.group(0))} años"

    dbData = candidato or {}
    msg_usuario = datos.get("mensaje_usuario") or ""

    if not msg_usuario or msg_usuario == "null":
        if tipo == "SOLICITUD" and dbData.get("estado") != "CV_RECIBIDO":
            msg_usuario = (
                "El candidato acaba de enviar la PRIMERA foto de su solicitud (frente). Agradécele e indícale "
                "que por favor envíe también la foto de la PARTE TRASERA para tener su expediente completo. "
                "Dile que si su solicitud solo tiene un lado o ya mandó ambas, responda 'Listo'."
            )
        elif tipo == "ANUNCIO":
            msg_usuario = f'[SISTEMA: El candidato te envió una captura de pantalla del anuncio de la vacante: *{vacante_anuncio}*.'
            if caption_usuario:
                msg_usuario += f' Además, escribió este mensaje: "{caption_usuario}".'
            msg_usuario += " OBLIGATORIO: Atiéndelo de forma natural, asume que le interesa esa vacante y muéstrale los detalles o pregúntale si quiere aplicar.]"
        elif tipo == "INE":
            if dbData.get("datos_rfc"):
                msg_usuario = "[SISTEMA: AMBOS DOCUMENTOS COMPLETOS. El candidato entregó INE y RFC. Revisa INMEDIATAMENTE tu calendario y ofrécele fechas de entrevista.]"
            else:
                msg_usuario = "[SISTEMA: El candidato entregó su INE, pero FALTA SU CONSTANCIA. Agradécele por el INE y pídele obligatoriamente su Constancia de Situación Fiscal (RFC). TIENES ESTRICTAMENTE PROHIBIDO AGENDAR CITA AÚN.]"
        elif tipo == "CONSTANCIA":
            if dbData.get("datos_ine"):
                msg_usuario = "[SISTEMA: AMBOS DOCUMENTOS COMPLETOS. El candidato entregó INE y RFC. Revisa INMEDIATAMENTE tu calendario y ofrécele fechas de entrevista.]"
            else:
                msg_usuario = "[SISTEMA: El candidato entregó su Constancia (RFC), pero FALTA SU INE. Agradécele por la Constancia y pídele obligatoriamente la foto frontal de su INE. TIENES ESTRICTAMENTE PROHIBIDO AGENDAR CITA AÚN.]"
        elif tipo == "CV" or (tipo == "SOLICITUD" and dbData.get("estado") == "CV_RECIBIDO"):
            if not datos.get("correo"):
                msg_usuario = "[SISTEMA: CV Recibido. Pregunta ÚNICAMENTE: '¡Recibí tu documento y tu perfil está súper bien! 👏 Antes de continuar, ¿me podrías proporcionar tu correo electrónico, por favor? 📧']"
            else:
                msg_usuario = "[SISTEMA: CV Recibido. Pregunta ÚNICAMENTE: '¡Recibí tu documento y tu perfil está súper bien! 👏 Antes de continuar, me gustaría hacerte una pregunta rápida: ¿Te encuentras laborando actualmente? 💼']"
        else:
            msg_usuario = "El candidato envió un documento. Confírmale de recibido de forma amable."
    elif tipo == "ANUNCIO":
        msg_usuario = f'[SISTEMA: El candidato te envió una foto del anuncio de la vacante: *{vacante_anuncio}*. Mensaje: "{caption_usuario}". Atiéndelo.]'

    # `identidad_bloqueada` (bloquea agendar) solo para discrepancias GRAVES
    # (3+ caracteres). `identidad_alerta` (queda pendiente de revisión en el
    # modal del reclutador, pero NO bloquea) para discrepancias menores
    # (1-2 caracteres, típico de error de OCR). Esta distinción ya la hace
    # chat_prompt.md ("Diferencia de 1 a 2 caracteres → PERMITIDO AGENDAR" /
    # "3 o más → PROHIBIDO AGENDAR"), pero antes ambos casos forzaban
    # identidad_bloqueada=true por igual -- el candidato se quedaba
    # bloqueado incluso en el caso que el propio prompt dice permitir.
    identidad_bloqueada = False
    identidad_alerta = False
    identidad_motivo = ""
    curp_eval = {"tipo": "OK"}
    if tipo == "INE" and dbData.get("curp_rfc") and datos.get("curp"):
        curp_eval = _evaluar_curps(datos.get("curp"), dbData.get("curp_rfc"))
    elif tipo in ("CONSTANCIA", "CSF", "RFC") and dbData.get("curp_ine") and datos.get("curp"):
        curp_eval = _evaluar_curps(datos.get("curp"), dbData.get("curp_ine"))

    curp_ine_salida = datos.get("curp") if tipo == "INE" else None
    curp_rfc_salida = datos.get("curp") if tipo in ("CONSTANCIA", "CSF", "RFC") else None

    if curp_eval["tipo"] == "REVISION_HUMANA":
        identidad_alerta = True
        identidad_motivo = (
            f"Diferencia menor en la CURP: INE ({curp_eval['c1']}) vs Constancia ({curp_eval['c2']}), "
            f"distancia de {curp_eval['distancia']} caracter(es). Posible error de OCR por calidad de foto — "
            "queda pendiente de revisión, pero el candidato puede seguir agendando su entrevista."
        )
        # Sin override de msg_usuario: se deja el mensaje normal de arriba
        # (p.ej. "AMBOS DOCUMENTOS COMPLETOS... ofrécele fechas de entrevista")
        # para que el candidato pueda avanzar mientras el reclutador revisa.
    elif curp_eval["tipo"] == "GRAVE":
        identidad_bloqueada = True
        identidad_motivo = (
            f"CURP totalmente distinta entre INE ({curp_eval['c1']}) y Constancia ({curp_eval['c2']}) — posible "
            "documento de otra persona. Requiere validación de un reclutador antes de continuar."
        )
        msg_usuario = "[SISTEMA: Recibimos tus documentos, pero la CURP del INE y de la Constancia no coinciden. Un reclutador va a revisar tus documentos para confirmar tu identidad antes de continuar. Te avisaremos en cuanto lo revisen.]"

    return {
        "nombre": nombre_original,
        "nombre_limpio": nombre_limpio,
        "telefono": telefono,
        "tipo_origen": tipo,
        "cv_manual": datos,
        "experiencia": datos.get("experiencia") or "",
        "veredicto": datos.get("veredicto"),
        "motivo": datos.get("motivo"),
        "resumen_excel": datos.get("resumen_excel"),
        "fecha_nacimiento": datos.get("fecha_nacimiento") or "No visible",
        "vacante_anuncio": vacante_anuncio,
        "mensaje_usuario": msg_usuario,
        "edad_calculada": edad_calculada,
        "nombre_chat": nombre_whatsapp,
        "correo": datos.get("correo"),
        "identidad_bloqueada": identidad_bloqueada,
        "identidad_alerta": identidad_alerta,
        "identidad_motivo": identidad_motivo,
        "curp_ine": curp_ine_salida,
        "curp_rfc": curp_rfc_salida,
    }


# --- Subida y actualización de expediente (reusa Next.js) ------------------

async def subir_cv(telefono: str, data: bytes, mime_type: str) -> str | None:
    url = f"{ENV.FRONTEND_API_BASE}/api/upload-cv"
    ext = ".pdf" if "pdf" in mime_type else (".png" if "png" in mime_type else ".jpg")
    files = {"data": (f"documento{ext}", data, mime_type)}
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, params={"telefono": telefono}, files=files, headers=auth_headers())
        resp.raise_for_status()
        body = resp.json()
        return body.get("url")


async def actualizar_expediente(payload: dict) -> None:
    url = f"{ENV.FRONTEND_API_BASE}/api/webhook/expediente"
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, json=payload, headers=auth_headers())
        resp.raise_for_status()


# --- DefinirAgenda -----------------------------------------------------------

_CLEAN_STR_RE = re.compile(r"[̀-ͯ]")


def _clean_str(s) -> str:
    if not s:
        return ""
    normalized = unicodedata.normalize("NFD", str(s))
    return _CLEAN_STR_RE.sub("", normalized).upper().strip()


async def _calendarios_con_credenciales() -> set[str]:
    """calendar_id que sí tienen refresh_token guardado -- ver
    oauth_store.py. Se usa para que el fallback de `definir_agenda` nunca
    elija a un reclutador cuyo calendario todavía no está autorizado
    (visto en producción: el fallback caía en el reclutador creado más
    recientemente sin importar si ya tenía OAuth hecho, y `revisar_calendario`
    tronaba con CredencialesNoEncontradas)."""
    pool = get_pool()
    try:
        rows = await pool.fetch("SELECT calendar_id FROM google_calendar_credentials")
        return {r["calendar_id"] for r in rows}
    except Exception:
        logger.exception("_calendarios_con_credenciales: query falló")
        return set()


def _reclutador_asignado(
    equipo: list[dict], asignado_a_id: str | None, calendarios_ok: set[str]
) -> dict | None:
    """El reclutador que la plataforma ya tiene asignado al candidato
    (`candidatos.asignado_a_id`), siempre que siga activo y con calendario
    autorizado. Devuelve None si no aplica, para que el llamador siga con su
    lógica normal."""
    if not asignado_a_id:
        return None
    return next(
        (
            r for r in equipo
            if str(r.get("reclutador_id")) == str(asignado_a_id)
            and (r.get("calendar_id") or "").strip() in calendarios_ok
        ),
        None,
    )


def _elegir_gerente(equipo: list[dict], calendarios_ok: set[str]) -> dict:
    """Elige un reclutador de respaldo determinista para cuando no hay
    match de vacante, en vez del `equipo[-1]` original (el reclutador
    creado más recientemente, arbitrario -- podía no tener ni siquiera
    OAuth configurado). Orden de preferencia:
    1. Reclutador explícitamente marcado como 'Gerente de Reclutamiento'.
    2. Entre los que SÍ tienen credenciales de calendario: el ENCARGADO
       del equipo (jefe de grupo real, ver usuarios.rol) si existe, si no
       el primero por antigüedad (equipo ya viene ordenado por
       created_at ASC desde /api/db/reclutador_vacantes).
    3. Si NINGUNO tiene credenciales todavía, el primero por antigüedad
       de todos modos (mismo comportamiento de antes, para no romper si
       el equipo entero está sin autorizar) -- pero esto queda registrado
       como warning para que se note en logs."""
    explicito = next((r for r in equipo if r.get("nombre") == "Gerente de Reclutamiento"), None)
    if explicito:
        return explicito

    con_calendario = [r for r in equipo if (r.get("calendar_id") or "").strip() in calendarios_ok]
    if con_calendario:
        encargado = next((r for r in con_calendario if r.get("es_encargado")), None)
        return encargado or con_calendario[0]

    if equipo:
        logger.warning("_elegir_gerente: ningun reclutador del equipo tiene OAuth de calendario configurado")
        return equipo[0]

    return {"nombre": "Gerente de Reclutamiento", "telefono": "5213332012658", "calendar_id": "talreclutamiento01@gmail.com"}


async def definir_agenda(
    nave_interes: str | None,
    vacante_interes: str | None,
    empresa_id: str | None,
    asignado_a_id: str | None = None,
) -> dict:
    """Puerto de 'DefinirAgenda': resuelve el/los reclutadores candidatos
    para esta vacante/nave vía GET /api/db/reclutador_vacantes (ya
    existe, no se reimplementa la lógica de asignación en Python).

    `asignado_a_id` es el reclutador que la plataforma ya tiene asignado al
    candidato (`candidatos.asignado_a_id`). Se respeta cuando la vacante no
    se puede resolver, en vez de irse al reclutador de respaldo: en
    producción un candidato con MICHELLE asignada terminó agendado con el
    "Equipo de Reclutamiento" porque su `vacante_interes` quedó en
    'General' -- el CRM decía una cosa y el calendario otra."""
    nave_actual = (nave_interes or "").strip() or "1"
    vacante = (vacante_interes or "General").strip()

    equipo: list[dict] = []
    try:
        url = f"{ENV.FRONTEND_API_BASE}/api/db/reclutador_vacantes"
        params = {"empresa_id": empresa_id} if empresa_id else {}
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, params=params, headers=auth_headers())
            if resp.status_code == 200:
                equipo = resp.json()
                if not isinstance(equipo, list):
                    equipo = []
    except Exception:
        logger.exception("definir_agenda: fetch reclutador_vacantes falló, usando fallback")
        equipo = [{
            "nombre": "Gerente de Reclutamiento", "emoji": "🚨", "telefono": "5213332012658",
            "calendar_id": "talreclutamiento01@gmail.com", "naves": ["1", "2", "3"], "vacantes": [],
        }]

    calendarios_ok = await _calendarios_con_credenciales()
    gerente = _elegir_gerente(equipo, calendarios_ok)

    default_calendar = (gerente.get("calendar_id") or "").strip() or "talreclutamiento01@gmail.com"

    vacante_clean = _clean_str(vacante)
    vacante_desconocida = not vacante_clean or vacante_clean == "GENERAL"

    def _agenda_de(rec: dict) -> dict:
        return {
            "nombre_reclutador": rec.get("nombre") or "Equipo de Reclutamiento",
            "telefono_reclutador": rec.get("telefono") or "5213323379399",
            "calendar_id": (rec.get("calendar_id") or "").strip() or default_calendar,
            "vacante_detectada": vacante,
            "nave_candidato": nave_actual,
            "grupo_turno": None,
            "turno_total": 1,
            "candidatos_turno": None,
        }

    if vacante_desconocida:
        # Antes de caer al respaldo: si la plataforma ya le asignó un
        # reclutador a este candidato y ese reclutador tiene calendario
        # autorizado, la cita le corresponde a él.
        asignado = _reclutador_asignado(equipo, asignado_a_id, calendarios_ok)
        if asignado:
            return _agenda_de(asignado)
        logger.warning(
            "definir_agenda: vacante desconocida (%r) y sin reclutador asignado usable -- usando respaldo %r",
            vacante, gerente.get("nombre"),
        )
        # Se devuelve el nombre REAL del reclutador de respaldo, no un
        # "Equipo de Reclutamiento" genérico: la cita se crea en SU calendario,
        # así que es a esa persona a quien tiene que preguntar el candidato al
        # llegar. Decirle un nombre abstracto dejaba a recepción sin saber a
        # quién llamar.
        return _agenda_de(gerente)

    def _matches(r: dict) -> bool:
        # Solo se excluye al "Gerente de Reclutamiento" explícito, que es una
        # figura de escalamiento y no atiende vacantes. Antes se excluía a
        # QUIEN hiciera de respaldo, y como el respaldo se elige entre los
        # reclutadores reales, esa persona nunca recibía candidatos por su
        # propia vacante: con dos reclutadores compartiendo una vacante, el
        # turno rotativo no repartía nada y todo caía en el otro.
        if r.get("nombre") == "Gerente de Reclutamiento":
            return False
        vacantes = r.get("vacantes") or []
        if not vacantes:
            return False
        for v in vacantes:
            v_nombre_clean = _clean_str(v.get("nombre"))
            v_id_clean = _clean_str(v.get("id"))
            match_vacante = (
                (v_id_clean and v_id_clean == vacante_clean)
                or (v_nombre_clean and v_nombre_clean == vacante_clean)
                or (v_nombre_clean and vacante_clean and (vacante_clean in v_nombre_clean or v_nombre_clean in vacante_clean))
            )
            if not match_vacante:
                continue
            naves_vacante = v.get("naves") or ([v["nave"]] if v.get("nave") else [])
            if not naves_vacante:
                return True
            nave_clean = _clean_str(nave_actual)
            if not nave_clean or nave_clean in ("1", "GENERAL", "PENDIENTE"):
                return True
            for n in naves_vacante:
                n_clean = _clean_str(n)
                if n_clean == nave_clean or nave_clean in n_clean or n_clean in nave_clean:
                    return True
        return False

    matches = [r for r in equipo if _matches(r)]

    if not matches:
        # La vacante no corresponde a nadie (nombre que no está en el catálogo,
        # o no existe en la nave del candidato). Antes se caía directo al
        # respaldo, ignorando que la plataforma ya le había asignado un
        # reclutador a este candidato: el CRM decía una cosa y la cita se
        # agendaba con otra persona. Se respeta al asignado siempre que tenga
        # calendario autorizado.
        asignado = _reclutador_asignado(equipo, asignado_a_id, calendarios_ok)
        if asignado:
            logger.info(
                "definir_agenda: vacante %r sin dueño; se respeta el reclutador ya asignado (%s)",
                vacante, asignado.get("nombre"),
            )
            return _agenda_de(asignado)
        logger.warning(
            "definir_agenda: vacante %r no corresponde a ningún reclutador -- usando respaldo %r",
            vacante, gerente.get("nombre"),
        )

    candidatos = matches if matches else [gerente]

    if len(candidatos) == 1:
        cand = candidatos[0]
        return {
            "nombre_reclutador": cand.get("nombre") or "Equipo de Reclutamiento",
            "telefono_reclutador": cand.get("telefono") or "5213323379399",
            "calendar_id": (cand.get("calendar_id") or "").strip() or default_calendar,
            "vacante_detectada": vacante,
            "nave_candidato": nave_actual,
            "grupo_turno": None,
            "turno_total": 1,
            "candidatos_turno": None,
        }

    grupo_key = "|".join(sorted(r.get("nombre", "") for r in candidatos))[:100]
    return {
        "vacante_detectada": vacante,
        "nave_candidato": nave_actual,
        "grupo_turno": grupo_key,
        "turno_total": len(candidatos),
        "candidatos_turno": json.dumps([
            {
                "nombre": r.get("nombre") or "Reclutador",
                "telefono": r.get("telefono") or "5213323379399",
                "calendar_id": (r.get("calendar_id") or "").strip() or default_calendar,
                "emoji": r.get("emoji") or "📅",
            }
            for r in candidatos
        ]),
    }


# --- CargarPrompt ------------------------------------------------------------

_DIAS_ES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
_MESES_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]

_ESTADOS_SIN_CATALOGO = {"CITA_AGENDADA", "DOCUMENTOS_NO_COINCIDEN", "INE_VALIDADA"}


def _formatear_fecha_hora_larga(dt: datetime) -> str:
    dia = _DIAS_ES[dt.weekday()]
    mes = _MESES_ES[dt.month - 1]
    hora12 = dt.hour % 12 or 12
    ampm = "a. m." if dt.hour < 12 else "p. m."
    return f"{dia}, {dt.day} de {mes} de {dt.year}, {hora12}:{dt.minute:02d} {ampm}"


def _formatear_fecha_corta(dt: datetime) -> str:
    dia = _DIAS_ES[dt.weekday()]
    mes = _MESES_ES[dt.month - 1]
    return f"{dia}, {dt.day} de {mes}"


def _extraer_seccion_nave(texto: str, nave: str) -> str:
    if not texto:
        return texto
    pattern = re.compile(r"--- SUCURSAL " + re.escape(nave) + r":.*?---\n([\s\S]*?)(?=--- SUCURSAL|$)")
    m = pattern.search(texto)
    return m.group(1).strip() if m else texto


def _leer_prompt_archivo() -> str:
    """Plantilla global en disco (virgo_data/prompts/chat_prompt.md). Es el
    respaldo cuando la empresa no tiene un prompt propio configurado."""
    prompt_path = os.path.join(ENV.VIRGO_FILES_DIR, "prompts", "chat_prompt.md")
    try:
        with open(prompt_path, "r", encoding="utf-8") as f:
            return f.read()
    except OSError:
        logger.exception("cargar_prompt: no se pudo leer %s", prompt_path)
        return ""


async def cargar_prompt(webhook_payload: dict, contacto: dict, candidato: dict) -> str:
    """Puerto de 'CargarPrompt'. La base sale de `prompt_base` del contexto
    -- que es `empresas.prompt_ia` cuando la empresa tiene uno configurado
    en el panel, y si no la plantilla global del archivo -- y el catálogo de
    obtener_prompt_context().

    Antes se leía el archivo directo y `prompt_base` se ignoraba, así que
    editar el prompt desde el CRM no tenía ningún efecto sobre el bot: la
    pantalla guardaba en la BD y el agente seguía con el archivo."""
    dbData = candidato or {}

    nave_actual = dbData.get("nave_interes") or "Pendiente"
    estado_actual = dbData.get("estado") or "NUEVO"

    now_mx = datetime.now(_MX_TZ)
    fecha_actual = _formatear_fecha_hora_larga(now_mx)
    anio_actual = now_mx.year
    manana = now_mx + timedelta(days=1)
    fecha_manana = _formatear_fecha_corta(manana)

    ctx = await obtener_prompt_context(dbData.get("empresa_id"))

    prompt_cand = (ctx.get("prompt_base") or "").strip()
    if not prompt_cand or prompt_cand.startswith("Error:"):
        prompt = _leer_prompt_archivo()
    else:
        prompt = prompt_cand

    menu_naves_txt = ""
    menu_txt = ""
    detalle_txt = ""

    necesita_catalogo = estado_actual not in _ESTADOS_SIN_CATALOGO
    if necesita_catalogo:
        menu_naves_txt = ctx.get("menu_naves") or ""
        menu_txt = ctx.get("menu_vacantes") or ""
        detalle_txt = ctx.get("detalle_vacantes") or ""
        if nave_actual and nave_actual != "Pendiente":
            menu_txt = _extraer_seccion_nave(menu_txt, str(nave_actual))
            detalle_txt = _extraer_seccion_nave(detalle_txt, str(nave_actual))
    else:
        menu_naves_txt = menu_txt = detalle_txt = "[Catalogo omitido: no aplica en esta etapa del proceso]"

    if not menu_txt:
        menu_txt = "No hay vacantes en ninguna sucursal por el momento."
    if not detalle_txt:
        detalle_txt = "Informacion no disponible."

    nombre_real = dbData.get("nombre_chat") or dbData.get("nombre_ine") or dbData.get("nombre_solicitud") or "Desconocido"
    if nombre_real in ("Candidato", "No registrado"):
        nombre_real = "Desconocido"

    semaforo_ine = "PENDIENTE"
    if dbData.get("nombre_confirmado") is True or dbData.get("estado") == "INE_VALIDADA" or dbData.get("cv_manual"):
        semaforo_ine = "VERIFICADO"

    replacements = {
        "NOMBRE_WHATSAPP": ((webhook_payload.get("_data") or {}).get("notifyName")) or "Usuario",
        "TELEFONO_ID": contacto.get("number") or "000",
        "NAVE_ACTUAL": nave_actual,
        "MENU_NAVES": menu_naves_txt,
        "MENU_VACANTES": menu_txt,
        "DETALLE_VACANTES": detalle_txt,
        "FECHA_HORA_ACTUAL": fecha_actual,
        "FECHA_MANANA": fecha_manana,
        "ANIO_ACTUAL": str(anio_actual),
        "STATUS_INE": semaforo_ine,
        "NOMBRE_REGISTRADO": nombre_real,
        "LUGAR_RESIDENCIA": dbData.get("lugar_residencia") or "Pendiente",
        "ESTADO_ACTUAL": estado_actual,
        "VACANTE_INTERES": dbData.get("vacante_interes") or "Ninguna",
        "RESUMEN_ANTERIOR": dbData.get("resumen_ia") or "Conversacion nueva.",
    }
    for key, value in replacements.items():
        prompt = prompt.replace(_PLACEHOLDER_RE_TEMPLATE.format(name=key), str(value))

    return prompt


# --- Orquestador de esta oleada ---------------------------------------------

async def analizar_mensaje(webhook_payload: dict, contacto: dict, candidato: dict, empresa_id: str | None = None) -> dict:
    """Punto de entrada de este módulo: clasifica el mensaje, llama a
    Gemini si hace falta, sube/actualiza expediente si aplica. Devuelve
    un dict con `mensaje_para_agente` (lo que verá el agente de chat en
    lugar del texto crudo del usuario cuando hay media) y `detuvo_flujo`
    (True si ya se mandó una respuesta final -- p.ej. rechazo de Word --
    y no debe continuar hacia el agente)."""
    tipo = clasificar_media(webhook_payload)
    session = webhook_payload.get("session") or "default"
    chat_id = f"{contacto.get('number')}@c.us"
    telefono = contacto.get("number")

    if tipo == "texto":
        # Puerto de 'Escribiendo...': en n8n mandaba el indicador con
        # session="default" fijo (no la session dinámica del webhook) en
        # la rama de solo texto.
        await waha_client.start_typing("default", chat_id)
        return {"mensaje_para_agente": None, "detuvo_flujo": False}

    # Puerto de 'Escribiendo...1': aquí sí usa la session real del webhook.
    await waha_client.start_typing(session, chat_id)

    if tipo == "word":
        await waha_client.send_text(
            session, chat_id,
            "😅Veo que me enviaste un documento de Word. Por estrictas políticas de ciberseguridad, mi sistema "
            "corporativo no me permite abrir este tipo de archivos. \n\n🛡️*¿Podrías apoyarme guardando tu documento "
            "como PDF o simplemente tomándole una Fotografía clara 📸 y volviéndolo a enviar por aquí, por favor? "
            "¡Gracias! ✨",
        )
        return {"mensaje_para_agente": None, "detuvo_flujo": True}

    media_url = (webhook_payload.get("media") or {}).get("url")
    if not media_url:
        return {"mensaje_para_agente": None, "detuvo_flujo": False}

    data, mime_type = await waha_client.download_media(media_url)

    if tipo == "audio":
        texto_transcrito = await gemini_client.transcribir_audio(data, "audio/ogg")
        return {"mensaje_para_agente": texto_transcrito, "detuvo_flujo": False}

    # tipo == "documento"
    vacante_interes = (candidato or {}).get("vacante_interes") or "General"
    detalle_vacantes = await obtener_detalle_vacantes((candidato or {}).get("nave_interes"), empresa_id)
    prompt = _ANALYZE_DOCUMENT_PROMPT_TEMPLATE.format(detalle_vacantes=detalle_vacantes, vacante_interes=vacante_interes)
    gemini_text = await gemini_client.analizar_documento(data, mime_type, prompt)

    caption_usuario = webhook_payload.get("body") or ""
    nombre_whatsapp = (webhook_payload.get("_data") or {}).get("notifyName") or "Candidato"
    resultado = separar_json(gemini_text, telefono, nombre_whatsapp, caption_usuario, candidato)

    mensaje_para_agente = resultado["mensaje_usuario"]

    if resultado["tipo_origen"] != "INVALIDO":
        link_cv = None
        try:
            link_cv = await subir_cv(telefono, data, mime_type)
        except Exception:
            logger.exception("analizar_mensaje: subir_cv falló para telefono=%s", telefono)

        try:
            await actualizar_expediente({
                "telefono": telefono,
                "nombre": resultado["nombre"],
                "vacante": resultado["vacante_anuncio"],
                "tipo_origen": resultado["tipo_origen"],
                "experiencia": resultado["experiencia"],
                "mensaje_usuario": resultado["mensaje_usuario"],
                "datos_documento": json.dumps(resultado["cv_manual"]) if resultado.get("cv_manual") else None,
                "veredicto": resultado["veredicto"],
                "motivo": resultado["motivo"],
                "link_cv": link_cv,
                "nombre_chat": resultado["nombre_chat"],
                "edad": resultado["edad_calculada"],
                "correo": resultado["correo"],
                "filtros_tecnicos": None,
                "identidad_bloqueada": "true" if resultado["identidad_bloqueada"] else "false",
                "identidad_alerta": "true" if resultado["identidad_alerta"] else "false",
                "identidad_motivo": resultado["identidad_motivo"],
                "curp_ine": resultado["curp_ine"],
                "curp_rfc": resultado["curp_rfc"],
            })
        except Exception:
            logger.exception("analizar_mensaje: actualizar_expediente falló para telefono=%s", telefono)
    else:
        mensaje_para_agente = (
            "[NOTA INTERNA: El usuario te acaba de mandar una imagen irrelevante (un meme, un sticker, una selfie, "
            "su mascota, etc.) en lugar de su documento. ¡Reacciona como humana! Ríete un poco (ej. '¡Ay! jaja' o "
            "'¡Qué buen sticker!') y dile en tono súper casual que crees que se equivocó porque ahí no ves sus "
            f"datos. OJO, el usuario también escribió este texto junto a la imagen: '{caption_usuario}'. Responde "
            "a su texto de forma natural y luego pídele amablemente que te mande la de su INE o CV para poder "
            "avanzar.]"
        )

    return {"mensaje_para_agente": mensaje_para_agente, "detuvo_flujo": False}
