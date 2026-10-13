"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Info,
  AlertTriangle,
  ImageIcon,
  PlayCircle,
  ExternalLink,
  List,
  Lock,
} from "lucide-react";
import { useIsHydrated, useLocalStorageValue } from "@/hooks/useLocalStorageValue";
import { leccionesPorRol, type Bloque, type Leccion, type Rol } from "@/lib/capacitacion";
import { ESTADOS, ESTADOS_CRM, ESTADOS_ORDENADOS, type EstadoKey } from "@/lib/estados";
import { VideoLeccion } from "./VideoLeccion";

/** Quién mueve cada estado, derivado del catálogo, no escrito a mano. */
function quienAsigna(key: EstadoKey): { texto: string; clase: string } {
  const def = ESTADOS[key];
  const laMueveElCrm = ESTADOS_CRM.includes(key);
  if (def.asignadoPor === "bot" && !laMueveElCrm) {
    return { texto: "La IA", clase: "bg-info/10 text-info" };
  }
  if (def.asignadoPor === "crm") {
    return { texto: "Tú", clase: "bg-primary/10 text-primary" };
  }
  // asignadoPor "ambos", o un estado del bot que el CRM también puede mover.
  return { texto: "Ambos", clase: "bg-slate-100 text-slate-500" };
}

function getBloqueKeySuffix(bloque: Bloque): string {
  if ("texto" in bloque && typeof bloque.texto === "string") {
    return bloque.texto.slice(0, 15);
  }
  if ("titulo" in bloque && typeof bloque.titulo === "string") {
    return bloque.titulo;
  }
  if ("items" in bloque && Array.isArray(bloque.items) && bloque.items[0]) {
    return bloque.items[0].slice(0, 15);
  }
  return "bloque";
}

/**
 * Tabla de estados construida desde `@/lib/estados`, que es la fuente única de
 * verdad del sistema. Escribirla a mano aquí garantizaría que la capacitación
 * se desincronice del producto en cuanto alguien agregue o retire un estado.
 */
