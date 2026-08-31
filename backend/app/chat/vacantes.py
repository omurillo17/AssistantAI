"""Normalización, limpieza y encasillamiento estricto de vacantes del catálogo.

Centraliza el reconocimiento de placeholders ("GENERAL", "NINGUNA", "{Ninguna}"),
la limpieza de adornos tipográficos y el matching estricto contra el catálogo
de vacantes_def activas en Postgres.
"""

import logging
import re
import time
import unicodedata
from typing import Any

logger = logging.getLogger("vacantes")

# Valores que el prompt usa como "todavía no hay vacante" o frases genéricas
# que no deben guardarse como vacante real.
PLACEHOLDERS_VACANTE = frozenset({
    "GENERAL", "NINGUNA", "PENDIENTE", "DESCONOCIDA", "X", "NUESTRAS VACANTES",
    "ESTA VACANTE", "VACANTES", "VACANTE", "EMPLEO", "TRABAJO", "INFORMACION",
    "PUESTO", "POSTULACION", "OTRO", "OTRA", "NINGUNO", "NO SE", "CUALQUIERA",
    "SIN VACANTE", "NO DEFINIDA", "SOLICITUD", "CANDIDATO", "NONE", "NULL",
    "SIN REGISTRAR", "NO REGISTRADO", "DEFAULT", "TODAS", "CUALQUIER",
})

# Llaves, corchetes, comillas, pipes y asteriscos de markdown.
_ADORNOS_RE = re.compile(r"[{}\[\]\"'|`*]+")

# Prefijos de ruido comunes en respuestas de IA o mensajes de candidatos
_PREFIX_RE = re.compile(
    r"^(?:(?:LA|EL)\s+DE\s+|VACANTE\s+(?:DE|PARA)\s+|PUESTO\s+(?:DE|PARA)\s+|"
    r"POSTULACI[OÓ]N\s+A(?:\s+LA\s+VACANTE\s+DE)?\s+|INTERESA(?:\s+LA\s+VACANTE\s+DE)?\s+|"
    r"PROCESO\s+PARA(?:\s+LA\s+VACANTE\s+DE)?\s+|REFIE?RES\s+A(?:\s+LA)?\s+|"
    r"INFORMACI[OÓ]N\s+(?:DE|SOBRE)\s+)",
    re.IGNORECASE,
)

# Sufijos de ruido (como nombres de nave pegados a la vacante o fórmulas de cortesía)
_SUFFIX_RE = re.compile(
    r"(?:\s+EN\s+(?:CEDIS|DULCERIA|MATERIAS\s+PRIMAS|SUCURSAL|PLANTA|ZMG|MANDARINA)|"
    r"\s+(?:CEDIS|DULCERIA|MATERIAS\s+PRIMAS|MANDARINA)|\s+ES(?:\s+UNA|\s+UN|\s+LA)?|"
    r"\s+DISPONIBLE|\s+POR\s+FAVOR|\s+GRACIAS)$",
    re.IGNORECASE,
)

# Catálogo base de respaldo en caso de fallo de BD
CATALOGO_DEFAULT = [
    "AUXILIAR DE CREDITO Y COBRANZA",
    "AUXILIAR DE MERCADOTECNIA",
    "AUXILIAR DE SISTEMAS",
    "OPERADOR DE ALMACEN",
    "BECARIO DE MERCADOTECNIA",
    "OPERADOR DE MANTENIMIENTO",
    "OPERADOR DE ESTACIONAMIENTO",
    "CAJERO/A",
    "OPERADOR DE REPARTO",
    "OPERADOR DE VEHICULO",
    "OPERADOR DE RECIBO",
]

# Sinónimos y aliases comunes hacia el catálogo estándar
SINONIMOS_VACANTES = {
    "CHOFER": "OPERADOR DE VEHICULO",
    "CHOFER DE REPARTO": "OPERADOR DE REPARTO",
    "REPARTIDOR": "OPERADOR DE REPARTO",
    "REPARTIDORA": "OPERADOR DE REPARTO",
    "ALMACENISTA": "OPERADOR DE ALMACEN",
    "ALMACEN": "OPERADOR DE ALMACEN",
    "ESTACIONAMIENTO": "OPERADOR DE ESTACIONAMIENTO",
    "MANTENIMIENTO": "OPERADOR DE MANTENIMIENTO",
    "SISTEMAS": "AUXILIAR DE SISTEMAS",
    "COBRANZA": "AUXILIAR DE CREDITO Y COBRANZA",
    "CREDITO": "AUXILIAR DE CREDITO Y COBRANZA",
    "MERCADOTECNIA": "AUXILIAR DE MERCADOTECNIA",
    "RECIBO": "OPERADOR DE RECIBO",
}


