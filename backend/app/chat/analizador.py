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
from app.chat.mensajes_comunes import DESCALIFICACION_CIUDAD_MSG
from app.chat.vacantes import es_placeholder_vacante, limpiar_vacante
from app.internal_api import auth_headers
from app.utils.fechas_es import DIAS_ES, MESES_ES

logger = logging.getLogger("analizador")

_MX_TZ = ZoneInfo("America/Mexico_City")

_ANALYZE_DOCUMENT_PROMPT_TEMPLATE = """Eres el Reclutador Experto de Grupo Virgo y, por encima de todo, un ANALISTA DE SEGURIDAD Y VALIDACIÓN DE DOCUMENTOS.
Tu prioridad es doble y en este orden:
1. Rechazar con firmeza cualquier meme, personaje de ficción, animal, objeto o imagen que claramente NO sea un intento de documento oficial.
2. Ser MUY TOLERANTE con fotos reales de documentos reales que tengan problemas de calidad. Una foto imperfecta de un documento real NO es lo mismo que un documento falso — NO las trates igual.

ℹ️ NOTA MULTI-FOTO / MULTI-PÁGINA:
El candidato puede enviarte 1, 2 o más fotos o páginas en este turno (por ejemplo: Frente y Reverso de su INE, dos caras de su Solicitud de empleo, o su INE y su Constancia de Situación Fiscal RFC juntos).
Analiza e integra TODAS las imágenes adjuntas en conjunto para extraer y validar la información completa.

REGLA DE ORO: Si puedes leer el nombre de la persona Y al menos un dato más (número de credencial, CURP, RFC, texto institucional, foto de rostro humano), clasifica como VALIDO aunque la foto no sea perfecta. La calidad imperfecta de la foto NO es motivo suficiente para REVISAR_MANUAL si los datos clave son legibles.
Catálogo completo de vacantes disponibles:
{detalle_vacantes}
💼 LA VACANTE QUE EL CANDIDATO SOLICITÓ ES: {vacante_interes}
--- NORMAS DE VALIDACIÓN ---
1. INE (Credencial de Elector Mexicana):
   - Puede enviarse solo el Frente, o Frente + Reverso en fotos separadas.
   - Marcadores: (a) texto "Instituto Nacional Electoral"/"INE"/"Elector" aunque sea parcial, (b) fotografía de un rostro humano real, (c) estructura típica de credencial, (d) reverso con código de barras/firma/OCR/CIC.
   - VALIDO: si se lee el nombre y la CURP o clave de elector. Si vienen frente y reverso, úsalos para validar la credencial de forma completa.
   - REVISAR_MANUAL: se intuye claramente que es una INE (hay foto de rostro + algo de estructura) pero el nombre es completamente ilegible por calidad de foto muy baja.
   - INVALIDO: es evidentemente un personaje de ficción, animal, objeto, meme, sticker, o no hay NINGÚN marcador de credencial oficial.
2. CONSTANCIA (Constancia de Situación Fiscal / Cédula de Identificación Fiscal del SAT):
   - Marcadores: (a) mención de "SAT", "Hacienda", "Situación Fiscal" o "Cédula de Identificación Fiscal", (b) un RFC con formato reconocible, (c) estructura de documento oficial.
   - VALIDO: cumple 2 de 3 marcadores. RFC parcialmente legible + membrete del SAT = VALIDO.
   - REVISAR_MANUAL: claramente es un documento del SAT pero el RFC es completamente ilegible.
   - INVALIDO: hoja en blanco, objeto random, personaje de ficción, o ningún marcador presente.
3. AMBOS_DOCS (Si en las imágenes adjuntas vienen TANTO la INE COMO la Constancia/RFC del SAT):
   - Extrae el nombre, la CURP de la INE, y el RFC y la CURP de la Constancia.
   - Clasifica tipo_documento como "AMBOS_DOCS".
4. SOLICITUD (Formato preimpreso de papelería, frente o 2 caras):
   - Marcadores: (a) estructura de formulario preimpreso con cuadrículas, (b) texto manuscrito rellenando el formato, (c) se lee o se intuye "Solicitud de Empleo" o similar.
   - VALIDO/REVISAR_MANUAL/INVALIDO con la misma lógica: si los datos básicos son legibles = VALIDO.
5. CV (Currículum Vitae digital o impreso, 1 o varias páginas):
   - Marcadores: (a) estructura de CV (secciones tipo Experiencia/Educación/Habilidades), (b) texto técnico legible, (c) datos de contacto visibles.
   - VALIDO si se pueden leer al menos nombre + una sección de contenido.
6. ANUNCIO: cartel o captura de pantalla ofreciendo una vacante con sueldo/requisitos — clasificación directa, sin candado de calidad.
⛔ REGLA DE ORO DE RECHAZO: memes, capturas de series/películas, personajes de caricatura, animales, objetos, paisajes, comida, o imágenes totalmente ilegibles donde NO hay ningún intento reconocible de documento oficial → INVALIDO siempre, sin excepción.
✅ REGLA ANTI-BUCLE: Si ya clasificaste este tipo de documento como REVISAR_MANUAL anteriormente para este candidato, en esta segunda oportunidad clasifica como VALIDO si hay cualquier dato legible. No pidas la foto más de una vez por tipo de documento.
--- FORMATO DE SALIDA (JSON ESTRICTO, sin bloques de código) ---
{{
  "tipo_documento": "INE, CV, SOLICITUD, ANUNCIO, CONSTANCIA, AMBOS_DOCS o INVALIDO",
  "estado_validacion": "VALIDO, REVISAR_MANUAL o INVALIDO",
  "calidad_imagen": "buena, borrosa, oscura, reflejo, recortada, ilegible o null",
  "nombre_completo": "Si es visible aunque sea parcialmente. Si es INVALIDO, null.",
  "correo": "Visible en CV/Solicitud. Si no, null.",
  "institucion": "SAT, INE, SOLICITUD o null.",
  "clave_elector": "Visible en INE. Si no, null.",
  "curp": "Visible en INE/Constancia. OBLIGATORIO: La CURP mexicana DEBE contener EXACTAMENTE 18 caracteres alfanuméricos. Si lees más de 18 caracteres, revisa con cuidado y ajusta solo a los 18 caracteres oficiales.",
  "rfc": "Visible en Constancia/RFC. Si no, null.",
  "curp_rfc": "Si envió Constancia/RFC y la CURP es visible en ella, colócala aquí. Si no, null.",
  "veredicto": "VIABLE, CARTERA_GENERAL, RECHAZADO o null (sobre el perfil del candidato en CV/Solicitud, NO sobre autenticidad del documento)",
  "experiencia": "Visible en CV/Solicitud. Si no, null.",
  "motivo": "Explica brevemente el estado_validacion, sobre todo si es REVISAR_MANUAL o INVALIDO.",
  "mensaje_usuario": "Aquí va el mensaje según las reglas de abajo (si aplica).",
  "archivos": [
    {{"indice": 1, "tipo": "INE_FRENTE"}},
    {{"indice": 2, "tipo": "CONSTANCIA_FISCAL"}}
  ]
}}
--- CLASIFICACIÓN ARCHIVO POR ARCHIVO (OBLIGATORIA) ---
Además del `tipo_documento` global, devuelve SIEMPRE el arreglo "archivos" con EXACTAMENTE UNA entrada por cada imagen o PDF adjunto en este turno.
`indice` empieza en 1 y respeta el orden en que se te adjuntaron los archivos. `tipo` debe ser uno de estos valores, sin inventar otros:
- INE_FRENTE / INE_REVERSO: las dos caras de la credencial de elector.
- CONSTANCIA_FISCAL: Constancia de Situación Fiscal o Cédula de Identificación Fiscal del SAT.
- CV: currículum. SOLICITUD: formato de solicitud de empleo.
- ACTA_NACIMIENTO, CURP, IMSS, COMPROBANTE_DOMICILIO, COMPROBANTE_ESTUDIOS, ANTECEDENTES_PENALES: otros documentos personales.
- ANUNCIO: cartel o CAPTURA DE PANTALLA de la oferta de empleo (Facebook, WhatsApp, la vacante publicada). No es un documento del candidato.
- IRRELEVANTE: meme, sticker, selfie, mascota, paisaje, captura sin ningún documento.
Los archivos marcados ANUNCIO o IRRELEVANTE NO se guardan en el expediente, así que úsalos sin miedo: es preferible marcar una captura del anuncio como ANUNCIO que archivarla como si fuera un documento.
Si un PDF trae varias páginas de distinto tipo, clasifícalo por lo que predomine.
--- REGLAS DE MENSAJES (mensaje_usuario) ---
1. Si estado_validacion es INVALIDO (documento evidentemente falso/broma): "¡Hola! Oye, estuve revisando la foto que me enviaste pero fíjate que no pude identificarla como un documento oficial válido (INE, RFC o Solicitud). 🧐 ¿Podrías apoyarme mandando de nuevo una foto clara de tu documento real por favor? ¡Así podré agilizar tu trámite! 😊"
2. Si estado_validacion es REVISAR_MANUAL (foto muy baja calidad, datos clave ilegibles): "¡Gracias por la foto! 📸 Solo que no logro leer bien los datos porque se ve muy [usa calidad_imagen: borrosa/oscura/con reflejo/recortada]. ¿Me la puedes mandar de nuevo con buena luz y que se vea el documento completo? Es la última vez que te la pido, prometo que con eso es suficiente. 🙏"
3. Si estado_validacion es VALIDO y el veredicto es VIABLE/CARTERA_GENERAL/RECHAZADO: mantén tus reglas de mensajes estándar para CV y Solicitudes.
4. Si el documento es CONSTANCIA (SAT), INE o AMBOS_DOCS con estado_validacion VALIDO: pon null en el mensaje, el sistema se encargará."""

