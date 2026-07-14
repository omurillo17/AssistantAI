"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search, User, Phone, Calendar, Briefcase, FileText,
  CheckCircle, XCircle, Clock, MessageSquare, ExternalLink,
} from "lucide-react";
import { getEstado, ESTADOS_CRM, ESTADOS } from "@/lib/estados";

const N8N_BASE_URL = "/api/n8n";

import type { Candidato, ChatMessage } from "@/types";

function getNombre(c: Candidato) {
  return c.nombre_chat || c.nombre_solicitud || c.nombre_ine || c.nombre || "Candidato Desconocido";
}

// Convierte URLs de WAHA a URLs del proxy de Next.js
function proxyMediaUrl(url: string | null): string | null {
  if (!url) return null;
  return url.replace(/^https?:\/\/(localhost|waha)(:\d+)?\//, '/api/waha-media/');
}

// ─── Badge de Estado ──────────────────────────────────────
function EstadoBadge({ estado }: { estado: string }) {
  const def = getEstado(estado);
  return (
    <span className={`inline-flex items-center gap-1.5 font-bold rounded-full px-3 py-1 text-sm ${def.bg} ${def.color}`}>
      <span>{def.emoji}</span>
      <span>{def.label}</span>
    </span>
  );
}

// ─── Indicador de documento ───────────────────────────────
function DocCard({ label, sublabel, has, hasPartial, detail }: {
  label: string;
  sublabel?: string;
  has: boolean;
  hasPartial?: boolean;
  detail?: string;
}) {
  return (
    <div className={`p-4 rounded-xl border ${has ? "bg-emerald-50 border-emerald-200" : hasPartial ? "bg-amber-50 border-amber-200" : "bg-slate-50 border-slate-200"}`}>
      <div className="flex items-center gap-2 mb-1">
        {has
          ? <CheckCircle size={16} className="text-emerald-600 flex-shrink-0" />
          : hasPartial
            ? <Clock size={16} className="text-amber-500 flex-shrink-0" />
            : <XCircle size={16} className="text-slate-400 flex-shrink-0" />
        }
        <div className={`font-bold text-sm ${has ? "text-emerald-700" : hasPartial ? "text-amber-700" : "text-slate-500"}`}>
          {label}
        </div>
      </div>
      {sublabel && <div className="text-xs text-slate-500 ml-6">{sublabel}</div>}
      {detail && <div className={`text-xs ml-6 font-medium mt-0.5 ${has ? "text-emerald-600" : "text-amber-600"}`}>{detail}</div>}
    </div>
  );
}

export default function CandidatosPage() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [candidato, setCandidato] = useState<Candidato | null>(null);
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [updatingStatus, setUpdatingStatus] = useState(false);

  useEffect(() => {
    document.title = "Expediente de Candidatos | Grupo Virgo";
  }, []);

  const showToast = (msg: string, isError: boolean) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchTerm.trim()) return;
    setIsSearching(true);
    setCandidato(null);
    setErrorMsg("");
    try {
      const res = await fetch(`/api/db/candidato?telefono=${encodeURIComponent(searchTerm.trim())}`);
      if (!res.ok) {
        if (res.status === 404) setErrorMsg("No se encontró ningún candidato con ese número.");
        else throw new Error();
        return;
      }
      const found = await res.json();
      setCandidato(found);
    } catch {
      showToast("Error al buscar candidato", true);
      setErrorMsg("Ocurrió un error de conexión.");
    } finally {
      setIsSearching(false);
    }
  };

  const handleUpdateStatus = async (newEstado: string) => {
    if (!candidato || updatingStatus) return;
    setUpdatingStatus(true);
    try {
      const res = await fetch("/api/db/candidato", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono: candidato.telefono, estado: newEstado }),
      });
      if (!res.ok) throw new Error();
      setCandidato({ ...candidato, estado: newEstado });
      showToast(`Estado actualizado → ${getEstado(newEstado).label}`, false);
    } catch {
      showToast("Error al actualizar estado", true);
    } finally {
      setUpdatingStatus(false);
    }
  };



  // Lógica de documentos
  const hasCV = candidato ? (candidato.tiene_cv || !!candidato.cv_manual) : false;
  const hasINE = candidato ? !!candidato.datos_ine : false;
  const hasRFC = candidato ? !!candidato.datos_rfc : false;
  const ineNombre = candidato?.datos_ine
    ? (typeof candidato.datos_ine === "object"
      ? (candidato.datos_ine as any).nombre || candidato.nombre_ine || null
      : candidato.nombre_ine)
    : null;

  const estadoDef = candidato ? getEstado(candidato.estado) : null;

  return (
    <div className="flex flex-col h-full text-slate-800">


      <main className="flex-1 p-8 max-w-6xl mx-auto w-full">
        {/* Buscador */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-black/5 mb-8">
          <h2 className="text-base font-bold text-slate-800 mb-4">Buscar Candidato por Teléfono</h2>
          <form onSubmit={handleSearch} className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-3.5 text-slate-400" size={18} />
              <input
                type="text"
                placeholder="Número de teléfono (ej. 521332...)"
                className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 focus:bg-white transition-all"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={isSearching || !searchTerm.trim()}
              className="px-8 py-3 bg-primary hover:bg-primary/90 text-white font-bold rounded shadow-sm transition-all disabled:opacity-50"
            >
              {isSearching ? "Buscando..." : "Buscar"}
            </button>
          </form>
          {errorMsg && <p className="text-red-500 mt-3 text-sm font-medium">{errorMsg}</p>}
        </div>

        {/* Resultados */}
        {candidato && (
          <div className="grid grid-cols-1 gap-6 items-start transition-all">

            {/* ── Tarjeta Expediente ─────────────────────── */}
            <div className="">
              <div className="bg-white rounded-2xl shadow-md border border-slate-100 overflow-hidden">
                {/* Header */}
                <div className="h-20 bg-gradient-to-r from-indigo-500 to-purple-600 relative">
                  {estadoDef && (
                    <div className={`absolute bottom-3 right-4 text-[10px] font-bold px-2 py-1 rounded-full ${estadoDef.bg} ${estadoDef.color}`}>
                      {estadoDef.emoji} {estadoDef.label}
                    </div>
                  )}
                </div>
                <div className="px-6 pb-6 relative">
                  {/* Avatar */}
                  <div className="w-20 h-20 bg-white rounded-full border-4 border-white shadow-md flex items-center justify-center -mt-10 mb-3">
                    <User size={36} className="text-slate-300" />
                  </div>

                  <h1 className="text-2xl font-extrabold text-slate-800">{getNombre(candidato)}</h1>
                  {candidato.vacante_interes && (
                    <div className="text-indigo-600 font-bold text-sm mt-0.5">💼 {candidato.vacante_interes}</div>
                  )}

                  {/* Estado + Veredicto */}
                  <div className="flex items-center gap-2 mt-3 mb-5">
                    <EstadoBadge estado={candidato.estado || "NUEVO"} />
                    {candidato.veredicto && (
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${candidato.veredicto === "VIABLE" ? "bg-success/20 text-success" : candidato.veredicto === "CARTERA_GENERAL" ? "bg-info/20 text-info" : "bg-warning/20 text-warning"}`}>
                        🤖 IA: {candidato.veredicto}
                      </span>
                    )}
                  </div>

                  {/* Datos personales */}
                  <div className="grid grid-cols-2 gap-3 mb-5">
                    {[
                      { icon: <Phone size={14} />, label: "Teléfono", value: candidato.telefono },
                      { icon: <User size={14} />, label: "Edad", value: candidato.edad || "—" },
                      { icon: <Briefcase size={14} />, label: "Vacante", value: candidato.vacante_interes || "—" },
                      { icon: <Calendar size={14} />, label: "Sucursal", value: candidato.nave_interes || "—" },
                      { icon: <FileText size={14} />, label: "Correo", value: candidato.correo || "—" },
                      candidato.fecha_entrevista
                        ? { icon: <Calendar size={14} />, label: "Cita", value: new Date(candidato.fecha_entrevista).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) }
                        : null,
                    ].filter(Boolean).map(item => (
                      <div key={item!.label} className="flex items-start gap-2 text-sm">
                        <div className="p-1.5 bg-slate-100 rounded-lg text-slate-400 mt-0.5 flex-shrink-0">{item!.icon}</div>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{item!.label}</div>
                          <div className="font-bold text-slate-700 text-xs truncate max-w-[120px]">{item!.value}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Resumen IA */}
                  {candidato.resumen_ia && (
                    <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 mb-5">
                      <div className="text-xs font-bold text-indigo-600 uppercase tracking-wider mb-1.5">🤖 Resumen IA</div>
                      <div className="text-sm text-indigo-900 leading-relaxed">{candidato.resumen_ia}</div>
                    </div>
                  )}

                  {/* Documentos */}
                  <div className="mb-5">
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2.5 flex items-center gap-1.5">
                      <FileText size={12} /> Documentación
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      <DocCard
                        label="CV / Solicitud"
                        sublabel={candidato.link_cv ? "Archivo disponible" : undefined}
                        has={hasCV}
                        detail={hasCV && candidato.link_cv ? "Ver archivo →" : undefined}
                      />
                      <DocCard
                        label="INE (Identificación)"
                        sublabel={ineNombre ? `Nombre: ${ineNombre}` : undefined}
                        has={hasINE}
                        hasPartial={!hasINE && candidato.nombre_ine != null}
                        detail={candidato.nombre_confirmado ? "Nombre confirmado ✓" : undefined}
                      />
                      <DocCard
                        label="Constancia Fiscal (RFC)"
                        sublabel={hasRFC ? "RFC registrado" : "Sin constancia"}
                        has={hasRFC}
                        hasPartial={!hasRFC && !!candidato.nombre_constancia}
                      />
                    </div>
                    {hasINE && hasRFC && !hasCV && (
                      <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs font-semibold text-amber-700">
                        ⚠️ Documentos de identidad completos — pendiente de CV/Solicitud
                      </div>
                    )}
                    {hasINE && hasRFC && hasCV && (
                      <div className="mt-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-semibold text-emerald-700">
                        ✅ Expediente completo — listo para entrevista
                      </div>
                    )}
                  </div>

                  {/* Mover estado */}
                  <div className="mb-5">
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Cambiar Estado Manualmente</div>
                    <div className="flex flex-wrap gap-1.5">
                      {ESTADOS_CRM.filter(k => k !== candidato.estado).map(k => (
                        <button
                          key={k}
                          disabled={updatingStatus}
                          onClick={() => handleUpdateStatus(k)}
                          className={`text-xs font-bold px-2.5 py-1 rounded-full border transition-all hover:opacity-80 disabled:opacity-50 ${ESTADOS[k].bg} ${ESTADOS[k].color} border-transparent`}
                        >
                          {ESTADOS[k].emoji} {ESTADOS[k].label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Acciones */}
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => router.push(`/mensajes?tel=${candidato.telefono}`)}
                      className="w-full bg-primary hover:bg-primary/90 text-white font-bold py-3 rounded shadow-sm transition-all flex items-center justify-center gap-2 text-sm"
                    >
                      <MessageSquare size={16} /> Abrir Chat 
                    </button>
                    {candidato.link_cv && (
                      <button
                        onClick={() => window.open(proxyMediaUrl(candidato.link_cv ?? null) || "", "_blank")}
                        className="w-full text-center bg-info hover:bg-info/90 text-white font-bold py-3 rounded shadow-sm transition-all flex items-center justify-center gap-2 text-sm"
                      >
                        📄 Ver CV Cargado
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* TOAST NOTIFICATION */}
      <div className={`fixed bottom-6 right-6 px-5 py-3 rounded font-bold text-white shadow-xl transition-all duration-300 z-[2000] ${toast ? "translate-y-0 opacity-100" : "translate-y-16 opacity-0"} ${toast?.isError ? "bg-danger" : "bg-success"}`}>
        {toast?.msg}
      </div>
    </div>
  );
}
