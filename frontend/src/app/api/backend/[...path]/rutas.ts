/**
 * Allowlist EXACTO (ruta + método) de lo que el CRM puede pedirle al backend
 * desde el navegador: los endpoints de citas que usa /calendario
 * (ver backend/app/routers/citas.py).
 */
const RUTAS_PERMITIDAS: Record<string, string> = {
  "/internal/citas/google-calendar": "GET",
  "/internal/citas/cancelar": "POST",
  "/internal/citas/reagendar": "POST",
  "/internal/citas/bloqueo": "POST",
};

/**
 * Construye la URL destino en el backend, o null si no está permitida.
 * Los segmentos llegan ya decodificados por Next, así que un `%2F` o `%2e%2e`
 * aparece aquí como `/` o `..`; un `%` restante sería doble codificación.
 * Un segmento vacío produciría `//host/...` (URL relativa al protocolo).
 */
export function construirDestinoBackend(
  base: string,
  method: string,
  segmentos: string[],
  search: string
): URL | null {
  if (segmentos.some((s) => !s || s === "." || s === ".." || /[/\\%]/.test(s))) return null;
  const destino = new URL("/" + segmentos.join("/"), base);
  if (destino.origin !== new URL(base).origin) return null;
  if (RUTAS_PERMITIDAS[destino.pathname] !== method) return null;
  destino.search = search;
  return destino;
}