# El prompt vivo (empresas.prompt_ia) escribe los placeholders con llave
# doble -- `{{VACANTE_INTERES}}` -- pero esta plantilla generaba el patrón
# con UNA sola llave, así que el replace sólo se comía el par interno y
# dejaba las externas: la ficha del candidato terminaba diciendo
# `| Vacante | {Ninguna} |` y el modelo copiaba ese `{Ninguna}` literal de
# vuelta en `actualizar_vacante`. Se acepta cualquiera de las dos formas
# para no depender de cómo esté escrito el prompt de cada empresa.
_PLACEHOLDER_RE_CACHE: dict[str, re.Pattern[str]] = {}


def _placeholder_re(name: str) -> re.Pattern[str]:
    patron = _PLACEHOLDER_RE_CACHE.get(name)
    if patron is None:
        patron = re.compile(r"\{\{?" + re.escape(name) + r"\}\}?")
        _PLACEHOLDER_RE_CACHE[name] = patron
    return patron


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


# --- Clasificación archivo por archivo --------------------------------------

# Gemini clasifica CADA adjunto del turno, no solo el "tipo de documento"
# global: un candidato manda en la misma tanda su INE, su Constancia, su acta y
# el pantallazo del anuncio, y antes los 10 archivos se guardaban bajo la misma
# etiqueta (el expediente acababa mostrando la misma lista repetida como "INE" y
# como "Constancia").
ETIQUETAS_ARCHIVO = {
    "INE_FRENTE": "INE — frente",
    "INE_REVERSO": "INE — reverso",
    "CONSTANCIA_FISCAL": "Constancia de Situación Fiscal",
    "CV": "Currículum",
    "SOLICITUD": "Solicitud de empleo",
    "ACTA_NACIMIENTO": "Acta de nacimiento",
    "CURP": "Constancia de CURP",
    "IMSS": "Documento del IMSS",
    "COMPROBANTE_DOMICILIO": "Comprobante de domicilio",
    "COMPROBANTE_ESTUDIOS": "Comprobante de estudios",
    "ANTECEDENTES_PENALES": "Carta de no antecedentes penales",
    "ANUNCIO": "Captura del anuncio",
    "OTRO": "Documento sin identificar",
}

