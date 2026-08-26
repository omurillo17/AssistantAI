"use client";

import { Suspense, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Send, Bot, User,
  Phone, AlertTriangle,
  Search, Loader2, Check, UserPlus, X, Copy, Image as ImageIcon
} from "lucide-react";

import { useMensajes } from "@/hooks/useMensajes";
import AvatarCandidato from "@/components/AvatarCandidato";

// ─── HELPERS ─────────────────────────────────────────────
function ensureUTC(ts: string): string {
  if (!ts) return ts;
  if (/[Zz]$/.test(ts) || /[+-]\d{2}:\d{2}$/.test(ts)) return ts;
  return ts + 'Z';
}

function timeAgo(ts: string | null | undefined) {
  if (!ts) return "";
  const d = new Date(ensureUTC(ts));
  const diff = Date.now() - d.getTime();
  if (diff < 0) return "ahora";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function formatTime(ts: string) {
  return new Date(ensureUTC(ts)).toLocaleTimeString("es-MX", {
    hour: "2-digit", minute: "2-digit",
    timeZone: "America/Mexico_City",
  });
}

import {
  proxyMediaUrl,
  detectMediaUrl,
  isAudioType,
  isImageType,
  isVideoType,
  isDocumentType,
} from "@/lib/formatters";

import type { Mensaje, Conversacion } from "@/types";

// ─── COMPONENTE: Contenido multimedia ────────────────────
function MediaContent({ msg, isUser }: { msg: Mensaje; isUser: boolean }) {
  const rawMediaUrl = msg.media_url || detectMediaUrl(msg.content || "");
  const mediaUrl = proxyMediaUrl(rawMediaUrl);

  if (isAudioType(msg.message_type) || (mediaUrl && /\.(ogg|opus|mp3|m4a)$/i.test(mediaUrl))) {
    return (
      <div className="mb-1">
        <div className={`flex items-center gap-2 mb-1 text-xs ${isUser ? "text-slate-500" : "text-indigo-200"}`}>
          🎤 <span className="font-semibold">Nota de voz</span>
        </div>
        {mediaUrl ? (
          <audio controls className="w-full max-w-[260px] h-8" preload="metadata"><source src={mediaUrl} />Tu navegador no soporta audio.</audio>
        ) : (
          <div className={`text-xs italic ${isUser ? "text-slate-400" : "text-indigo-200"}`}>🎤 Audio (archivo no disponible)</div>
        )}
      </div>
    );
  }

  if (isImageType(msg.message_type) || (mediaUrl && /\.(jpg|jpeg|png|gif|webp)$/i.test(mediaUrl))) {
    return (
      <div className="mb-1">
        {mediaUrl ? (
          // next/image no aplica: la URL sale de WhatsApp en tiempo de
          // ejecución y ya viaja por nuestro proxy (/api/waha-media), que es
          // quien controla caché y acceso.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaUrl} alt="Imagen" className="rounded-xl max-w-[280px] max-h-[300px] object-cover cursor-pointer hover:opacity-90 transition-opacity" onClick={() => window.open(mediaUrl, "_blank")} loading="lazy" />
        ) : (
          <div className={`text-xs italic ${isUser ? "text-slate-400" : "text-indigo-200"}`}>🖼️ Imagen (archivo no disponible)</div>
        )}
      </div>
    );
  }

  if (isVideoType(msg.message_type) || (mediaUrl && /\.mp4$/i.test(mediaUrl))) {
    return (
      <div className="mb-1">
        {mediaUrl ? (<video controls className="rounded-xl max-w-[280px] max-h-[260px]" preload="metadata"><source src={mediaUrl} /></video>) : (
          <div className={`text-xs italic ${isUser ? "text-slate-400" : "text-indigo-200"}`}>🎬 Video (archivo no disponible)</div>
        )}
      </div>
    );
  }

  if (isDocumentType(msg.message_type) || (mediaUrl && /\.(pdf|doc|docx)$/i.test(mediaUrl))) {
    return (
      <div className="mb-1">
        <a href={mediaUrl || "#"} target="_blank" rel="noopener noreferrer" className={`max-w-[75%] rounded-lg p-2.5 text-sm shadow-sm leading-relaxed whitespace-pre-wrap ${isUser ? "bg-white text-slate-800" : "bg-[#d9fdd3] text-[#111b21]"}`}>
          📄 <span>Documento adjunto</span>
        </a>
      </div>
    );
  }

  return null;
}

// ─── COMPONENTE: Burbuja de mensaje ──────────────────────
function BurbujaMensaje({ msg }: { msg: Mensaje }) {
  const isUser = msg.role === "user" || msg.role === "user_temp";
  const hasMedia = isAudioType(msg.message_type) || isImageType(msg.message_type) || isVideoType(msg.message_type) || isDocumentType(msg.message_type) || msg.media_url || detectMediaUrl(msg.content || "");
  const isSinTexto = msg.content === "[Mensaje sin texto]";

  return (
    <div className={`flex ${isUser ? "justify-start" : "justify-end"} mb-3 group`}>
      <div className={`relative max-w-[80%] md:max-w-[70%] p-3 text-sm shadow-sm leading-relaxed whitespace-pre-wrap transition-all ${isUser ? "bg-white text-slate-800 rounded-2xl rounded-tl-sm border border-slate-100" : "bg-[#d1f4cc] text-[#111b21] rounded-2xl rounded-tr-sm"}`}>
        <MediaContent msg={msg} isUser={isUser} />
        {isSinTexto && !hasMedia ? (
          <div className="flex items-center gap-2 text-slate-500 italic text-xs bg-slate-50/80 p-2 rounded-lg border border-slate-200 mt-1">
            <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />
            Multimedia recibida (Imagen/Archivo). Revisa la app de WhatsApp para ver el contenido.
          </div>
        ) : (
          msg.content && !hasMedia && <div className="whitespace-pre-wrap break-words">{msg.content}</div>
        )}
        {msg.content && hasMedia && !detectMediaUrl(msg.content) && !isSinTexto && msg.content.trim() && <div className="whitespace-pre-wrap break-words mt-1.5">{msg.content}</div>}
        <div className={`text-[10px] mt-1.5 text-right flex items-center justify-end gap-1 opacity-70 font-medium ${isUser ? 'text-slate-500' : 'text-[#4b5e48]'}`}>
          {formatTime(msg.timestamp)}
          {!isUser && <Check size={14} className="text-[#3b82f6]" />}
        </div>
      </div>
    </div>
  );
}

// ─── COMPONENTE: Tarjeta de conversación ─────────────────
function TarjetaConversacion({ conv, isActive, onClick }: { conv: Conversacion; isActive: boolean; onClick: () => void; }) {
  return (
    <div className={`px-4 py-3 border-b border-slate-100 transition-colors cursor-pointer flex gap-4 ${isActive ? "bg-[#f0f2f5]" : "bg-white hover:bg-[#f5f6f6]"}`} onClick={onClick}>
      <div className="relative">
        <AvatarCandidato telefono={conv.telefono} nombre={conv.nombre} escalado={conv.escalado} size={48} />
        {(conv.mensajes_no_leidos ?? 0) > 0 && <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-[#25D366] rounded-full border-2 border-white" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center mb-0.5">
          <span className={`font-bold text-sm truncate ${isActive ? "text-primary" : "text-slate-800"}`}>{conv.nombre}</span>
          <span className="text-[10px] text-slate-400">{timeAgo(conv.ultimo_mensaje_at)}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs text-slate-500 truncate max-w-[75%]">
            {conv.ultimo_mensaje_rol !== "user" && conv.ultimo_mensaje_rol !== "user_temp" && <span className="text-primary font-semibold">{conv.escalado ? "Tú: " : "Bot: "}</span>}
            {conv.ultimo_mensaje || conv.escalation_reason || "Sin mensajes"}
          </span>
          <div className="flex items-center gap-2">
            {(conv.mensajes_no_leidos ?? 0) > 0 && (
              <span className="flex-shrink-0 px-1.5 min-w-[20px] h-5 bg-[#25D366] rounded-full text-white text-[10px] font-bold flex items-center justify-center">
                {conv.mensajes_no_leidos}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── PÁGINA PRINCIPAL ─────────────────────────────────────
function MensajesInner() {
  const router = useRouter();
  const imageInputRef = useRef<HTMLInputElement>(null);
  
  // La ref es de esta pantalla (es su <div> el que scrollea) y se le presta al
  // hook; así el render nunca lee una ref desde el objeto que devuelve.
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const m = useMensajes({ chatScrollRef });

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      m.enviarImagen(file);
      e.target.value = "";
    }
  };

  return (
    <div className="flex flex-col bg-white rounded-xl shadow-sm border border-slate-200 text-[#111b21] overflow-hidden" style={{ height: 'calc(100vh - 130px)' }}>
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-80 bg-white border-r border-slate-200 flex flex-col z-10">
          <div className="flex text-[11px] font-bold border-b border-slate-200">
            {/* Sólo ROOT/ADMIN: es la única pestaña que incluye las
                conversaciones asignadas a otros reclutadores. */}
            {m.puedeVerTodo && (
              <button onClick={() => m.setActiveTab("todos")} className={`flex-1 py-2.5 text-center transition-colors ${m.activeTab === "todos" ? "bg-primary text-white" : "bg-[#f0f2f5] text-slate-600 hover:bg-slate-200"}`}>
                Todos
              </button>
            )}
            <button onClick={() => m.setActiveTab("mis_chats")} className={`flex-1 py-2.5 text-center transition-colors ${m.activeTab === "mis_chats" ? "bg-primary text-white" : "bg-[#f0f2f5] text-slate-600 hover:bg-slate-200"}`}>
              Mis Chats
            </button>
            <button onClick={() => m.setActiveTab("compartida")} className={`flex-1 py-2.5 text-center transition-colors ${m.activeTab === "compartida" ? "bg-primary text-white" : "bg-[#f0f2f5] text-slate-600 hover:bg-slate-200"}`}>
              General
            </button>
            <button onClick={() => m.setActiveTab("descartados")} className={`flex-1 py-2.5 text-center transition-colors ${m.activeTab === "descartados" ? "bg-rose-600 text-white" : "bg-[#f0f2f5] text-rose-600 hover:bg-rose-100"}`}>
              Descartados
            </button>
          </div>
          <div className="px-3 py-2 bg-[#f0f2f5] border-b border-slate-200 flex flex-col gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
              <input id="mensajes-search" name="search" type="text" placeholder="Buscar candidato..." className="w-full pl-8 pr-3 py-1.5 bg-white border-none rounded-lg text-sm focus:outline-none transition-colors" value={m.search} onChange={e => m.setSearch(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <select id="mensajes-vacante-filter" name="vacante_filter" className="w-full bg-white border-none rounded-lg text-xs py-1.5 px-2 focus:outline-none text-slate-600" value={m.filterVacante} onChange={e => m.setFilterVacante(e.target.value)}>
                <option value="">Todas las vacantes</option>
                {m.uniqueVacantes.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <select id="mensajes-nave-filter" name="nave_filter" className="w-full bg-white border-none rounded-lg text-xs py-1.5 px-2 focus:outline-none text-slate-600" value={m.filterNave} onChange={e => m.setFilterNave(e.target.value)}>
                <option value="">Todas las naves</option>
                {m.uniqueNaves.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>

          <div className="px-4 py-2 flex justify-between items-center border-b border-slate-100 bg-slate-50/50">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Activas ({m.filtradas.length})</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {m.loading ? (
              <div className="p-6 text-center text-xs text-slate-400">
                <Loader2 size={18} className="animate-spin mx-auto mb-2 text-primary" />
                Cargando conversaciones...
              </div>
            ) : m.filtradas.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                <p className="font-semibold mb-1">No hay conversaciones</p>
                {m.activeTab === "mis_chats" ? (
                  <button onClick={() => m.setActiveTab(m.puedeVerTodo ? "todos" : "compartida")} className="text-primary hover:underline text-xs mt-1 block w-full font-medium">
                    {m.puedeVerTodo ? "Ver todas las conversaciones" : "Ver Bandeja General"}
                  </button>
                ) : (
                  <p className="text-[11px] text-slate-400">Las nuevas interacciones por WhatsApp aparecerán aquí.</p>
                )}
              </div>
            ) : (
              m.filtradas.map((conv, idx) => (
                <TarjetaConversacion
                  key={conv.candidato_id || `${conv.telefono}_${idx}`}
                  conv={conv}
                  isActive={conv.telefono === m.activePhone}
                  onClick={() => { m.setActivePhone(conv.telefono); m.loadChat(conv.telefono, true, false); }}
                />
              ))
            )}
          </div>
        </aside>

        {/* Chat Area */}
        <main className="flex-1 flex flex-col bg-[#efeae2] relative overflow-hidden">
          {!m.activePhone ? (
            <div className="flex-1 flex items-center justify-center text-slate-400">Selecciona una conversación</div>
          ) : (
            <>
              {!m.convActiva?.asignado_a_id && (
                <div className="bg-primary text-white px-4 py-2 flex justify-between items-center z-20 shadow-sm">
                  <div className="text-sm">Este candidato está en la <strong>Bandeja General</strong>.</div>
                  <button onClick={m.tomarChat} disabled={m.actionLoading === "tomarChat"} className="bg-white text-primary font-bold text-xs px-4 py-1.5 rounded shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-50">
                    {m.actionLoading === "tomarChat" ? "Tomando..." : "Tomar Chat"}
                  </button>
                </div>
              )}
              <div className="flex-shrink-0 bg-[#f0f2f5] px-4 py-2 border-b border-slate-200 flex justify-between items-center shadow-sm relative z-10">
                <div className="flex items-center gap-3">
                  <AvatarCandidato
                    telefono={m.candidatoActivo?.telefono || m.convActiva?.telefono || m.activePhone}
                    nombre={m.candidatoActivo?.nombre || m.convActiva?.nombre}
                    escalado={m.candidatoActivo?.escalado}
                    size={40}
                  />
                  <div className="relative">
                    <button onClick={() => m.setShowPhoneModal(!m.showPhoneModal)} className="font-bold text-[#111b21] hover:underline text-left cursor-pointer focus:outline-none">
                      {m.candidatoActivo?.nombre || m.convActiva?.nombre || m.activePhone}
                    </button>
                    {m.showPhoneModal && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => m.setShowPhoneModal(false)} />
                        <div className="absolute top-full left-0 mt-2 bg-white rounded-lg shadow-xl border border-slate-100 p-4 z-50 min-w-[200px]">
                          <div className="flex justify-between items-center mb-3">
                            <span className="text-xs font-bold text-slate-500 uppercase">Información</span>
                            <button onClick={() => m.setShowPhoneModal(false)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
                          </div>
                          <div className="flex items-center justify-between gap-3 text-slate-700 bg-slate-50 p-2.5 rounded-md border border-slate-100 group">
                            <div className="flex items-center gap-2">
                              <Phone size={16} className="text-[#00a884]" />
                              <span className="font-mono text-sm font-semibold">+{m.activePhone}</span>
                            </div>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(m.activePhone || "");
                                m.setToast({ msg: "Teléfono copiado", isError: false });
                                setTimeout(() => m.setToast(null), 3000);
                                m.setShowPhoneModal(false);
                              }}
                              className="text-slate-400 hover:text-primary transition-colors focus:outline-none" title="Copiar teléfono"
                            >
                              <Copy size={16} />
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {m.candidatoActivo?.escalado ? (
                    <span className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 bg-danger/10 text-danger rounded-lg"><User size={12} /> Humano</span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 bg-slate-200 text-slate-600 rounded-lg"><Bot size={12} /> Bot</span>
                  )}

                  <button onClick={() => router.push(`/expedientes?tel=${m.activePhone}`)} className="px-3 py-1.5 hover:bg-black/5 text-slate-600 rounded-lg text-sm font-semibold transition-colors">Ver Perfil</button>

                  <button onClick={m.transferir} disabled={!!m.actionLoading} className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-70 text-white rounded-lg transition-colors shadow-sm">
                    {m.actionLoading === "transferir" ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />} Transferir
                  </button>

                  {m.candidatoActivo?.escalado && !m.estaAtendidoPorOtro && (
                    <button onClick={m.devolverAlBot} disabled={!!m.actionLoading} className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 bg-[#00a884] hover:bg-[#008f6f] disabled:opacity-70 text-white rounded-lg transition-colors shadow-sm">
                      {m.actionLoading === "devolverAlBot" ? <Loader2 size={12} className="animate-spin" /> : <Bot size={12} />} Devolver al Bot
                    </button>
                  )}

                  {!m.candidatoActivo?.escalado && (
                    <button
                      onClick={() => {
                        if (m.estaAtendidoPorOtro) {
                          alert(`Este chat está siendo atendido por: ${m.convActiva?.asignado_a_nombre}`);
                        } else {
                          m.tomarControl();
                        }
                      }}
                      disabled={!!m.actionLoading}
                      className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 bg-danger hover:bg-danger/90 disabled:opacity-70 text-white rounded-lg transition-colors shadow-sm"
                    >
                      {m.actionLoading === "tomarControl" ? <Loader2 size={12} className="animate-spin" /> : <User size={12} />} Tomar Control
                    </button>
                  )}
                </div>
              </div>
              <div ref={chatScrollRef} onScroll={m.handleScroll} className="flex-1 overflow-y-auto px-[5%] md:px-[10%] py-6" style={{ backgroundImage: `url('https://static.whatsapp.net/rsrc.php/v3/yl/r/r_QZ352iVXR.png')`, backgroundRepeat: 'repeat', backgroundSize: '400px' }}>
                {m.loadingChat ? <div className="flex justify-center mt-10"><div className="flex items-center gap-2 text-sm text-slate-600 bg-white/90 shadow-sm px-4 py-2 rounded-full font-medium"><Loader2 size={16} className="animate-spin text-primary" /> Cargando mensajes...</div></div> : m.mensajes.map((msg) => <BurbujaMensaje key={msg.id} msg={msg} />)}
              </div>
              <div className="flex-shrink-0 bg-[#f0f2f5] px-4 py-3 relative z-10 border-t border-slate-200">
                {!m.candidatoActivo?.escalado && !m.estaAtendidoPorOtro && (
                  <div className="mb-2 flex items-center justify-center gap-2 text-xs text-[#54656f] bg-white rounded-lg shadow-sm px-4 py-2 font-medium">
                    <Bot size={14} /><span>El bot está activo. Haz clic en &quot;Tomar Control&quot; para responder manualmente.</span>
                  </div>
                )}
                {m.estaAtendidoPorOtro && (
                  <div className="mb-2 flex items-center justify-center gap-2 text-xs text-danger bg-danger/10 rounded-lg shadow-sm px-4 py-2 font-medium">
                    <AlertTriangle size={14} /><span>Este chat está siendo atendido por {m.convActiva?.asignado_a_nombre}.</span>
                  </div>
                )}
                {m.supervisandoChatDeOtro && (
                  <div className="mb-2 flex items-center justify-center gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg shadow-sm px-4 py-2 font-medium">
                    <AlertTriangle size={14} /><span>Este chat lo atiende {m.convActiva?.asignado_a_nombre}. Puedes intervenir como supervisor.</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    ref={imageInputRef}
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageChange}
                  />
                  <button
                    onClick={() => imageInputRef.current?.click()}
                    disabled={!m.candidatoActivo?.escalado || m.estaAtendidoPorOtro || m.sending}
                    title="Enviar imagen (agradecimiento, aviso, etc.)"
                    className="w-10 h-10 bg-transparent text-[#54656f] hover:text-[#00a884] disabled:opacity-40 rounded-full flex items-center justify-center transition-colors shrink-0"
                  >
                    <ImageIcon size={22} />
                  </button>
                  <textarea id="mensajes-chat-input" name="chat_message" value={m.texto} onChange={e => m.setTexto(e.target.value)} onKeyDown={m.handleKeyDown} disabled={(!m.candidatoActivo?.escalado || m.estaAtendidoPorOtro) || m.sending} className="flex-1 p-2.5 bg-white border-none rounded-lg text-sm focus:outline-none transition-colors disabled:opacity-50 resize-none max-h-32" rows={1} placeholder={!m.candidatoActivo?.escalado ? "Toma el control para escribir" : m.estaAtendidoPorOtro ? `Atendido por ${m.convActiva?.asignado_a_nombre}` : "Escribe un mensaje"} />
                  <button onClick={m.enviarMensaje} disabled={m.sending || !m.texto.trim() || (!m.candidatoActivo?.escalado || m.estaAtendidoPorOtro)} className="w-10 h-10 bg-transparent text-[#54656f] hover:text-[#00a884] disabled:opacity-50 rounded-full flex items-center justify-center transition-colors shrink-0">
                    {m.sending ? <Loader2 size={24} className="animate-spin" /> : <Send size={24} />}
                  </button>
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      {/* Toast */}
      <div className={`fixed bottom-6 right-6 px-5 py-3 rounded font-bold text-white shadow-xl transition-all duration-300 z-[2000] ${m.toast ? "translate-y-0 opacity-100" : "translate-y-16 opacity-0"} ${m.toast?.isError ? "bg-danger" : "bg-success"}`}>
        {m.toast?.msg}
      </div>

      {/* Transfer Modal */}
      {m.showTransferModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-[3000]">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100">
              <h3 className="font-bold text-slate-800 flex items-center gap-2"><UserPlus size={18} className="text-primary" /> Transferir Conversación</h3>
              <button onClick={() => m.setShowTransferModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors"><X size={20} /></button>
            </div>
            <div className="p-6">
              <p className="text-sm text-slate-600 mb-4">Selecciona al reclutador al que deseas transferir este candidato. Se le notificará automáticamente por WhatsApp.</p>
              <select id="mensajes-transfer-target" name="transfer_target" className="w-full border border-slate-200 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" value={m.selectedReclutador} onChange={e => m.setSelectedReclutador(e.target.value)}>
                {m.reclutadores.map((grupo, idx) => (
                  <optgroup key={idx} label={grupo.grupo_nombre ? `${grupo.grupo_nombre} (${grupo.empresa_nombre || 'Local'})` : 'Reclutadores'}>
                    {grupo.reclutadores?.map((rec) => (
                      <option key={rec.id} value={rec.id}>{rec.nombre} ({rec.rol})</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end gap-3 border-t border-slate-100">
              <button onClick={() => m.setShowTransferModal(false)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 bg-slate-100 rounded-lg transition-colors">Cancelar</button>
              <button onClick={m.confirmTransferir} disabled={m.actionLoading === "transferir"} className="px-4 py-2 text-sm font-bold text-white bg-primary hover:bg-primary/90 disabled:opacity-70 rounded-lg shadow-sm transition-colors flex items-center gap-2">
                {m.actionLoading === "transferir" ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Confirmar Transferencia
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── EXPORT CON SUSPENSE (requerido por useSearchParams) ───
export default function MensajesPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen text-slate-500">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <MensajesInner />
    </Suspense>
  );
}
