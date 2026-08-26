"""Reconocimiento de valores de vacante que NO son una vacante real.

El modelo devuelve `actualizar_vacante` copiando lo que ve en su propia
ficha de contexto, y ahí el valor viene envuelto en adornos: llaves que
sobran de los placeholders del prompt (`{Ninguna}`), comillas, asteriscos
de negritas. Los guards que comparaban el string crudo contra
("GENERAL", "NINGUNA", ...) no atrapaban ninguna de esas variantes y el
placeholder acababa guardado como si fuera una vacante elegida, rompiendo
el match vacante->reclutador de `definir_agenda`.

Este módulo centraliza la limpieza y la comparación para que parser,
analizador y los webhooks del frontend usen el mismo criterio.
"""

import re

# Valores que el prompt usa como "todavía no hay vacante". 'X' es el
# literal de la plantilla cuando el modelo la copia sin rellenar.
PLACEHOLDERS_VACANTE = frozenset({"GENERAL", "NINGUNA", "PENDIENTE", "DESCONOCIDA", "X"})

# Llaves, corchetes, comillas, pipes y asteriscos de markdown: adornos con
# los que el modelo envuelve el valor sin que dejen de ser el mismo valor.
_ADORNOS_RE = re.compile(r"[{}\[\]\"'|`*]+")


def limpiar_vacante(valor: object) -> str:
    """Devuelve el valor sin adornos y sin espacios sobrantes."""
    if not valor:
        return ""
    return _ADORNOS_RE.sub("", str(valor)).strip()


def es_placeholder_vacante(valor: object, extra: frozenset[str] | set[str] | None = None) -> bool:
    """True si `valor` es un placeholder y no una vacante real.

    `extra` permite sumar literales propios de un call site (p. ej. las
    frases genéricas "ESTA VACANTE" / "NUESTRA VACANTE" que sólo aparecen
    cuando la vacante se rescata del texto del mensaje).
    """
    limpio = limpiar_vacante(valor).upper()
    if not limpio:
        return True
    if limpio in PLACEHOLDERS_VACANTE:
        return True
    return bool(extra) and limpio in extra
