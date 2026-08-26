"""Regresión del reconocimiento de placeholders de vacante.

En producción quedaron guardados '{Ninguna}', '{NINGUNA}' y 'General' como si
fueran vacantes elegidas: los guards comparaban el string crudo contra la
lista de placeholders y las llaves que el prompt dejaba alrededor del valor
hacían que ninguna coincidiera.
"""

import pytest

from app.chat.vacantes import es_placeholder_vacante, limpiar_vacante


@pytest.mark.parametrize("valor", [
    "NINGUNA", "Ninguna", "  ninguna  ",
    "{Ninguna}", "{NINGUNA}", "{{Ninguna}}",
    "General", "{General}", "[GENERAL]", '"General"', "*General*",
    "Pendiente", "Desconocida", "X",
    "", None,
])
def test_placeholders_reconocidos(valor):
    assert es_placeholder_vacante(valor) is True


@pytest.mark.parametrize("valor", [
    "OPERADOR DE ALMACEN", "{CAJERO/A}", "*Auxiliar de Sistemas*",
    "GENERALISTA DE RH",  # contiene 'GENERAL' pero no lo es
])
def test_vacantes_reales_no_son_placeholder(valor):
    assert es_placeholder_vacante(valor) is False


def test_limpiar_quita_adornos_pero_respeta_el_valor():
    assert limpiar_vacante("{OPERADOR DE VEHÍCULO}") == "OPERADOR DE VEHÍCULO"
    assert limpiar_vacante("*CAJERO/A*") == "CAJERO/A"
    assert limpiar_vacante(None) == ""


def test_frases_genericas_solo_con_extra():
    """'ESTA VACANTE' sólo es placeholder en el rescate por texto libre."""
    assert es_placeholder_vacante("ESTA VACANTE") is False
    assert es_placeholder_vacante("ESTA VACANTE", frozenset({"ESTA VACANTE"})) is True
