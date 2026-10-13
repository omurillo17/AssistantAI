/** Una línea de subtítulo WebVTT, en segundos. */
export type Cue = { inicio: number; fin: number; texto: string };

function segundos(ts: string): number {
  const m = /^(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})$/.exec(ts.trim());
  if (!m) throw new Error(`Marca de tiempo WebVTT inválida: "${ts}"`);
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

/**
 * Lector mínimo de WebVTT (solo cues; NOTE/STYLE se ignoran). Se usa para la
 * transcripción de los videos de Capacitación: sale del mismo archivo que los
 * subtítulos, así que nunca se desincronizan.
 */
export function parseVtt(texto: string): Cue[] {
  const src = texto.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!/^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(src)) throw new Error('El archivo WebVTT debe comenzar con "WEBVTT"');
  const cues: Cue[] = [];
  for (const bloque of src.split(/\n{2,}/).slice(1)) {
    const lineas = bloque.split("\n").filter(Boolean);
    const i = lineas.findIndex((l) => l.includes("-->"));
    if (i === -1) continue;
    const [a, b] = lineas[i].split("-->");
    cues.push({ inicio: segundos(a), fin: segundos(b.trim().split(/\s+/)[0]), texto: lineas.slice(i + 1).join("\n") });
  }
  return cues;
}

/** "m:ss" para etiquetas de la interfaz. */
export function formatoTiempo(seg: number): string {
  const s = Math.floor(seg);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
