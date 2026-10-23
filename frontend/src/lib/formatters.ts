/**
 * Shared utility functions for formatting and string sanitization across the application.
 */

/**
 * Placeholders que el pipeline escribe cuando no logra sacar un nombre real.
 * Se comparan en minúsculas y ya sin la puntuación envolvente, porque en la BD
 * aparecen envueltos en llaves ("{Desconocido}", "{{{Desconocido}}}") por un
 * serializador que arrastró las llaves de la plantilla.
 */
const PLACEHOLDERS = new Set([
  "candidato",
  "no registrado",
  "desconocido",
  "sin nombre",
  "usuario",
]);

const LEADING_NAME_SYMBOLS = new Set('{}[])()<>"\'`~*_.,;:!¡¿?@#/\\|-');
const TRAILING_NAME_SYMBOLS = new Set('{}[])()<>"\'`~*_,;:!¡¿?@#/\\|-');

/**
 * Deja el pushname de WhatsApp en algo presentable, o cadena vacía si no queda
 * nada que parezca el nombre de una persona.
 *
 * El pushname lo escribe el propio candidato y llega tal cual: con emojis
 * ("Michelle Torres🍒"), en unicode decorativo ("𝓒𝓐𝓡𝓣𝓔𝓡"), como handle de red
 * social ("cervantezgerardo91") o como placeholder del pipeline. Aquí se limpia
 * lo decorativo y se rechaza lo que no es un nombre; quien decide el reemplazo
 * es getCandidateDisplayName(), que cae al siguiente campo o al teléfono.
 *
 * Se usa \p{L} (cualquier alfabeto) en vez de A-Za-z a propósito: hay
 * candidatos registrados en árabe y descartarlos sería tratar su nombre real
 * como basura.
 */
export function cleanName(str?: string | null): string {
  if (!str) return "";

  // NFKC convierte las variantes tipográficas que WhatsApp deja pasar en sus
  // letras normales: "𝓒𝓐𝓡𝓣𝓔𝓡 𝓢𝓛𝓞𝓣𝓣" -> "CARTER SLOTT".
  let cleaned = str.normalize("NFKC");

  // Emojis, banderas, pictogramas y los invisibles que los acompañan.
  cleaned = cleaned
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}]/gu, "")
    .replace(/[\uFE0F\uFE0E\u200B-\u200D\u200E\u200F\uFEFF]/g, "");

  // Puntuación envolvente y espacios repetidos que deja la limpieza anterior.
  cleaned = cleaned.trim();
  let start = 0;
  while (start < cleaned.length && LEADING_NAME_SYMBOLS.has(cleaned[start])) {
    start++;
  }
  let end = cleaned.length;
  while (end > start && TRAILING_NAME_SYMBOLS.has(cleaned[end - 1])) {
    end--;
  }
  cleaned = cleaned.slice(start, end).replace(/\s+/g, " ").trim();

  if (!cleaned) return "";
  if (PLACEHOLDERS.has(cleaned.toLowerCase())) return "";

  // Un dígito delata un handle ("joelharo01", "Rdgoluv16") o un teléfono
  // guardado como nombre; los nombres de persona no llevan números.
  if (/\d/u.test(cleaned)) return "";

  // Con una sola letra no hay nombre que mostrar: son restos de un pushname
  // que era puro emoji.
  const letras = cleaned.match(/\p{L}/gu);
  if (!letras || letras.length < 2) return "";

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

const PLACEHOLDERS_NAVE = new Set([
  "NINGUNA",
  "GENERAL",
  "PENDIENTE",
  "DESCONOCIDA",
  "X",
  "NONE",
  "NULL",
  "SIN SUCURSAL",
  "NO DEFINIDA",
  "SIN ASIGNAR",
  "TODAS",
  "CUALQUIERA",
  "{NINGUNA}",
  "{GENERAL}",
  "{PENDIENTE}",
]);

/**
 * Maps numeric nave IDs or strings (e.g. "1", "2", "3") to human-readable Nave names.
 * Returns empty string for unrecognized values or placeholders.
 */
export function formatNaveName(nave?: string | number | null): string {
  if (!nave) return "";
  const clean = String(nave).trim();
  const normalized = clean.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

  if (PLACEHOLDERS_NAVE.has(normalized)) return "";

  if (clean === "1" || normalized === "NAVE 1" || normalized.includes("DULCERIA") || normalized.includes("MANDARINA")) return "DULCERIA";
  if (clean === "2" || normalized === "NAVE 2" || normalized.includes("CEDIS")) return "CEDIS";
  if (clean === "3" || normalized === "NAVE 3" || normalized.includes("MATERIAS PRIMAS")) return "MATERIAS PRIMAS";
  if (normalized.includes("MATRIZ")) return "MATRIZ";
  if (normalized.includes("SUCURSAL")) return "SUCURSAL";
  if (normalized.includes("VITALI")) return "VITALI";
  return "";
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
 * Extrae del texto la URL de un adjunto PROPIO: archivos de WAHA
 * (http://waha|localhost:<puerto>/..., que proxyMediaUrl reescribe),
 * /api/waha-media/ o /uploads/. Un https:// cualquiera que escriba el
 * candidato NO se trata como adjunto (se pintaría como imagen/link del CRM).
 */
export function detectMediaUrl(content?: string | null): string | null {
  if (!content) return null;
  const match = /(?:^|\s)((?:https?:\/\/(?:localhost|waha)(?::\d+)?\/|\/api\/waha-media\/|\/uploads\/)[\w.@/-]+\.(?:jpg|jpeg|png|gif|webp|mp4|ogg|opus|mp3|m4a|pdf|doc|docx))/i.exec(content);
  // Sin `..`: el navegador lo normaliza y la URL saldría de /uploads.
  return match && !match[1].includes("..") ? match[1] : null;
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

