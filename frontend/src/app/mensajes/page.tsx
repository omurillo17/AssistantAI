"use client";

import { useEffect, useState, useRef, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  MessageSquare, Send, Bot, User, RefreshCw,
  Phone, Briefcase, ChevronLeft, Circle, AlertTriangle,
  UserCheck, Search, Loader2, Check,
} from "lucide-react";

// ─── TIPOS ───────────────────────────────────────────────
type Conversacion = {
  telefono: string;
  nombre: string;
  estado: string;
  escalado: boolean;
  escalation_reason: string | null;
  vacante_interes: string | null;
  nave_interes: string | null;
  asignado_a: string | null;
  mensajes_no_leidos: number;
  ultimo_mensaje: string | null;
  ultimo_mensaje_rol: string;
  ultimo_mensaje_at: string | null;
  bandeja_activa: boolean;
};

type Mensaje = {
  id: number;
  role: "user" | "assistant" | "system" | "user_temp";
  content: string;
  message_type: string | null;
  media_url: string | null;
  timestamp: string;
};

type Candidato = {
  telefono: string;
  nombre: string;
  estado: string;
  escalado: boolean;
  escalation_reason: string | null;
  vacante_interes: string | null;
  nave_interes: string | null;
  correo: string | null;
};

// ─── HELPER ──────────────────────────────────────────────
function toMX(ts: string) {
  return new Date(ts);
}

function timeAgo(ts: string | null) {
  if (!ts) return "";
  const d = new Date(ts);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function formatTime(ts: string) {
  return toMX(ts).toLocaleTimeString("es-MX", {
    hour: "2-digit", minute: "2-digit",
    timeZone: "America/Mexico_City",
  });
}

// Detecta si el contenido es una URL de media de WAHA
function detectMediaUrl(content: string): string | null {
  if (!content) return null;
  const match = content.match(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|mp4|ogg|opus|mp3|m4a|pdf|doc|docx)/i);
  return match ? match[0] : null;
}

function isAudioType(mt: string | null): boolean {
  return !!mt && ["audio", "ptt", "voice"].includes(mt.toLowerCase());
}

function isImageType(mt: string | null): boolean {
  return !!mt && ["image", "sticker"].includes(mt.toLowerCase());
}

function isVideoType(mt: string | null): boolean {
  return mt === "video";
}

function isDocumentType(mt: string | null): boolean {
  return !!mt && ["document", "file"].includes(mt.toLowerCase());
}

