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
    // salirse del prefijo permitido. Next ya decodificó los segmentos: un
    // `/` o `\` dentro de uno venía de `%2F`/`%5C`, y un `%` restante sería
    // doble codificación. Uno vacío daría `//host/...`.
    if (segments.some((s) => !s || s.includes("..") || /[/\\%]/.test(s))) {
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

    // Se revalida sobre la URL ya construida: el pathname final (normalizado
    // por URL) y el host tienen que seguir siendo los de WAHA.
    const targetUrl = new URL(`/${path}`, WAHA_BASE);
    targetUrl.search = req.nextUrl.search;
    if (
      targetUrl.origin !== new URL(WAHA_BASE).origin ||
      !ALLOWED_PREFIXES.some((prefix) => targetUrl.pathname.startsWith(`/${prefix}`))
    ) {
      return new NextResponse("Ruta no permitida", { status: 403 });
    }

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

    // Solo imagen/audio/video se sirven inline (el chat los pinta con
    // <img>/<audio>/<video>). Lo demás (PDF, HTML, SVG que mande un candidato)
    // se fuerza a descarga para que no corra en el origen del CRM.
    const headers = new Headers({
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
    });
    const contentType = response.headers.get("content-type") || "";
    if (/^(image\/(?!svg)|audio\/|video\/)/i.test(contentType)) {
      headers.set("Content-Type", contentType);
    } else {
      headers.set("Content-Type", "application/octet-stream");
      headers.set("Content-Disposition", "attachment");
    }

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
