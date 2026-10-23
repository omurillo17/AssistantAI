"""Utilidades centralizadas para normalización y formateo de teléfonos en el backend."""

import re

_NON_DIGITS_RE = re.compile(r"\D")


def limpiar_digitos(telefono: str | None) -> str:
    """Extrae únicamente los dígitos numéricos de cualquier identificador."""
    if not telefono:
        return ""
    parte_antes_arroba = str(telefono).split("@")[0]
    return _NON_DIGITS_RE.sub("", parte_antes_arroba)


def obtener_ultimos_10_digitos(telefono: str | None) -> str:
    """Obtiene los últimos 10 dígitos (clave estándar en México / BD)."""
    digitos = limpiar_digitos(telefono)
    return digitos[-10:] if len(digitos) >= 10 else digitos


def enmascarar(telefono: str | None) -> str:
    """Para logs: solo los últimos 4 dígitos (ej. '***9399')."""
    digitos = limpiar_digitos(telefono)
    return f"***{digitos[-4:]}" if digitos else "?"


def normalizar_numero_meta(telefono: str | None) -> str:
    """Normaliza números para Meta Graph API.
    Para México: Meta exige 52 + 10 dígitos (12 dígitos).
    Si viene como 521 + 10 dígitos (13 dígitos), elimina el '1' intermedio.
    Si viene como 10 dígitos, le antepone '52'."""
    digitos = limpiar_digitos(telefono)
    if digitos.startswith("521") and len(digitos) == 13:
        return "52" + digitos[3:]
    if len(digitos) == 10:
        return "52" + digitos
    return digitos


def clave_lista_negra(*numeros: str | None) -> list[str]:
    """Normaliza cada identificador a sus últimos 10 dígitos para listas de exclusión
    (reclutadores y números ignorados)."""
    claves = set()
    for numero in numeros:
        ultimos_10 = obtener_ultimos_10_digitos(numero)
        if len(ultimos_10) == 10:
            claves.add(ultimos_10)
    return sorted(claves)


def a_chat_id(telefono: str | None) -> str:
    """Convierte un teléfono a formato chatId de WhatsApp."""
    if not telefono:
        return ""
    tel_str = str(telefono)
    if "@" in tel_str:
        return tel_str
    digitos = limpiar_digitos(tel_str)
    return f"{digitos}@lid" if len(digitos) > 13 else f"{digitos}@c.us"