def limpiar_vacante(valor: object) -> str:
    """Devuelve el valor sin adornos y sin espacios sobrantes."""
    if not valor:
        return ""
    return _ADORNOS_RE.sub("", str(valor)).strip()


def normalizar_texto(texto: str | None) -> str:
    """Mayúsculas, sin acentos y sin adornos."""
    if not texto:
        return ""
    nfd = unicodedata.normalize("NFD", str(texto).upper())
    sin_acento = "".join(c for c in nfd if unicodedata.category(c) != "Mn")
    return _ADORNOS_RE.sub("", sin_acento).strip()


def es_placeholder_vacante(valor: object, extra: frozenset[str] | set[str] | None = None) -> bool:
    """True si `valor` es un placeholder o frase genérica y no una vacante real."""
    limpio = normalizar_texto(str(valor) if valor else "")
    if not limpio:
        return True
    if limpio in PLACEHOLDERS_VACANTE:
        return True
    return bool(extra) and limpio in extra


def emparejar_vacante(
    texto: str | None,
    catalogo: list[str] | set[str] | None = None,
    sinonimos: dict[str, str] | None = None,
) -> str | None:
    """Encasilla un texto detectado contra el catálogo oficial de vacantes.

    Si coincide con una vacante del catálogo (o sus sinónimos/variaciones),
    devuelve el nombre canónico exacto registrado. Si es basura o genérico,
    devuelve None.
    """
    if not texto:
        return None

    norm = normalizar_texto(texto)
    if not norm or es_placeholder_vacante(norm):
        return None

    # Limpiar prefijos y sufijos conversacionales
    cur = _PREFIX_RE.sub("", norm).strip()
    cur = _SUFFIX_RE.sub("", cur).strip()
    cur = normalizar_texto(cur)
    if not cur or es_placeholder_vacante(cur):
        return None

    cats = catalogo if catalogo is not None else CATALOGO_DEFAULT
    cat_map = {normalizar_texto(c): c for c in cats if c}
    if cur in cat_map:
        return cat_map[cur]

    # Cotejar sinónimos directos
    sins = sinonimos if sinonimos is not None else SINONIMOS_VACANTES
    if cur in sins:
        sin_target = normalizar_texto(sins[cur])
        if sin_target in cat_map:
            return cat_map[sin_target]

    cur_tokens = set(re.findall(r"[A-Z0-9]+", cur)) - {"DE", "Y", "LA", "EL", "EN", "PARA", "UN", "UNA"}
    if not cur_tokens:
        return None

    # Coincidencia por tokens exactos
    for cat_norm, cat_orig in cat_map.items():
        cat_tokens = set(re.findall(r"[A-Z0-9]+", cat_norm)) - {"DE", "Y", "LA", "EL", "EN", "PARA", "UN", "UNA"}
        if cur_tokens == cat_tokens:
            return cat_orig

    # Inclusión de substring
    for cat_norm, cat_orig in cat_map.items():
        if cur in cat_norm or cat_norm in cur:
            return cat_orig

    # Tokens subset (ej. "OPERADOR ALMACEN" en "OPERADOR DE ALMACEN")
    for cat_norm, cat_orig in cat_map.items():
        cat_tokens = set(re.findall(r"[A-Z0-9]+", cat_norm)) - {"DE", "Y", "LA", "EL", "EN", "PARA", "UN", "UNA"}
        if cur_tokens.issubset(cat_tokens) and len(cur_tokens) >= 2:
            return cat_orig
        # Alias singular/plural especial (ej. CAJERO -> CAJERO/A)
        if len(cur_tokens) == 1 and list(cur_tokens)[0] in ("CAJERO", "CAJERA") and "CAJERO" in cat_norm:
            return cat_orig

    # Cotejar sinónimos por token
    for tok in cur_tokens:
        if tok in sins:
            sin_target = normalizar_texto(sins[tok])
            if sin_target in cat_map:
                return cat_map[sin_target]

    return None


