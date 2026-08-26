import { proxyMediaUrl } from "@/lib/formatters";

/**
 * Agrupación de los archivos que un candidato mandó por WhatsApp.
 *
 * El analizador (backend/app/chat/analizador.py) le pide a Gemini que
 * clasifique CADA archivo del turno, no solo el "tipo de documento" global, y
 * guarda esa clasificación dentro de `datos_ine` / `datos_rfc` / `cv_manual`
 * bajo la llave `archivos`: [{ url, tipo, etiqueta }].
 *
 * Los expedientes anteriores a ese cambio NO la tienen: cuando el candidato
 * mandaba INE y Constancia juntos (tipo_documento = AMBOS_DOCS) el mismo
 * arreglo completo de urls se copiaba en `datos_ine` Y en `datos_rfc`, así que
 * la UI acababa repitiendo los mismos 10 botones bajo los dos títulos. Aquí
 * eso se detecta (una url que aparece en ambos lados es AMBIGUA, no un
 * duplicado que se pueda asignar a ciegas) y se marca `sinClasificar` para que
 * la pantalla ofrezca reclasificar con IA en vez de mentir sobre qué es cada
 * archivo.
 */

export type TipoArchivo =
  | "INE_FRENTE"
  | "INE_REVERSO"
  | "CONSTANCIA_FISCAL"
  | "CV"
  | "SOLICITUD"
  | "ACTA_NACIMIENTO"
  | "CURP"
  | "IMSS"
  | "COMPROBANTE_DOMICILIO"
  | "COMPROBANTE_ESTUDIOS"
  | "ANTECEDENTES_PENALES"
  | "ANUNCIO"
  | "OTRO";

export const ETIQUETAS_ARCHIVO: Record<TipoArchivo, string> = {
  INE_FRENTE: "INE — frente",
  INE_REVERSO: "INE — reverso",
  CONSTANCIA_FISCAL: "Constancia de Situación Fiscal",
  CV: "Currículum",
  SOLICITUD: "Solicitud de empleo",
  ACTA_NACIMIENTO: "Acta de nacimiento",
  CURP: "Constancia de CURP",
  IMSS: "Documento del IMSS",
  COMPROBANTE_DOMICILIO: "Comprobante de domicilio",
  COMPROBANTE_ESTUDIOS: "Comprobante de estudios",
  ANTECEDENTES_PENALES: "Carta de no antecedentes penales",
  ANUNCIO: "Captura del anuncio",
  OTRO: "Documento sin identificar",
};

const TIPOS_VALIDOS = new Set(Object.keys(ETIQUETAS_ARCHIVO));

export type ArchivoCandidato = {
  url: string;
  tipo: TipoArchivo;
  etiqueta: string;
};

export type DocumentosCandidato = {
  /** INE (frente/reverso). */
  ine: ArchivoCandidato[];
  /** Constancia de Situación Fiscal / RFC. */
  csf: ArchivoCandidato[];
  /** Todo lo demás: acta, IMSS, comprobantes, CV, documentos sin identificar. */
  otros: ArchivoCandidato[];
  /** Hay archivos que el expediente no sabe encasillar (datos legados). */
  sinClasificar: boolean;
  total: number;
};

type Blob = Record<string, unknown> | null;

export function parseDatosDocumento(value: unknown): Blob {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizarTipo(raw: unknown): TipoArchivo {
  const tipo = String(raw || "").trim().toUpperCase();
  if (TIPOS_VALIDOS.has(tipo)) return tipo as TipoArchivo;
  // Alias que manda Gemini o que ya existían en la base.
  if (tipo === "INE") return "INE_FRENTE";
  if (["CONSTANCIA", "CSF", "RFC", "SAT"].includes(tipo)) return "CONSTANCIA_FISCAL";
  return "OTRO";
}

/** Urls sueltas de un blob legado, en orden y ya normalizadas por el proxy. */
function urlsCrudas(blob: Blob, ...extras: unknown[]): string[] {
  const out: string[] = [];
  const push = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const url = proxyMediaUrl(raw);
    if (url && !out.includes(url)) out.push(url);
  };
  extras.forEach(push);
  push(blob?.url);
  push(blob?.link);
  if (Array.isArray(blob?.urls)) (blob.urls as unknown[]).forEach(push);
  push(blob?.url_reverso);
  return out;
}

export type FuenteDocumentos = {
  datos_ine?: unknown;
  datos_rfc?: unknown;
  cv_manual?: unknown;
  link_ine?: string | null;
  link_csf?: string | null;
  link_rfc?: string | null;
  link_cv?: string | null;
};

export function agruparDocumentos(fuente: FuenteDocumentos): DocumentosCandidato {
  const ineBlob = parseDatosDocumento(fuente.datos_ine);
  const csfBlob = parseDatosDocumento(fuente.datos_rfc);
  const cvBlob = parseDatosDocumento(fuente.cv_manual);

  const ine: ArchivoCandidato[] = [];
  const csf: ArchivoCandidato[] = [];
  const otros: ArchivoCandidato[] = [];
  const vistos = new Set<string>();
  let sinClasificar = false;

  const agregar = (url: string, tipo: TipoArchivo) => {
    if (!url || vistos.has(url)) return;
    vistos.add(url);
    const archivo = { url, tipo, etiqueta: ETIQUETAS_ARCHIVO[tipo] };
    if (tipo === "INE_FRENTE" || tipo === "INE_REVERSO") ine.push(archivo);
    else if (tipo === "CONSTANCIA_FISCAL") csf.push(archivo);
    else otros.push(archivo);
  };

  // 1. Clasificación explícita de la IA (fuente de verdad cuando existe).
  for (const blob of [ineBlob, csfBlob, cvBlob]) {
    if (!Array.isArray(blob?.archivos)) continue;
    for (const entrada of blob.archivos as unknown[]) {
      if (!entrada || typeof entrada !== "object") continue;
      const { url, tipo } = entrada as { url?: unknown; tipo?: unknown };
      agregar(proxyMediaUrl(typeof url === "string" ? url : null), normalizarTipo(tipo));
    }
  }

  // 2. Urls legadas. Una url que aparece en datos_ine Y en datos_rfc viene de un
  //    turno AMBOS_DOCS: no se puede saber si es la INE o la Constancia.
  const crudasIne = urlsCrudas(ineBlob, fuente.link_ine);
  const crudasCsf = urlsCrudas(csfBlob, fuente.link_csf, fuente.link_rfc);
  const crudasCv = urlsCrudas(cvBlob, fuente.link_cv);
  const ambiguas = new Set(crudasIne.filter((u) => crudasCsf.includes(u)));

  for (const url of crudasIne) {
    if (vistos.has(url)) continue;
    if (ambiguas.has(url)) {
      sinClasificar = true;
      agregar(url, "OTRO");
    } else {
      agregar(url, ine.length === 0 ? "INE_FRENTE" : "INE_REVERSO");
    }
  }
  for (const url of crudasCsf) {
    if (vistos.has(url)) continue;
    if (ambiguas.has(url)) {
      sinClasificar = true;
      agregar(url, "OTRO");
    } else {
      agregar(url, "CONSTANCIA_FISCAL");
    }
  }
  for (const url of crudasCv) agregar(url, "CV");

  return { ine, csf, otros, sinClasificar, total: vistos.size };
}
