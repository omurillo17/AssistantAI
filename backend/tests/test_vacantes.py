"""Regresión del reconocimiento de placeholders de vacante.

En producción quedaron guardados '{Ninguna}', '{NINGUNA}' y 'General' como si
fueran vacantes elegidas: los guards comparaban el string crudo contra la
lista de placeholders y las llaves que el prompt dejaba alrededor del valor
hacían que ninguna coincidiera.
"""

import pytest

from app.chat.vacantes import emparejar_vacante, es_placeholder_vacante, limpiar_vacante


@pytest.mark.parametrize("valor", [
    "NINGUNA", "Ninguna", "  ninguna  ",
    "{Ninguna}", "{NINGUNA}", "{{Ninguna}}",
    "General", "{General}", "[GENERAL]", '"General"', "*General*",
    "Pendiente", "Desconocida", "X", "NUESTRAS VACANTES",
    "ESTA VACANTE", "VACANTES", "VACANTE",
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


@pytest.mark.parametrize("entrada,esperado", [
    ("OPERADOR DE VEHICULO EN CEDIS", "OPERADOR DE VEHICULO"),
    ("OPERADOR DE VEHÍCULO ES", "OPERADOR DE VEHICULO"),
    ("OPERADOR DE REPARTO EN CEDIS", "OPERADOR DE REPARTO"),
    ("NUESTRAS VACANTES", None),
    ("LA DE OPERADOR DE REPARTO", "OPERADOR DE REPARTO"),
    ("CAJERO", "CAJERA O ESCANER"),
    ("CAJERA", "CAJERA O ESCANER"),
    ("Cajera o Escaner", "CAJERA O ESCANER"),
    ("Cajera O Escaner", "CAJERA O ESCANER"),
    ("Cajera o Escáner", "CAJERA O ESCANER"),
    ("escaner", "CAJERA O ESCANER"),
    ("OPERADOR GENERAL", "OPERADOR GENERAL"),
    ("Operador General", "OPERADOR GENERAL"),
    ("Operadora General", "OPERADOR GENERAL"),
    ("OPERADOR ALMACEN", "OPERADOR DE ALMACEN"),
    ("OPERADOR DE ALMACÉN", "OPERADOR DE ALMACEN"),
    ("OPERADOR DE VEHÍCULO", "OPERADOR DE VEHICULO"),
    ("{Ninguna}", None),
    ("General", None),
    ("AUXILIAR DE SISTEMAS", "AUXILIAR DE SISTEMAS"),
    ("auxiliar de credito y cobranza", "AUXILIAR DE CREDITO Y COBRANZA"),
    ("chofer", "OPERADOR DE VEHICULO"),
    ("repartidor en cedis", "OPERADOR DE REPARTO"),
    ("almacenista", "OPERADOR DE ALMACEN"),
    ("solicitud de empleo", None),
    ("la vacante de operador de reparto disponible", "OPERADOR DE REPARTO"),
    ("esta vacante", None),
])
def test_emparejar_vacante_casos_produccion(entrada, esperado):
    assert emparejar_vacante(entrada) == esperado


@pytest.mark.parametrize("entrada,esperado", [
    ("NINGUNA", None),
    ("Ninguna", None),
    ("{Ninguna}", None),
    ("General", None),
    ("PENDIENTE", None),
    ("DULCERIA", "DULCERIA"),
    ("CEDIS", "CEDIS"),
    ("MATERIAS PRIMAS", "MATERIAS PRIMAS"),
    ("1", "DULCERIA"),
    ("NAVE 1", "DULCERIA"),
    ("DULCERIA/MANDARINA", "DULCERIA"),
    ("MANDARINA", "DULCERIA"),
    ("2", "CEDIS"),
    ("3", "MATERIAS PRIMAS"),
    ("MATRIZ", "MATRIZ"),
    ("SUCURSAL", "SUCURSAL"),
    ("VITALI", "VITALI"),
])
def test_emparejar_nave_casos_produccion(entrada, esperado):
    from app.chat.vacantes import emparejar_nave
    assert emparejar_nave(entrada) == esperado