# Lo que NO se archiva: la captura del anuncio de la vacante (Facebook Ads,
# WhatsApp, el cartel de la oferta) y la basura (memes, stickers, selfies). No
# son documentos del candidato, no se consultan nunca desde el expediente y
# llenaban /uploads de pantallazos.
TIPOS_ARCHIVO_DESCARTABLES = {"ANUNCIO", "IRRELEVANTE"}

_ALIAS_TIPO_ARCHIVO = {
    "INE": "INE_FRENTE",
    "INE_ANVERSO": "INE_FRENTE",
    "CONSTANCIA": "CONSTANCIA_FISCAL",
    "CSF": "CONSTANCIA_FISCAL",
    "RFC": "CONSTANCIA_FISCAL",
    "SAT": "CONSTANCIA_FISCAL",
    "ACTA": "ACTA_NACIMIENTO",
    "INVALIDO": "IRRELEVANTE",
    "MEME": "IRRELEVANTE",
}


def normalizar_tipo_archivo(raw: object) -> str:
    tipo = str(raw or "").strip().upper()
    if tipo in TIPOS_ARCHIVO_DESCARTABLES or tipo in ETIQUETAS_ARCHIVO:
        return tipo
    return _ALIAS_TIPO_ARCHIVO.get(tipo, "OTRO")


