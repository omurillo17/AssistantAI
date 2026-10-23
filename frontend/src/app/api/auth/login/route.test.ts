import { beforeAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", () => ({ pool: { query } }));

import { POST } from "./route";
import { revocarSesiones, verificarTokenSesion } from "@/lib/auth";

function intento(usuario: string, password: string) {
  return POST(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": `10.0.0.${usuario.length}` },
      body: JSON.stringify({ usuario, password }),
    })
  );
}

describe("POST /api/auth/login", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = "s".repeat(32);
  });

  it("bloquea al usuario tras 5 fallos aunque no exista", async () => {
    query.mockResolvedValue({ rowCount: 0, rows: [] });
    for (let i = 0; i < 5; i++) {
      expect((await intento("fantasma", "mala-clave")).status).toBe(401);
    }
    expect((await intento("fantasma", "mala-clave")).status).toBe(429);
  }, 20_000);

  it("firma tv y la sesión deja de valer al revocarla", async () => {
    const hash = await bcrypt.hash("clave-correcta-1", 4);
    let version = 3;
    query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("UPDATE")) return { rowCount: 1, rows: [{ token_version: ++version }] };
      if (sql.includes("SELECT token_version")) return { rowCount: 1, rows: [{ token_version: version }] };
      return { rowCount: 1, rows: [{ usuario: "ana", rol: "ADMIN", password_hash: hash, token_version: version }] };
    });

    const res = await intento("ana", "clave-correcta-1");
    expect(res.status).toBe(200);
    const token = /tci_session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";

    expect((await verificarTokenSesion(token))?.tv).toBe(3);
    await revocarSesiones("ana");
    expect(await verificarTokenSesion(token)).toBeNull();
  });
});
