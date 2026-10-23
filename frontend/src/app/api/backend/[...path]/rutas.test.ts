import { describe, expect, it } from "vitest";
import { construirDestinoBackend } from "./rutas";

const BASE = "http://backend:8000";
const destino = (method: string, segs: string[], search = "") =>
  construirDestinoBackend(BASE, method, segs, search)?.toString() ?? null;

describe("construirDestinoBackend", () => {
  it("permite solo las rutas de citas con su método", () => {
    expect(destino("GET", ["internal", "citas", "google-calendar"], "?start=a&end=b")).toBe(
      "http://backend:8000/internal/citas/google-calendar?start=a&end=b"
    );
    expect(destino("POST", ["internal", "citas", "cancelar"])).toBe("http://backend:8000/internal/citas/cancelar");
    expect(destino("GET", ["internal", "citas", "cancelar"])).toBeNull();
    expect(destino("GET", ["internal", "citas"])).toBeNull();
    expect(destino("POST", ["internal", "citas", "bloqueo", "extra"])).toBeNull();
  });

  it("rechaza traversal, slashes codificados y hosts relativos al protocolo", () => {
    expect(destino("GET", ["internal", "citas", "..", "admin"])).toBeNull();
    expect(destino("GET", ["internal", "citas", "google-calendar/../../x"])).toBeNull();
    expect(destino("GET", ["internal", "citas", "google-calendar%2F"])).toBeNull();
    expect(destino("GET", ["internal", "citas", "a\\b"])).toBeNull();
    expect(destino("GET", ["", "evil.com", "internal", "citas", "google-calendar"])).toBeNull();
  });
});
