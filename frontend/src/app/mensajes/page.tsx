"use client";

import { useEffect, useState, useRef, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  MessageSquare, Send, Bot, User, RefreshCw,
  Phone, Briefcase, ChevronLeft, Circle, AlertTriangle,
  UserCheck, Search, Loader2, Check, Eye, UserPlus, X, Copy
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
// Los timestamps de la BD son 'timestamp without time zone' almacenados en UTC.
// Agregamos 'Z' si no tiene zona para que JS los interprete como UTC.
function ensureUTC(ts: string): string {
  if (!ts) return ts;
  // Si ya tiene Z o +/- offset, dejarlo
  if (/[Zz]$/.test(ts) || /[+-]\d{2}:\d{2}$/.test(ts)) return ts;
  return ts + 'Z';
}

function timeAgo(ts: string | null) {
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

// Detecta si el contenido es una URL de media de WAHA
function detectMediaUrl(content: string): string | null {
  if (!content) return null;
  const match = content.match(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|mp4|ogg|opus|mp3|m4a|pdf|doc|docx)/i);
  return match ? match[0] : null;
}

// Convierte URLs de WAHA (http://localhost:3000/... o http://waha:3000/...)
// a URLs del proxy de Next.js (/api/waha-media/...) para evitar bloqueo de CSP
function proxyMediaUrl(url: string | null): string | null {
  if (!url) return null;
  // http://localhost:3000/api/files/... → /api/waha-media/api/files/...
  // http://waha:3000/api/files/... → /api/waha-media/api/files/...
  return url.replace(/^https?:\/\/(localhost|waha)(:\d+)?\//, '/api/waha-media/');
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
  const rawMediaUrl = msg.media_url || detectMediaUrl(msg.content || "");
  const mediaUrl = proxyMediaUrl(rawMediaUrl);
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
          msg.content && !hasMedia && <div className="whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: msg.content.replace(/\n/g, "<br>") }} />
        )}
        {msg.content && hasMedia && !detectMediaUrl(msg.content) && !isSinTexto && msg.content.trim() && <div className="whitespace-pre-wrap break-words mt-1.5" dangerouslySetInnerHTML={{ __html: msg.content.replace(/\n/g, "<br>") }} />}
        
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
        <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold shadow-sm ${conv.escalado ? "bg-danger/10 text-danger" : "bg-slate-200 text-slate-600"}`}>
          {(conv.nombre || conv.telefono)?.[0]?.toUpperCase() || "?"}
        </div>
        {conv.mensajes_no_leidos > 0 && <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-[#25D366] rounded-full border-2 border-white" />}
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
            {conv.mensajes_no_leidos > 0 && (
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
const normalize = (str?: string | null) => str ? str.trim().toUpperCase() : "";

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
  const [filterVacante, setFilterVacante] = useState("");
  const [filterNave, setFilterNave] = useState("");
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);
  const [reclutadores, setReclutadores] = useState<string[]>([]);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [selectedReclutador, setSelectedReclutador] = useState("");
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const prevMessagesLength = useRef(0);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [misVacantes, setMisVacantes] = useState<string[]>([]);

  // Ref para saber si estamos cerca del final y hacer auto-scroll suave
  const isNearBottom = useRef(true);

  useEffect(() => {
    const n = localStorage.getItem("tci_nombre") || localStorage.getItem("tci_username") || "Reclutador";
    setNombre(n);
    if (!localStorage.getItem("tci_authenticated")) { router.push("/login"); return; }
    loadConversaciones();
    loadReclutadores();
    const tel = searchParams.get("tel");
    if (tel) {
      setActivePhone(tel);
      loadChat(tel, true);
    }
    loadMisVacantes(n);
  }, []);

  const loadMisVacantes = async (nombreUser: string) => {
    try {
      const res = await fetch("/api/db/reclutador_vacantes");
      console.log("loadMisVacantes res.ok:", res.ok, "status:", res.status);
      if (res.ok) {
        const data = await res.json();
        const searchName = nombreUser.trim().toLowerCase();
        const reclutador = data.find((r: any) => 
          r.nombre?.trim().toLowerCase() === searchName || 
          r.usuario?.trim().toLowerCase() === searchName
        );
        console.log("Found reclutador:", reclutador);
        if (reclutador && reclutador.vacantes) {
          const vacantesNames = reclutador.vacantes.map((v: any) => normalize(v.nombre)).filter(Boolean);
          setMisVacantes(Array.from(new Set(vacantesNames)) as string[]);
        }
      } else {
        console.error("Failed to fetch vacantes", await res.text());
      }
    } catch (e) {
      console.error("Error cargando mis vacantes", e);
    }
  };

  // Ref estable para activePhone para que el polling siempre use el valor actual
  const activePhoneRef = useRef<string | null>(null);
  useEffect(() => { activePhoneRef.current = activePhone; }, [activePhone]);

  const loadReclutadores = async () => {
    try {
      const res = await fetch("/api/db/reclutadores");
      if (res.ok) {
        const data = await res.json();
        setReclutadores(data);
        if (data.length > 0) setSelectedReclutador(data[0]);
      }
    } catch (e) {
      console.error("Error cargando reclutadores", e);
    }
  };

  const handleScroll = () => {
    if (!chatScrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatScrollRef.current;
    // Si estamos a menos de 100px del final, consideramos que estamos "al fondo"
    isNearBottom.current = scrollHeight - scrollTop - clientHeight < 100;
  };

  useEffect(() => { 
    if (chatScrollRef.current && isNearBottom.current) {
      if (mensajes.length > prevMessagesLength.current) {
        chatScrollRef.current.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' });
      } else if (mensajes.length !== prevMessagesLength.current) {
        chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
      }
    }
    prevMessagesLength.current = mensajes.length;
  }, [mensajes]);

  useEffect(() => {
    if (activePhone) {
      router.push(`?tel=${activePhone}`, { scroll: false });
    }
  }, [activePhone]);

  useEffect(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(() => {
      const phone = activePhoneRef.current;
      if (phone) loadChat(phone, false);
      loadConversaciones(false);
    }, 4000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, []);

  const showToast = (msg: string, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3000);
  };

  const loadConversaciones = useCallback(async (showLoad = true) => {
    if (showLoad) setLoading(true);
    try {
      const res = await fetch("/api/db/mensajes?t=" + Date.now());
      if (!res.ok) {
        if (res.status === 429) return; // Ignorar silenciosamente si hay rate limit
        throw new Error("Failed to fetch");
      }
      const data = await res.json();
      let safeData = Array.isArray(data) ? data : [];
      safeData = safeData.map(c => {
        let n = c.nombre?.replace(/[\uFE0F\u200B\u200D]/g, '').trim();
        if (!n) n = c.telefono;
        return { ...c, nombre: n };
      });
      setConversaciones(safeData);
    } catch { 
      if (showLoad) showToast("Error al cargar", true); 
    } finally { 
      if (showLoad) setLoading(false); 
    }
  }, []);

  const loadChat = useCallback(async (tel: string, showLoad = true, isPreview = false) => {
    if (showLoad) { setLoadingChat(true); setMensajes([]); setCandidatoActivo(null); isNearBottom.current = true; prevMessagesLength.current = 0; }
    try {
      const res = await fetch(`/api/db/mensajes/${tel}${isPreview ? "?preview=true&" : "?"}t=${Date.now()}`);
      if (!res.ok) {
        if (res.status === 429) return; // Ignorar silenciosamente si hay rate limit
        throw new Error("Failed to fetch");
      }
      const data = await res.json();
      if (data.candidato) {
        let n = data.candidato.nombre?.replace(/[\uFE0F\u200B\u200D]/g, '').trim();
        if (!n) n = data.candidato.telefono;
        data.candidato.nombre = n;
      }
      setCandidatoActivo(data.candidato);
      setMensajes(data.mensajes || []);
    } catch { 
      if (showLoad) showToast("Error al cargar historial", true); 
    } finally { 
      if (showLoad) setLoadingChat(false); 
    }
  }, []);

  const enviarMensaje = async () => {
    if (!texto.trim() || !activePhone || sending) return;
    const msgText = texto;
    setTexto("");
    setSending(true);
    isNearBottom.current = true;
    try {
      await fetch(`/api/db/mensajes/${activePhone}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto: msgText, asignado_a: nombre }) });
      await loadChat(activePhone, false);
    } catch { showToast("Error al enviar", true); } finally { setSending(false); }
  };

  const tomarControl = async () => {
    if (!activePhone) return;
    setActionLoading("tomarControl");
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
    } finally {
      setActionLoading(null);
    }
  };

  const devolverAlBot = async () => {
    if (!activePhone) return;
    setActionLoading("devolverAlBot");
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
        body: JSON.stringify({ telefono: activePhone }),
      });
      setCandidatoActivo(prev => prev ? { ...prev, escalado: false } : prev);
      setConversaciones(prev =>
        prev.map(c => c.telefono === activePhone ? { ...c, escalado: false } : c)
      );
      showToast("🤖 Bot reactivado para este candidato");
    } catch {
      showToast("Error al devolver al bot", true);
    } finally {
      setActionLoading(null);
    }
  };

  const transferir = () => {
    if (!activePhone) return;
    setShowTransferModal(true);
  };

  const confirmTransferir = async () => {
    if (!activePhone || !selectedReclutador) return;
    setActionLoading("transferir");
    
    try {
      const res = await fetch("/api/db/candidato", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telefono: activePhone,
          escalado: true,
          estado: "ESCALADO",
          escalation_reason: `Transferido a ${selectedReclutador} por ${nombre}`,
          asignado_a: selectedReclutador
        }),
      });
      if (!res.ok) throw new Error();
      setCandidatoActivo(prev => prev ? { ...prev, escalado: true, estado: "ESCALADO", asignado_a: selectedReclutador } : prev);
      setConversaciones(prev =>
        prev.map(c => c.telefono === activePhone ? { ...c, escalado: true, asignado_a: selectedReclutador } : c)
      );
      await fetch("/api/db/mensajes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono: activePhone, asignado_a: selectedReclutador }),
      });
      showToast(`✅ Conversación transferida a ${selectedReclutador}`);
      setShowTransferModal(false);
    } catch {
      showToast("Error al transferir", true);
    } finally {
      setActionLoading(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      enviarMensaje();
    }
  };

  const uniqueVacantes = misVacantes;
  const uniqueNaves = Array.from(new Set(conversaciones.map(c => normalize(c.nave_interes)).filter(Boolean))).sort() as string[];

  const filtradas = conversaciones.filter(c => {
    const matchesSearch = c.nombre.toLowerCase().includes(search.toLowerCase()) || c.telefono.includes(search);
    const matchesVacante = filterVacante ? normalize(c.vacante_interes) === filterVacante : true;
    const matchesNave = filterNave ? normalize(c.nave_interes) === filterNave : true;
    return matchesSearch && matchesVacante && matchesNave;
  });
  const convActiva = conversaciones.find(c => c.telefono === activePhone);
  const estaAtendidoPorOtro = Boolean(
    candidatoActivo?.escalado && 
    convActiva?.asignado_a && 
    convActiva.asignado_a.toLowerCase() !== nombre.toLowerCase()
  );

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
            <span className="font-semibold">{nombre.toUpperCase()}</span>
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
          <div className="px-3 py-2 bg-[#f0f2f5] border-b border-slate-200 flex flex-col gap-2">
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
            <div className="flex flex-col gap-2">
              <select
                className="w-full bg-white border-none rounded-lg text-xs py-1.5 px-2 focus:outline-none text-slate-600"
                value={filterVacante}
                onChange={e => setFilterVacante(e.target.value)}
              >
                <option value="">Todas las vacantes</option>
                {uniqueVacantes.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <select
                className="w-full bg-white border-none rounded-lg text-xs py-1.5 px-2 focus:outline-none text-slate-600"
                value={filterNave}
                onChange={e => setFilterNave(e.target.value)}
              >
                <option value="">Todas las naves</option>
                {uniqueNaves.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
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
                onClick={() => { setActivePhone(conv.telefono); loadChat(conv.telefono, true, false); }} 
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
                  <div className="relative">
                    <button 
                      onClick={() => setShowPhoneModal(!showPhoneModal)}
                      className="font-bold text-[#111b21] hover:underline text-left cursor-pointer focus:outline-none"
                    >
                      {candidatoActivo?.nombre || convActiva?.nombre || activePhone}
                    </button>
                    {showPhoneModal && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowPhoneModal(false)} />
                        <div className="absolute top-full left-0 mt-2 bg-white rounded-lg shadow-xl border border-slate-100 p-4 z-50 min-w-[200px]">
                          <div className="flex justify-between items-center mb-3">
                            <span className="text-xs font-bold text-slate-500 uppercase">Información</span>
                            <button onClick={() => setShowPhoneModal(false)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
                          </div>
                          <div className="flex items-center justify-between gap-3 text-slate-700 bg-slate-50 p-2.5 rounded-md border border-slate-100 group">
                            <div className="flex items-center gap-2">
                              <Phone size={16} className="text-[#00a884]" />
                              <span className="font-mono text-sm font-semibold">+{activePhone}</span>
                            </div>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(activePhone || "");
                                setToast({ msg: "Teléfono copiado", isError: false });
                                setTimeout(() => setToast(null), 3000);
                                setShowPhoneModal(false);
                              }}
                              className="text-slate-400 hover:text-primary transition-colors focus:outline-none"
                              title="Copiar teléfono"
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
                  
                  {candidatoActivo?.escalado && !estaAtendidoPorOtro ? (
                    <>
                      <button
                        onClick={transferir}
                        disabled={!!actionLoading}
                        className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-70 text-white rounded-lg transition-colors shadow-sm"
                      >
                        {actionLoading === "transferir" ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />} Transferir
                      </button>
                      <button
                        onClick={devolverAlBot}
                        disabled={!!actionLoading}
                        className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 bg-[#00a884] hover:bg-[#008f6f] disabled:opacity-70 text-white rounded-lg transition-colors shadow-sm"
                      >
                        {actionLoading === "devolverAlBot" ? <Loader2 size={12} className="animate-spin" /> : <Bot size={12} />} Devolver al Bot
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => {
                        if (estaAtendidoPorOtro) {
                          alert(`Este chat está siendo atendido por: ${convActiva?.asignado_a}`);
                        } else {
                          tomarControl();
                        }
                      }}
                      disabled={!!actionLoading}
                      className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 bg-danger hover:bg-danger/90 disabled:opacity-70 text-white rounded-lg transition-colors shadow-sm"
                    >
                      {actionLoading === "tomarControl" ? <Loader2 size={12} className="animate-spin" /> : <User size={12} />} Tomar Control
                    </button>
                  )}
                </div>
              </div>
              <div ref={chatScrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-[5%] md:px-[10%] py-6" style={{ backgroundImage: `url('https://static.whatsapp.net/rsrc.php/v3/yl/r/r_QZ352iVXR.png')`, backgroundRepeat: 'repeat', backgroundSize: '400px' }}>
                {loadingChat ? <div className="flex justify-center mt-10"><div className="flex items-center gap-2 text-sm text-slate-600 bg-white/90 shadow-sm px-4 py-2 rounded-full font-medium"><Loader2 size={16} className="animate-spin text-primary" /> Cargando mensajes...</div></div> : mensajes.map(msg => <BurbujaMensaje key={msg.id} msg={msg} />)}
              </div>
              <div className="flex-shrink-0 bg-[#f0f2f5] px-4 py-3 relative z-10 border-t border-slate-200">
                {!candidatoActivo?.escalado && !estaAtendidoPorOtro && (
                  <div className="mb-2 flex items-center justify-center gap-2 text-xs text-[#54656f] bg-white rounded-lg shadow-sm px-4 py-2 font-medium">
                    <Bot size={14} />
                    <span>El bot está activo. Haz clic en "Tomar Control" para responder manualmente.</span>
                  </div>
                )}
                {estaAtendidoPorOtro && (
                  <div className="mb-2 flex items-center justify-center gap-2 text-xs text-danger bg-danger/10 rounded-lg shadow-sm px-4 py-2 font-medium">
                    <AlertTriangle size={14} />
                    <span>Este chat está siendo atendido por {convActiva?.asignado_a}.</span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <textarea 
                    value={texto} 
                    onChange={e => setTexto(e.target.value)} 
                    onKeyDown={handleKeyDown}
                    disabled={(!candidatoActivo?.escalado || estaAtendidoPorOtro) || sending}
                    className="flex-1 p-2.5 bg-white border-none rounded-lg text-sm focus:outline-none transition-colors disabled:opacity-50 resize-none max-h-32" 
                    rows={1} 
                    placeholder={!candidatoActivo?.escalado ? "Toma el control para escribir" : estaAtendidoPorOtro ? `Atendido por ${convActiva?.asignado_a}` : "Escribe un mensaje"}
                  />
                  <button 
                    onClick={enviarMensaje} 
                    disabled={sending || !texto.trim() || (!candidatoActivo?.escalado || estaAtendidoPorOtro)} 
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

      {showTransferModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-[3000]">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100">
              <h3 className="font-bold text-slate-800 flex items-center gap-2"><UserPlus size={18} className="text-primary" /> Transferir Conversación</h3>
              <button onClick={() => setShowTransferModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors"><X size={20} /></button>
            </div>
            <div className="p-6">
              <p className="text-sm text-slate-600 mb-4">Selecciona al reclutador al que deseas transferir este candidato. Se le notificará automáticamente por WhatsApp.</p>
              <select
                className="w-full border border-slate-200 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                value={selectedReclutador}
                onChange={e => setSelectedReclutador(e.target.value)}
              >
                {reclutadores.map(rec => (
                  <option key={rec} value={rec}>{rec}</option>
                ))}
              </select>
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end gap-3 border-t border-slate-100">
              <button onClick={() => setShowTransferModal(false)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 bg-slate-100 rounded-lg transition-colors">Cancelar</button>
              <button onClick={confirmTransferir} disabled={actionLoading === "transferir"} className="px-4 py-2 text-sm font-bold text-white bg-primary hover:bg-primary/90 disabled:opacity-70 rounded-lg shadow-sm transition-colors flex items-center gap-2">
                {actionLoading === "transferir" ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Confirmar Transferencia
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

