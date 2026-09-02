/**
 * Utilidades centralizadas para normalización y formateo de números de teléfono
 * en todo el frontend (compatible con Meta Cloud API y WAHA).
 */

/**
 * Extrae únicamente los dígitos numéricos de cualquier cadena telefónica.
 */
export function limpiarDigitos(telefono?: string | null): string {
  if (!telefono) return '';
  return telefono.split('@')[0].replace(/\D/g, '');
}

/**
 * Obtiene los últimos 10 dígitos (clave estándar en México / BD de reclutadores y candidatos).
 */
export function obtenerUltimos10Digitos(telefono?: string | null): string {
  const digitos = limpiarDigitos(telefono);
  return digitos.length >= 10 ? digitos.slice(-10) : digitos;
}

/**
 * Normaliza números para Meta Graph API.
 * Para México: Meta exige 52 + 10 dígitos (12 dígitos). Si viene como 521 + 10 dígitos (13 dígitos),
 * se remueve el '1' intermedio.
 */
export function normalizarNumeroMeta(telefono?: string | null): string {
  const digitos = limpiarDigitos(telefono);
  if (digitos.startsWith('521') && digitos.length === 13) {
    return '52' + digitos.slice(3);
  }
  if (digitos.length === 10) {
    return '52' + digitos;
  }
  return digitos;
}

/**
 * Convierte un teléfono a formato chatId estándar (ej: 523323379399@c.us o @lid).
 */
export function aChatId(telefono?: string | null): string {
  if (!telefono) return '';
  if (telefono.includes('@')) return telefono;
  const digitos = limpiarDigitos(telefono);
  return digitos.length > 13 ? `${digitos}@lid` : `${digitos}@c.us`;
}

/**
 * Formato visual legible para el usuario (ej: +52 33 3248 3278).
 */
export function formatearTelefonoDisplay(telefono?: string | null): string {
  const digitos = limpiarDigitos(telefono);
  if (digitos.length === 10) {
    return `${digitos.slice(0, 2)} ${digitos.slice(2, 6)} ${digitos.slice(6)}`;
  }
  if (digitos.length === 12 && digitos.startsWith('52')) {
    return `+52 ${digitos.slice(2, 4)} ${digitos.slice(4, 8)} ${digitos.slice(8)}`;
  }
  if (digitos.length === 13 && digitos.startsWith('521')) {
    return `+52 ${digitos.slice(3, 5)} ${digitos.slice(5, 9)} ${digitos.slice(9)}`;
  }
  return telefono || '';
}
