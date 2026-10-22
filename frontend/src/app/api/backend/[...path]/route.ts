import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import type { JWTPayload } from "jose";

import { getSession } from "@/lib/auth";
import { pool } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

const BACKEND_API_BASE = process.env.BACKEND_API_BASE || "http://localhost:8000";
// Solo los endpoints de citas que el CRM necesita desde el navegador.
const ALLOWED_PATHS = [
  "/internal/citas",
];

let warnedNoKey = false;

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const params = await context.params;
  return handleProxy(request, params.path);
}

export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const params = await context.params;
  return handleProxy(request, params.path);
}

/** Calendarios (en minúsculas) de los reclutadores de una empresa. */
async function calendariosDeEmpresa(empresaId: string | null): Promise<Set<string>> {
  const res = await pool.query(
    `SELECT LOWER(calendar_id) AS cal FROM reclutadores WHERE empresa_id = $1 AND calendar_id IS NOT NULL AND calendar_id != ''`,
    [empresaId]
  );
  return new Set(res.rows.map((r: { cal: string }) => r.cal));
}

/**
 * Las acciones de escritura del backend (cancelar, reagendar, bloquear) no
 * conocen la sesión, así que el permiso se decide aquí: el calendario y el
 * candidato tienen que ser de la empresa del usuario (ROOT queda exento), y
 * cancelar exige la contraseña del propio usuario, verificada en el servidor.
 * Devuelve el body a reenviar, o una respuesta de error.
 */
async function autorizarEscritura(
  request: Request,
  pathname: string,
  session: JWTPayload
): Promise<{ body: string } | { error: NextResponse }> {
  const deny = (error: string, status = 403) => ({ error: NextResponse.json({ success: false, error }, { status }) });
  const rol = session.rol as string;
  if (!["ADMIN", "ROOT", "ENCARGADO", "RECLUTADOR"].includes(rol)) return deny("Permisos insuficientes");

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(await request.text());
  } catch {
    return deny("Body inválido", 400);
  }

  if (pathname.endsWith("/cancelar")) {
    if (!rateLimit(request, 10).success) return deny("Demasiados intentos", 429);
    const password = typeof data.password === "string" ? data.password : "";
    const userRes = await pool.query(`SELECT password_hash FROM usuarios WHERE usuario = $1`, [session.usuario]);
    if (!password || userRes.rowCount === 0 || !(await bcrypt.compare(password, userRes.rows[0].password_hash))) {
      return deny("Contraseña incorrecta", 401);
    }
    delete data.password;
  }

  if (rol !== "ROOT") {
    const empresaId = (session.empresa_id as string | null) ?? null;
    if (!empresaId) return deny("Permisos insuficientes");
    const calendarId = typeof data.calendar_id === "string" ? data.calendar_id.toLowerCase() : "";
    if (calendarId && !(await calendariosDeEmpresa(empresaId)).has(calendarId)) {
      return deny("Calendario fuera de tu empresa");
    }
    const telefono = typeof data.telefono === "string" ? data.telefono : "";
    if (telefono && telefono !== "No registrado") {
      const cand = await pool.query(`SELECT 1 FROM candidatos WHERE telefono = $1 AND empresa_id = $2`, [telefono, empresaId]);
      if (cand.rowCount === 0) return deny("Candidato fuera de tu empresa");
    }
  }

  return { body: JSON.stringify(data) };
}

async function handleProxy(request: Request, pathArray: string[]) {
  try {
    const pathname = "/" + pathArray.join("/");

    const isAllowed = ALLOWED_PATHS.some((allowedPath) => pathname.startsWith(allowedPath));
    if (!isAllowed) {
      return NextResponse.json({ success: false, error: "403 Forbidden" }, { status: 403 });
    }

    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 });
    }

    let forwardBody: string | undefined;
    if (request.method !== "GET" && request.method !== "HEAD") {
      const auth = await autorizarEscritura(request, pathname, session);
      if ("error" in auth) return auth.error;
      forwardBody = auth.body;
    }

    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();

    let targetUrl = `${BACKEND_API_BASE}${pathname}`;
    if (queryString) {
      targetUrl += `?${queryString}`;
    }

    const headers = new Headers();
    const apiKey = process.env.PYTHON_SERVICE_API_KEY;
    if (apiKey) {
      headers.set("X-Api-Key", apiKey);
    } else if (!warnedNoKey) {
      console.warn(
        "[proxy backend] PYTHON_SERVICE_API_KEY no está configurada: las llamadas a " +
          "/internal/citas/* saldrán sin header X-Api-Key (backend las acepta en modo " +
          "fail-open, con su propia advertencia)."
      );
      warnedNoKey = true;
    }

    const contentType = request.headers.get("Content-Type");
    if (contentType) {
      headers.set("Content-Type", contentType);
    }

    const options: RequestInit = {
      method: request.method,
      headers,
    };

    if (forwardBody) {
      options.body = forwardBody;
    }

    const response = await fetch(targetUrl, options);
    let data = await response.text();

    // El backend devuelve los eventos de todos los calendarios; fuera de ROOT
    // solo se entregan los de la empresa de la sesión.
    if (pathname.endsWith("/google-calendar") && response.ok && session.rol !== "ROOT") {
      const permitidos = await calendariosDeEmpresa((session.empresa_id as string | null) ?? null);
      const eventos = JSON.parse(data) as { calendarId?: string }[];
      data = JSON.stringify(eventos.filter((e) => permitidos.has((e.calendarId || "").toLowerCase())));
    }

    return new NextResponse(data, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "application/json",
      },
    });
  } catch (error) {
    console.error("Proxy backend Error:", error);
    return NextResponse.json({ success: false, error: "Error en el proxy de backend" }, { status: 500 });
  }
}
