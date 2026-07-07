import { NextResponse } from "next/server";
import { ENV } from "@/lib/env";

const N8N_BASE_URL = "http://localhost:5678";
const ALLOWED_PATHS = [
  "/webhook",
  "/api/v1/executions",
  "/api/v1/workflows"
];

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const params = await context.params;
  return handleProxy(request, params.path);
}

export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const params = await context.params;
  return handleProxy(request, params.path);
}

export async function PUT(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const params = await context.params;
  return handleProxy(request, params.path);
}

export async function DELETE(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const params = await context.params;
  return handleProxy(request, params.path);
}

async function handleProxy(request: Request, pathArray: string[]) {
  try {
    // Reconstruir la URL
    const pathname = "/" + pathArray.join("/");
    
    // Validar si la ruta está permitida (debe iniciar con uno de los paths permitidos)
    const isAllowed = ALLOWED_PATHS.some(allowedPath => pathname.startsWith(allowedPath));
    if (!isAllowed) {
      return NextResponse.json({ success: false, error: "403 Forbidden" }, { status: 403 });
    }

    // Pasar los search params (query string)
    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    
    let targetUrl = `${N8N_BASE_URL}${pathname}`;
    if (queryString) {
      targetUrl += `?${queryString}`;
    }

    // Configurar Headers, inyectando la llave secreta directamente
    const headers = new Headers();
    headers.set("Authorization", ENV.N8N_SECRET);
    
    // Si viene con un Content-Type, respetarlo (importante para POSTs)
    const contentType = request.headers.get("Content-Type");
    if (contentType) {
      headers.set("Content-Type", contentType);
    }
    
    // Preparar opciones
    const options: RequestInit = {
      method: request.method,
      headers,
    };

    // Agregar el body si no es GET/HEAD
    if (request.method !== "GET" && request.method !== "HEAD") {
      const body = await request.text();
      if (body) {
        options.body = body;
      }
    }

    // Llamar a n8n
    const response = await fetch(targetUrl, options);
    
    // Obtener contenido
    const data = await response.text();

    // Devolver la misma respuesta de n8n al cliente
    return new NextResponse(data, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "application/json",
      },
    });

  } catch (error: any) {
    console.error("Proxy n8n Error:", error);
    return NextResponse.json({ success: false, error: "Error en el proxy de n8n" }, { status: 500 });
  }
}