def _tipos_por_documento_global(tipo_documento: str, total: int) -> list[str]:
    """Respaldo cuando Gemini no devuelve el arreglo `archivos`: se reparte el
    `tipo_documento` global entre los adjuntos, como se hacía antes."""
    tipo = (tipo_documento or "").upper()
    if tipo == "ANUNCIO":
        return ["ANUNCIO"] * total
    if tipo == "INVALIDO":
        return ["IRRELEVANTE"] * total
    if tipo == "INE":
        return ["INE_FRENTE" if i == 0 else "INE_REVERSO" for i in range(total)]
    if tipo in ("CONSTANCIA", "CSF", "RFC", "SAT"):
        return ["CONSTANCIA_FISCAL"] * total
    if tipo in ("CV", "SOLICITUD"):
        return [tipo] * total
    # AMBOS_DOCS y cualquier otro: no se puede saber cuál archivo es cuál, pero
    # tampoco se descarta ninguno.
    return ["OTRO"] * total


def clasificar_archivos(datos: dict, total: int) -> list[str]:
    """Un tipo por adjunto, en el mismo orden en que se le mandaron a Gemini."""
    if total <= 0:
        return []
    tipos = _tipos_por_documento_global(datos.get("tipo_documento") or "", total)
    for entrada in datos.get("archivos") or []:
        if not isinstance(entrada, dict):
            continue
        try:
            idx = int(entrada.get("indice")) - 1
        except (TypeError, ValueError):
            continue
        if 0 <= idx < total:
            tipos[idx] = normalizar_tipo_archivo(entrada.get("tipo"))
    return tipos


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


# RFC de persona física: 4 letras + AAMMDD + 3 de homoclave. Sus primeros 10
# caracteres son, por construcción, los mismos 10 primeros de la CURP.
_RFC_PERSONA_FISICA_RE = re.compile(r"^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$")
_CURP_RE = re.compile(r"^[A-Z0-9]{18}$")


def _es_rfc_del_mismo_titular(a: str, b: str) -> bool:
    """True si uno de los dos valores es la CURP y el otro el RFC de la MISMA
    persona (mismos 10 caracteres de raíz).

    La Constancia de Situación Fiscal muestra el RFC y la CURP juntos, y Gemini
    a veces copia el RFC en el campo `curp_rfc`. Comparado contra la CURP del
    INE eso daba una distancia enorme y el candidato acababa marcado como
    "documentos que no coinciden" siendo la misma persona -- bloqueado sin poder
    agendar (visto en producción el 19/08/2026).
    """
    curp, rfc = (a, b) if _CURP_RE.match(a) else (b, a)
    if not _CURP_RE.match(curp) or not _RFC_PERSONA_FISICA_RE.match(rfc):
        return False
    return curp[:10] == rfc[:10]


def _evaluar_curps(c1_raw: str | None, c2_raw: str | None) -> dict:
    if not c1_raw or not c2_raw:
        return {"tipo": "OK"}
    c1 = re.sub(r"[^A-Z0-9]", "", str(c1_raw).upper())
    c2 = re.sub(r"[^A-Z0-9]", "", str(c2_raw).upper())
    if not c1 or not c2:
        return {"tipo": "OK"}
    if c1 == c2:
        return {"tipo": "OK"}
    if _es_rfc_del_mismo_titular(c1, c2):
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

