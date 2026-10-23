/**
 * Normaliza el teléfono que escribe el candidato en el portal (público) a los
 * 10 dígitos nacionales. Acepta 10 dígitos, o 12/13 con prefijo 52/521.
 * Cualquier otra cosa devuelve null: el match en BD es por sufijo exacto de
 * 10 dígitos, nunca por fragmento.
 */
export function normalizarTelefonoPortal(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const d = raw.replace(/\D/g, '');
  if (d.length === 10) return d;
  if ((d.length === 12 && d.startsWith('52')) || (d.length === 13 && d.startsWith('521'))) {
    return d.slice(-10);
  }
  return null;
}