// ─── COMPONENTE: Contenido multimedia ────────────────────
function MediaContent({ msg, isUser }: { msg: Mensaje; isUser: boolean }) {
  const mediaUrl = msg.media_url || detectMediaUrl(msg.content || "");
  const mt = msg.message_type?.toLowerCase() || "";

  // Audio / PTT (nota de voz)
  if (isAudioType(msg.message_type) || (mediaUrl && /\.(ogg|opus|mp3|m4a)$/i.test(mediaUrl))) {
    return (
      <div className="mb-1">
        <div className={`flex items-center gap-2 mb-1 text-xs ${isUser ? "text-slate-500" : "text-indigo-200"}`}>
          🎤 <span className="font-semibold">Nota de voz</span>
        </div>
        {mediaUrl ? (
          <audio controls className="w-full max-w-[260px] h-8" preload="metadata">
            <source src={mediaUrl} />
            Tu navegador no soporta audio.
          </audio>
        ) : (
          <div className={`text-xs italic ${isUser ? "text-slate-400" : "text-indigo-200"}`}>🎤 Audio (archivo no disponible)</div>
        )}
      </div>
    );
  }

  // Imagen / Sticker
  if (isImageType(msg.message_type) || (mediaUrl && /\.(jpg|jpeg|png|gif|webp)$/i.test(mediaUrl))) {
    return (
      <div className="mb-1">
        {mediaUrl ? (
          <img
            src={mediaUrl}
            alt="Imagen"
            className="rounded-xl max-w-[280px] max-h-[300px] object-cover cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => window.open(mediaUrl, "_blank")}
            loading="lazy"
          />
        ) : (
          <div className={`text-xs italic ${isUser ? "text-slate-400" : "text-indigo-200"}`}>🖼️ Imagen (archivo no disponible)</div>
        )}
      </div>
    );
  }

  // Video
  if (isVideoType(msg.message_type) || (mediaUrl && /\.mp4$/i.test(mediaUrl))) {
    return (
      <div className="mb-1">
        {mediaUrl ? (
          <video controls className="rounded-xl max-w-[280px] max-h-[260px]" preload="metadata">
            <source src={mediaUrl} />
          </video>
        ) : (
          <div className={`text-xs italic ${isUser ? "text-slate-400" : "text-indigo-200"}`}>🎬 Video (archivo no disponible)</div>
        )}
      </div>
    );
  }

  // Documento
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

  return (
    <div className={`flex ${isUser ? "justify-start" : "justify-end"} mb-1.5`}>
      <div className={`max-w-[75%] p-2 text-sm shadow-sm leading-relaxed whitespace-pre-wrap ${isUser ? "bg-white text-[#111b21] rounded-lg rounded-tl-none" : "bg-[#d9fdd3] text-[#111b21] rounded-lg rounded-tr-none"}`}>
        <MediaContent msg={msg} isUser={isUser} />
        {msg.content && !hasMedia && <div className="whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: msg.content.replace(/\n/g, "<br>") }} />}
        {msg.content && hasMedia && !detectMediaUrl(msg.content) && msg.content.trim() && <div className="whitespace-pre-wrap break-words mt-1" dangerouslySetInnerHTML={{ __html: msg.content.replace(/\n/g, "<br>") }} />}
        <div className={`text-[10px] mt-0.5 text-right text-slate-500 flex items-center justify-end gap-1`}>
          {formatTime(msg.timestamp)}
          {!isUser && <Check size={12} className="text-blue-500" />}
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
        <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold shadow-sm ${conv.escalado ? "bg-danger/10 text-danger" : "bg-slate-200 text-slate-600"}`}>
          {(conv.nombre || conv.telefono)?.[0]?.toUpperCase() || "?"}
        </div>
        {conv.mensajes_no_leidos > 0 && <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-danger rounded-full border-2 border-white" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center mb-0.5">
          <span className={`font-bold text-sm truncate ${isActive ? "text-primary" : "text-slate-800"}`}>{conv.nombre}</span>
          <span className="text-[10px] text-slate-400">{timeAgo(conv.ultimo_mensaje_at)}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs text-slate-500 truncate max-w-[75%]">
            {conv.ultimo_mensaje_rol !== "user" && <span className="text-primary font-semibold">Tú: </span>}
            {conv.ultimo_mensaje || conv.escalation_reason || "Sin mensajes"}
          </span>
          {conv.mensajes_no_leidos > 0 && (
            <span className="flex-shrink-0 ml-1 px-1.5 min-w-[20px] h-5 bg-success rounded-full text-white text-[10px] font-bold flex items-center justify-center">
              {conv.mensajes_no_leidos}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── PÁGINA PRINCIPAL ─────────────────────────────────────
function MensajesInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePhone, setActivePhone] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [candidatoActivo, setCandidatoActivo] = useState<Candidato | null>(null);
  const [loadingChat, setLoadingChat] = useState(false);
  const [sending, setSending] = useState(false);
  const [texto, setTexto] = useState("");
  const [nombre, setNombre] = useState("");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const n = localStorage.getItem("tci_nombre") || "Reclutador";
    setNombre(n);
    if (!localStorage.getItem("tci_authenticated")) { router.push("/login"); return; }
    loadConversaciones();
    const tel = searchParams.get("tel");
    if (tel) setActivePhone(tel);
  }, []);

  useEffect(() => { 
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [mensajes]);

  useEffect(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (!activePhone) return;
    pollingRef.current = setInterval(() => { loadChat(activePhone, false); loadConversaciones(false); }, 4000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [activePhone]);

  const showToast = (msg: string, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3000);
  };

  const loadConversaciones = useCallback(async (showLoad = true) => {
    if (showLoad) setLoading(true);
    try {
      const res = await fetch("/api/db/mensajes");
      const data = await res.json();
      setConversaciones(Array.isArray(data) ? data : []);
    } catch { showToast("Error al cargar", true); } finally { setLoading(false); }
  }, []);

  const loadChat = useCallback(async (tel: string, showLoad = true) => {
    if (showLoad) { setLoadingChat(true); setMensajes([]); setCandidatoActivo(null); }
    try {
      const res = await fetch(`/api/db/mensajes/${tel}`);
      const data = await res.json();
      setCandidatoActivo(data.candidato);
      setMensajes(data.mensajes || []);
    } catch { showToast("Error al cargar historial", true); } finally { setLoadingChat(false); }
  }, []);

  const enviarMensaje = async () => {
    if (!texto.trim() || !activePhone || sending) return;
    const msgText = texto;
    setTexto("");
    setSending(true);
    try {
      await fetch(`/api/db/mensajes/${activePhone}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto: msgText, asignado_a: nombre }) });
      await loadChat(activePhone, false);
    } catch { showToast("Error al enviar", true); } finally { setSending(false); }
  };

  const tomarControl = async () => {
    if (!activePhone) return;
    try {
      const res = await fetch("/api/db/candidato", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telefono: activePhone,
          escalado: true,
          estado: "ESCALADO",
          escalation_reason: `Atendido manualmente por ${nombre}`,
        }),
      });
      if (!res.ok) throw new Error();
      setCandidatoActivo(prev => prev ? { ...prev, escalado: true, estado: "ESCALADO" } : prev);
      setConversaciones(prev =>
        prev.map(c => c.telefono === activePhone ? { ...c, escalado: true, asignado_a: nombre } : c)
      );
      await fetch("/api/db/mensajes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono: activePhone, asignado_a: nombre }),
      });
      showToast(`✅ Tomaste el control de la conversación`);
    } catch {
      showToast("Error al tomar control", true);
    }
  };

  const devolverAlBot = async () => {
    if (!activePhone) return;
    try {
      const res = await fetch("/api/db/candidato", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telefono: activePhone,
          escalado: false,
          escalation_reason: null,
        }),
      });
      if (!res.ok) throw new Error();
      await fetch("/api/db/mensajes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono: activePhone, asignado_a: null }),
      });
      setCandidatoActivo(prev => prev ? { ...prev, escalado: false } : prev);
      setConversaciones(prev =>
        prev.map(c => c.telefono === activePhone ? { ...c, escalado: false, asignado_a: null } : c)
      );
      showToast("🤖 Bot reactivado para este candidato");
    } catch {
      showToast("Error al devolver al bot", true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      enviarMensaje();
    }
  };

  const filtradas = conversaciones.filter(c => c.nombre.toLowerCase().includes(search.toLowerCase()) || c.telefono.includes(search));
  const convActiva = conversaciones.find(c => c.telefono === activePhone);

  return (
    <div className="flex flex-col bg-white rounded-xl shadow-sm border border-slate-200 text-[#111b21] overflow-hidden" style={{ height: 'calc(100vh - 130px)' }}>
      {/* PAGE HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-2 px-6 pt-4 pb-2 border-b border-slate-200">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 font-semibold rounded shadow-sm transition-colors text-sm border border-slate-200"
          >
            ⬅ Atrás
          </button>
          <h1 className="text-2xl font-bold text-slate-800">
            Bandeja de Mensajes
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-white shadow-sm border border-slate-200 px-3 py-1.5 rounded">
            <Circle size={7} className="fill-success text-success" />
            <span className="font-semibold">{nombre}</span>
          </div>
          <button
            onClick={() => loadConversaciones(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-white font-bold rounded text-xs transition-colors shadow-sm"
          >
            <RefreshCw size={13} /> Actualizar
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-80 bg-white border-r border-slate-200 flex flex-col z-10">
          <div className="px-3 py-2 bg-[#f0f2f5] border-b border-slate-200">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar candidato..."
                className="w-full pl-8 pr-3 py-1.5 bg-white border-none rounded-lg text-sm focus:outline-none transition-colors"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
          
          <div className="px-4 py-2 flex justify-between items-center border-b border-slate-100 bg-slate-50/50">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Activas ({filtradas.length})
            </span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filtradas.map(conv => (
              <TarjetaConversacion 
                key={conv.telefono} 
                conv={conv} 
                isActive={conv.telefono === activePhone} 
                onClick={() => { setActivePhone(conv.telefono); loadChat(conv.telefono); }} 
              />
            ))}
          </div>
        </aside>

        <main className="flex-1 flex flex-col bg-[#efeae2] relative overflow-hidden">
          {!activePhone ? (
            <div className="flex-1 flex items-center justify-center text-slate-400">Selecciona una conversación</div>
          ) : (
            <>
              <div className="flex-shrink-0 bg-[#f0f2f5] px-4 py-2 border-b border-slate-200 flex justify-between items-center shadow-sm relative z-10">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold shadow-sm flex-shrink-0 ${candidatoActivo?.escalado ? "bg-danger/10 text-danger" : "bg-slate-200 text-slate-600"}`}>
                    {candidatoActivo?.nombre?.[0]?.toUpperCase() || "?"}
                  </div>
                  <div>
                    <div className="font-bold text-[#111b21]">{candidatoActivo?.nombre || convActiva?.nombre || activePhone}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {candidatoActivo?.escalado ? (
                    <span className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 bg-danger/10 text-danger rounded-lg">
                      <User size={12} /> Humano
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 bg-slate-200 text-slate-600 rounded-lg">
                      <Bot size={12} /> Bot
                    </span>
                  )}
                  
                  <button onClick={() => router.push(`/crm`)} className="px-3 py-1.5 hover:bg-black/5 text-slate-600 rounded-lg text-sm font-semibold transition-colors">Ver CRM</button>
                  
                  {candidatoActivo?.escalado ? (
                    <button
                      onClick={devolverAlBot}
                      className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 bg-[#00a884] hover:bg-[#008f6f] text-white rounded-lg transition-colors shadow-sm"
                    >
                      <Bot size={12} /> Devolver al Bot
                    </button>
                  ) : (
                    <button
                      onClick={tomarControl}
                      className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 bg-danger hover:bg-danger/90 text-white rounded-lg transition-colors shadow-sm"
                    >
                      <User size={12} /> Tomar Control
                    </button>
                  )}
                </div>
              </div>
              <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-[10%] py-4" style={{ backgroundImage: `url('https://static.whatsapp.net/rsrc.php/v3/yl/r/r_QZ352iVXR.png')`, backgroundRepeat: 'repeat' }}>
                {loadingChat ? <div className="text-center text-slate-500 bg-white/80 p-2 rounded-lg max-w-[150px] mx-auto">Cargando...</div> : mensajes.map(msg => <BurbujaMensaje key={msg.id} msg={msg} />)}
              </div>
              <div className="flex-shrink-0 bg-[#f0f2f5] px-4 py-3 relative z-10 border-t border-slate-200">
                {!candidatoActivo?.escalado && (
                  <div className="mb-2 flex items-center justify-center gap-2 text-xs text-[#54656f] bg-white rounded-lg shadow-sm px-4 py-2 font-medium">
                    <Bot size={14} />
                    <span>El bot está activo. Haz clic en "Tomar Control" para responder manualmente.</span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <textarea 
                    value={texto} 
                    onChange={e => setTexto(e.target.value)} 
                    onKeyDown={handleKeyDown}
                    disabled={!candidatoActivo?.escalado || sending}
                    className="flex-1 p-2.5 bg-white border-none rounded-lg text-sm focus:outline-none transition-colors disabled:opacity-50 resize-none max-h-32" 
                    rows={1} 
                    placeholder={candidatoActivo?.escalado ? "Escribe un mensaje" : "Toma el control para escribir"}
                  />
                  <button 
                    onClick={enviarMensaje} 
                    disabled={sending || !texto.trim() || !candidatoActivo?.escalado} 
                    className="w-10 h-10 bg-transparent text-[#54656f] hover:text-[#00a884] disabled:opacity-50 rounded-full flex items-center justify-center transition-colors"
                  >
                    {sending ? <Loader2 size={24} className="animate-spin" /> : <Send size={24} />}
                  </button>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
      <div className={`fixed bottom-6 right-6 px-5 py-3 rounded font-bold text-white shadow-xl transition-all duration-300 z-[2000] ${toast ? "translate-y-0 opacity-100" : "translate-y-16 opacity-0"} ${toast?.isError ? "bg-danger" : "bg-success"}`}>
        {toast?.msg}
      </div>
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

