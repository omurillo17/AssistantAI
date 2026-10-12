/**
 * Reconocimiento de valores de vacante que NO son una vacante real.
 *
 * El agente devuelve la vacante copiando lo que ve en su ficha de contexto,
 * y ahí el valor viene envuelto en adornos: llaves que sobran de los
 * placeholders del prompt (`{Ninguna}`), comillas, asteriscos de negritas.
 * Los guards que comparaban el string crudo contra ['GENERAL', 'NINGUNA']
 * no atrapaban ninguna de esas variantes y el placeholder acababa guardado
 * como si fuera una vacante elegida, rompiendo el match vacante->reclutador
 * de definir_agenda.
 *
 * Espejo de `backend/app/chat/vacantes.py`: si cambia una lista, cambia la
 * otra.
 */

/** Valores que el prompt usa como "todavía no hay vacante". */
export const PLACEHOLDERS_VACANTE = ['GENERAL', 'NINGUNA', 'PENDIENTE', 'DESCONOCIDA', 'X'];

// Llaves, corchetes, comillas, pipes y asteriscos de markdown: adornos con
// los que el modelo envuelve el valor sin que deje de ser el mismo valor.
const ADORNOS_RE = /[{}[\]"'|`*]+/g;

/** Devuelve el valor sin adornos ni espacios sobrantes. */
export function limpiarVacante(valor: unknown): string {
  if (!valor || typeof valor !== 'string') return '';
  return valor.replace(ADORNOS_RE, '').trim();
}

/** True si `valor` es un placeholder y no una vacante real. */
export function esPlaceholderVacante(valor: unknown): boolean {
  const limpio = limpiarVacante(valor).toUpperCase();
  return !limpio || PLACEHOLDERS_VACANTE.includes(limpio);
}

/**
 * Normaliza una vacante al nombre canónico oficial en mayúsculas sin acentos,
 * unificando variaciones tipográficas comunes.
 */
export function normalizarVacante(valor: unknown): string {
  if (!valor || typeof valor !== 'string') return '';
  const limpio = limpiarVacante(valor);
  if (esPlaceholderVacante(limpio)) return '';
  const sinAcentos = limpio.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
  if (sinAcentos.includes('CAJER') || sinAcentos.includes('ESCAN')) {
    return 'CAJERA O ESCANER';
  }
  if (sinAcentos.includes('OPERADOR') && sinAcentos.includes('GENERAL')) {
    return 'OPERADOR GENERAL';
  }
  return sinAcentos;
}
