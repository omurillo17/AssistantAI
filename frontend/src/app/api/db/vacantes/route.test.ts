import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const connect = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({ getSession: async () => session.current }));
vi.mock("@/lib/db", () => ({ pool: { connect } }));
vi.mock("@/lib/syncPromptContext", () => ({ syncPromptContextDisk: vi.fn() }));
vi.mock("@/lib/grupos", () => ({ resolveGrupoNaveIds: vi.fn() }));

import { POST } from "./route";

const post = (body: unknown, query = "") =>
  POST(new Request(`http://x/api/db/vacantes${query}`, { method: "POST", body: JSON.stringify(body) }));

describe("POST /api/db/vacantes", () => {
  beforeEach(() => connect.mockReset());

  it("rechaza a ROOT sin empresa: evita DELETE sobre toda la tabla", async () => {
    session.current = { rol: "ROOT", empresa_id: null };
    const res = await post([]);
    expect(res.status).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });

  it("rechaza a ADMIN sin empresa en el JWT", async () => {
    session.current = { rol: "ADMIN", empresa_id: null };
    expect((await post([], "?empresa_id=otra")).status).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });

  it("rechaza el rol USER", async () => {
    session.current = { rol: "USER", empresa_id: "e1" };
    expect((await post([])).status).toBe(403);
    expect(connect).not.toHaveBeenCalled();
  });

  it("rechaza un body sin la lista de vacantes", async () => {
    session.current = { rol: "ADMIN", empresa_id: "e1" };
    expect((await post([{ reclutador_id: "r1" }])).status).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });
});
