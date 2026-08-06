import { NextResponse } from "next/server";

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

async function handleProxy(request: Request, pathArray: string[]) {
  try {
    const pathname = "/" + pathArray.join("/");

    const isAllowed = ALLOWED_PATHS.some((allowedPath) => pathname.startsWith(allowedPath));
    if (!isAllowed) {
      return NextResponse.json({ success: false, error: "403 Forbidden" }, { status: 403 });
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

    if (request.method !== "GET" && request.method !== "HEAD") {
      const body = await request.text();
      if (body) {
        options.body = body;
      }
    }

    const response = await fetch(targetUrl, options);
    const data = await response.text();

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
