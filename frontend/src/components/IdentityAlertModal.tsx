"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRealtime } from "@/lib/realtimeClient";
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";

import { agruparDocumentos, type ArchivoCandidato } from "@/lib/documentosCandidato";

type AlertaIdentidad = {
  telefono: string;
  nombre_ine: string | null;
  curp_ine: string | null;
  nombre_constancia: string | null;
  curp_rfc: string | null;
  vacante_interes: string | null;
  alerta_identidad_motivo: string | null;
  datos_ine?: unknown;
  datos_rfc?: unknown;
  link_cv?: string | null;
  link_ine?: string | null;
  link_csf?: string | null;
  link_rfc?: string | null;
  updated_at?: string | null;
};

// Alertas que el reclutador mandó a la campana. Se guarda la `updated_at` con la
// que se pospuso: si el candidato reenvía documentos (updated_at cambia), la
// alerta vuelve a interrumpir porque ya es información nueva.
const STORAGE_KEY = "tci_alertas_identidad_pospuestas";

function leerPospuestas(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function guardarPospuestas(valor: Record<string, string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(valor));
  } catch {
    // modo privado / cuota llena: la alerta seguirá viva en memoria, no pasa nada
  }
}

function firmaAlerta(a: AlertaIdentidad): string {
  return a.updated_at ? String(a.updated_at) : "sin-fecha";
}

