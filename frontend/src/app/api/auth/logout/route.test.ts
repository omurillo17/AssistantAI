import { describe, expect, it } from "vitest";
import { POST } from "./route";

describe("POST /api/auth/logout", () => {
  it("expira la cookie de sesión HttpOnly", async () => {
    const res = await POST();
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(res.status).toBe(200);
    expect(cookie).toMatch(/^tci_session=;/);
    expect(cookie).toMatch(/Max-Age=0/i);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\//i);
  });
});