def separar_json(
    gemini_text: str,
    telefono: str,
    nombre_whatsapp: str,
    caption_usuario: str,
    candidato: dict,
    total_archivos: int = 0,
) -> dict:
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
                "El candidato acaba de enviar su solicitud de empleo. Agradécele e indícale "
                "que si tiene parte trasera la envíe, o si ya mandó ambas caras responda 'Listo'."
            )
        elif tipo == "ANUNCIO":
            msg_usuario = f'[SISTEMA: El candidato te envió una captura de pantalla del anuncio de la vacante: *{vacante_anuncio}*.'
            if caption_usuario:
                msg_usuario += f' Además, escribió este mensaje: "{caption_usuario}".'
            msg_usuario += " OBLIGATORIO: Atiéndelo de forma natural, asume que le interesa esa vacante y muéstrale los detalles o pregúntale si quiere aplicar.]"
        elif tipo == "AMBOS_DOCS":
            msg_usuario = "[SISTEMA: AMBOS DOCUMENTOS COMPLETOS. El candidato entregó INE y RFC simultáneamente. Revisa INMEDIATAMENTE tu calendario y ofrécele fechas de entrevista.]"
        elif tipo == "INE":
            if dbData.get("datos_rfc") or dbData.get("curp_rfc"):
                msg_usuario = "[SISTEMA: AMBOS DOCUMENTOS COMPLETOS. El candidato entregó INE y RFC. Revisa INMEDIATAMENTE tu calendario y ofrécele fechas de entrevista.]"
            else:
                msg_usuario = "[SISTEMA: El candidato entregó su INE, pero FALTA SU CONSTANCIA. Agradécele por el INE y pídele obligatoriamente su Constancia de Situación Fiscal (RFC). TIENES ESTRICTAMENTE PROHIBIDO AGENDAR CITA AÚN.]"
        elif tipo in ("CONSTANCIA", "CSF", "RFC"):
            if dbData.get("datos_ine") or dbData.get("curp_ine"):
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

    identidad_bloqueada = False
    identidad_alerta = False
    identidad_motivo = ""
    curp_eval = {"tipo": "OK"}
    curp_ine_salida = datos.get("curp") if tipo in ("INE", "AMBOS_DOCS") else None
    curp_rfc_salida = datos.get("curp_rfc") or (datos.get("curp") if tipo in ("CONSTANCIA", "CSF", "RFC") else None)

    if tipo == "AMBOS_DOCS":
        curp_ine_comp = curp_ine_salida
        curp_rfc_comp = curp_rfc_salida or dbData.get("curp_rfc")
        if curp_ine_comp and curp_rfc_comp:
            curp_eval = _evaluar_curps(curp_ine_comp, curp_rfc_comp)
    elif tipo == "INE" and dbData.get("curp_rfc") and datos.get("curp"):
        curp_eval = _evaluar_curps(datos.get("curp"), dbData.get("curp_rfc"))
    elif tipo in ("CONSTANCIA", "CSF", "RFC") and dbData.get("curp_ine") and datos.get("curp"):
        curp_eval = _evaluar_curps(datos.get("curp"), dbData.get("curp_ine"))

    if curp_eval["tipo"] == "REVISION_HUMANA":
        identidad_alerta = True
        identidad_motivo = (
            f"Diferencia menor en la CURP: INE ({curp_eval['c1']}) vs Constancia ({curp_eval['c2']}), "
            f"distancia de {curp_eval['distancia']} caracter(es). Posible error de OCR por calidad de foto — "
            "queda pendiente de revisión, pero el candidato puede seguir agendando su entrevista."
        )
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
        "clasificacion_archivos": clasificar_archivos(datos, total_archivos),
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
        asignado = _reclutador_asignado(equipo, asignado_a_id, calendarios_ok)
        if asignado:
            return _agenda_de(asignado)
        logger.warning(
            "definir_agenda: vacante desconocida (%r) y sin reclutador asignado usable -- usando respaldo %r",
            vacante, gerente.get("nombre"),
        )
        return _agenda_de(gerente)

    def _matches(r: dict) -> bool:
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

_ESTADOS_SIN_CATALOGO = {"CITA_AGENDADA", "DOCUMENTOS_NO_COINCIDEN", "INE_VALIDADA"}


def _formatear_fecha_hora_larga(dt: datetime) -> str:
    dia = DIAS_ES[dt.weekday()]
    mes = MESES_ES[dt.month - 1]
    hora12 = dt.hour % 12 or 12
    ampm = "a. m." if dt.hour < 12 else "p. m."
    return f"{dia}, {dt.day} de {mes} de {dt.year}, {hora12}:{dt.minute:02d} {ampm}"


def _formatear_fecha_corta(dt: datetime) -> str:
    dia = DIAS_ES[dt.weekday()]
    mes = MESES_ES[dt.month - 1]
    return f"{dia}, {dt.day} de {mes}"


def _extraer_seccion_nave(texto: str, nave: str) -> str:
    if not texto:
        return texto
    pattern = re.compile(r"--- SUCURSAL " + re.escape(nave) + r":.*?---\n([\s\S]*?)(?=--- SUCURSAL|$)")
    m = pattern.search(texto)
    return m.group(1).strip() if m else texto


def _leer_prompt_archivo() -> str:
    prompt_path = os.path.join(ENV.VIRGO_FILES_DIR, "prompts", "chat_prompt.md")
    try:
        with open(prompt_path, "r", encoding="utf-8") as f:
            return f.read()
    except OSError:
        logger.exception("cargar_prompt: no se pudo leer %s", prompt_path)
        return ""


