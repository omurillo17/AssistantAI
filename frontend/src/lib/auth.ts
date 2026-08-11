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

/**
 * Autenticación server-to-server (backend Python → frontend) vía header
 * `x-api-key`, comparado contra INTERNAL_API_KEY. La usan todas las rutas
 * internas: /api/webhook/*, /api/upload-cv, /api/prompt-context, /api/cron/*
 * y las lecturas server-to-server de /api/db/*.
 *
 * Se acepta N8N_API_KEY / WEBHOOK_API_KEY como respaldo para no romper
 * despliegues que aún no renombran la variable (mismo respaldo que
 * ENV.INTERNAL_API_KEY en backend/app/config.py). Eran dos llaves separadas
 * porque n8n no se podía redesplegar junto con el frontend; ahora los dos
 * extremos son nuestros y se despliegan juntos, así que basta una.
 *
 * Fail-open deliberado: si no hay ninguna llave configurada se permite el
 * acceso y se registra una advertencia, para que un despliegue sin la
 * variable siga funcionando en vez de tumbar la ingesta de WhatsApp.
 */
export function verifyInternalApiKey(request: Request): boolean {
  const expectedKey =
    process.env.INTERNAL_API_KEY || process.env.N8N_API_KEY || process.env.WEBHOOK_API_KEY;
  if (!expectedKey) {
    if (!warned.has("INTERNAL_API_KEY")) {
      console.warn(
        "[seguridad] INTERNAL_API_KEY no está configurada: /api/webhook/*, /api/upload-cv, " +
          "/api/prompt-context y /api/cron quedan sin autenticación. Configúrala en " +
          "frontend/.env.local con el mismo valor que la del backend."
      );
      warned.add("INTERNAL_API_KEY");
    }
    return true;
  }
  const provided = request.headers.get("x-api-key");
  return provided !== null && safeCompare(provided, expectedKey);
}
