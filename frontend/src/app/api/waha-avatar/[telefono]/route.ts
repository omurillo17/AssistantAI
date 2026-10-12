import { NextRequest, NextResponse } from "next/server";
import { WAHA_BASE, WAHA_API_KEY, WAHA_SESSION, normalizarChatIdWaha } from "@/lib/waha";

/**
 * Foto de perfil de WhatsApp de un candidato, sin almacenarla en ningún lado.
 *
 * WAHA no sirve la imagen: devuelve la URL pública del CDN de Meta
 * (`GET /api/contacts/profile-picture` -> { profilePictureURL }). Esa URL trae
 * una firma con caducidad (`oe=`, ~10 días), así que no tiene sentido guardarla
 * en la BD; se vuelve a pedir cuando expira el cache en memoria.
 *
 * Aquí solo hacemos de puente: pedimos la URL a WAHA (con la X-Api-Key, que
 * nunca sale del servidor) y retransmitimos los bytes al navegador. Nada toca
 * disco ni base de datos, y el CSP de next.config.ts sigue sin necesitar
 * abrirse a pps.whatsapp.net porque para el navegador la imagen es same-origin.
 *
 * La sesión la exige src/proxy.ts, que niega por defecto lo que no esté en su
 * lista pública.
 */

// Cache del `profilePictureURL` (no de la imagen). La bandeja pinta ~50
// avatares por carga; sin esto sería una llamada a WAHA por avatar y por
// refresco de la lista.
type EntradaCache = { url: string | null; expira: number };
const cacheUrls = new Map<string, EntradaCache>();

const TTL_CON_FOTO = 60 * 60 * 1000; // 1 h
const TTL_SIN_FOTO = 15 * 60 * 1000; // 15 min: privacidad activada o contacto nuevo
const MAX_ENTRADAS = 2000;

function leerCache(clave: string): EntradaCache | null {
  const hit = cacheUrls.get(clave);
  if (!hit) return null;
  if (hit.expira < Date.now()) {
    cacheUrls.delete(clave);
    return null;
  }
  return hit;
}

function guardarCache(clave: string, url: string | null) {
  // Poda simple: el Map conserva orden de inserción, así que el primero es el
  // más viejo. Evita que el proceso crezca sin límite con teléfonos únicos.
  if (cacheUrls.size >= MAX_ENTRADAS) {
    const masViejo = cacheUrls.keys().next().value;
    if (masViejo !== undefined) cacheUrls.delete(masViejo);
  }
  cacheUrls.set(clave, {
    url,
    expira: Date.now() + (url ? TTL_CON_FOTO : TTL_SIN_FOTO),
  });
}

async function obtenerUrlFoto(chatId: string): Promise<string | null> {
  if (!WAHA_BASE) {
    return null;
  }
  const enCache = leerCache(chatId);
  if (enCache) return enCache.url;

  const endpoint = `${WAHA_BASE}/api/contacts/profile-picture?session=${encodeURIComponent(
    WAHA_SESSION
  )}&contactId=${encodeURIComponent(chatId)}`;

  try {
    const res = await fetch(endpoint, {
      headers: { "X-Api-Key": WAHA_API_KEY, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn(`[waha-avatar] WAHA respondió ${res.status} para ${chatId}`);
      guardarCache(chatId, null);
      return null;
    }

    const data = (await res.json()) as { profilePictureURL?: string | null };
    const url = data?.profilePictureURL || null;
    guardarCache(chatId, url);
    return url;
  } catch (fetchErr) {
    console.warn(`[waha-avatar] error contactando WAHA para ${chatId}:`, fetchErr);
    return null;
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ telefono: string }> }
) {
  try {
    const { telefono } = await params;
    // Solo dígitos: el path no debe poder inyectar otro contactId ni query.
    if (!/^\d{6,20}$/.test(telefono)) {
      return new NextResponse("Teléfono inválido", { status: 400 });
    }

    const chatId = normalizarChatIdWaha(telefono);
    const url = await obtenerUrlFoto(chatId);
    // 404 = "sin foto"; el componente cae a las iniciales.
    if (!url) return new NextResponse("Sin foto de perfil", { status: 404 });

    // La URL viene de WAHA, pero la validamos igual antes de que el servidor
    // haga una petición saliente hacia ella.
    let destino: URL;
    try {
      destino = new URL(url);
    } catch {
      return new NextResponse("URL de foto inválida", { status: 502 });
    }
    if (
      destino.protocol !== "https:" ||
      !/(^|\.)whatsapp\.net$/.test(destino.hostname)
    ) {
      console.error(`[seguridad] waha-avatar descartó un host inesperado: ${destino.hostname}`);
      return new NextResponse("Origen de foto no permitido", { status: 502 });
    }

    const imagen = await fetch(destino, { signal: AbortSignal.timeout(8000) });
    if (!imagen.ok || !imagen.body) {
      // La firma pudo caducar antes que el cache; se fuerza a repedirla.
      cacheUrls.delete(chatId);
      return new NextResponse("No se pudo obtener la foto", { status: 502 });
    }

    const contentType = imagen.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      return new NextResponse("El CDN no devolvió una imagen", { status: 502 });
    }

    return new NextResponse(imagen.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        // `private`: es un dato del candidato, no debe quedar en caches
        // compartidos. El navegador la reusa una hora sin volver a pedirla.
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error("[waha-avatar] error inesperado:", error);
    return new NextResponse("Error interno", { status: 500 });
  }
}