function TablaEstados() {
  return (
    <div className="mb-4 flex flex-col gap-2">
      {ESTADOS_ORDENADOS.map((key) => {
        const def = ESTADOS[key];
        const asigna = quienAsigna(key);
        return (
          <div
            key={key}
            className={`flex items-start gap-3 p-3 rounded-lg border ${def.border} ${def.bg} ${
              !def.activo ? "opacity-60" : ""
            }`}
          >
            <span className="text-lg leading-none mt-0.5 select-none">{def.emoji}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-0.5">
                <span className={`font-bold text-sm ${def.color}`}>{def.label}</span>
                <code className="text-[10px] text-slate-400 font-mono">{key}</code>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${asigna.clase}`}>
                  {asigna.texto}
                </span>
                {!def.activo && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-500">
                    Histórico
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-600 leading-snug">{def.descripcion}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BloqueContenido({ bloque }: Readonly<{ bloque: Bloque }>) {
  switch (bloque.tipo) {
    case "parrafo":
      return <p className="text-slate-600 leading-relaxed mb-4">{bloque.texto}</p>;

    case "lista":
      return (
        <ul className="mb-4 flex flex-col gap-2">
          {bloque.items.map((item) => (
            <li key={item} className="flex gap-3 text-slate-600 leading-relaxed">
              <span className="mt-2 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );

    case "pasos":
      return (
        <ol className="mb-4 flex flex-col gap-3">
          {bloque.items.map((item, i) => (
            <li key={item} className="flex gap-3 text-slate-600 leading-relaxed">
              <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                {i + 1}
              </span>
              <span className="pt-0.5">{item}</span>
            </li>
          ))}
        </ol>
      );

    case "nota":
      return (
        <div className="mb-4 flex gap-3 bg-info/10 border-l-4 border-info rounded-r-lg p-4">
          <Info size={18} className="text-info shrink-0 mt-0.5" />
          <p className="text-sm text-slate-700 leading-relaxed">{bloque.texto}</p>
        </div>
      );

    case "aviso":
      return (
        <div className="mb-4 flex gap-3 bg-danger/10 border-l-4 border-danger rounded-r-lg p-4">
          <AlertTriangle size={18} className="text-danger shrink-0 mt-0.5" />
          <p className="text-sm text-slate-700 leading-relaxed">{bloque.texto}</p>
        </div>
      );

    case "estados":
      return <TablaEstados />;

    case "imagen":
      return (
        <figure className="mb-5">
          {bloque.src ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={bloque.src}
              alt={bloque.titulo}
              className="w-full rounded-lg border border-slate-200"
            />
          ) : (
            <div className="w-full aspect-video rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center text-slate-400 gap-2">
              <ImageIcon size={28} />
              <span className="text-sm font-semibold">{bloque.titulo}</span>
              <span className="text-xs">Imagen pendiente de agregar</span>
            </div>
          )}
          {bloque.pie && (
            <figcaption className="text-xs text-slate-400 mt-2 text-center">
              {bloque.pie}
            </figcaption>
          )}
        </figure>
      );

    default:
      return null;
  }
}

export function LeccionVista({ leccion }: Readonly<{ leccion: Leccion }>) {
  const hidratado = useIsHydrated();
  const role = useLocalStorageValue("tci_role");

  const disponibles = useMemo(() => leccionesPorRol(role), [role]);

  const { anterior, siguiente } = useMemo(() => {
    const i = disponibles.findIndex((l) => l.slug === leccion.slug);
    return {
      anterior: i > 0 ? disponibles[i - 1] : null,
      siguiente: i >= 0 && i < disponibles.length - 1 ? disponibles[i + 1] : null,
    };
  }, [disponibles, leccion.slug]);

  // El índice ya oculta las lecciones de otros roles; sin esta comprobación
  // bastaba con teclear la URL para leerlas.
  const permitida = !leccion.roles || leccion.roles.includes((role || "USER") as Rol);

  if (!hidratado) {
    return (
      <div className="p-10 text-center text-slate-400 text-sm">Cargando guía...</div>
    );
  }

  if (!permitida) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
        <Lock size={28} className="mx-auto text-slate-300 mb-3" />
        <p className="text-slate-600 font-semibold mb-1">Esta guía no está disponible para tu perfil</p>
        <p className="text-slate-400 text-sm mb-4">
          Es material para los roles {leccion.roles?.join(" / ")}.
        </p>
        <Link
          href="/capacitacion"
          className="inline-flex items-center gap-1.5 text-primary font-bold text-sm"
        >
          <ChevronLeft size={16} /> Volver a Capacitación
        </Link>
      </div>
    );
  }

  const tieneVideo = Boolean(leccion.video.embed || leccion.video.url);

  return (
    <>
      <Link
        href="/capacitacion"
        className="inline-flex items-center gap-1.5 text-slate-500 hover:text-primary font-semibold text-sm mb-4 transition-colors"
      >
        <ChevronLeft size={16} /> Centro de Capacitación
      </Link>

      {/* Encabezado */}
      <div className={`${leccion.color} rounded-xl text-white p-8 mb-6 relative overflow-hidden`}>
        <div className="relative z-10 max-w-3xl">
          <div className="text-white/70 text-xs font-bold uppercase tracking-wider mb-2">
            {leccion.categoria}
          </div>
          <h1 className="text-3xl font-bold mb-2">{leccion.titulo}</h1>
          <p className="text-white/80 mb-4">{leccion.resumen}</p>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="flex items-center gap-1.5 bg-black/15 px-2.5 py-1.5 rounded font-semibold">
              <Clock size={12} /> {leccion.lectura} de lectura
            </span>
            {leccion.roles && (
              <span className="bg-black/15 px-2.5 py-1.5 rounded font-semibold">
                Solo {leccion.roles.join(" / ")}
              </span>
            )}
            {leccion.ruta && (
              <Link
                href={leccion.ruta}
                className="flex items-center gap-1.5 bg-white/90 text-slate-800 px-2.5 py-1.5 rounded font-bold hover:bg-white transition-colors"
              >
                <ExternalLink size={12} /> Abrir el módulo
              </Link>
            )}
          </div>
        </div>
        <div className="absolute top-4 right-6 text-black/10 text-8xl font-black select-none">
          {leccion.icono}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Índice: arriba en móvil, a la derecha en escritorio. */}
        <aside className="order-first lg:order-last w-full lg:w-64 shrink-0 bg-white rounded-xl border border-slate-200 p-5 lg:sticky lg:top-20">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
            <List size={13} /> En esta guía
          </div>
          <nav className="flex flex-col gap-1">
            {leccion.secciones.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="text-sm text-slate-600 hover:text-primary hover:bg-slate-50 rounded px-2 py-1.5 transition-colors"
              >
                {s.titulo}
              </a>
            ))}
          </nav>
        </aside>

        {/* Contenido */}
        <article className="flex-1 min-w-0 bg-white rounded-xl border border-slate-200 p-6 md:p-8">
          <section className="mb-8">
            {(() => {
              if (leccion.video.embed) {
                return (
                  <div className="aspect-video w-full rounded-lg overflow-hidden border border-slate-200">
                    <iframe
                      src={leccion.video.embed}
                      title={leccion.video.titulo}
                      allowFullScreen
                      className="w-full h-full"
                    />
                  </div>
                );
              }
              if (leccion.video.url) {
                return <VideoLeccion video={leccion.video} />;
              }
              return (
                <div className="w-full aspect-video rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center text-slate-400 gap-2 px-6 text-center">
                  <PlayCircle size={38} />
                  <span className="text-sm font-bold text-slate-500">{leccion.video.titulo}</span>
                  <span className="text-xs">
                    El video de esta lección está en producción. Mientras tanto, la guía
                    escrita de abajo cubre el tema completo.
                  </span>
                </div>
              );
            })()}
            {tieneVideo && (
              <p className="text-xs text-slate-400 mt-2">{leccion.video.titulo}</p>
            )}
          </section>

          {leccion.secciones.map((seccion) => (
            <section key={seccion.id} id={seccion.id} className="mb-8 scroll-mt-24 last:mb-0">
              <h2 className="text-xl font-bold text-slate-800 mb-3 pb-2 border-b border-slate-100">
                {seccion.titulo}
              </h2>
              {seccion.bloques.map((bloque) => {
                const bKey = `${seccion.id}-${bloque.tipo}-${getBloqueKeySuffix(bloque)}`;
                return <BloqueContenido key={bKey} bloque={bloque} />;
              })}
            </section>
          ))}

          <div className="flex flex-col sm:flex-row gap-3 mt-10 pt-6 border-t border-slate-100">
            {anterior ? (
              <Link
                href={`/capacitacion/${anterior.slug}`}
                className="flex-1 flex items-center gap-3 p-4 rounded-lg border border-slate-200 hover:border-primary hover:bg-slate-50 transition-colors"
              >
                <ChevronLeft size={18} className="text-slate-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Anterior
                  </div>
                  <div className="text-sm font-bold text-slate-700 truncate">
                    {anterior.titulo}
                  </div>
                </div>
              </Link>
            ) : (
              <div className="flex-1" />
            )}

            {siguiente && (
              <Link
                href={`/capacitacion/${siguiente.slug}`}
                className="flex-1 flex items-center justify-end gap-3 p-4 rounded-lg border border-slate-200 hover:border-primary hover:bg-slate-50 transition-colors text-right"
              >
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Siguiente
                  </div>
                  <div className="text-sm font-bold text-slate-700 truncate">
                    {siguiente.titulo}
                  </div>
                </div>
                <ChevronRight size={18} className="text-slate-400 shrink-0" />
              </Link>
            )}
          </div>
        </article>
      </div>
    </>
  );
}
