"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BookOpen, Search, Clock, PlayCircle, ArrowRight } from "lucide-react";
import { useLocalStorageValue } from "@/hooks/useLocalStorageValue";
import { CATEGORIAS, leccionesPorRol, type Categoria } from "@/lib/capacitacion";

export default function CapacitacionPage() {
  const role = useLocalStorageValue("tci_role");
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState<Categoria | "TODAS">("TODAS");

  const lecciones = useMemo(() => leccionesPorRol(role), [role]);

  const visibles = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    return lecciones.filter((l) => {
      if (categoria !== "TODAS" && l.categoria !== categoria) return false;
      if (!texto) return true;
      return (
        l.titulo.toLowerCase().includes(texto) ||
        l.resumen.toLowerCase().includes(texto) ||
        l.secciones.some((s) => s.titulo.toLowerCase().includes(texto))
      );
    });
  }, [lecciones, busqueda, categoria]);

  const categoriasConContenido = CATEGORIAS.filter((c) =>
    lecciones.some((l) => l.categoria === c)
  );

  return (
    <div className="p-2 animate-fade-in">
      {/* Encabezado */}
      <div className="bg-primary rounded-xl text-white p-8 mb-6 relative overflow-hidden">
        <div className="relative z-10 max-w-2xl">
          <div className="flex items-center gap-2 text-white/70 text-xs font-bold uppercase tracking-wider mb-2">
            <BookOpen size={14} /> Centro de Capacitación
          </div>
          <h1 className="text-3xl font-bold mb-2">Aprende a usar la plataforma</h1>
          <p className="text-white/80">
            Guías cortas, módulo por módulo, para que cualquier reclutador del equipo
            pueda trabajar sin depender de que alguien le explique. Los videos se irán
            publicando en cada lección.
          </p>
        </div>
        <div className="absolute top-4 right-6 text-black/10 text-8xl font-black select-none">
          🎓
        </div>
      </div>

      {/* Buscador y filtros */}
      <div className="flex flex-col md:flex-row md:items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            id="capacitacion-busqueda"
            name="capacitacion_busqueda"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar una guía..."
            className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-primary transition-colors"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setCategoria("TODAS")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              categoria === "TODAS"
                ? "bg-primary text-white"
                : "bg-white text-slate-500 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            Todas
          </button>
          {categoriasConContenido.map((c) => (
            <button
              key={c}
              onClick={() => setCategoria(c)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                categoria === c
                  ? "bg-primary text-white"
                  : "bg-white text-slate-500 border border-slate-200 hover:bg-slate-50"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Listado */}
      {visibles.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400">
          No hay guías que coincidan con tu búsqueda.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {visibles.map((l) => (
            <Link
              key={l.slug}
              href={`/capacitacion/${l.slug}`}
              className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col group"
            >
              {/* Portada */}
              <div className={`${l.color} h-28 relative flex items-center justify-center`}>
                <span className="text-5xl select-none">{l.icono}</span>
                <span className="absolute top-3 left-3 bg-black/20 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded">
                  {l.categoria}
                </span>
                {!l.video.url && !l.video.embed && (
                  <span className="absolute bottom-3 right-3 bg-black/25 text-white text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1">
                    <PlayCircle size={11} /> Video próximamente
                  </span>
                )}
              </div>

              <div className="p-5 flex-1 flex flex-col">
                <h2 className="font-bold text-lg text-slate-800 mb-1.5 group-hover:text-primary transition-colors">
                  {l.titulo}
                </h2>
                <p className="text-sm text-slate-500 leading-relaxed flex-1">{l.resumen}</p>

                <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
                  <span className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
                    <Clock size={12} /> {l.lectura} de lectura
                  </span>
                  <span className="flex items-center gap-1 text-xs font-bold text-primary">
                    Leer <ArrowRight size={13} />
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <p className="text-center text-xs text-slate-400 mt-8">
        ¿Falta algo en esta guía? Coméntalo con tu encargado para agregarlo.
      </p>
    </div>
  );
}
