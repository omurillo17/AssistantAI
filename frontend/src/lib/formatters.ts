/**
 * Shared utility functions for formatting and string sanitization across the application.
 */

/**
 * Cleans string input by removing invisible unicode characters
 * (variation selectors, zero-width spaces, etc.) and fallback text.
 */
export function cleanName(str?: string | null): string {
  if (!str) return "";
  
  // Remove invisible unicode characters like \uFE0F, \u200B-\u200D, \uFEFF
  const cleaned = str.replace(/[\uFE0F\u200B-\u200D\u200E\u200F\uFEFF]/g, "").trim();
  
  // Filter out default placeholder strings or phone numbers
  if (
    !cleaned ||
    cleaned === "Candidato" ||
    cleaned === "No registrado" ||
    cleaned === "Desconocido" ||
    /^\+?\d+$/.test(cleaned)
  ) {
    return "";
  }
  
  return cleaned;
}

/**
 * Returns the best display name for a candidate from their candidate object.
 */
export function getCandidateDisplayName(c: {
  nombre_ine?: string | null;
  nombre_solicitud?: string | null;
  nombre_constancia?: string | null;
  nombre_chat?: string | null;
  nombre?: string | null;
}): string {
  const name =
    cleanName(c.nombre_ine) ||
    cleanName(c.nombre_solicitud) ||
    cleanName(c.nombre_constancia) ||
    cleanName(c.nombre_chat) ||
    cleanName(c.nombre);

  return name || "Candidato Desconocido";
}

/**
 * Maps numeric nave IDs or strings (e.g. "1", "2", "3") to human-readable Nave names.
 */
export function formatNaveName(nave?: string | number | null): string {
  if (!nave) return "";
  const clean = String(nave).trim();
  if (clean === "1" || clean.toUpperCase() === "NAVE 1") return "Dulcería";
  if (clean === "2" || clean.toUpperCase() === "NAVE 2") return "CEDIS";
  if (clean === "3" || clean.toUpperCase() === "NAVE 3") return "Materias Primas";
  return clean;
}