/** Lista compacta de archivos de un mismo tipo (INE, Constancia, otros). */
function GrupoArchivos({
  titulo,
  icono,
  archivos,
  color,
  vacio,
}: {
  titulo: string;
  icono: string;
  archivos: ArchivoCandidato[];
  color: "violet" | "emerald";
  vacio: string;
}) {
  const estilos = {
    violet: {
      caja: "border-violet-200 bg-violet-50/70 text-violet-800",
      chip: "border-violet-200 text-violet-700 hover:bg-violet-100",
    },
    emerald: {
      caja: "border-emerald-200 bg-emerald-50/70 text-emerald-800",
      chip: "border-emerald-200 text-emerald-700 hover:bg-emerald-100",
    },
  }[color];

  return (
    <div className={`rounded-xl border p-3 ${estilos.caja}`}>
      <div className="text-[11px] font-bold uppercase tracking-wide flex items-center gap-1.5">
        <span>{icono}</span>
        <span>{titulo}</span>
        {archivos.length > 1 && <span className="opacity-60">({archivos.length})</span>}
      </div>
      {archivos.length === 0 ? (
        <p className="text-xs text-slate-400 font-medium mt-1.5">{vacio}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {archivos.map((archivo) => (
            <a
              key={archivo.url}
              href={archivo.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-1 text-[11px] font-bold bg-white px-2 py-1 rounded-lg border shadow-2xs transition-colors ${estilos.chip}`}
            >
              {archivo.etiqueta}
              <ExternalLink size={11} />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function IdentityAlertModal() {
  const pathname = usePathname();
  const [alertas, setAlertas] = useState<AlertaIdentidad[]>([]);
  // Inicialización perezosa: en el servidor no hay localStorage, y en el primer
  // render del cliente `alertas` todavía está vacío, así que el HTML coincide.
  const [pospuestas, setPospuestas] = useState<Record<string, string>>(
    () => (typeof window === "undefined" ? {} : leerPospuestas())
  );
  const [indice, setIndice] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [clasificando, setClasificando] = useState(false);
  // Teléfono del candidato cuyo bloque "Más archivos" está abierto: se colapsa
  // solo al cambiar de candidato, sin un efecto que resetee el estado.
  const [otrosAbiertosDe, setOtrosAbiertosDe] = useState<string | null>(null);

  const fetchAlertas = useCallback(async () => {
    try {
      const res = await fetch("/api/db/alertas-identidad");
      if (res.ok) {
        const data = await res.json();
        setAlertas(data.items || []);
      }
    } catch {
      // silencioso, se reintenta en el siguiente ciclo
    }
  }, []);

  // Igual que la campana: las alertas llegan por push cuando cambia
  // alerta_identidad_estado (canal candidato_change); el intervalo largo es
  // solo el respaldo si el stream se corta sin avisar.
  useRealtime((ev) => {
    if (ev.tipo === "candidato" && ev.alerta) fetchAlertas();
  });

  useEffect(() => {
    // Envuelta en una función async local (igual que en TopNavbar): llamarla
    // suelta en el cuerpo del efecto hace que el analizador la lea como un
    // setState síncrono y avise de renders en cascada.
    const cargar = async () => { await fetchAlertas(); };
    cargar();
    const interval = setInterval(cargar, 120000);

    const handleOpenEvent = (e: Event) => {
      const telefono = (e as CustomEvent<{ telefono?: string }>).detail?.telefono;
      setPospuestas((prev) => {
        const next = telefono ? { ...prev } : {};
        if (telefono) delete next[telefono];
        guardarPospuestas(next);
        return next;
      });
      fetchAlertas();
    };

    window.addEventListener("open-identity-modal", handleOpenEvent);
    return () => {
      clearInterval(interval);
      window.removeEventListener("open-identity-modal", handleOpenEvent);
    };
  }, [fetchAlertas]);

  // Un candidato pospuesto no vuelve a interrumpir hasta que mande documentos
  // nuevos (cambia updated_at) o el reclutador lo abra desde la campana.
  const pendientes = useMemo(
    () => alertas.filter((a) => pospuestas[a.telefono] !== firmaAlerta(a)),
    [alertas, pospuestas]
  );

  // El índice se acota al renderizar: si se resuelve la última alerta de la
  // lista, el modal pasa a la anterior sin necesidad de sincronizar estado.
  const actual = pendientes[Math.min(indice, pendientes.length - 1)];

  const documentos = useMemo(() => agruparDocumentos(actual ?? {}), [actual]);

  if (pathname === "/login" || !actual) return null;

  const verOtros = otrosAbiertosDe === actual.telefono;

  const posponer = (telefono: string, firma: string) => {
    setPospuestas((prev) => {
      const next = { ...prev, [telefono]: firma };
      guardarPospuestas(next);
      return next;
    });
  };

  /** La ✕: baja TODAS las alertas pendientes a la campana de notificaciones. */
  const cerrarTodas = async () => {
    const aPosponer = pendientes;
    setPospuestas((prev) => {
      const next = { ...prev };
      aPosponer.forEach((a) => { next[a.telefono] = firmaAlerta(a); });
      guardarPospuestas(next);
      return next;
    });
    setIndice(0);

    await Promise.all(
      aPosponer.map((a) =>
        fetch("/api/db/notificaciones", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // `clave` evita duplicados: si ya hay una notificación sin leer de
            // este candidato, el endpoint no inserta otra.
            clave: a.telefono,
            mensaje:
              `⚠️ Verificación de identidad pendiente — ${a.nombre_ine || a.nombre_constancia || "Candidato"} ` +
              `(wa.me/${a.telefono})${a.vacante_interes ? ` · ${a.vacante_interes}` : ""}. ` +
              `${a.alerta_identidad_motivo || "La CURP del INE y de la Constancia no coinciden."}`,
          }),
        }).catch(() => {})
      )
    );
    window.dispatchEvent(new CustomEvent("refrescar-notificaciones"));
  };

  const resolver = async (decision: "validar" | "no_validar") => {
    setProcessing(true);
    try {
      await fetch("/api/db/candidato/validar-identidad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono: actual.telefono, decision }),
      });
      posponer(actual.telefono, firmaAlerta(actual));
      await fetchAlertas();
    } catch (e) {
      console.error("Error resolviendo alerta de identidad:", e);
    } finally {
      setProcessing(false);
    }
  };

  const clasificarConIA = async () => {
    setClasificando(true);
    try {
      const res = await fetch("/api/db/candidato/clasificar-archivos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono: actual.telefono }),
      });
      if (res.ok) await fetchAlertas();
    } catch (e) {
      console.error("Error clasificando archivos con IA:", e);
    } finally {
      setClasificando(false);
    }
  };

  const curpsDistintas = !!actual.curp_ine && !!actual.curp_rfc && actual.curp_ine !== actual.curp_rfc;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[92vh] overflow-y-auto border-2 border-red-500">
        <div className="bg-red-600 text-white px-4 py-3 flex items-center justify-between gap-3 sticky top-0 z-10">
          <div className="flex items-center gap-2.5 min-w-0">
            <AlertTriangle size={20} className="shrink-0" />
            <div className="min-w-0">
              <h2 className="font-bold text-base leading-tight truncate">Verificación de identidad</h2>
              <p className="text-red-100 text-[11px] truncate">
                {actual.nombre_ine || actual.nombre_constancia || "Candidato"} · wa.me/{actual.telefono}
                {actual.vacante_interes ? ` · ${actual.vacante_interes}` : ""}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {pendientes.length > 1 && (
              <div className="flex items-center gap-0.5 text-[11px] font-bold bg-red-700/60 rounded-lg px-1">
                <button
                  onClick={() => setIndice((i) => Math.max(0, i - 1))}
                  disabled={indice === 0}
                  className="p-1 disabled:opacity-30 hover:bg-red-800/60 rounded"
                  title="Anterior"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="tabular-nums px-0.5">{indice + 1}/{pendientes.length}</span>
                <button
                  onClick={() => setIndice((i) => Math.min(pendientes.length - 1, i + 1))}
                  disabled={indice >= pendientes.length - 1}
                  className="p-1 disabled:opacity-30 hover:bg-red-800/60 rounded"
                  title="Siguiente"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
            <button
              onClick={cerrarTodas}
              title={
                pendientes.length > 1
                  ? `Cerrar las ${pendientes.length} alertas y dejarlas en notificaciones`
                  : "Cerrar y dejarla en notificaciones"
              }
              className="p-1.5 hover:bg-red-700 rounded-lg transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-3">
          {actual.alerta_identidad_motivo && (
            <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 leading-relaxed">
              {actual.alerta_identidad_motivo}
            </div>
          )}

          {(actual.curp_ine || actual.curp_rfc) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {[
                { titulo: "CURP en INE", valor: actual.curp_ine, nombre: actual.nombre_ine },
                { titulo: "CURP en Constancia", valor: actual.curp_rfc, nombre: actual.nombre_constancia },
              ].map((campo) => (
                <div
                  key={campo.titulo}
                  className={`rounded-xl border p-2.5 ${curpsDistintas ? "border-red-200 bg-red-50/60" : "border-slate-200 bg-slate-50"}`}
                >
                  <div className="text-[10px] font-bold uppercase text-slate-500">{campo.titulo}</div>
                  <div className="font-mono font-bold text-slate-800 break-all">{campo.valor || "—"}</div>
                  {campo.nombre && <div className="text-[11px] text-slate-500 truncate">{campo.nombre}</div>}
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <GrupoArchivos
              titulo="INE"
              icono="🪪"
              color="violet"
              archivos={documentos.ine}
              vacio="Sin INE identificada"
            />
            <GrupoArchivos
              titulo="Constancia fiscal"
              icono="📋"
              color="emerald"
              archivos={documentos.csf}
              vacio="Sin constancia identificada"
            />
          </div>

          {documentos.otros.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50">
              <button
                onClick={() => setOtrosAbiertosDe(verOtros ? null : actual.telefono)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                <span>📎 Más archivos ({documentos.otros.length})</span>
                <ChevronDown size={14} className={`transition-transform ${verOtros ? "rotate-180" : ""}`} />
              </button>
              {verOtros && (
                <div className="flex flex-wrap gap-1.5 px-3 pb-3">
                  {documentos.otros.map((archivo) => (
                    <a
                      key={archivo.url}
                      href={archivo.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-bold bg-white text-slate-700 px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 shadow-2xs transition-colors"
                    >
                      {archivo.etiqueta}
                      <ExternalLink size={11} />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {documentos.sinClasificar && (
            <button
              onClick={clasificarConIA}
              disabled={clasificando}
              className="w-full flex items-center justify-center gap-2 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl py-2.5 transition-colors disabled:opacity-60"
            >
              {clasificando ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {clasificando
                ? "Identificando documentos…"
                : "Este expediente llegó sin clasificar · Identificar INE y constancia con IA"}
            </button>
          )}

          {documentos.total === 0 && (
            <p className="text-xs text-slate-400 text-center py-2">
              Este candidato todavía no tiene archivos guardados.
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <button
              disabled={processing}
              onClick={() => resolver("validar")}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg transition-colors"
            >
              Validar
            </button>
            <button
              disabled={processing}
              onClick={() => resolver("no_validar")}
              className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg transition-colors"
            >
              No validar
            </button>
          </div>
          <button
            disabled={processing}
            onClick={() => posponer(actual.telefono, firmaAlerta(actual))}
            className="w-full text-center text-xs text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50"
          >
            Revisar después
          </button>
        </div>
      </div>
    </div>
  );
}
