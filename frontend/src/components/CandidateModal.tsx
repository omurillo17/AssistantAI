"use client";

import { useState, useEffect, useRef } from "react";
import { Candidato, ChatMessage } from "@/types";
import { getEstado, ESTADOS_CRM, ESTADOS, EstadoKey } from "@/lib/estados";
import { getCandidateDisplayName } from "@/lib/formatters";
import { X, ExternalLink, Calendar, Briefcase, FileText, CheckCircle, AlertCircle, Bot, User, MessageSquare } from "lucide-react";

interface CandidateModalProps {
  candidato: Candidato;
  onClose: () => void;
  onStatusChange: (telefono: string, newStatus: string) => void;
  onGoToChat: (telefono: string) => void;
}

export function CandidateModal({ candidato, onClose, onStatusChange, onGoToChat }: CandidateModalProps) {
  const [mensajes, setMensajes] = useState<ChatMessage[]>([]);
  const [loadingChat, setLoadingChat] = useState(true);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const nombre = getCandidateDisplayName(candidato);

  // Fetch chat history
  useEffect(() => {
    async function loadChat() {
      if (!candidato.telefono) return;
      setLoadingChat(true);
      try {
        const storedEmpresaId = localStorage.getItem("tci_empresa_id");
        const storedNaveId = localStorage.getItem("tci_nave_id");
        let query = "";
        if (storedEmpresaId) query += `?empresa_id=${storedEmpresaId}`;
        if (storedNaveId) query += (query ? `&` : `?`) + `nave_id=${storedNaveId}`;
        
        const res = await fetch(`/api/db/mensajes/${candidato.telefono}${query}`);
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
  }, [candidato.telefono]);

  // Scroll to bottom of chat
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [mensajes]);

  const hasCV = candidato.tiene_cv || !!candidato.cv_manual || !!candidato.link_cv;
  const cvLink = candidato.link_cv || (candidato.cv_manual as any)?.url;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1000] p-4 lg:p-6" onClick={onClose}>
      <div 
        className="bg-white rounded-2xl w-full max-w-6xl max-h-[90vh] shadow-2xl flex flex-col overflow-hidden animate-fade-in" 
        onClick={e => e.stopPropagation()}
      >
        {/* HEADER */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50 flex-shrink-0">
          <div>
            <h2 className="text-2xl font-extrabold text-slate-800">{nombre}</h2>
            <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
              <span className="font-mono bg-slate-200 px-2 py-0.5 rounded text-slate-700">{candidato.telefono}</span>
              {candidato.vacante_interes && (
                <span className="flex items-center gap-1 font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                  <Briefcase size={14} /> {candidato.vacante_interes}
                </span>
              )}
              {candidato.nave_interes && (
                <span className="flex items-center gap-1 font-semibold text-slate-600 bg-slate-200 px-2 py-0.5 rounded">
                  {candidato.nave_interes}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => onGoToChat(candidato.telefono)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 font-bold rounded-lg transition-colors shadow-sm"
            >
              <MessageSquare size={16} /> Ir a Mensajes
            </button>
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full transition-colors">
              <X size={24} />
            </button>
          </div>
        </div>

        {/* BODY (Split Layout) */}
        <div className="flex flex-1 overflow-hidden flex-col md:flex-row min-h-0">
          
          {/* LEFT COL: Profile Info */}
          <div className="w-full md:w-1/2 lg:w-5/12 border-r border-slate-100 overflow-y-auto p-6 space-y-6 bg-white">
            
            {/* ESTADO CHANGER */}
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Estado del Proceso</label>
              <select
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer shadow-sm transition-colors"
                value={candidato.estado}
                onChange={(e) => onStatusChange(candidato.telefono, e.target.value)}
              >
                {ESTADOS_CRM.map(k => (
                  <option key={k} value={k}>{ESTADOS[k as EstadoKey].emoji} {ESTADOS[k as EstadoKey].label}</option>
                ))}
              </select>
            </div>

            {/* IA SUMMARY */}
            {(() => {
              const parseResumenIa = (text?: string | null) => {
                if (!text) return { items: [], notes: "" };
                if (text.includes(":") && (text.includes(".") || text.includes("\n"))) {
                  const rawParts = text.split(/(?=[A-Z][a-zA-ZÁÉÍÓÚáéíóúñÑ_0-9\s]+:)/g);
                  const items: { label: string; value: string }[] = [];
                  let notes = "";
                  for (const part of rawParts) {
                    const match = part.trim().match(/^([a-zA-ZÁÉÍÓÚáéíóúñÑ_0-9\s]+):\s*(.*)$/);
                    if (match) {
                      const key = match[1].trim();
                      const val = match[2].replace(/\.$/, "").trim();
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
                return { items: [], notes: text };
              };

              const { items, notes } = parseResumenIa(candidato.resumen_ia);
              const experienciaTexto = candidato.experiencia || candidato.motivo_analisis || notes || ((candidato.cv_manual as any)?.experiencia || (candidato.cv_manual as any)?.resumen_excel);

              return (
                <div className="bg-gradient-to-br from-purple-50/70 to-indigo-50/50 border border-purple-100 rounded-2xl p-5 shadow-sm space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-purple-900 flex items-center gap-2">
                      <Bot size={18} className="text-purple-600" /> Resumen de IA Sofía
                    </h3>
                    {candidato.veredicto && (
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                        candidato.veredicto === 'VIABLE' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' :
                        candidato.veredicto === 'REUBICACION' ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                        candidato.veredicto === 'CARTERA_GENERAL' ? 'bg-slate-200 text-slate-800 border border-slate-300' :
                        'bg-rose-100 text-rose-800 border border-rose-200'
                      }`}>
                        {candidato.veredicto === 'VIABLE' ? <CheckCircle size={14}/> : <AlertCircle size={14}/>}
                        {candidato.veredicto}
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
                          const valLower = it.value.toLowerCase();
                          const isOk = valLower.includes('aceptad') || valLower.includes('verificad') || valLower.includes('recibid') || valLower.includes('agendad') || valLower.includes('sí') || valLower.includes('si');
                          
                          const formatValue = (v: string) => {
                            if (!v) return v;
                            const isoMatch = v.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/);
                            if (isoMatch) {
                              try {
                                const d = new Date(isoMatch[0]);
                                if (!isNaN(d.getTime())) {
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
                              } catch(e) {}
                            }
                            return v;
                          };

                          return (
                            <div key={idx} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                              isOk 
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

                  {/* RESUMEN DE CV / SOLICITUD */}
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 flex items-center gap-1">
                      <FileText size={13} /> Resumen de Perfil / Experiencia
                    </div>
                    <div className="text-sm text-slate-700 leading-relaxed bg-white/70 p-3.5 rounded-xl border border-purple-100/60 whitespace-pre-wrap font-sans">
                      {experienciaTexto || <span className="text-slate-400 italic">No hay detalles de experiencia o resumen de CV registrados.</span>}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* DOCUMENTOS */}
            <div>
              <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-3">
                <FileText size={16} /> Documentos y Expediente
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* CV Card */}
                <div className={`p-4 rounded-xl border ${hasCV ? 'bg-cyan-50 border-cyan-100' : 'bg-slate-50 border-slate-100'} flex flex-col items-start gap-2`}>
                  <div className={`text-xs font-bold ${hasCV ? 'text-cyan-800' : 'text-slate-500'}`}>Currículum Vitae</div>
                  {cvLink ? (
                    <a href={cvLink} target="_blank" rel="noreferrer" className="text-sm font-semibold text-cyan-600 hover:text-cyan-700 flex items-center gap-1">
                      Ver Archivo <ExternalLink size={14}/>
                    </a>
                  ) : hasCV ? (
                    <span className="text-sm font-semibold text-cyan-600">Recibido (Sin enlace)</span>
                  ) : (
                    <span className="text-sm text-slate-400">No proporcionado</span>
                  )}
                </div>
                
                {/* INE Card */}
                {(() => {
                  const ine = typeof candidato.datos_ine === 'string' ? (() => { try { return JSON.parse(candidato.datos_ine); } catch(e) { return null; } })() : candidato.datos_ine;
                  const ineUrl = ine?.url || ine?.link || (candidato as any).link_ine;
                  return (
                    <div className={`p-4 rounded-xl border ${ine ? 'bg-violet-50 border-violet-100' : 'bg-slate-50 border-slate-100'} flex flex-col items-start gap-2`}>
                      <div className={`text-xs font-bold ${ine ? 'text-violet-800' : 'text-slate-500'}`}>Datos de INE</div>
                      {ine ? (
                        <div className="text-xs text-violet-700 space-y-1 w-full">
                          <div><span className="font-semibold">Clave:</span> {ine.clave_elector || ine.cve_elector || '—'}</div>
                          <div><span className="font-semibold">CURP:</span> {ine.curp || '—'}</div>
                          <div><span className="font-semibold">Nacimiento:</span> {ine.fecha_nacimiento || '—'}</div>
                          {ineUrl && (
                            <a href={ineUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded text-xs transition-colors shadow-sm">
                              Ver INE <ExternalLink size={12}/>
                            </a>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-slate-400">No validado</span>
                      )}
                    </div>
                  );
                })()}

                {/* CSF / RFC Card */}
                {(() => {
                  const csf = typeof candidato.datos_rfc === 'string' ? (() => { try { return JSON.parse(candidato.datos_rfc); } catch(e) { return null; } })() : candidato.datos_rfc;
                  const csfUrl = csf?.url || csf?.link || (candidato as any).link_csf || (candidato as any).link_rfc;
                  return (
                    <div className={`p-4 rounded-xl border ${csf ? 'bg-emerald-50 border-emerald-100' : 'bg-slate-50 border-slate-100'} flex flex-col items-start gap-2 col-span-1 sm:col-span-2`}>
                      <div className={`text-xs font-bold ${csf ? 'text-emerald-800' : 'text-slate-500'}`}>Datos CSF (RFC)</div>
                      {csf ? (
                        <div className="text-xs text-emerald-700 space-y-1 w-full">
                          <div className="grid grid-cols-2 gap-2">
                            <div><span className="font-semibold">RFC:</span> {csf.rfc || '—'}</div>
                            <div><span className="font-semibold">CURP:</span> {csf.curp || '—'}</div>
                          </div>
                          {csfUrl && (
                            <a href={csfUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded text-xs transition-colors shadow-sm">
                              Ver CSF <ExternalLink size={12}/>
                            </a>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-slate-400">No validado</span>
                      )}
                    </div>
                  );
                })()}
              </div>

              {candidato.alerta_identidad_estado && (
                <div className={`mt-3 p-3 rounded-xl border text-xs flex items-start gap-2 ${
                  candidato.alerta_identidad_estado === 'PENDIENTE'
                    ? 'bg-red-50 border-red-200 text-red-600'
                    : candidato.alerta_identidad_estado === 'RECHAZADO'
                      ? 'bg-amber-50 border-amber-200 text-amber-700'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                }`}>
                  <span className="font-bold shrink-0">
                    {candidato.alerta_identidad_estado === 'PENDIENTE' && '⚠️ Pendiente de validar:'}
                    {candidato.alerta_identidad_estado === 'RECHAZADO' && '🚫 No validado:'}
                    {candidato.alerta_identidad_estado === 'VALIDADO' && '✅ Validado por reclutador:'}
                  </span>
                  <span>{candidato.alerta_identidad_motivo || 'Discrepancia de CURP entre INE y RFC.'}</span>
                </div>
              )}
            </div>

            {/* INFO EXTRA */}
            {(candidato.edad || candidato.correo || candidato.fecha_entrevista) && (
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-5 shadow-sm space-y-3">
                {candidato.fecha_entrevista && (
                  <div className="flex items-center gap-2 text-sm text-slate-700">
                    <Calendar size={16} className="text-amber-500" />
                    <span className="font-bold">Entrevista:</span> 
                    {new Date(candidato.fecha_entrevista).toLocaleString("es-MX", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </div>
                )}
                {candidato.edad && (
                  <div className="flex items-center gap-2 text-sm text-slate-700">
                    <User size={16} className="text-slate-400" />
                    <span className="font-bold">Edad:</span> {candidato.edad}
                  </div>
                )}
                {candidato.correo && (
                  <div className="flex items-center gap-2 text-sm text-slate-700">
                    <span className="font-bold text-slate-400">@</span>
                    <span className="font-bold">Correo:</span> {candidato.correo}
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
              {loadingChat ? (
                <div className="flex justify-center items-center h-full text-slate-400">
                  <div className="w-6 h-6 border-2 border-emerald-200 border-t-emerald-600 rounded-full animate-spin"></div>
                </div>
              ) : mensajes.length === 0 ? (
                <div className="text-center text-slate-400 py-10 italic">No hay mensajes registrados.</div>
              ) : (
                mensajes.map((m, i) => {
                  const isUser = m.role === 'user';
                  const isSystem = m.role === 'system';
                  
                  if (isSystem) {
                    return (
                      <div key={i} className="flex justify-center my-3">
                        <span className="bg-white/90 text-slate-600 text-xs px-3 py-1 rounded-full border border-slate-200/80 shadow-xs font-medium">
                          {m.content}
                        </span>
                      </div>
                    );
                  }

                  return (
                    <div key={i} className={`flex flex-col ${isUser ? 'items-start' : 'items-end'}`}>
                      <div className={`max-w-[85%] md:max-w-[75%] rounded-2xl px-4 py-2.5 shadow-sm text-sm ${
                        isUser 
                          ? 'bg-white text-slate-800 rounded-tl-none border border-slate-200/80' 
                          : 'bg-[#d9fdd3] text-[#111b21] rounded-tr-none'
                      }`}>
                        <div className="whitespace-pre-wrap leading-relaxed break-words">{m.content}</div>
                        <div className={`text-[10px] mt-1 text-right font-medium ${isUser ? 'text-slate-400' : 'text-[#4b5e48]'}`}>
                          {m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
