import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock de @/lib/db para pruebas unitarias de mensajería sin conexión a BD
vi.mock('@/lib/db', () => ({
  pool: {
    query: vi.fn(),
  },
}));

import { enviarMensajeDirecto } from './messagingService';
import * as metaModule from './metaWhatsapp';

describe('messagingService (Meta Cloud API Exclusivo)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('envía mensaje exitosamente a través de Meta Cloud API', async () => {
    process.env.META_WA_ACCESS_TOKEN = 'test_token';
    process.env.META_WA_PHONE_NUMBER_ID = '1373866945815230';

    vi.spyOn(metaModule, 'enviarMensajeMeta').mockResolvedValue({
      ok: true,
      messageId: 'wamid.HBgLMTM3Mzg2Njk0NTgxNTIzMBUCABEYE...',
    });

    const res = await enviarMensajeDirecto('3332483278', 'Hola desde test');
    expect(res.ok).toBe(true);
    expect(res.provider).toBe('meta');
    expect(res.messageId).toBeDefined();
  });

  it('reporta error si Meta Cloud API devuelve fallo', async () => {
    process.env.META_WA_ACCESS_TOKEN = 'test_token';
    process.env.META_WA_PHONE_NUMBER_ID = '1373866945815230';

    vi.spyOn(metaModule, 'enviarMensajeMeta').mockResolvedValue({
      ok: false,
      error: 'Meta Graph API Error 190: Invalid Token',
    });

    const res = await enviarMensajeDirecto('3332483278', 'Mensaje de prueba');
    expect(res.ok).toBe(false);
    expect(res.provider).toBe('meta');
    expect(res.error).toContain('Meta Graph API Error');
  });

  it('retorna error si las credenciales de Meta no están presentes', async () => {
    delete process.env.META_WA_ACCESS_TOKEN;
    delete process.env.META_WA_PHONE_NUMBER_ID;

    const res = await enviarMensajeDirecto('3332483278', 'Mensaje sin config');
    expect(res.ok).toBe(false);
    expect(res.provider).toBe('none');
  });
});
