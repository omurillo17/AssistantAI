import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/grupos", () => ({ resolveGrupoNaveIds: vi.fn(async () => ["11111111-1111-1111-1111-111111111111"]) }));

import { buildCandidatosScope } from "@/lib/candidatosScope";

const EMP = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTRA = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const NAVE = "22222222-2222-2222-2222-222222222222";
const qs = (s = "") => new URLSearchParams(s);

describe("buildCandidatosScope", () => {
  it("fuerza la empresa del JWT a quien no es ROOT aunque pida otra", async () => {
    const s = await buildCandidatosScope({ rol: "ADMIN", empresa_id: EMP }, qs(`empresa_id=${OTRA}`));
    expect(s.values).toContain(EMP);
    expect(s.values).not.toContain(OTRA);
  });

  it("falla cerrado si un no-ROOT no tiene empresa", async () => {
    const s = await buildCandidatosScope({ rol: "ENCARGADO", empresa_id: null }, qs());
    expect(s.conditions).toContain("FALSE");
  });

  it("ROOT sin empresa ve todo", async () => {
    const s = await buildCandidatosScope({ rol: "ROOT" }, qs());
    expect(s.conditions).toEqual([]);
  });

  it("aplica las naves del JWT a ENCARGADO/RECLUTADOR, no a ADMIN", async () => {
    const enc = await buildCandidatosScope({ rol: "ENCARGADO", empresa_id: EMP, naves_asignadas: [NAVE, "no-uuid"] }, qs());
    expect(enc.values).toContainEqual([NAVE]);
    expect(enc.conditions.some((c) => c.includes("nave_id = ANY"))).toBe(true);
    expect(enc.nextIdx).toBe(1 + enc.values.length);

    const admin = await buildCandidatosScope({ rol: "ADMIN", empresa_id: EMP, naves_asignadas: [NAVE] }, qs());
    expect(admin.conditions.some((c) => c.includes("nave_id = ANY"))).toBe(false);
  });

  it("con grupo aplicado no duplica el filtro de naves del JWT", async () => {
    const s = await buildCandidatosScope(
      { rol: "RECLUTADOR", empresa_id: EMP, grupo_id: "g1", reclutador_id: "r1", naves_asignadas: [NAVE] },
      qs("grupo_id=g1"),
    );
    expect(s.values).not.toContainEqual([NAVE]);
    expect(s.nextIdx).toBe(1 + s.values.length);
  });
});
