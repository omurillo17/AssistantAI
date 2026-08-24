"""Reclasificación de los archivos YA guardados de un candidato.

El analizador clasifica cada adjunto en el momento en que llega
(analizador.py -> `clasificar_archivos`), pero los expedientes anteriores a ese
cambio no traen esa información: cuando el candidato mandaba INE y Constancia
en la misma tanda, el arreglo completo de urls se copiaba tal cual en
`datos_ine` Y en `datos_rfc`, así que el CRM no puede saber cuál archivo es
cuál y acaba repitiendo la misma lista bajo los dos títulos.

Este endpoint vuelve a pasar esos archivos por Gemini —una sola llamada
multimodal con todos— y guarda la clasificación por archivo en el expediente.
De paso borra del disco lo que resulta ser captura del anuncio de la vacante o
basura (memes, stickers), que nunca debió archivarse.
"""

import json
import logging
import os

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app import gemini_client
from app.chat.analizador import (
    ETIQUETAS_ARCHIVO,
    TIPOS_ARCHIVO_DESCARTABLES,
    normalizar_tipo_archivo,
)
from app.config import ENV
from app.db import get_pool
from app.security import verify_api_key

logger = logging.getLogger("documentos")

router = APIRouter(
    prefix="/internal/documentos",
    dependencies=[Depends(verify_api_key)],
)

MAX_ARCHIVOS = 15

_MIME_POR_EXTENSION = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}

_PROMPT_CLASIFICACION = """Eres el analista documental de Grupo Virgo. Te adjunto {total} archivo(s) que un candidato mandó por WhatsApp, en orden.

Tu ÚNICA tarea es decir qué es cada archivo. No valides autenticidad, no extraigas datos, no escribas mensajes.

Tipos permitidos (usa exactamente estas cadenas):
- INE_FRENTE / INE_REVERSO: caras de la credencial de elector.
- CONSTANCIA_FISCAL: Constancia de Situación Fiscal o Cédula de Identificación Fiscal del SAT.
- CV: currículum. SOLICITUD: formato de solicitud de empleo.
- ACTA_NACIMIENTO, CURP, IMSS, COMPROBANTE_DOMICILIO, COMPROBANTE_ESTUDIOS, ANTECEDENTES_PENALES.
- ANUNCIO: cartel o captura de pantalla de la oferta de empleo (Facebook, WhatsApp, la vacante publicada).
- IRRELEVANTE: meme, sticker, selfie, mascota, paisaje, captura sin ningún documento.
- OTRO: es un documento del candidato pero no encaja en ninguno de los anteriores.

Responde SOLO con este JSON, sin bloques de código, con una entrada por archivo y `indice` empezando en 1:
{{"archivos": [{{"indice": 1, "tipo": "INE_FRENTE"}}]}}"""


class ClasificarRequest(BaseModel):
    telefono: str


def _parse_blob(value: object) -> dict:
    if not value:
        return {}
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return {}
    return value if isinstance(value, dict) else {}


def _urls_del_blob(blob: dict) -> list[str]:
    urls: list[str] = []

    def push(raw: object) -> None:
        if isinstance(raw, str) and raw.startswith("/uploads/") and raw not in urls:
            urls.append(raw)

    for entrada in blob.get("archivos") or []:
        if isinstance(entrada, dict):
            push(entrada.get("url"))
    push(blob.get("url"))
    push(blob.get("link"))
    for u in blob.get("urls") or []:
        push(u)
    push(blob.get("url_reverso"))
    return urls


def _ruta_local(url: str) -> str:
    return os.path.join(ENV.VIRGO_FILES_DIR, "uploads", os.path.basename(url))


def _leer_archivo(url: str) -> dict | None:
    ruta = _ruta_local(url)
    ext = os.path.splitext(ruta)[1].lower()
    mime = _MIME_POR_EXTENSION.get(ext)
    if not mime:
        return None
    try:
        with open(ruta, "rb") as f:
            return {"mime_type": mime, "data": f.read()}
    except OSError:
        logger.warning("clasificar: no se pudo leer %s", ruta)
        return None


def _borrar_archivo(url: str) -> None:
    try:
        os.remove(_ruta_local(url))
    except OSError:
        pass


