"use client";

import { useState, useEffect, useRef } from "react";
import { Candidato, ChatMessage, Mensaje } from "@/types";
import { getEstado, ESTADOS_CRM, ESTADOS, EstadoKey, estadosPersonalizadosActivos } from "@/lib/estados";
import { getCandidateDisplayName, formatNaveName, proxyMediaUrl } from "@/lib/formatters";
import { agruparDocumentos, parseDatosDocumento } from "@/lib/documentosCandidato";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import { X, ExternalLink, Calendar, Briefcase, FileText, CheckCircle, AlertCircle, Bot, User, MessageSquare, Sparkles } from "lucide-react";

interface CandidateModalProps {
  candidato: Candidato;
  onClose: () => void;
  onStatusChange: (telefono: string, newStatus: string) => void;
  onGoToChat: (telefono: string) => void;
}

function getVeredictoBadgeClass(veredicto?: string | null): string {
  switch (veredicto) {
    case "VIABLE":
      return "bg-emerald-100 text-emerald-800 border border-emerald-200";
    case "REUBICACION":
      return "bg-amber-100 text-amber-800 border border-amber-200";
    case "CARTERA_GENERAL":
      return "bg-slate-200 text-slate-800 border border-slate-300";
    default:
      return "bg-rose-100 text-rose-800 border border-rose-200";
  }
}

function parseResumenParts(rawParts: string[]) {
  const items: { label: string; value: string }[] = [];
  let notes = "";
  for (const part of rawParts) {
    const colonIdx = part.indexOf(":");
    if (colonIdx > 0) {
      const key = part.slice(0, colonIdx).trim();
      const val = part.slice(colonIdx + 1).replace(/\.$/, "").trim();
      const keyLower = key.toLowerCase();
      if (keyLower === "notas" || keyLower === "resumen" || keyLower === "analisis") {
        notes = val;
      } else if (!["nombre", "vacante", "etapa"].includes(keyLower)) {
        items.push({ label: key, value: val });
      }
    } else if (part.trim() && !notes) {
      notes = part.trim();
    }
  }
  return { items, notes };
}

function parseResumenIa(text?: string | null) {
  if (!text || typeof text !== "string") {
    return { items: [], notes: typeof text === "object" ? JSON.stringify(text) : String(text || "") };
  }
  if (text.includes(":") && (text.includes(".") || text.includes("\n"))) {
    const rawParts = text.split(/(?:\r?\n|(?<=\.)\s+)/);
    return parseResumenParts(rawParts);
  }
  return { items: [], notes: text };
}