_CATALOGO_CACHE: dict[str, tuple[float, list[str], dict[str, str]]] = {}
_CACHE_TTL_SEGUNDOS = 60


async def obtener_catalogo_vacantes_db(empresa_id: str | None = None) -> tuple[list[str], dict[str, str]]:
    """Consulta las vacantes activas y sus palabras clave desde la BD con cache."""
    cache_key = empresa_id or "global"
    now = time.time()
    cached = _CATALOGO_CACHE.get(cache_key)
    if cached and (now - cached[0]) < _CACHE_TTL_SEGUNDOS:
        return cached[1], cached[2]

    try:
        from app.db import get_pool
        pool = get_pool()
        if empresa_id:
            rows = await pool.fetch(
                "SELECT nombre, palabras_clave FROM vacantes_def WHERE activa = true AND (empresa_id = $1::uuid OR empresa_id IS NULL)",
                empresa_id,
            )
        else:
            rows = await pool.fetch(
                "SELECT nombre, palabras_clave FROM vacantes_def WHERE activa = true"
            )

        nombres = [r["nombre"] for r in rows if r.get("nombre")]
        sinonimos: dict[str, str] = dict(SINONIMOS_VACANTES)
        for r in rows:
            nombre = r.get("nombre")
            palabras = r.get("palabras_clave") or ""
            if nombre and palabras:
                for kw in palabras.split(","):
                    kw_clean = normalizar_texto(kw)
                    if kw_clean:
                        sinonimos[kw_clean] = nombre

        if not nombres:
            nombres = list(CATALOGO_DEFAULT)

        _CATALOGO_CACHE[cache_key] = (now, nombres, sinonimos)
        return nombres, sinonimos
    except Exception as e:
        logger.warning("obtener_catalogo_vacantes_db: error consultando BD (%s), usando default", e)
        return list(CATALOGO_DEFAULT), dict(SINONIMOS_VACANTES)


PLACEHOLDERS_NAVE = frozenset({
    "NINGUNA", "GENERAL", "PENDIENTE", "DESCONOCIDA", "X", "NONE", "NULL",
    "SIN SUCURSAL", "NO DEFINIDA", "SIN ASIGNAR", "TODAS", "CUALQUIERA",
    "{NINGUNA}", "{GENERAL}", "{PENDIENTE}",
})

NAVES_DEFAULT = ["DULCERIA", "CEDIS", "MATERIAS PRIMAS", "MATRIZ", "SUCURSAL", "VITALI"]

SINONIMOS_NAVES = {
    "1": "DULCERIA",
    "NAVE 1": "DULCERIA",
    "DULCERIA/MANDARINA": "DULCERIA",
    "MANDARINA": "DULCERIA",
    "2": "CEDIS",
    "NAVE 2": "CEDIS",
    "3": "MATERIAS PRIMAS",
    "NAVE 3": "MATERIAS PRIMAS",
}


def es_placeholder_nave(valor: object) -> bool:
    """True si `valor` es un placeholder y no una nave o sucursal real."""
    limpio = normalizar_texto(str(valor) if valor else "")
    if not limpio:
        return True
    return limpio in PLACEHOLDERS_NAVE


def emparejar_nave(texto: str | None, catalogo: list[str] | set[str] | None = None) -> str | None:
    """Encasilla el valor de nave a un nombre canónico registrado o None si es inválido o placeholder."""
    if not texto:
        return None
    norm = normalizar_texto(texto)
    if not norm or es_placeholder_nave(norm):
        return None

    if norm in SINONIMOS_NAVES:
        return SINONIMOS_NAVES[norm]

    cats = catalogo if catalogo is not None else NAVES_DEFAULT
    cat_map = {normalizar_texto(c): c for c in cats if c}
    if norm in cat_map:
        return cat_map[norm]

    for cat_norm, cat_orig in cat_map.items():
        if norm in cat_norm or cat_norm in norm:
            return cat_orig

    return None