async def cargar_prompt(webhook_payload: dict, contacto: dict, candidato: dict) -> str:
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

    nombre_candidato = dbData.get("nombre_chat") or dbData.get("nombre_ine") or dbData.get("nombre_solicitud") or dbData.get("nombre") or ""
    nombre_candidato = re.sub(r"[{}\[\]\"'|]", "", str(nombre_candidato)).strip()
    if not nombre_candidato or nombre_candidato.upper() in ("CANDIDATO", "DESCONOCIDO", "NO REGISTRADO", "PENDIENTE", "USUARIO", "SIN REGISTRAR", "NONE", "NULL"):
        notify_name = ((webhook_payload.get("_data") or {}).get("notifyName")) or ""
        notify_clean = re.sub(r"[{}\[\]\"'|]", "", str(notify_name)).strip()
        if notify_clean and not notify_clean.isdigit() and len(notify_clean) >= 2 and notify_clean.upper() not in ("USUARIO", "USER", "WHATSAPP"):
            nombre_real = notify_clean
        else:
            nombre_real = "Candidato"
    else:
        nombre_real = nombre_candidato

    semaforo_ine = "PENDIENTE"
    if dbData.get("estado") == "INE_VALIDADA" or dbData.get("curp_ine") or dbData.get("datos_ine"):
        semaforo_ine = "VERIFICADO"

    semaforo_privacidad = "ACEPTADA" if dbData.get("privacidad_aceptada") else "PENDIENTE"

    vacante_interes = limpiar_vacante(dbData.get("vacante_interes"))
    if es_placeholder_vacante(vacante_interes):
        vacante_interes = ""
        resumen_prev = dbData.get("resumen_ia") or ""
        vac_match = re.search(r'Vacante:\s*([^.\n|]+)', resumen_prev, re.IGNORECASE)
        if vac_match and vac_match.group(1):
            cand_vac = limpiar_vacante(vac_match.group(1)).upper()
            if not es_placeholder_vacante(cand_vac):
                vacante_interes = cand_vac

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
        "STATUS_PRIVACIDAD": semaforo_privacidad,
        "STATUS_INE": semaforo_ine,
        "NOMBRE_REGISTRADO": nombre_real,
        "LUGAR_RESIDENCIA": dbData.get("lugar_residencia") or "Pendiente",
        "ESTADO_ACTUAL": estado_actual,
        "VACANTE_INTERES": vacante_interes or "Ninguna",
        "RESUMEN_ANTERIOR": dbData.get("resumen_ia") or "Conversacion nueva.",
    }
    for key, value in replacements.items():
        # `re.sub` con una función de reemplazo: el valor puede traer barras
        # invertidas o `\g` (nombres, menús) que se interpretarían como
        # referencias de grupo si se pasara como string.
        prompt = _placeholder_re(key).sub(lambda _m, v=str(value): v, prompt)

    return prompt


_OUT_OF_STATE_CITIES_RE = re.compile(
    r'\b(?:CIUDAD JUÁREZ|CIUDAD JUAREZ|JUÁREZ|JUAREZ|CDMX|CIUDAD DE MÉXICO|CIUDAD DE MEXICO|'
    r'MONTERREY|TIJUANA|CHIHUAHUA|MICHOACÁN|MICHOACAN|SINALOA|SONORA|VERACRUZ|'
    r'PUEBLA|QUERÉTARO|QUERETARO|GUANAJUATO|LEÓN|LEON|SAN LUIS POTOSÍ|SAN LUIS POTOSI|'
    r'TABASCO|CHIAPAS|YUCATÁN|YUCATAN|QUINTANA ROO|CANCÚN|CANCUN|MÉRIDA|MERIDA|'
    r'TOLUCA|ESTADO DE MÉXICO|ESTADO DE MEXICO|EDOMEX|MORELIA|OAXACA|DURANGO|'
    r'COAHUILA|SALTILLO|TORREÓN|TORREON|TAMAULIPAS|REYNOSA|MATAMOROS|COLIMA)\b',
    re.IGNORECASE
)

def _detectar_ciudad_no_apta_en_texto(texto: str) -> str | None:
    if not texto or not isinstance(texto, str):
        return None
    match = _OUT_OF_STATE_CITIES_RE.search(texto)
    if match:
        return match.group(0).strip().title()
    return None

def extraer_anuncio_referral(webhook_payload: dict) -> dict | None:
    if not isinstance(webhook_payload, dict):
        return None
    _data = webhook_payload.get("_data") or {}
    context = webhook_payload.get("context") or _data.get("context") or {}
    referral = (
        webhook_payload.get("referral")
        or _data.get("referral")
        or context.get("ad")
        or context.get("referral")
    )
    if isinstance(referral, dict):
        headline = (
            referral.get("headline")
            or referral.get("title")
            or referral.get("body")
            or referral.get("source_url")
            or ""
        )
        return {
            "headline": str(headline).strip(),
            "source_type": str(referral.get("source_type") or "ad"),
            "raw": referral,
        }
    return None

# --- Orquestador de esta oleada ---------------------------------------------

