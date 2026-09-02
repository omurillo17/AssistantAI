import unittest
from app.utils.phone import (
    limpiar_digitos,
    obtener_ultimos_10_digitos,
    normalizar_numero_meta,
    clave_lista_negra,
    a_chat_id,
)

class TestPhoneUtils(unittest.TestCase):
    def test_limpiar_digitos(self):
        self.assertEqual(limpiar_digitos("+52 1 (33) 3248-3278"), "5213332483278")
        self.assertEqual(limpiar_digitos("5213323379399@c.us"), "5213323379399")
        self.assertEqual(limpiar_digitos(None), "")

    def test_obtener_ultimos_10_digitos(self):
        self.assertEqual(obtener_ultimos_10_digitos("5213332483278"), "3332483278")
        self.assertEqual(obtener_ultimos_10_digitos("523332483278"), "3332483278")
        self.assertEqual(obtener_ultimos_10_digitos("3332483278"), "3332483278")

    def test_normalizar_numero_meta(self):
        self.assertEqual(normalizar_numero_meta("5213332483278"), "523332483278")
        self.assertEqual(normalizar_numero_meta("+52 1 33 3248 3278"), "523332483278")
        self.assertEqual(normalizar_numero_meta("3332483278"), "523332483278")
        self.assertEqual(normalizar_numero_meta("523332483278"), "523332483278")

    def test_clave_lista_negra(self):
        claves = clave_lista_negra("5213332483278@c.us", "3332483278")
        self.assertEqual(claves, ["3332483278"])

    def test_a_chat_id(self):
        self.assertEqual(a_chat_id("523332483278"), "523332483278@c.us")
        self.assertEqual(a_chat_id("151226570248433"), "151226570248433@lid")
        self.assertEqual(a_chat_id("523332483278@c.us"), "523332483278@c.us")
