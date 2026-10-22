import { describe, expect, it } from "vitest";
import {
  ESTADOS,
  ESTADOS_CRM,
  ESTADOS_ORDENADOS,
  GRUPOS,
  KANBAN_COLUMNAS,
  getEstado,
  getEstadoColor,
  columnaKanban,
  estadosPersonalizadosActivos,
  registrarEstadosPersonalizados,
  type EstadoKey,
} from "@/lib/estados";
import { ESTADOS_VALIDOS } from "@/lib/stateMachine";

const CATALOGO = Object.keys(ESTADOS);

describe("catálogo de estados", () => {
  it("todo estado de la máquina existe en el catálogo del CRM", () => {
    // Al revés se ve feo pero no rompe; así sí: un estado que la máquina puede
    // producir y que el catálogo no conoce se pinta como "❓ Estado desconocido"
    // en el kanban y en los gráficos.
    const faltantes = [...ESTADOS_VALIDOS].filter((estado) => !CATALOGO.includes(estado));
    expect(faltantes).toEqual([]);
  });

  it("solo estos estados del catálogo viven fuera de la máquina", () => {
    // ESTADOS_VALIDOS es lo que acepta /api/webhook/n8n-incoming: un estado
    // del catálogo que no esté ahí se degrada a NUEVO al llegar un mensaje.
    //  - OTRA_CIUDAD: lo escribe el backend (analizador.py, parser.py) pero la
    //    ruta corta antes con un return, así que nunca se degrada.
    //  - FILTROS_COMPLETADOS: nadie lo escribe hoy; es solo etiqueta de UI.
    // Si esta lista crece, revisa que el estado nuevo no quede huérfano.
    const fueraDeLaMaquina = CATALOGO.filter((estado) => !ESTADOS_VALIDOS.has(estado));
    expect(fueraDeLaMaquina.sort()).toEqual(["FILTROS_COMPLETADOS", "OTRA_CIUDAD"]);
  });

  it("las listas y agrupaciones solo referencian estados que existen", () => {
    const referenciados = [
      ...ESTADOS_ORDENADOS,
      ...ESTADOS_CRM,
      ...Object.values(GRUPOS).flatMap((g) => g.estados),
      ...KANBAN_COLUMNAS.flatMap((c) => c.estados),
    ];
    const huerfanos = [...new Set(referenciados)].filter((estado) => !CATALOGO.includes(estado));
    expect(huerfanos).toEqual([]);
  });

  it("cada estado trae los campos que la UI pinta sin condicional", () => {
    for (const [key, def] of Object.entries(ESTADOS)) {
      expect(def.label, `${key}.label`).toBeTruthy();
      expect(def.hex, `${key}.hex`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(def.emoji, `${key}.emoji`).toBeTruthy();
    }
  });
});

describe("getEstado", () => {
  it("devuelve la definición real de un estado conocido", () => {
    expect(getEstado("NUEVO")).toBe(ESTADOS.NUEVO);
  });

  it("devuelve un fallback usable para un estado desconocido", () => {
    const def = getEstado("ESTADO_QUE_NO_EXISTE");
    expect(def.label).toBe("ESTADO_QUE_NO_EXISTE");
    expect(def.hex).toBe("#94a3b8");
    expect(def.activo).toBe(false);
  });
});

describe("getEstadoColor", () => {
  it("usa el hex del catálogo cuando el estado existe", () => {
    for (const key of CATALOGO) {
      expect(getEstadoColor(key)).toBe(ESTADOS[key as EstadoKey].hex);
    }
  });

  it("normaliza etiquetas con espacios y minúsculas", () => {
    expect(getEstadoColor("otra ciudad")).toBe(ESTADOS.OTRA_CIUDAD.hex);
  });

  it("cae a coincidencia semántica para textos libres", () => {
    expect(getEstadoColor("fue descartado")).toBe("#ef4444");
    expect(getEstadoColor("mudanza a otra ciudad")).toBe("#8b5cf6");
  });

  it("devuelve el gris neutro cuando no reconoce nada", () => {
    expect(getEstadoColor("")).toBe("#94a3b8");
    expect(getEstadoColor("zzz")).toBe("#94a3b8");
  });
});

describe("estados personalizados", () => {
  it("se integran al catálogo: nombre, color, columna del kanban y activos", () => {
    registrarEstadosPersonalizados([
      { clave: "M_abc", nombre: "En capacitación", color: "#123456", grupo: "exitoso", activo: true },
      { clave: "M_old", nombre: "Viejo", color: "#654321", grupo: "descartado", activo: false },
    ]);
    expect(getEstado("M_abc").label).toBe("En capacitación");
    expect(getEstadoColor("M_abc")).toBe("#123456");
    expect(columnaKanban("M_abc")).toBe("final");
    expect(columnaKanban("M_old")).toBe("pool");
    expect(columnaKanban("INTERESADO")).toBe("pipeline");
    expect(columnaKanban("NO_EXISTE")).toBeUndefined();
    expect(estadosPersonalizadosActivos().map((e) => e.clave)).toEqual(["M_abc"]);
    registrarEstadosPersonalizados([]);
    expect(getEstado("M_abc").label).toBe("M_abc");
  });
});
