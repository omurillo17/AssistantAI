import { describe, it, expect } from 'vitest';

import { esPlaceholderVacante, limpiarVacante } from './vacantes';

/**
 * En producción quedaron guardados '{Ninguna}', '{NINGUNA}' y 'General' como
 * si fueran vacantes elegidas: los guards de los webhooks comparaban el
 * string crudo contra ['GENERAL', 'NINGUNA'] y las llaves que el prompt
 * dejaba alrededor del valor hacían que ninguna coincidiera. Con el
 * placeholder guardado, definir_agenda manda la cita al reclutador de
 * respaldo en vez de al dueño de la vacante.
 */
describe('esPlaceholderVacante', () => {
  it.each([
    'NINGUNA', 'Ninguna', '  ninguna  ',
    '{Ninguna}', '{NINGUNA}', '{{Ninguna}}',
    'General', '{General}', '[GENERAL]', '"General"', '*General*',
    'Pendiente', 'Desconocida', 'X',
    '', null, undefined,
  ])('reconoce %j como placeholder', (valor) => {
    expect(esPlaceholderVacante(valor)).toBe(true);
  });

  it.each([
    'OPERADOR DE ALMACEN',
    '{CAJERO/A}',
    '*Auxiliar de Sistemas*',
    'GENERALISTA DE RH', // contiene 'GENERAL' pero no lo es
  ])('deja pasar la vacante real %j', (valor) => {
    expect(esPlaceholderVacante(valor)).toBe(false);
  });
});

describe('limpiarVacante', () => {
  it('quita los adornos pero respeta el valor', () => {
    expect(limpiarVacante('{OPERADOR DE VEHÍCULO}')).toBe('OPERADOR DE VEHÍCULO');
    expect(limpiarVacante('*CAJERO/A*')).toBe('CAJERO/A');
    expect(limpiarVacante(null)).toBe('');
  });
});
