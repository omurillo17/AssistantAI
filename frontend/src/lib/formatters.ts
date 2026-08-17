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

export function formatPhoneNumber(phone?: string | null): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length > 13) {
    return ""; // Es un LID largo, no un teléfono
  }
  if (digits.startsWith("521") && digits.length === 13) {
    const local = digits.slice(3);
    return `+52 ${local.slice(0, 2)} ${local.slice(2, 6)} ${local.slice(6)}`;
  }
  if (digits.startsWith("52") && digits.length === 12) {
    const local = digits.slice(2);
    return `+52 ${local.slice(0, 2)} ${local.slice(2, 6)} ${local.slice(6)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 2)} ${digits.slice(2, 6)} ${digits.slice(6)}`;
  }
  return digits ? `+${digits}` : "";
}

/**
 * Returns the best display name for a candidate from their candidate object.
 * Falls back to their real phone number if no name is available.
 */
export function getCandidateDisplayName(c: {
  nombre_ine?: string | null;
  nombre_solicitud?: string | null;
  nombre_constancia?: string | null;
  nombre_chat?: string | null;
  nombre?: string | null;
  telefono?: string | null;
}): string {
  const name =
    cleanName(c.nombre_ine) ||
    cleanName(c.nombre_solicitud) ||
    cleanName(c.nombre_constancia) ||
    cleanName(c.nombre_chat) ||
    cleanName(c.nombre);

  if (name) return name;
  if (c.telefono) {
    const formatted = formatPhoneNumber(c.telefono);
    if (formatted) return formatted;
  }
  return "Candidato";
}

/**
 * Maps numeric nave IDs or strings (e.g. "1", "2", "3") to human-readable Nave names.
 */
export function formatNaveName(nave?: string | number | null): string {
  if (!nave) return "";
  const clean = String(nave).trim();
  const normalized = clean.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

  if (clean === "1" || normalized === "NAVE 1" || normalized.includes("DULCERIA")) return "DULCERIA";
  if (clean === "2" || normalized === "NAVE 2" || normalized.includes("CEDIS")) return "CEDIS";
  if (clean === "3" || normalized === "NAVE 3" || normalized.includes("MATERIAS PRIMAS")) return "MATERIAS PRIMAS";
  if (normalized.includes("MATRIZ")) return "MATRIZ";
  if (normalized.includes("SUCURSAL")) return "SUCURSAL";
  if (normalized.includes("VITALI")) return "VITALI";
  return clean.toUpperCase();
}

/**
 * Rewrites WAHA/localhost media URLs to use the internal Next.js media proxy.
 */
export function proxyMediaUrl(url?: string | null): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  return trimmed.replace(/^https?:\/\/(localhost|waha)(:\d+)?\//, "/api/waha-media/");
}

/**
 * Extracts a media URL from a raw message text if present.
 */
export function detectMediaUrl(content?: string | null): string | null {
  if (!content) return null;
  const match = content.match(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|mp4|ogg|opus|mp3|m4a|pdf|doc|docx)/i);
  return match ? match[0] : null;
}

export function isAudioType(mt?: string | null): boolean {
  return !!mt && ["audio", "ptt", "voice"].includes(mt.toLowerCase());
}

export function isImageType(mt?: string | null): boolean {
  return !!mt && ["image", "sticker"].includes(mt.toLowerCase());
}

export function isVideoType(mt?: string | null): boolean {
  return mt === "video";
}

export function isDocumentType(mt?: string | null): boolean {
  return !!mt && ["document", "file"].includes(mt.toLowerCase());
}

