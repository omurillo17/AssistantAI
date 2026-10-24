import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { generarCodigo, verificarCodigo, firmarTokenPortal, verificarTokenPortal } from './portalOtp';

const EMP = '11111111-1111-1111-1111-111111111111';
let n = 0;
// Teléfono distinto por prueba: el store es global y guarda el historial de envíos.
const tel = () => `55000000${String(++n).padStart(2, '0')}`;

function pedir(t: string, ahora = Date.now()) {
  const r = generarCodigo(t, EMP, ahora);
  if (!r.ok) throw new Error(r.motivo);
  return r.codigo;
}

beforeAll(() => {
  process.env.JWT_SECRET = 'secreto-de-prueba';
});

afterAll(() => {
  delete process.env.JWT_SECRET;
});

describe('código OTP del portal', () => {
  it('acepta el código correcto una sola vez', () => {
    const t = tel();
    const codigo = pedir(t);
    expect(codigo).toMatch(/^\d{6}$/);
    expect(verificarCodigo(t, EMP, codigo)).toBe(true);
    expect(verificarCodigo(t, EMP, codigo)).toBe(false);
  });

  it('el código no sirve para otra empresa', () => {
    const t = tel();
    const codigo = pedir(t);
    expect(verificarCodigo(t, null, codigo)).toBe(false);
    expect(verificarCodigo(t, EMP, codigo)).toBe(true);
  });

  it('tras 5 fallos invalida el código aunque luego llegue el correcto', () => {
    const t = tel();
    const codigo = pedir(t);
    const malo = codigo === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect(verificarCodigo(t, EMP, malo)).toBe(false);
    expect(verificarCodigo(t, EMP, codigo)).toBe(false);
  });

  it('vence a los 10 minutos', () => {
    const t = tel();
    const ahora = Date.now();
    const codigo = pedir(t, ahora);
    expect(verificarCodigo(t, EMP, codigo, ahora + 10 * 60 * 1000 + 1)).toBe(false);
  });

  it('espera 60 s entre envíos y máximo 3 por hora', () => {
    const t = tel();
    const ahora = Date.now();
    pedir(t, ahora);
    expect(generarCodigo(t, EMP, ahora + 30_000)).toEqual({ ok: false, motivo: 'espera' });
    pedir(t, ahora + 61_000);
    pedir(t, ahora + 122_000);
    expect(generarCodigo(t, EMP, ahora + 183_000)).toEqual({ ok: false, motivo: 'limite' });
    expect(generarCodigo(t, EMP, ahora + 60 * 60 * 1000 + 1000).ok).toBe(true);
  });
});

describe('token del portal', () => {
  it('devuelve teléfono y empresa del token válido', () => {
    expect(verificarTokenPortal(firmarTokenPortal('5500000001', EMP))).toEqual({ telefono: '5500000001', empresaId: EMP });
  });

  it('rechaza un token alterado', () => {
    const token = firmarTokenPortal('5500000001', EMP);
    const [, firma] = token.split('.');
    const otro = Buffer.from(JSON.stringify({ tel: '5500000002', emp: EMP, exp: 9999999999 })).toString('base64url');
    expect(verificarTokenPortal(`${otro}.${firma}`)).toBeNull();
    expect(verificarTokenPortal(token.slice(0, -2) + 'xx')).toBeNull();
    expect(verificarTokenPortal('basura')).toBeNull();
    expect(verificarTokenPortal(null)).toBeNull();
  });

  it('rechaza un token vencido (30 min)', () => {
    const ahora = Date.now();
    const token = firmarTokenPortal('5500000001', EMP, ahora);
    expect(verificarTokenPortal(token, ahora + 29 * 60 * 1000)).not.toBeNull();
    expect(verificarTokenPortal(token, ahora + 31 * 60 * 1000)).toBeNull();
  });
});