async def analizar_mensaje(webhook_payload: dict, contacto: dict, candidato: dict, empresa_id: str | None = None) -> dict:
    """Punto de entrada de este módulo: clasifica el mensaje, recolecta
    todos los archivos multimedia acumulados en la ventana de debounce,
    llama a Gemini multimodal si hace falta (analizando todas las imágenes
    juntas), y sube/actualiza expediente."""
    tipo = clasificar_media(webhook_payload)
    session = webhook_payload.get("session") or "default"
    telefono = contacto.get("number")
    chat_id = contacto.get("chat_id") or (f"{telefono}@c.us" if str(telefono).isdigit() else f"{telefono}@lid")
    body_text = (webhook_payload.get("body") or "").strip()

    # 1. VERIFICACIÓN DE CIUDAD NO APTA (ZMG / JALISCO) EN TEXTO
    ciudad_detectada = _detectar_ciudad_no_apta_en_texto(body_text)
    if ciudad_detectada:
        logger.info("Detectada ciudad no apta en texto para telefono=%s: %s", telefono, ciudad_detectada)
        pool = get_pool()
        await pool.execute(
            "UPDATE candidatos SET estado = 'OTRA_CIUDAD', lugar_residencia = $1, "
            "resumen_ia = $2 WHERE telefono = $3",
            ciudad_detectada,
            f"Descalificado automáticamente: Radica en otra ciudad ({ciudad_detectada})",
            telefono,
        )
        await waha_client.send_text(session, chat_id, DESCALIFICACION_CIUDAD_MSG)
        return {"mensaje_para_agente": None, "detuvo_flujo": True}

    # 2. DETECCIÓN Y PROCESAMIENTO DE ANUNCIOS DE FACEBOOK ADS
    referral_info = extraer_anuncio_referral(webhook_payload)
    mensaje_para_agente = None

    if referral_info and referral_info.get("headline"):
        headline = referral_info["headline"]
        logger.info("Anuncio de Facebook Ads detectado para telefono=%s: %s", telefono, headline)
        pool = get_pool()
        await pool.execute(
            # El WHERE sólo contemplaba NULL/''/'General', así que un candidato
            # con un placeholder adornado guardado ('{Ninguna}') no recibía la
            # vacante del anuncio. Se compara sobre el valor sin adornos.
            "UPDATE candidatos SET vacante_interes = $1 WHERE telefono = $2 "
            """AND UPPER(BTRIM(COALESCE(vacante_interes, ''), '{}[]"''| ')) """
            "IN ('', 'GENERAL', 'NINGUNA', 'PENDIENTE', 'DESCONOCIDA', 'X')",
            headline,
            telefono,
        )
        mensaje_para_agente = (
            f"[SISTEMA: El candidato ingresó a través de un anuncio de Facebook Ads para la vacante: *{headline}*. "
            f"Salúdalo amablemente, dale la bienvenida a Talentos Creativos e Innovación, confírmale brevemente que el anuncio es para la vacante *{headline}* "
            f"y pregúntale en qué municipio o ciudad radica actualmente para verificar su residencia presencial.]"
        )
    elif body_text.lower().startswith("¡hola! quiero más información") or body_text.lower().startswith("hola, quiero más información"):
        logger.info("Detectado mensaje genérico por defecto de anuncio para telefono=%s", telefono)
        mensaje_para_agente = (
            "[SISTEMA: El candidato ingresó desde un anuncio de Facebook ('¡Hola! Quiero más información'). "
            "Salúdalo con entusiasmo, bienvenido a Talentos Creativos e Innovación, y pregúntale de inmediato "
            "en qué municipio o ciudad radica actualmente para verificar su residencia presencial antes de mostrarle vacantes.]"
        )

    # 3. RECOLECCIÓN DE TODOS LOS MENSAJES TEMPORALES DEL TURNO (DEBOUNCE)
    pool = get_pool()
    temp_rows = await pool.fetch(
        "SELECT content, message_type, media_url FROM conversation_history WHERE telefono = $1 AND role = 'user_temp' ORDER BY id ASC",
        telefono,
    )

    media_urls: list[str] = []
    for r in temp_rows:
        u = r.get("media_url")
        if u and u not in media_urls:
            media_urls.append(u)

    # Fallback si viene en webhook_payload pero no estaba en user_temp
    payload_media_url = (webhook_payload.get("media") or {}).get("url")
    if payload_media_url and payload_media_url not in media_urls:
        media_urls.append(payload_media_url)

    if not media_urls:
        # Turno de solo texto
        await waha_client.start_typing("default", chat_id)
        return {"mensaje_para_agente": mensaje_para_agente, "detuvo_flujo": False}

    await waha_client.start_typing(session, chat_id)

    # 4. PROCESAR AUDIO
    if any("audio" in ((r.get("message_type") or "")).lower() for r in temp_rows) or tipo == "audio":
        audio_url = media_urls[0]
        data, mime_type = await waha_client.download_media(audio_url)
        texto_transcrito = await gemini_client.transcribir_audio(data, "audio/ogg")
        return {"mensaje_para_agente": texto_transcrito, "detuvo_flujo": False}

    # 5. PROCESAR WORD
    if tipo == "word":
        await waha_client.send_text(
            session, chat_id,
            "😅Veo que me enviaste un documento de Word. Por estrictas políticas de ciberseguridad, mi sistema "
            "corporativo no me permite abrir este tipo de archivos. \n\n🛡️*¿Podrías apoyarme guardando tu documento "
            "como PDF o simplemente tomándole una Fotografía clara 📸 y volviéndolo a enviar por aquí, por favor? "
            "¡Gracias! ✨",
        )
        return {"mensaje_para_agente": None, "detuvo_flujo": True}

    # 6. DESCARGAR TODOS LOS DOCUMENTOS/FOTOS
    # Solo a memoria: la subida a storage ocurre DESPUÉS del análisis (paso 8),
    # cuando ya se sabe qué es cada archivo. Antes se subía todo aquí, así que
    # los pantallazos del anuncio de la vacante y los memes se quedaban en
    # /uploads para siempre aunque el expediente nunca los referenciara.
    archivos_descargados: list[dict] = []

    for m_url in media_urls:
        try:
            data, mime_type = await waha_client.download_media(m_url)
            if data:
                archivos_descargados.append({"mime_type": mime_type, "data": data})
        except Exception:
            logger.exception("analizar_mensaje: download_media falló para %s", m_url)

    if not archivos_descargados:
        return {"mensaje_para_agente": None, "detuvo_flujo": False}

    # 7. ANÁLISIS MULTIMODAL CONSOLIDADO EN GEMINI (TODOS LOS ARCHIVOS A LA VEZ)
    vacante_interes = (candidato or {}).get("vacante_interes") or "General"
    detalle_vacantes = await obtener_detalle_vacantes((candidato or {}).get("nave_interes"), empresa_id)
    prompt = _ANALYZE_DOCUMENT_PROMPT_TEMPLATE.format(detalle_vacantes=detalle_vacantes, vacante_interes=vacante_interes)

    gemini_text = await gemini_client.analizar_documentos(archivos_descargados, prompt)

    captions = [r["content"] for r in temp_rows if r.get("content") and r["content"] != "[Mensaje multimedia]"]
    caption_usuario = " ".join(captions).strip() or (webhook_payload.get("body") or "")
    nombre_whatsapp = (webhook_payload.get("_data") or {}).get("notifyName") or "Candidato"
    resultado = separar_json(
        gemini_text, telefono, nombre_whatsapp, caption_usuario, candidato,
        total_archivos=len(archivos_descargados),
    )

    mensaje_para_agente = resultado["mensaje_usuario"]

    # 8. SUBIR A STORAGE SOLO LO QUE ES DOCUMENTO DEL CANDIDATO
    archivos_guardados: list[dict] = []
    for indice, (archivo, tipo_archivo) in enumerate(
        zip(archivos_descargados, resultado["clasificacion_archivos"]), start=1
    ):
        if tipo_archivo in TIPOS_ARCHIVO_DESCARTABLES:
            logger.info(
                "analizar_mensaje: archivo %d/%d de %s descartado sin guardar (%s)",
                indice, len(archivos_descargados), telefono, tipo_archivo,
            )
            continue
        try:
            up_url = await subir_cv(telefono, archivo["data"], archivo["mime_type"])
        except Exception:
            logger.exception("analizar_mensaje: subir_cv falló para archivo %d de %s", indice, telefono)
            continue
        if up_url:
            archivos_guardados.append({
                "url": up_url,
                "tipo": tipo_archivo,
                "etiqueta": ETIQUETAS_ARCHIVO.get(tipo_archivo, "Documento sin identificar"),
            })

    urls_subidas = [a["url"] for a in archivos_guardados]

    if resultado["tipo_origen"] != "INVALIDO":
        link_cv = urls_subidas[0] if urls_subidas else None
        resultado["cv_manual"] = resultado.get("cv_manual") or {}
        # `archivos` es lo que lee el CRM para encasillar cada documento; `urls`
        # y `url`/`url_reverso` se conservan por compatibilidad con expedientes
        # y pantallas anteriores.
        resultado["cv_manual"]["archivos"] = archivos_guardados
        resultado["cv_manual"]["urls"] = urls_subidas
        resultado["cv_manual"]["url"] = link_cv
        if len(urls_subidas) > 1:
            resultado["cv_manual"]["url_reverso"] = urls_subidas[1]

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
