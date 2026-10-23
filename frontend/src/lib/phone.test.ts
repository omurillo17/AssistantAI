import { describe, it, expect } from 'vitest';
import {
  limpiarDigitos,
  obtenerUltimos10Digitos,
  normalizarNumeroMeta,
  aChatId,
  formatearTelefonoDisplay,
} from './phone';

describe('Utilidades de Teléfono (phone.ts)', () => {
  describe('limpiarDigitos', () => {
    it('extrae solo los dígitos eliminando caracteres no numéricos y dominios @c.us / @lid', () => {
      expect(limpiarDigitos('+52 (33) 3248-3278')).toBe('523332483278');
      expect(limpiarDigitos('5215500000001@c.us')).toBe('5215500000001');
      expect(limpiarDigitos(null)).toBe('');
      expect(limpiarDigitos(undefined)).toBe('');
    });
  });

  describe('obtenerUltimos10Digitos', () => {
    it('obtiene exactamente los 10 dígitos locales de México', () => {
      expect(obtenerUltimos10Digitos('5213332483278')).toBe('3332483278');
      expect(obtenerUltimos10Digitos('523332483278')).toBe('3332483278');
      expect(obtenerUltimos10Digitos('3332483278')).toBe('3332483278');
      expect(obtenerUltimos10Digitos('12345')).toBe('12345');
    });
  });

  describe('normalizarNumeroMeta', () => {
    it('convierte 521 + 10 dígitos (13 dígitos) a 52 + 10 dígitos (12 dígitos requeridos por Meta)', () => {
      expect(normalizarNumeroMeta('5213332483278')).toBe('523332483278');
      expect(normalizarNumeroMeta('+52 1 33 3248 3278')).toBe('523332483278');
    });

    it('antepone 52 a números locales de 10 dígitos', () => {
      expect(normalizarNumeroMeta('3332483278')).toBe('523332483278');
    });

    it('conserva números que ya tienen 12 dígitos con prefijo 52', () => {
      expect(normalizarNumeroMeta('523332483278')).toBe('523332483278');
    });
  });

  describe('aChatId', () => {
    it('agrega sufijo @c.us o @lid según la longitud', () => {
      expect(aChatId('523332483278')).toBe('523332483278@c.us');
      expect(aChatId('151226570248433')).toBe('151226570248433@lid');
      expect(aChatId('523332483278@c.us')).toBe('523332483278@c.us');
      expect(aChatId('')).toBe('');
    });
  });

  describe('formatearTelefonoDisplay', () => {
    it('formatea visualmente con código de país y espacios', () => {
      expect(formatearTelefonoDisplay('3332483278')).toBe('33 3248 3278');
      expect(formatearTelefonoDisplay('523332483278')).toBe('+52 33 3248 3278');
      expect(formatearTelefonoDisplay('5213332483278')).toBe('+52 33 3248 3278');
    });
  });
});
