import { describe, expect, it } from "vitest";
import { detectMediaUrl } from "./formatters";

describe("detectMediaUrl solo reconoce adjuntos propios", () => {
  it("acepta WAHA, /api/waha-media y /uploads", () => {
    expect(detectMediaUrl("/uploads/5500000001_1700000000.jpg")).toBe("/uploads/5500000001_1700000000.jpg");
    expect(detectMediaUrl("ver /api/waha-media/api/files/default/false_521@c.us_AB.jpeg")).toBe(
      "/api/waha-media/api/files/default/false_521@c.us_AB.jpeg"
    );
  });

  it("ignora URLs externas, esquemas raros y traversal", () => {
    expect(detectMediaUrl("mira https://evil.com/foto.jpg")).toBeNull();
    expect(detectMediaUrl("javascript:alert(1)//x.jpg")).toBeNull();
    expect(detectMediaUrl("/uploads/../api/db/x.pdf")).toBeNull();
  });
});
