import { LRUCache } from 'lru-cache';
import { NextRequest } from 'next/server';

const rateLimitOptions = {
  max: 500, // Maximum number of IPs to track
  ttl: 60 * 1000, // 1 minute in milliseconds
};

const tokenCache = new LRUCache<string, number>(rateLimitOptions);

export function rateLimit(request: NextRequest | Request, limit: number = 100) {
  // De dónde sale la IP, en orden de confianza:
  //
  // 1. `cf-connecting-ip`: lo pone cloudflared, que es el ÚNICO camino desde
  //    internet (los puertos del compose están atados a 127.0.0.1). El cliente
  //    no lo puede falsear porque cloudflared lo sobrescribe.
  // 2. `x-forwarded-for`: se toma la ÚLTIMA entrada, no la primera. La cadena
  //    es "cliente, proxy1, proxy2" y cada proxy AÑADE al final, así que la
  //    primera entrada es justamente la que el cliente controla. Tomándola,
  //    bastaba mandar un `X-Forwarded-For` distinto en cada petición para
  //    estrenar cubeta y saltarse el límite por completo (verificado: 25/25
  //    peticiones pasaban rotando la cabecera).
  // 3. `x-real-ip` y, por último, una constante.
  const forwarded = request.headers.get('x-forwarded-for');
  const forwardedParts = forwarded
    ? forwarded.split(',').map((p) => p.trim()).filter(Boolean)
    : [];
  const ip = request.headers.get('cf-connecting-ip') ||
             (forwardedParts.length > 0 ? forwardedParts[forwardedParts.length - 1] : null) ||
             request.headers.get('x-real-ip') ||
             '127.0.0.1';

  const tokenCount = tokenCache.get(ip) || 0;
  
  if (tokenCount >= limit) {
    return { success: false, limit, current: tokenCount, remaining: 0 };
  }
  
  tokenCache.set(ip, tokenCount + 1);
  return { success: true, limit, current: tokenCount + 1, remaining: limit - (tokenCount + 1) };
}
