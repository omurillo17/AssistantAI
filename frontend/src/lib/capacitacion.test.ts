import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CATEGORIAS, LECCIONES, getLeccion, leccionesPorRol } from "@/lib/capacitacion";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../app");

describe("contenido de capacitación", () => {
  it("no hay slugs repetidos", () => {
    const slugs = LECCIONES.map((l) => l.slug);
    expect(slugs.length).toBe(new Set(slugs).size);
  });

  it("los slugs son seguros para una URL", () => {
    const malos = LECCIONES.filter((l) => !/^[a-z0-9-]+$/.test(l.slug));
    expect(malos.map((l) => l.slug)).toEqual([]);
  });

  it("cada lección tiene contenido y su categoría existe", () => {
    for (const l of LECCIONES) {
      expect(l.secciones.length, `${l.slug} sin secciones`).toBeGreaterThan(0);
      expect(CATEGORIAS, `${l.slug} con categoría inválida`).toContain(l.categoria);
      for (const s of l.secciones) {
        expect(s.bloques.length, `${l.slug}#${s.id} sin bloques`).toBeGreaterThan(0);
      }
    }
  });

  it("los anclas del índice lateral son únicas dentro de cada lección", () => {
    // Dos secciones con el mismo id harían que el índice salte siempre a la primera.
    for (const l of LECCIONES) {
      const ids = l.secciones.map((s) => s.id);
      expect(new Set(ids).size, `ids repetidos en ${l.slug}`).toBe(ids.length);
    }
  });

  it("el botón 'Abrir el módulo' apunta a rutas que existen", () => {
    // Evita mandar al reclutador a un 404 si un módulo se renombra o se retira.
    const rotas = LECCIONES.filter((l) => {
      if (!l.ruta) return false;
      const rel = l.ruta === "/" ? "page.tsx" : path.join(l.ruta.slice(1), "page.tsx");
      return !fs.existsSync(path.join(APP_DIR, rel));
    });
    expect(rotas.map((l) => `${l.slug} -> ${l.ruta}`)).toEqual([]);
  });

  it("getLeccion encuentra todas y rechaza lo inexistente", () => {
    for (const l of LECCIONES) expect(getLeccion(l.slug)?.titulo).toBe(l.titulo);
    expect(getLeccion("no-existe")).toBeUndefined();
  });

  it("el filtro por rol oculta lo restringido y ROOT lo ve todo", () => {
    const deUser = leccionesPorRol("USER");
    expect(deUser.some((l) => l.slug === "saas-admin")).toBe(false);
    expect(deUser.every((l) => !l.roles || l.roles.includes("USER"))).toBe(true);
    expect(leccionesPorRol("ROOT").length).toBe(LECCIONES.length);
  });

  it("sin rol (antes de hidratar) se comporta como USER", () => {
    expect(leccionesPorRol(null).length).toBe(leccionesPorRol("USER").length);
  });
});
