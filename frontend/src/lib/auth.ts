import { jwtVerify, type JWTPayload } from "jose";
import { timingSafeEqual } from "crypto";
import { ENV } from "@/lib/env";

export interface SessionPayload extends JWTPayload {
  authenticated?: boolean;
  usuario?: string;
  rol?: string;
  reclutador_id?: string | null;
  empresa_id?: string | null;
  grupo_id?: string | null;
  naves_asignadas?: string[];
}

/**
 * Verifica la sesión JWT de la cookie `tci_session`.
 * Acepta un `Request` (lee el header Cookie) o directamente el token.
 * Devuelve el payload o `null` si no hay sesión válida. Nunca usa un
 * secreto de respaldo: si JWT_SECRET no está configurado, falla cerrado.
 */
export async function getSession(source: Request | string | undefined | null): Promise<SessionPayload | null> {
  let token: string | undefined;

  if (typeof source === "string") {
    token = source;
  } else if (source) {
    token = source.headers
      .get("cookie")
      ?.split("; ")
      .find((row) => row.startsWith("tci_session="))
      ?.split("=")[1];
  }

  if (!token) return null;

  try {
    const secretKey = new TextEncoder().encode(ENV.JWT_SECRET);
    const { payload } = await jwtVerify(token, secretKey);
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Comprueba si la sesión tiene alguno de los roles indicados.
 * Uso: requireRole(payload, "ADMIN", "ROOT")
 */
export function requireRole(payload: SessionPayload | null, ...roles: string[]): boolean {
  if (!payload?.rol) return false;
  return roles.includes(payload.rol);
}

/**
 * Normaliza un nombre de usuario: minúsculas, sin acentos, sin espacios extremos.
 * Debe usarse SIEMPRE que se cree o busque un usuario para que login y alta
 * apliquen la misma regla.
 */
export function normalizeUsername(usuario: string): string {
  return usuario.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

const warned = new Set<string>();

/** Comparación en tiempo constante para no filtrar la llave por timing. */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function checkApiKey(request: Request, envVar: string, endpoints: string): boolean {
  const expectedKey = process.env[envVar];
  if (!expectedKey) {
    if (!warned.has(envVar)) {
      console.warn(
        `[seguridad] ${envVar} no está configurada: ${endpoints} quedan sin autenticación. Configúrala en frontend/.env.local y asegúrate de que n8n mande el header x-api-key con el mismo valor.`
      );
      warned.add(envVar);
    }
    return true;
  }
  const provided = request.headers.get("x-api-key");
  return provided !== null && safeCompare(provided, expectedKey);
}

/**
 * Autenticación server-to-server (n8n → frontend) vía header `x-api-key`,
 * comparado contra N8N_API_KEY. Usada por /api/prompt-context y
 * /api/cron/process-outbox (el flujo 5 de n8n ya envía este header).
 */
export function verifyInternalApiKey(request: Request): boolean {
  return checkApiKey(request, "N8N_API_KEY", "/api/prompt-context y /api/cron");
}

/**
 * Autenticación de los webhooks que reciben datos desde n8n
 * (/api/webhook/*, /api/upload-cv), comparada contra WEBHOOK_API_KEY.
 * Es una variable separada de N8N_API_KEY para poder activar la protección
 * solo cuando los flujos de n8n ya envíen el header (los JSON de
 * virgo_data/workflows ya lo incluyen; hay que reimportarlos en n8n).
 * Mientras WEBHOOK_API_KEY no esté configurada, se permite el acceso y se
 * registra una advertencia.
 */
export function verifyWebhookApiKey(request: Request): boolean {
  return checkApiKey(request, "WEBHOOK_API_KEY", "/api/webhook/* y /api/upload-cv");
}
