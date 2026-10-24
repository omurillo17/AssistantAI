/**
 * Código de un solo uso (OTP) por WhatsApp para el portal público del candidato.
 *
 * Antes bastaba conocer un teléfono para ver nombre/vacante y subir documentos
 * a nombre de esa persona. Ahora el portal manda un código de 6 dígitos al
 * WhatsApp registrado; quien lo teclea recibe un token firmado (30 min) que
 * /api/portal/subir exige y del que toma el teléfono y la empresa.
 *
 * Solo se guarda el HASH del código, nunca el código.
 */
import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { LRUCache } from 'lru-cache';
import { ENV } from '@/lib/env';

const VIGENCIA_CODIGO_MS = 10 * 60 * 1000;
const MAX_INTENTOS = 5;
const MAX_ENVIOS_POR_HORA = 3;
export const ESPERA_REENVIO_MS = 60 * 1000;
const HORA_MS = 60 * 60 * 1000;
const VIGENCIA_TOKEN_S = 30 * 60;

type Entrada = {
  envios: number[]; // timestamps de envío de la última hora (límite por teléfono)
  codigo?: { hash: Buffer; exp: number; intentos: number };
};

// ponytail: en memoria del proceso (una sola réplica de frontend); los códigos
// se pierden al reiniciar. Pasar a una tabla en BD si se escala a más réplicas.
// Va en globalThis para que todas las rutas compartan la misma instancia.
const g = globalThis as unknown as { __portalOtp?: LRUCache<string, Entrada> };
const store = (g.__portalOtp ??= new LRUCache<string, Entrada>({ max: 10000, ttl: HORA_MS }));

function hashCodigo(codigo: string, telefono: string, empresaId: string | null): Buffer {
  return createHash('sha256').update(`${codigo}:${telefono}:${empresaId ?? ''}`).digest();
}

export type ResultadoSolicitud =
  | { ok: true; codigo: string }
  | { ok: false; motivo: 'espera' | 'limite' };

/**
 * Genera y guarda un código nuevo (reemplaza al anterior). Aplica el límite de
 * 3 envíos por hora y 60 s entre envíos al mismo teléfono.
 */
export function generarCodigo(telefono: string, empresaId: string | null, ahora = Date.now()): ResultadoSolicitud {
  const entrada = store.get(telefono) ?? { envios: [] };
  entrada.envios = entrada.envios.filter((t) => ahora - t < HORA_MS);
  const ultimo = entrada.envios.at(-1);
  if (ultimo !== undefined && ahora - ultimo < ESPERA_REENVIO_MS) return { ok: false, motivo: 'espera' };
  if (entrada.envios.length >= MAX_ENVIOS_POR_HORA) return { ok: false, motivo: 'limite' };

  const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
  entrada.envios.push(ahora);
  entrada.codigo = { hash: hashCodigo(codigo, telefono, empresaId), exp: ahora + VIGENCIA_CODIGO_MS, intentos: 0 };
  store.set(telefono, entrada);
  return { ok: true, codigo };
}

/**
 * Verifica el código. De un solo uso: se borra al acertar. Tras 5 fallos (o
 * vencido) se invalida y hay que pedir otro.
 */
export function verificarCodigo(telefono: string, empresaId: string | null, codigo: string, ahora = Date.now()): boolean {
  const entrada = store.get(telefono);
  const actual = entrada?.codigo;
  if (!entrada || !actual) return false;
  if (ahora > actual.exp || actual.intentos >= MAX_INTENTOS) {
    delete entrada.codigo;
    return false;
  }
  if (timingSafeEqual(actual.hash, hashCodigo(codigo, telefono, empresaId))) {
    delete entrada.codigo;
    return true;
  }
  actual.intentos++;
  if (actual.intentos >= MAX_INTENTOS) delete entrada.codigo;
  return false;
}

// --- Token del portal: base64url(payload).firma -----------------------------

type PayloadToken = { tel: string; emp: string | null; exp: number };

function firmar(payload: string): string {
  // Prefijo de dominio: la firma no sirve como ningún otro token del sistema.
  return createHmac('sha256', ENV.JWT_SECRET).update(`portal:${payload}`).digest('base64url');
}

export function firmarTokenPortal(telefono: string, empresaId: string | null, ahora = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ tel: telefono, emp: empresaId, exp: Math.floor(ahora / 1000) + VIGENCIA_TOKEN_S } satisfies PayloadToken)
  ).toString('base64url');
  return `${payload}.${firmar(payload)}`;
}

/** Devuelve teléfono y empresa del token, o null. Falla CERRADO. */
export function verificarTokenPortal(
  token: unknown,
  ahora = Date.now()
): { telefono: string; empresaId: string | null } | null {
  if (typeof token !== 'string') return null;
  const [payload, firma, sobra] = token.split('.');
  if (!payload || !firma || sobra !== undefined) return null;

  const esperada = Buffer.from(firmar(payload));
  const recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return null;

  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString()) as PayloadToken;
    if (typeof p.exp !== 'number' || Math.floor(ahora / 1000) > p.exp) return null;
    if (typeof p.tel !== 'string' || !/^\d{10}$/.test(p.tel)) return null;
    return { telefono: p.tel, empresaId: typeof p.emp === 'string' ? p.emp : null };
  } catch {
    return null;
  }
}
