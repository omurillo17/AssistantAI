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
             forwardedParts.at(-1) ||
             request.headers.get('x-real-ip') ||
             '127.0.0.1';

  const tokenCount = tokenCache.get(ip) || 0;
  
  if (tokenCount >= limit) {
    return { success: false, limit, current: tokenCount, remaining: 0 };
  }
  
  tokenCache.set(ip, tokenCount + 1);
  return { success: true, limit, current: tokenCount + 1, remaining: limit - (tokenCount + 1) };
}

// Bloqueo por usuario, además del límite por IP: con muchas IPs (botnet, o
// rotando la salida) el límite por IP no frena probar contraseñas contra UNA
// cuenta. 5 fallos seguidos bloquean ese usuario 15 min; cada fallo renueva el
// plazo y un login correcto lo limpia. La clave es el usuario tal como se
// intentó (exista o no), para no revelar qué cuentas existen.
// ponytail: en memoria del proceso; se pierde al reiniciar y no se comparte
// entre réplicas. Pasar a la base si algún día hay más de un frontend.
const MAX_FALLOS_LOGIN = 5;
const fallosLogin = new LRUCache<string, number>({ max: 5000, ttl: 15 * 60 * 1000 });

export function usuarioBloqueado(usuario: string): boolean {
  return (fallosLogin.get(usuario) ?? 0) >= MAX_FALLOS_LOGIN;
}

export function registrarFalloLogin(usuario: string): void {
  fallosLogin.set(usuario, (fallosLogin.get(usuario) ?? 0) + 1);
}

export function limpiarFallosLogin(usuario: string): void {
  fallosLogin.delete(usuario);
}
