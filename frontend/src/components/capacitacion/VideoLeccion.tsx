"use client";

import { useRef, useState } from "react";
import { Captions, ListVideo, ScrollText } from "lucide-react";
import type { Video } from "@/lib/capacitacion";
import { formatoTiempo, parseVtt, type Cue } from "@/lib/vtt";

const VELOCIDADES = [0.75, 1, 1.25, 1.5, 2];

/**
 * Reproductor nativo de las lecciones: subtítulos WebVTT, capítulos, velocidad y
 * transcripción. La transcripción se arma con el mismo .vtt de los subtítulos.
 * Los archivos viven en /public/capacitacion y proxy.ts exige sesión para servirlos.
 */
export function VideoLeccion({ video }: { video: Video }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [tiempo, setTiempo] = useState(0);
  const [cues, setCues] = useState<Cue[] | null>(null);
  const [errorTranscripcion, setErrorTranscripcion] = useState(false);

  const capitulos = video.capitulos ?? [];
  const actual = (inicios: number[]) => inicios.filter((s) => s <= tiempo).length - 1;
  const capActual = actual(capitulos.map((c) => c.inicio));
  const cueActual = cues ? actual(cues.map((c) => c.inicio)) : -1;

  function ir(seg: number) {
    const v = ref.current;
    if (!v) return;
    v.currentTime = seg;
    void v.play().catch(() => {});
  }

  async function cargarTranscripcion() {
    if (cues || !video.subtitulos) return;
    try {
      const res = await fetch(video.subtitulos);
      if (!res.ok) throw new Error(String(res.status));
      setCues(parseVtt(await res.text()));
    } catch {
      setErrorTranscripcion(true);
    }
  }

  return (
    <div>
      <video
        ref={ref}
        src={video.url ?? undefined}
        poster={video.poster}
        controls
        playsInline
        preload="metadata"
        aria-label={`Video: ${video.titulo}`}
        onTimeUpdate={(e) => setTiempo(e.currentTarget.currentTime)}
        className="w-full rounded-lg border border-slate-200 bg-black aspect-video"
      >
        {video.subtitulos && <track kind="captions" src={video.subtitulos} srcLang="es" label="Español" default />}
      </video>

      <div className="flex flex-wrap items-center gap-3 mt-3 text-xs text-slate-500">
        <label className="flex items-center gap-1.5 font-semibold">
          Velocidad
          <select
            defaultValue="1"
            onChange={(e) => ref.current && (ref.current.playbackRate = Number(e.target.value))}
            className="bg-white border border-slate-200 rounded px-1.5 py-1 text-slate-700 focus:outline-none focus:border-primary"
          >
            {VELOCIDADES.map((v) => (
              <option key={v} value={v}>{v}×</option>
            ))}
          </select>
        </label>
        {video.subtitulos && (
          <span className="flex items-center gap-1 bg-slate-100 px-2 py-1 rounded font-semibold">
            <Captions size={13} /> Subtítulos en español
          </span>
        )}
        {video.duracion && <span className="bg-slate-100 px-2 py-1 rounded font-semibold">{video.duracion}</span>}
      </div>

      {capitulos.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
            <ListVideo size={13} /> Capítulos
          </div>
          <ol className="grid sm:grid-cols-2 gap-1">
            {capitulos.map((c, i) => (
              <li key={c.inicio}>
                <button
                  type="button"
                  onClick={() => ir(c.inicio)}
                  aria-current={i === capActual ? "true" : undefined}
                  className={`w-full text-left text-sm rounded px-2 py-1.5 transition-colors ${
                    i === capActual ? "bg-primary/10 text-primary font-semibold" : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <span className="tabular-nums text-slate-400 mr-2">{formatoTiempo(c.inicio)}</span>
                  {c.titulo}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {video.subtitulos && (
        <details className="mt-4 group" onToggle={(e) => e.currentTarget.open && void cargarTranscripcion()}>
          <summary className="flex items-center gap-1.5 cursor-pointer text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-primary">
            <ScrollText size={13} /> Transcripción
          </summary>
          <ol className="mt-2 max-h-64 overflow-y-auto flex flex-col gap-0.5">
            {errorTranscripcion && <li className="text-sm text-slate-400 px-2">No se pudo cargar la transcripción.</li>}
            {!cues && !errorTranscripcion && <li className="text-sm text-slate-400 px-2">Cargando…</li>}
            {cues?.map((c, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => ir(c.inicio)}
                  className={`w-full text-left text-sm rounded px-2 py-1 transition-colors ${
                    i === cueActual ? "bg-primary/10 text-slate-800" : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <span className="tabular-nums text-slate-400 mr-2">{formatoTiempo(c.inicio)}</span>
                  {c.texto}
                </button>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
