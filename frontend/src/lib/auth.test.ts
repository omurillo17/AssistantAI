import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeUsername, requireRole, verifyInternalApiKey } from "@/lib/auth";

const CLAVE = "x".repeat(64);

function peticionCon(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/webhook/n8n-incoming", { headers });
}

describe("verifyInternalApiKey", () => {
  const entornoOriginal = { ...process.env };

  beforeEach(() => {
    delete process.env.INTERNAL_API_KEY;
    delete process.env.N8N_API_KEY;
    delete process.env.WEBHOOK_API_KEY;
  });

  afterEach(() => {
    process.env = { ...entornoOriginal };
    vi.restoreAllMocks();
  });

  it("acepta la llave correcta", () => {
    process.env.INTERNAL_API_KEY = CLAVE;
    expect(verifyInternalApiKey(peticionCon({ "x-api-key": CLAVE }))).toBe(true);
  });

  it("rechaza una llave incorrecta de la misma longitud", () => {
    process.env.INTERNAL_API_KEY = CLAVE;
    expect(verifyInternalApiKey(peticionCon({ "x-api-key": "y".repeat(64) }))).toBe(false);
  });

  it("rechaza una llave de longitud distinta sin lanzar", () => {
    // timingSafeEqual explota si los buffers no miden lo mismo; safeCompare
    // debe cortar antes.
    process.env.INTERNAL_API_KEY = CLAVE;
    expect(verifyInternalApiKey(peticionCon({ "x-api-key": "corta" }))).toBe(false);
  });

  it("rechaza cuando no viene el header", () => {
    process.env.INTERNAL_API_KEY = CLAVE;
    expect(verifyInternalApiKey(peticionCon())).toBe(false);
  });

  it("falla CERRADO si no hay ninguna llave configurada", () => {
    // Regresión: antes devolvía true, dejando /api/webhook/*, /api/upload-cv
    // y /api/cron/* sin autenticación ante un olvido en el .env.
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(verifyInternalApiKey(peticionCon({ "x-api-key": CLAVE }))).toBe(false);
  });

  it("acepta N8N_API_KEY y WEBHOOK_API_KEY como respaldo", () => {
    process.env.N8N_API_KEY = CLAVE;
    expect(verifyInternalApiKey(peticionCon({ "x-api-key": CLAVE }))).toBe(true);

    delete process.env.N8N_API_KEY;
    process.env.WEBHOOK_API_KEY = CLAVE;
    expect(verifyInternalApiKey(peticionCon({ "x-api-key": CLAVE }))).toBe(true);
  });
});

describe("normalizeUsername", () => {
  // Login y alta de usuario deben normalizar igual, o se crean cuentas
  // imposibles de encontrar al iniciar sesión.
  it("baja a minúsculas, quita acentos y espacios de los extremos", () => {
    expect(normalizeUsername("  Jerónimo  ")).toBe("jeronimo");
    expect(normalizeUsername("MURILLO")).toBe("murillo");
  });

  it("es idempotente", () => {
    const una = normalizeUsername(" Ángel ");
    expect(normalizeUsername(una)).toBe(una);
  });
});

describe("requireRole", () => {
  it("acepta un rol que está en la lista", () => {
    expect(requireRole({ rol: "ADMIN" }, "ADMIN", "ROOT")).toBe(true);
  });

  it("rechaza un rol fuera de la lista", () => {
    expect(requireRole({ rol: "RECLUTADOR" }, "ADMIN", "ROOT")).toBe(false);
  });

  it("rechaza una sesión nula o sin rol", () => {
    expect(requireRole(null, "ADMIN")).toBe(false);
    expect(requireRole({}, "ADMIN")).toBe(false);
  });
});
