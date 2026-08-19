import { NextRequest, NextResponse } from "next/server";
import { WAHA_BASE, WAHA_API_KEY } from "@/lib/waha";

/**
 * Proxy de solo lectura hacia WAHA para mostrar media de conversaciones
 * (audios, imágenes, documentos que manda el candidato) en el CRM.
 *
 * La sesión ya la exige src/proxy.ts, que niega por defecto todo lo que no
 * esté en su lista pública. Este allowlist es la segunda capa: sin él, un
 * usuario con sesión podría usar la X-Api-Key de administrador de WAHA que
 * inyectamos aquí para llegar a cualquier endpoint GET del motor
 * (/api/sessions, /api/contacts, ...), no solo a los archivos.
 *
 * Las URLs llegan reescritas por proxyMediaUrl() en src/lib/formatters.ts,
 * que cambia `http://waha:3000/` por `/api/waha-media/`; el resto del path
 * es tal cual lo sirve WAHA, o sea `api/files/<sesion>/<archivo>`.
 */
const ALLOWED_PREFIXES = ["api/files/", "files/"];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const p = await params;
    const segments = p.path ?? [];

    // `..` nunca aparece en un path legítimo de WAHA y es la vía obvia para
    // salirse del prefijo permitido.
    if (segments.some((segment) => segment === "." || segment === "..")) {
      return new NextResponse("Ruta inválida", { status: 400 });
    }

    const path = segments.join("/");
    if (!ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      console.error(
        `[seguridad] waha-media rechazó un path fuera del allowlist: ${path}. ` +
          "Si es media legítima, agrega su prefijo a ALLOWED_PREFIXES."
      );
      return new NextResponse("Ruta no permitida", { status: 403 });
    }

    const targetUrl = `${WAHA_BASE}/${path}${req.nextUrl.search}`;

    // Fetch the media from WAHA API with the required X-Api-Key header
    const response = await fetch(targetUrl, {
      method: "GET",
      headers: {
        "X-Api-Key": WAHA_API_KEY,
        "Accept": "*/*",
      },
    });

    if (!response.ok) {
      console.error(`Error fetching WAHA media. Status: ${response.status} ${response.statusText}`);
      return new NextResponse(`Error fetching media: ${response.statusText}`, { status: response.status });
    }

    // Set the appropriate headers for the file
    const headers = new Headers();
    const contentType = response.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);

    // Pipe the binary data to the client
    return new NextResponse(response.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("Error in WAHA media proxy:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
