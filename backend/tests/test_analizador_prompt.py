"""Regresión de la sustitución de placeholders del system prompt.

El prompt vivo (`empresas.prompt_ia`) escribe los placeholders con llave
doble -- `{{VACANTE_INTERES}}` -- pero el patrón se construía con UNA sola
llave, así que el replace sólo se comía el par interno y dejaba las externas:
la ficha del candidato terminaba diciendo `| Vacante | {Ninguna} |` y el
modelo copiaba ese `{Ninguna}` literal de vuelta en `actualizar_vacante`.
"""

from app.chat.analizador import _placeholder_re


def _sustituir(prompt: str, valores: dict[str, str]) -> str:
    for key, value in valores.items():
        prompt = _placeholder_re(key).sub(lambda _m, v=value: v, prompt)
    return prompt


def test_llave_doble_no_deja_llaves_sueltas():
    assert _sustituir("| Vacante | {{VACANTE_INTERES}} |", {"VACANTE_INTERES": "Ninguna"}) == "| Vacante | Ninguna |"


def test_llave_simple_sigue_funcionando():
    assert _sustituir("Vacante: {VACANTE_INTERES}", {"VACANTE_INTERES": "Ninguna"}) == "Vacante: Ninguna"


def test_valor_con_barras_no_se_interpreta_como_referencia_de_grupo():
    """Los menús traen saltos, viñetas y a veces barras invertidas: pasados
    como string de reemplazo, `re.sub` los leería como `\\g<n>` y reventaría."""
    menu = r"1. Operador \ Almacén \g<1>"
    assert _sustituir("{{MENU_VACANTES}}", {"MENU_VACANTES": menu}) == menu


def test_solo_sustituye_el_placeholder_pedido():
    prompt = "{{VACANTE_INTERES}} y {{NAVE_ACTUAL}}"
    assert _sustituir(prompt, {"VACANTE_INTERES": "CAJERO/A"}) == "CAJERO/A y {{NAVE_ACTUAL}}"
