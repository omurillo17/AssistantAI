import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CATEGORIAS, LECCIONES, getLeccion, leccionesPorRol } from "@/lib/capacitacion";
import { formatoTiempo, parseVtt } from "@/lib/vtt";
import generados from "@/lib/capacitacion-videos.json";

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
    expect(deUser.some((l) => l.slug === "usuarios")).toBe(false);
    expect(deUser.every((l) => !l.roles || l.roles.includes("USER"))).toBe(true);
    expect(leccionesPorRol("ROOT").length).toBe(LECCIONES.length);
  });

  it("sin rol (antes de hidratar) se comporta como USER", () => {
    expect(leccionesPorRol(null).length).toBe(leccionesPorRol("USER").length);
  });

  it("los videos publicados apuntan a archivos reales y sus subtítulos son WebVTT válidos", () => {
    // Un video, miniatura o .vtt faltante se vería como reproductor roto frente al reclutador.
    const PUBLIC_DIR = path.resolve(APP_DIR, "../../public");
    for (const l of LECCIONES) {
      const v = l.video;
      for (const ruta of [v.url, v.poster, v.subtitulos]) {
        if (!ruta) continue;
        expect(ruta.startsWith("/"), `${l.slug}: ruta relativa ${ruta}`).toBe(true);
        expect(fs.existsSync(path.join(PUBLIC_DIR, ruta)), `${l.slug}: no existe public${ruta}`).toBe(true);
      }
      if (v.subtitulos) {
        const cues = parseVtt(fs.readFileSync(path.join(PUBLIC_DIR, v.subtitulos), "utf8"));
        expect(cues.length, `${l.slug}: subtítulos vacíos`).toBeGreaterThan(0);
      }
      const inicios = (v.capitulos ?? []).map((c) => c.inicio);
      expect(inicios, `${l.slug}: capítulos fuera de orden`).toEqual([...inicios].sort((a, b) => a - b));
    }
  });
});

describe("videos generados (capacitacion-videos.json)", () => {
  it("cada video generado corresponde a una lección existente", () => {
    // Un guion con un id mal escrito generaría un video que ninguna lección muestra.
    const slugs = new Set(LECCIONES.map((l) => l.slug));
    const huerfanos = Object.keys(generados.videos).filter((id) => !slugs.has(id));
    expect(huerfanos).toEqual([]);
  });

  it("las lecciones con video generado lo muestran con sus capítulos", () => {
    for (const id of Object.keys(generados.videos)) {
      const v = getLeccion(id)?.video;
      expect(v?.url, id).toMatch(/\.mp4$/);
      expect(v?.capitulos?.length, id).toBeGreaterThan(0);
    }
  });
});

describe("parseVtt", () => {
  it("lee cues con horas opcionales y ajustes, ignora NOTE", () => {
    const vtt = "WEBVTT\n\nNOTE comentario\n\n00:00:01.000 --> 00:00:02.500 align:start\nHola\n\n01:03.000 --> 01:04.000\nAdiós\n";
    expect(parseVtt(vtt)).toEqual([
      { inicio: 1, fin: 2.5, texto: "Hola" },
      { inicio: 63, fin: 64, texto: "Adiós" },
    ]);
  });

  it("rechaza archivos sin encabezado WEBVTT", () => {
    expect(() => parseVtt("00:00:01.000 --> 00:00:02.000\nx")).toThrow();
  });

  it("formatoTiempo muestra m:ss", () => {
    expect(formatoTiempo(83.4)).toBe("1:23");
  });
});
