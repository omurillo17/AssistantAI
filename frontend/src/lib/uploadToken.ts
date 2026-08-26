/**
 * Token firmado y de vida corta para descargar un archivo de /uploads sin
 * sesión de navegador.
 *
 * Por qué existe: los expedientes (CV, INE, RFC, constancia) se sirven como
 * estáticos desde /uploads, y estaban abiertos a internet -- con la URL bastaba
 * para bajar el documento de identidad de un candidato. El nombre del archivo
 * es `<telefono>_<timestamp>.<ext>`, así que tampoco era secreto.
 *
 * No se puede exigir sesión y ya: WAHA descarga el archivo por HTTP
 * (`http://frontend:3001/uploads/...`, ver enviarImagenCandidato en
 * src/lib/waha.ts) para reenviarlo por WhatsApp, y esa petición no lleva
 * cookie. Distinguir "viene de la red interna" por cabeceras no sirve: Next
 * añade `x-forwarded-*` a TODAS las peticiones, y el `Host` lo puede falsear
 * quien llegue de fuera. Un token firmado sí es infalsificable.
 *
 * Se usa Web Crypto (no `node:crypto`) porque proxy.ts corre en el runtime
 * Edge, donde `crypto.subtle` está disponible pero `node:crypto` no.
 */

const TTL_SEGUNDOS_POR_DEFECTO = 300; // 5 min: el envío a WAHA es inmediato

function getSecret(): string | null {
  return process.env.INTERNAL_API_KEY || process.env.JWT_SECRET || null;
}

function base64url(bytes: ArrayBuffer): string {
  const chars = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(chars).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function firmar(mensaje: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const firma = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(mensaje));
  return base64url(firma);
}

/** Comparación en tiempo constante para no filtrar la firma byte a byte. */
function comparaSegura(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

/**
 * Firma una ruta de /uploads. Devuelve `<expiracion>.<firma>` o null si no hay
 * secreto configurado (el llamador debe tratarlo como error, no seguir sin él).
 */
export async function firmarRutaUpload(
  pathname: string,
  ttlSegundos: number = TTL_SEGUNDOS_POR_DEFECTO
): Promise<string | null> {
  const secret = getSecret();
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + ttlSegundos;
  const firma = await firmar(`${pathname}:${exp}`, secret);
  return `${exp}.${firma}`;
}

/** Verifica el token contra la ruta pedida. Falla CERRADO ante cualquier duda. */
export async function verificarTokenUpload(pathname: string, token: string | null): Promise<boolean> {
  if (!token) return false;
  const secret = getSecret();
  if (!secret) return false;

  const punto = token.indexOf('.');
  if (punto <= 0) return false;

  const exp = Number(token.slice(0, punto));
  const firmaRecibida = token.slice(punto + 1);
  if (!Number.isFinite(exp) || !firmaRecibida) return false;
  if (Math.floor(Date.now() / 1000) > exp) return false;

  const firmaEsperada = await firmar(`${pathname}:${exp}`, secret);
  return comparaSegura(firmaRecibida, firmaEsperada);
}