export function CandidateModal({ candidato, onClose, onStatusChange, onGoToChat }: Readonly<CandidateModalProps>) {
  const [cand, setCand] = useState<Candidato>(candidato);
  const [validating, setValidating] = useState(false);
  const [clasificando, setClasificando] = useState(false);
  const [mensajes, setMensajes] = useState<ChatMessage[]>([]);
  const [loadingChat, setLoadingChat] = useState(true);
  const [justUpdated, setJustUpdated] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const [suppressNextUpdate, setSuppressNextUpdate] = useState(false);
  const [prevCandidato, setPrevCandidato] = useState(candidato);

  if (candidato !== prevCandidato) {
    setPrevCandidato(candidato);
    setCand(candidato);
    if (suppressNextUpdate) {
      setSuppressNextUpdate(false);
    } else if (JSON.stringify(candidato) !== JSON.stringify(prevCandidato)) {
      setJustUpdated(true);
    }
  }

  // El aviso se esconde solo a los 4s. El setState va dentro del timeout, no
  // en el cuerpo del efecto.
  useEffect(() => {
    if (!justUpdated) return;
    const t = setTimeout(() => setJustUpdated(false), 4000);
    return () => clearTimeout(t);
  }, [justUpdated]);

  const nombre = getCandidateDisplayName(cand);

  // Reclasificación con IA de los archivos ya guardados. Solo hace falta en
  // expedientes anteriores a la clasificación por archivo del analizador: el
  // backend vuelve a pasarlos por Gemini, guarda qué es cada uno y de paso
  // borra las capturas del anuncio que nunca debieron archivarse.
  const handleClasificarArchivos = async () => {
    if (!cand.telefono || clasificando) return;
    setClasificando(true);
    try {
      const res = await fetch("/api/db/candidato/clasificar-archivos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono: cand.telefono }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        setSuppressNextUpdate(true);
        setCand(prev => {
          const ine = parseDatosDocumento(prev.datos_ine);
          const rfc = parseDatosDocumento(prev.datos_rfc);
          const cv = parseDatosDocumento(prev.cv_manual);
          return {
            ...prev,
            datos_ine: ine ? { ...ine, archivos: data.archivos } : { archivos: data.archivos },
            datos_rfc: rfc ? JSON.stringify({ ...rfc, archivos: data.archivos }) : JSON.stringify({ archivos: data.archivos }),
            cv_manual: cv ? { ...cv, archivos: data.archivos } : { archivos: data.archivos },
          };
        });
      }
    } catch (e) {
      console.error("Error clasificando archivos con IA:", e);
    } finally {
      setClasificando(false);
    }
  };

  const handleValidarIdentidad = async (decision: "validar" | "no_validar") => {
    if (!cand.telefono || validating) return;
    setValidating(true);
    try {
      const res = await fetch("/api/db/candidato/validar-identidad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono: cand.telefono, decision }),
      });
      if (res.ok) {
        const newStatus = decision === "validar" ? "INE_VALIDADA" : "DOCUMENTOS_NO_COINCIDEN";
        const newAlertaState = decision === "validar" ? "VALIDADO" : "RECHAZADO";
        setSuppressNextUpdate(true);
        setCand(prev => ({
          ...prev,
          estado: newStatus,
          alerta_identidad_estado: newAlertaState
        }));
        onStatusChange(cand.telefono, newStatus);
      }
    } catch (err) {
      console.error("Error al procesar decisión de identidad:", err);
    } finally {
      setValidating(false);
    }
  };

  // Fetch chat history
  useEffect(() => {
    async function loadChat() {
      if (!cand.telefono) return;
      setLoadingChat(true);
      try {
        const storedEmpresaId = localStorage.getItem("tci_empresa_id");
        const storedNaveId = localStorage.getItem("tci_nave_id");
        let query = "";
        if (storedEmpresaId) query += `?empresa_id=${storedEmpresaId}`;
        if (storedNaveId) query += (query ? `&` : `?`) + `nave_id=${storedNaveId}`;

        const res = await fetch(`/api/db/mensajes/${cand.telefono}${query}`);
        if (res.ok) {
          const data = await res.json();
          setMensajes(data.mensajes || data.history || []);
        }
      } catch (err) {
        console.error("Error loading chat:", err);
      } finally {
        setLoadingChat(false);
      }
    }
    loadChat();
  }, [cand.telefono]);

  // Scroll to bottom of chat
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [mensajes]);

  const ineData = parseDatosDocumento(cand.datos_ine);
  const csfData = parseDatosDocumento(cand.datos_rfc);

  const chatMediaUrls = (mensajes || [])
    // Según de dónde venga el mensaje el campo llega con uno u otro nombre;
    // se contemplan los tres en vez de apagar el tipado con `any`.
    .map((m) => {
      const alt = m as Mensaje & { url?: string | null; mediaUrl?: string | null };
      return proxyMediaUrl(alt.media_url || alt.url || alt.mediaUrl);
    })
    .filter((url): url is string => !!url);

  // Cada archivo va a su casilla según la clasificación por archivo que dejó la
  // IA al recibirlo (backend/app/chat/analizador.py). Lo que no se puede
  // identificar cae en "Más archivos" en vez de repetirse idéntico bajo INE y
  // bajo Constancia, que es lo que pasaba con los expedientes AMBOS_DOCS.
  const documentos = agruparDocumentos(cand);
  const esCV = (tipo: string) => tipo === 'CV' || tipo === 'SOLICITUD';
  const ineUrls = documentos.ine.map(a => a.url);
  const csfUrls = documentos.csf.map(a => a.url);
  const cvUrls = documentos.otros.filter(a => esCV(a.tipo)).map(a => a.url);
  const otrosArchivos = documentos.otros.filter(a => !esCV(a.tipo));

  let cvLink = cvUrls[0] || null;
  let ineUrl = ineUrls[0] || null;
  let csfUrl = csfUrls[0] || null;

  if (!cvLink && chatMediaUrls.length > 0) cvLink = chatMediaUrls[0];
  if (!ineUrl && chatMediaUrls.length > 1) ineUrl = chatMediaUrls[1];
  if (!csfUrl && chatMediaUrls.length > 2) csfUrl = chatMediaUrls[2];

  const asStr = (val: unknown): string => {
    if (typeof val === "string") return val;
    if (typeof val === "number") return String(val);
    return "";
  };
  const ineName = (asStr(ineData?.nombre_completo) || asStr(ineData?.nombre) || cand.nombre_ine || "").trim();
  const rfcName = (asStr(csfData?.nombre_completo) || asStr(csfData?.nombre) || asStr(csfData?.razon_social) || cand.nombre_constancia || "").trim();

  const ineCurp = (asStr(ineData?.curp) || cand.curp_ine || "").trim();
  const rfcCurp = (asStr(csfData?.curp) || cand.curp_rfc || "").trim();

  const getLevenshtein = (s1: unknown, s2: unknown) => {
    if (!s1 || !s2 || typeof s1 !== "string" || typeof s2 !== "string") return 0;
    const a = s1.toUpperCase();
    const b = s2.toUpperCase();
    if (a === b) return 0;
    const track = new Array(b.length + 1).fill(null).map(() => new Array(a.length + 1).fill(null));
    for (let i = 0; i <= a.length; i++) track[0][i] = i;
    for (let j = 0; j <= b.length; j++) track[j][0] = j;
    for (let j = 1; j <= b.length; j++) {
      for (let i = 1; i <= a.length; i++) {
        const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
        track[j][i] = Math.min(
          track[j][i - 1] + 1,
          track[j - 1][i] + 1,
          track[j - 1][i - 1] + indicator
        );
      }
    }
    return track[b.length][a.length];
  };

  const charDiff = (ineName && rfcName) ? getLevenshtein(ineName, rfcName) : 0;
  const hasCV = cand.tiene_cv || !!cvLink || cvUrls.length > 0;
  const backdropHandlers = useBackdropClose(onClose);

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1000] p-2 sm:p-4 lg:p-6"
      {...backdropHandlers}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-6xl max-h-[94vh] sm:max-h-[90vh] shadow-2xl flex flex-col overflow-hidden animate-fade-in"
      >
        {/* AVISO DE ACTUALIZACIÓN AUTOMÁTICA */}
        {justUpdated && (
          <div className="px-4 sm:px-6 py-2 bg-indigo-600 text-white text-xs font-bold flex items-center gap-2 flex-shrink-0 animate-fade-in">
            <Sparkles size={13} /> Se actualizó por nueva información
          </div>
        )}

        {/* HEADER */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 bg-slate-50 flex-shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg sm:text-2xl font-extrabold text-slate-800 truncate">{nombre}</h2>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-1 text-xs sm:text-sm text-slate-500">
              <span className="font-mono bg-slate-200 px-2 py-0.5 rounded text-slate-700">{cand.telefono}</span>
              {cand.vacante_interes && (
                <span className="flex items-center gap-1 font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded text-xs">
                  <Briefcase size={13} /> {cand.vacante_interes}
                </span>
              )}
              {cand.nave_interes && (
                <span className="flex items-center gap-1 font-semibold text-slate-600 bg-slate-200 px-2 py-0.5 rounded text-xs">
                  {formatNaveName(cand.nave_interes)}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <button
              onClick={() => onGoToChat(cand.telefono)}
              className="flex items-center gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 bg-indigo-600 text-white hover:bg-indigo-700 font-bold rounded-lg transition-colors shadow-sm text-xs sm:text-sm"
            >
              <MessageSquare size={15} /> <span className="hidden xs:inline">Ir a</span> Mensajes
            </button>
            <button onClick={onClose} className="p-1.5 sm:p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full transition-colors">
              <X size={22} />
            </button>
          </div>
        </div>

        {/* BODY (Split Layout) */}
        <div className="flex flex-1 overflow-y-auto md:overflow-hidden flex-col md:flex-row min-h-0">

          {/* LEFT COL: Profile Info */}
          <div className="w-full md:w-1/2 lg:w-5/12 border-b md:border-b-0 md:border-r border-slate-100 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-6 bg-white">

            {/* ESTADO CHANGER */}
            <div>
              <label htmlFor="candidate-estado" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Estado del Proceso</label>
              <select
                id="candidate-estado"
                name="estado"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer shadow-sm transition-colors"
                value={cand.estado}
                onChange={(e) => {
                  const newStatus = e.target.value;
                  setSuppressNextUpdate(true);
                  setCand(prev => ({ ...prev, estado: newStatus }));
                  onStatusChange(cand.telefono, newStatus);
                }}
              >
                <option value={cand.estado}>{getEstado(cand.estado).emoji} {getEstado(cand.estado).label}</option>
                <option disabled>── Mover a ──</option>
                {ESTADOS_CRM.filter(k => k !== cand.estado).map(k => (
                  <option key={k} value={k}>{ESTADOS[k as EstadoKey].emoji} {ESTADOS[k as EstadoKey].label}</option>
                ))}
                {estadosPersonalizadosActivos().filter(e => e.clave !== cand.estado).map(e => (
                  <option key={e.clave} value={e.clave}>✋ {e.nombre}</option>
                ))}
              </select>
            </div>

            {/* IA SUMMARY */}
            {(() => {
              const { items } = parseResumenIa(cand.resumen_ia);

              return (
                <div className="bg-gradient-to-br from-purple-50/70 to-indigo-50/50 border border-purple-100 rounded-2xl p-5 shadow-sm space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-purple-900 flex items-center gap-2">
                      <Bot size={18} className="text-purple-600" /> Resumen de IA Sofía
                    </h3>
                    {cand.veredicto && (
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${getVeredictoBadgeClass(cand.veredicto)}`}>
                        {cand.veredicto === 'VIABLE' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                        {cand.veredicto}
                      </span>
                    )}
                  </div>

                  {/* CHECKLIST DE ESTADO / DOCUMENTOS */}
                  {items.length > 0 && (
                    <div className="bg-white/80 backdrop-blur-sm rounded-xl p-3.5 border border-purple-100/80 shadow-2xs">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-purple-700 mb-2 flex items-center gap-1.5">
                        <CheckCircle size={13} /> Requisitos & Documentos
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {items.map((it, idx) => {
                          const valLower = String(it.value || '').toLowerCase();
                          const isOk = valLower.includes('aceptad') || valLower.includes('verificad') || valLower.includes('recibid') || valLower.includes('agendad') || valLower.includes('sí') || valLower.includes('si');

                          const formatValue = (v: unknown) => {
                            if (!v || typeof v !== 'string') return typeof v === 'number' ? String(v) : '';
                            const isoMatch = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/.exec(v);
                            if (isoMatch) {
                              try {
                                const d = new Date(isoMatch[0]);
                                if (!Number.isNaN(d.getTime())) {
                                  const formatted = d.toLocaleString('es-MX', {
                                    day: 'numeric',
                                    month: 'short',
                                    year: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    hour12: true
                                  });
                                  return v.replace(isoMatch[0], formatted);
                                }
                              } catch { }
                            }
                            return v;
                          };

                          return (
                            <div key={`${it.label}-${String(it.value)}`} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border ${isOk
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200/80'
                              : 'bg-amber-50 text-amber-800 border-amber-200/80'
                              }`}>
                              <span className="opacity-75">{it.label}:</span>
                              <span className="font-bold">{formatValue(it.value)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* EXPERIENCIA EN LAS ACTIVIDADES DEL PUESTO */}
            {cand.experiencia_actividades && (
              <div className="bg-emerald-50/60 border border-emerald-200/70 rounded-2xl p-4">
                <h3 className="text-sm font-bold text-emerald-900 flex items-center gap-2 mb-2">
                  <Briefcase size={18} className="text-emerald-600" />
                  Experiencia en las actividades del puesto
                </h3>
                <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                  {cand.experiencia_actividades}
                </p>
                <p className="text-[11px] text-emerald-700/70 mt-2">
                  Respuesta del candidato cuando se le mostraron las actividades a realizar.
                </p>
              </div>
            )}

            {/* DOCUMENTOS Y COMPARACIÓN INE vs RFC */}
            {(() => {
              return (
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-slate-700 flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <FileText size={16} /> Documentos
                    </span>
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* CV Card */}
                    <div className={`p-4 rounded-xl border ${hasCV ? 'bg-cyan-50/80 border-cyan-100' : 'bg-slate-50 border-slate-100'} flex flex-col items-start gap-2 col-span-1 sm:col-span-2`}>
                      <div className="flex justify-between items-center w-full">
                        <div className={`text-xs font-bold ${hasCV ? 'text-cyan-800' : 'text-slate-500'}`}>Currículum Vitae / Solicitud {cvUrls.length > 1 && `(${cvUrls.length} docs/págs)`}</div>
                        {cvUrls.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {cvUrls.map((u, idx) => (
                              <a key={u} href={u} target="_blank" rel="noreferrer" className="text-xs font-bold text-cyan-700 hover:underline flex items-center gap-1 bg-white px-2 py-0.5 rounded border border-cyan-200 shadow-2xs">
                                {cvUrls.length > 1 ? `Ver Pág ${idx + 1}` : 'Abrir CV'} <ExternalLink size={12} />
                              </a>
                            ))}
                          </div>
                        )}
                        {cvUrls.length === 0 && cvLink && (
                          <a href={cvLink} target="_blank" rel="noreferrer" className="text-xs font-bold text-cyan-700 hover:underline flex items-center gap-1 bg-white px-2 py-0.5 rounded border border-cyan-200 shadow-2xs">
                            Abrir CV <ExternalLink size={12} />
                          </a>
                        )}
                      </div>
                      {hasCV ? (
                        <span className="text-xs text-cyan-700">Documento recibido y analizado por Sofia.</span>
                      ) : (
                        <span className="text-xs text-slate-400">No proporcionado</span>
                      )}
                    </div>

                    {/* INE Card */}
                    <div className={`p-4 rounded-xl border ${ineData || ineName ? 'bg-violet-50/80 border-violet-100' : 'bg-slate-50 border-slate-100'} flex flex-col items-start gap-2`}>
                      <div className="flex justify-between items-center w-full">
                        <div className={`text-xs font-bold ${ineData || ineName ? 'text-violet-800' : 'text-slate-500'}`}>🪪 Documento INE {ineUrls.length > 1 && `(${ineUrls.length} fotos)`}</div>
                        {ineUrls.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {ineUrls.map((u, idx) => {
                              let label = "Ver INE";
                              if (ineUrls.length > 1) {
                                if (idx === 0) {
                                  label = "Frente";
                                } else {
                                  const revNum = idx > 1 ? ` ${idx}` : "";
                                  label = `Reverso${revNum}`;
                                }
                              }
                              return (
                                <a key={u} href={u} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-violet-700 hover:underline flex items-center gap-1 bg-white px-2 py-0.5 rounded border border-violet-200 shadow-2xs">
                                  {label} <ExternalLink size={11} />
                                </a>
                              );
                            })}
                          </div>
                        )}
                        {ineUrls.length === 0 && ineUrl && (
                          <a href={ineUrl} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-violet-700 hover:underline flex items-center gap-1 bg-white px-2 py-0.5 rounded border border-violet-200 shadow-2xs">
                            Ver INE <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                      {ineData || ineName ? (
                        <div className="text-xs text-violet-900 space-y-1.5 w-full bg-white/70 p-2.5 rounded-lg border border-violet-100">
                          <div><span className="font-bold text-slate-500 block text-[10px] uppercase">Nombre en INE:</span> <span className="font-extrabold">{ineName || '—'}</span></div>
                          <div><span className="font-bold text-slate-500 block text-[10px] uppercase">CURP:</span> <span className="font-mono">{ineCurp || '—'}</span></div>
                          {ineData?.clave_elector ? <div><span className="font-bold text-slate-500 block text-[10px] uppercase">Clave Elector:</span> <span className="font-mono">{asStr(ineData.clave_elector)}</span></div> : null}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">No entregado aún</span>
                      )}
                    </div>

                    {/* CSF / RFC Card */}
                    <div className={`p-4 rounded-xl border ${csfData || rfcName ? 'bg-emerald-50/80 border-emerald-100' : 'bg-slate-50 border-slate-100'} flex flex-col items-start gap-2`}>
                      <div className="flex justify-between items-center w-full">
                        <div className={`text-xs font-bold ${csfData || rfcName ? 'text-emerald-800' : 'text-slate-500'}`}>📋 Constancia Fiscal (CSF) {csfUrls.length > 1 && `(${csfUrls.length} docs)`}</div>
                        {csfUrls.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {csfUrls.map((u, idx) => (
                              <a key={u} href={u} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-emerald-700 hover:underline flex items-center gap-1 bg-white px-2 py-0.5 rounded border border-emerald-200 shadow-2xs">
                                {csfUrls.length > 1 ? `Pág ${idx + 1}` : 'Ver CSF'} <ExternalLink size={11} />
                              </a>
                            ))}
                          </div>
                        )}
                        {csfUrls.length === 0 && csfUrl && (
                          <a href={csfUrl} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-emerald-700 hover:underline flex items-center gap-1 bg-white px-2 py-0.5 rounded border border-emerald-200 shadow-2xs">
                            Ver CSF <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                      {csfData || rfcName ? (
                        <div className="text-xs text-emerald-900 space-y-1.5 w-full bg-white/70 p-2.5 rounded-lg border border-emerald-100">
                          <div><span className="font-bold text-slate-500 block text-[10px] uppercase">Nombre / Razón Social:</span> <span className="font-extrabold">{rfcName || '—'}</span></div>
                          <div className="grid grid-cols-2 gap-1">
                            <div><span className="font-bold text-slate-500 block text-[10px] uppercase">RFC:</span> <span className="font-mono">{asStr(csfData?.rfc) || '—'}</span></div>
                            <div><span className="font-bold text-slate-500 block text-[10px] uppercase">CURP:</span> <span className="font-mono">{rfcCurp || '—'}</span></div>
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">No entregado aún</span>
                      )}
                    </div>

                    {/* MÁS ARCHIVOS: todo lo que el candidato mandó y no es INE,
                        constancia ni CV (acta, IMSS, comprobantes, etc.). */}
                    {otrosArchivos.length > 0 && (
                      <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col items-start gap-2 col-span-1 sm:col-span-2">
                        <div className="text-xs font-bold text-slate-600">📎 Más archivos ({otrosArchivos.length})</div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {otrosArchivos.map(archivo => (
                            <a
                              key={archivo.url}
                              href={archivo.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] font-bold text-slate-700 hover:underline flex items-center gap-1 bg-white px-2 py-0.5 rounded border border-slate-200 shadow-2xs"
                            >
                              {archivo.etiqueta} <ExternalLink size={11} />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {documentos.total > 0 && (
                      <button
                        onClick={handleClasificarArchivos}
                        disabled={clasificando}
                        className="col-span-1 sm:col-span-2 flex items-center justify-center gap-2 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl py-2.5 transition-colors disabled:opacity-60 cursor-pointer shadow-xs"
                      >
                        <Sparkles size={14} className={clasificando ? 'animate-pulse' : ''} />
                        {clasificando
                          ? 'Identificando documentos con IA…'
                          : documentos.sinClasificar
                            ? 'Este expediente llegó sin clasificar · Identificar INE y constancia con IA'
                            : 'Reclasificar documentos con IA (identificar archivos)'}
                      </button>
                    )}

                  </div>

                  {/* PANEL DE VALIDACIÓN / DECISIÓN MANUAL */}
                  {(() => {
                    const isAlreadyValidated = cand.alerta_identidad_estado === 'VALIDADO' || cand.estado === 'INE_VALIDADA';
                    const hasActivePendingError = !isAlreadyValidated && (
                      charDiff >= 3 ||
                      cand.alerta_identidad_estado === 'PENDIENTE' ||
                      cand.estado === 'DOCUMENTOS_NO_COINCIDEN'
                    );

                    let cardBgClass = "bg-slate-50 border-slate-200 opacity-80";
                    if (hasActivePendingError) {
                      cardBgClass = "bg-amber-50/70 border-amber-200 shadow-sm";
                    } else if (isAlreadyValidated) {
                      cardBgClass = "bg-emerald-50/60 border-emerald-200";
                    }

                    let statusBadge = (
                      <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full border bg-emerald-100 text-emerald-800 border-emerald-300">
                        ✅ Sin Errores
                      </span>
                    );
                    if (isAlreadyValidated) {
                      statusBadge = (
                        <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full border bg-emerald-100 text-emerald-800 border-emerald-300">
                          ✅ Validado
                        </span>
                      );
                    } else if (cand.alerta_identidad_estado) {
                      const badgeColor =
                        cand.alerta_identidad_estado === "RECHAZADO"
                          ? "bg-rose-100 text-rose-800 border-rose-300"
                          : "bg-amber-100 text-amber-800 border-amber-300";
                      statusBadge = (
                        <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${badgeColor}`}>
                          {cand.alerta_identidad_estado === "RECHAZADO" && "🚫 Rechazado"}
                          {cand.alerta_identidad_estado === "PENDIENTE" && "⚠️ Pendiente de revisión"}
                        </span>
                      );
                    }

                    let validationMessage = null;
                    if (isAlreadyValidated) {
                      validationMessage = (
                        <div className="text-xs text-emerald-800 font-medium">
                          La documentación ya fue validada. Las opciones de validación manual se encuentran deshabilitadas.
                        </div>
                      );
                    } else if (hasActivePendingError && cand.alerta_identidad_motivo) {
                      validationMessage = (
                        <div className="text-xs text-amber-800 bg-white/80 p-2.5 rounded-xl border border-amber-200 leading-snug">
                          {cand.alerta_identidad_motivo}
                        </div>
                      );
                    } else if (!hasActivePendingError) {
                      validationMessage = (
                        <div className="text-xs text-slate-500 italic">
                          Los documentos fueron validados sin errores. La validación manual solo se habilita cuando existe un error pendiente.
                        </div>
                      );
                    }

                    return (
                      <div className={`rounded-2xl p-4 space-y-3 border transition-all ${cardBgClass}`}>
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-extrabold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                            <CheckCircle size={14} className={hasActivePendingError ? "text-amber-600" : "text-emerald-600"} /> Validación Manual de Documentación
                          </div>
                          {statusBadge}
                        </div>

                        {validationMessage}

                        <div className="flex gap-2 pt-1">
                          <button
                            disabled={!hasActivePendingError || validating}
                            onClick={() => handleValidarIdentidad('validar')}
                            className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-1.5"
                          >
                            <CheckCircle size={14} /> Validar Documentos
                          </button>
                          <button
                            disabled={!hasActivePendingError || validating}
                            onClick={() => handleValidarIdentidad('no_validar')}
                            className="flex-1 py-2.5 px-4 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-1.5"
                          >
                            <AlertCircle size={14} /> No Validar
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })()}

            {/* INFO EXTRA */}
            {(cand.edad || cand.correo || cand.fecha_entrevista) && (
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-5 shadow-sm space-y-3">
                {cand.fecha_entrevista && (() => {
                  try {
                    const d = new Date(cand.fecha_entrevista);
                    if (Number.isNaN(d.getTime())) return null;
                    return (
                      <div className="flex items-center gap-2 text-sm text-slate-700">
                        <Calendar size={16} className="text-amber-500" />
                        <span className="font-bold">Entrevista:</span>
                        {d.toLocaleString("es-MX", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    );
                  } catch { return null; }
                })()}
                {cand.edad && (
                  <div className="flex items-center gap-2 text-sm text-slate-700">
                    <User size={16} className="text-slate-400" />
                    <span className="font-bold">Edad:</span> {cand.edad}
                  </div>
                )}
                {cand.correo && (
                  <div className="flex items-center gap-2 text-sm text-slate-700">
                    <span className="font-bold text-slate-400">@</span>
                    <span className="font-bold">Correo:</span> {cand.correo}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RIGHT COL: Chat History */}
          <div className="w-full md:w-1/2 lg:w-7/12 bg-[#efeae2]/40 flex flex-col flex-1 min-h-[350px] md:min-h-0 overflow-hidden">
            <div className="px-6 py-3 border-b border-slate-200 bg-white flex justify-between items-center flex-shrink-0">
              <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                <MessageSquare size={16} className="text-emerald-600" /> Historial de Conversación (WhatsApp)
              </h3>
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-3 min-h-0 max-h-[450px] md:max-h-none" ref={chatScrollRef}>
              {(() => {
                if (loadingChat) {
                  return (
                    <div className="flex justify-center items-center h-full text-slate-400">
                      <div className="w-6 h-6 border-2 border-emerald-200 border-t-emerald-600 rounded-full animate-spin"></div>
                    </div>
                  );
                }
                if (mensajes.length === 0) {
                  return (
                    <div className="text-center text-slate-400 py-10 italic">No hay mensajes registrados.</div>
                  );
                }
                return mensajes.map((m) => {
                  const isUser = m.role === 'user';
                  const isSystem = m.role === 'system';
                  const msgKey = `${m.timestamp || ''}-${m.role}-${m.content.slice(0, 16)}`;

                  if (isSystem) {
                    return (
                      <div key={msgKey} className="flex justify-center my-3">
                        <span className="bg-white/90 text-slate-600 text-xs px-3 py-1 rounded-full border border-slate-200/80 shadow-xs font-medium">
                          {m.content}
                        </span>
                      </div>
                    );
                  }

                  return (
                    <div key={msgKey} className={`flex flex-col ${isUser ? 'items-start' : 'items-end'}`}>
                      <div className={`max-w-[85%] md:max-w-[75%] rounded-2xl px-4 py-2.5 shadow-sm text-sm ${isUser
                        ? 'bg-white text-slate-800 rounded-tl-none border border-slate-200/80'
                        : 'bg-[#d9fdd3] text-[#111b21] rounded-tr-none'
                        }`}>
                        <div className="whitespace-pre-wrap leading-relaxed break-words">{m.content}</div>
                        <div className={`text-[10px] mt-1 text-right font-medium ${isUser ? 'text-slate-400' : 'text-[#4b5e48]'}`}>
                          {m.timestamp && !Number.isNaN(new Date(m.timestamp).getTime()) ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
