import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { firmarRutaUpload, verificarTokenUpload } from './uploadToken';

/**
 * /uploads sirve CVs, INEs y RFCs de candidatos reales y estaba abierto a
 * internet. Ahora exige sesión salvo que traiga este token, que es lo único
 * que permite a WAHA descargar el adjunto para reenviarlo por WhatsApp.
 */
const RUTA = '/uploads/5213312345678_1786716503946.pdf';

beforeAll(() => {
  process.env.INTERNAL_API_KEY = 'secreto-de-prueba';
});

afterAll(() => {
  delete process.env.INTERNAL_API_KEY;
});

describe('token de /uploads', () => {
  it('acepta un token recién firmado para su propia ruta', async () => {
    const token = await firmarRutaUpload(RUTA);
    expect(token).toBeTruthy();
    expect(await verificarTokenUpload(RUTA, token)).toBe(true);
  });

  it('rechaza el token de OTRA ruta (no sirve para pescar otros expedientes)', async () => {
    const token = await firmarRutaUpload(RUTA);
    expect(await verificarTokenUpload('/uploads/otro_candidato.pdf', token)).toBe(false);
  });

  it('rechaza un token expirado', async () => {
    const token = await firmarRutaUpload(RUTA, -1);
    expect(await verificarTokenUpload(RUTA, token)).toBe(false);
  });

  it('rechaza firma manipulada, token vacío y basura', async () => {
    const token = (await firmarRutaUpload(RUTA))!;
    const [exp] = token.split('.');
    expect(await verificarTokenUpload(RUTA, `${exp}.firmaInventada`)).toBe(false);
    expect(await verificarTokenUpload(RUTA, null)).toBe(false);
    expect(await verificarTokenUpload(RUTA, '')).toBe(false);
    expect(await verificarTokenUpload(RUTA, 'sinpunto')).toBe(false);
  });

  it('no se puede alargar la expiración sin volver a firmar', async () => {
    const token = (await firmarRutaUpload(RUTA))!;
    const firma = token.split('.').slice(1).join('.');
    const futuro = Math.floor(Date.now() / 1000) + 99999;
    expect(await verificarTokenUpload(RUTA, `${futuro}.${firma}`)).toBe(false);
  });

  it('falla cerrado si no hay secreto configurado', async () => {
    const previo = process.env.INTERNAL_API_KEY;
    const previoJwt = process.env.JWT_SECRET;
    delete process.env.INTERNAL_API_KEY;
    delete process.env.JWT_SECRET;
    expect(await firmarRutaUpload(RUTA)).toBeNull();
    expect(await verificarTokenUpload(RUTA, 'lo.que.sea')).toBe(false);
    process.env.INTERNAL_API_KEY = previo;
    if (previoJwt) process.env.JWT_SECRET = previoJwt;
  });
});
