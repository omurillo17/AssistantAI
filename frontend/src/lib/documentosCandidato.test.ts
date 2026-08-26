import { describe, expect, it } from "vitest";

import { agruparDocumentos } from "./documentosCandidato";

describe("agruparDocumentos", () => {
  it("usa la clasificación por archivo de la IA cuando existe", () => {
    const docs = agruparDocumentos({
      datos_ine: {
        archivos: [
          { url: "/uploads/a.jpg", tipo: "INE_FRENTE" },
          { url: "/uploads/b.jpg", tipo: "INE_REVERSO" },
          { url: "/uploads/c.pdf", tipo: "CONSTANCIA_FISCAL" },
          { url: "/uploads/d.jpg", tipo: "ACTA_NACIMIENTO" },
        ],
      },
    });

    expect(docs.ine.map((a) => a.url)).toEqual(["/uploads/a.jpg", "/uploads/b.jpg"]);
    expect(docs.csf.map((a) => a.url)).toEqual(["/uploads/c.pdf"]);
    expect(docs.otros.map((a) => a.url)).toEqual(["/uploads/d.jpg"]);
    expect(docs.otros[0].etiqueta).toBe("Acta de nacimiento");
    expect(docs.sinClasificar).toBe(false);
    expect(docs.total).toBe(4);
  });

  it("no repite un archivo que la IA clasificó en datos_ine y en datos_rfc", () => {
    const archivos = [
      { url: "/uploads/a.jpg", tipo: "INE_FRENTE" },
      { url: "/uploads/c.pdf", tipo: "CONSTANCIA_FISCAL" },
    ];
    const docs = agruparDocumentos({
      datos_ine: { archivos },
      datos_rfc: JSON.stringify({ archivos }),
    });

    expect(docs.total).toBe(2);
    expect(docs.ine).toHaveLength(1);
    expect(docs.csf).toHaveLength(1);
  });

  it("manda a 'otros' las urls legadas que están en datos_ine y datos_rfc a la vez", () => {
    // Caso real (AMBOS_DOCS antes de la clasificación por archivo): las mismas
    // 3 urls copiadas en los dos campos. Asignarlas a ciegas mentiría sobre
    // cuál es la INE, así que quedan sin clasificar.
    const urls = ["/uploads/1.pdf", "/uploads/2.jpg", "/uploads/3.jpg"];
    const docs = agruparDocumentos({
      datos_ine: { urls, url: urls[0], url_reverso: urls[1] },
      datos_rfc: JSON.stringify({ urls, url: urls[0] }),
    });

    expect(docs.ine).toEqual([]);
    expect(docs.csf).toEqual([]);
    expect(docs.otros.map((a) => a.url)).toEqual(urls);
    expect(docs.sinClasificar).toBe(true);
    expect(docs.total).toBe(3);
  });

  it("respeta urls legadas exclusivas de cada documento", () => {
    const docs = agruparDocumentos({
      datos_ine: { url: "/uploads/frente.jpg", url_reverso: "/uploads/reverso.jpg" },
      datos_rfc: { url: "/uploads/csf.pdf" },
      link_cv: "/uploads/cv.pdf",
    });

    expect(docs.ine.map((a) => a.tipo)).toEqual(["INE_FRENTE", "INE_REVERSO"]);
    expect(docs.csf.map((a) => a.url)).toEqual(["/uploads/csf.pdf"]);
    expect(docs.otros.map((a) => a.tipo)).toEqual(["CV"]);
    expect(docs.sinClasificar).toBe(false);
  });

  it("normaliza alias de tipo y descarta entradas inválidas", () => {
    const docs = agruparDocumentos({
      datos_ine: {
        archivos: [
          { url: "/uploads/a.jpg", tipo: "INE" },
          { url: "/uploads/b.pdf", tipo: "csf" },
          { url: "/uploads/c.jpg", tipo: "ALGO_RARO" },
          { url: null, tipo: "INE_FRENTE" },
          "basura",
        ],
      },
    });

    expect(docs.ine.map((a) => a.tipo)).toEqual(["INE_FRENTE"]);
    expect(docs.csf.map((a) => a.tipo)).toEqual(["CONSTANCIA_FISCAL"]);
    expect(docs.otros.map((a) => a.tipo)).toEqual(["OTRO"]);
    expect(docs.total).toBe(3);
  });

  it("devuelve grupos vacíos cuando el candidato no ha entregado nada", () => {
    expect(agruparDocumentos({})).toEqual({
      ine: [],
      csf: [],
      otros: [],
      sinClasificar: false,
      total: 0,
    });
  });
});
