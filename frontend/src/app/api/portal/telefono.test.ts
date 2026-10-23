import { describe, expect, it } from "vitest";
import { normalizarTelefonoPortal } from "./telefono";

describe("normalizarTelefonoPortal", () => {
  it("acepta 10 dígitos o prefijos 52/521 y devuelve los 10 nacionales", () => {
    expect(normalizarTelefonoPortal("55 0000 0001")).toBe("5500000001");
    expect(normalizarTelefonoPortal("+52 5500000001")).toBe("5500000001");
    expect(normalizarTelefonoPortal("5215500000001")).toBe("5500000001");
  });

  it("rechaza fragmentos, números largos y prefijos ajenos", () => {
    expect(normalizarTelefonoPortal("00000001")).toBeNull();
    expect(normalizarTelefonoPortal("445500000001")).toBeNull();
    expect(normalizarTelefonoPortal("99995500000001")).toBeNull();
    expect(normalizarTelefonoPortal(null)).toBeNull();
  });
});