@router.post("/clasificar")
async def clasificar(payload: ClasificarRequest) -> dict:
    """Reclasifica con IA los archivos ya guardados de un candidato."""
    pool = get_pool()
    row = await pool.fetchrow(
        "SELECT id, link_cv, datos_ine, datos_rfc, cv_manual FROM candidatos WHERE telefono = $1 "
        "ORDER BY updated_at DESC NULLS LAST LIMIT 1",
        payload.telefono,
    )
    if row is None:
        return {"ok": False, "error": "Candidato no encontrado", "archivos": []}

    blobs = {campo: _parse_blob(row[campo]) for campo in ("datos_ine", "datos_rfc", "cv_manual")}

    urls: list[str] = []
    if isinstance(row["link_cv"], str) and row["link_cv"].startswith("/uploads/"):
        urls.append(row["link_cv"])
    for blob in blobs.values():
        for url in _urls_del_blob(blob):
            if url not in urls:
                urls.append(url)

    if not urls:
        return {"ok": True, "archivos": [], "descartados": 0}

    if len(urls) > MAX_ARCHIVOS:
        logger.info("clasificar: %s tiene %d archivos, se analizan los primeros %d",
                    payload.telefono, len(urls), MAX_ARCHIVOS)
        urls = urls[:MAX_ARCHIVOS]

    leidos = [(url, _leer_archivo(url)) for url in urls]
    disponibles = [(url, arch) for url, arch in leidos if arch]
    if not disponibles:
        return {"ok": False, "error": "Los archivos ya no están en el servidor", "archivos": []}

    prompt = _PROMPT_CLASIFICACION.format(total=len(disponibles))
    try:
        respuesta = await gemini_client.analizar_documentos([a for _, a in disponibles], prompt)
    except Exception:
        logger.exception("clasificar: Gemini falló para %s", payload.telefono)
        return {"ok": False, "error": "El análisis con IA no respondió", "archivos": []}

    try:
        crudo = respuesta[respuesta.index("{"):respuesta.rindex("}") + 1]
        datos = json.loads(crudo)
    except (ValueError, json.JSONDecodeError):
        logger.warning("clasificar: respuesta no parseable de Gemini para %s", payload.telefono)
        return {"ok": False, "error": "El análisis con IA devolvió una respuesta inesperada", "archivos": []}

    tipos = ["OTRO"] * len(disponibles)
    for entrada in datos.get("archivos") or []:
        if not isinstance(entrada, dict):
            continue
        try:
            idx = int(entrada.get("indice")) - 1
        except (TypeError, ValueError):
            continue
        if 0 <= idx < len(tipos):
            tipos[idx] = normalizar_tipo_archivo(entrada.get("tipo"))

    archivos: list[dict] = []
    descartadas: set[str] = set()
    for (url, _), tipo in zip(disponibles, tipos):
        if tipo in TIPOS_ARCHIVO_DESCARTABLES:
            descartadas.add(url)
            _borrar_archivo(url)
            continue
        archivos.append({
            "url": url,
            "tipo": tipo,
            "etiqueta": ETIQUETAS_ARCHIVO.get(tipo, "Documento sin identificar"),
        })

    urls_vivas = [a["url"] for a in archivos]

    # Se reescriben los tres campos con la misma clasificación: cada uno sigue
    # guardando los datos extraídos que ya tenía (nombre, curp, rfc...), solo
    # cambia la lista de archivos y se limpian las urls descartadas.
    for blob in blobs.values():
        if not blob:
            continue
        blob["archivos"] = archivos
        blob["urls"] = [u for u in (blob.get("urls") or []) if u not in descartadas]
        if blob.get("url") in descartadas:
            blob["url"] = urls_vivas[0] if urls_vivas else None
        if blob.get("url_reverso") in descartadas:
            blob.pop("url_reverso", None)

    link_cv = row["link_cv"] if row["link_cv"] not in descartadas else None

    await pool.execute(
        "UPDATE candidatos SET datos_ine = $1::jsonb, datos_rfc = $2, cv_manual = $3::jsonb, "
        "link_cv = $4, updated_at = NOW() WHERE id = $5",
        json.dumps(blobs["datos_ine"]) if blobs["datos_ine"] else None,
        json.dumps(blobs["datos_rfc"]) if blobs["datos_rfc"] else None,
        json.dumps(blobs["cv_manual"]) if blobs["cv_manual"] else None,
        link_cv,
        row["id"],
    )

    logger.info("clasificar: %s -> %d archivos clasificados, %d descartados",
                payload.telefono, len(archivos), len(descartadas))
    return {"ok": True, "archivos": archivos, "descartados": len(descartadas)}
