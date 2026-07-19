"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Conversacion, Mensaje, Candidato } from "@/types";

const normalize = (str?: string | null) => str ? str.trim().toUpperCase() : "";

export function useMensajes() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ─── State ──────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"mis_chats" | "compartida">("mis_chats");
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
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [misVacantes, setMisVacantes] = useState<string[]>([]);

  // ─── Refs ───────────────────────────────────────────────
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const prevMessagesLength = useRef(0);
  const isNearBottom = useRef(true);
  const activePhoneRef = useRef<string | null>(null);

  useEffect(() => { activePhoneRef.current = activePhone; }, [activePhone]);

  // ─── Toast ──────────────────────────────────────────────
  const showToast = (msg: string, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3000);
  };

  // ─── Init ───────────────────────────────────────────────
  useEffect(() => {
    const n = localStorage.getItem("tci_nombre") || localStorage.getItem("tci_username") || "Reclutador";
    setNombre(n);

    loadConversaciones();
    loadReclutadores();
    const tel = searchParams.get("tel");
    if (tel) {
      setActivePhone(tel);
      loadChat(tel, true);
    }
    loadMisVacantes(n);
  }, []);

  // ─── Polling ────────────────────────────────────────────
  useEffect(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(() => {
      const phone = activePhoneRef.current;
      if (phone) loadChat(phone, false);
      loadConversaciones(false);
    }, 4000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, []);

  // ─── URL sync ──────────────────────────────────────────
  useEffect(() => {
    if (activePhone) {
      router.push(`?tel=${activePhone}`, { scroll: false });
    }
  }, [activePhone]);

  // ─── Auto-scroll ───────────────────────────────────────
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

  const handleScroll = () => {
    if (!chatScrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatScrollRef.current;
    isNearBottom.current = scrollHeight - scrollTop - clientHeight < 100;
  };

  // ─── Data Loading ──────────────────────────────────────
  const loadMisVacantes = async (nombreUser: string) => {
    try {
      const res = await fetch("/api/db/reclutador_vacantes");
      if (res.ok) {
        const data = await res.json();
        const searchName = nombreUser.trim().toLowerCase();
        const reclutador = data.find((r: any) =>
          r.nombre?.trim().toLowerCase() === searchName ||
          r.usuario?.trim().toLowerCase() === searchName
        );
        if (reclutador && reclutador.vacantes) {
          const vacantesNames = reclutador.vacantes.map((v: any) => normalize(v.nombre)).filter(Boolean);
          setMisVacantes(Array.from(new Set(vacantesNames)) as string[]);
        }
      }
    } catch (e) {
      console.error("Error cargando mis vacantes", e);
    }
  };

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

  const loadConversaciones = useCallback(async (showLoad = true) => {
    if (showLoad) setLoading(true);
    try {
      const res = await fetch("/api/db/mensajes?t=" + Date.now());
      if (!res.ok) {
        if (res.status === 429) return;
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
        if (res.status === 429) return;
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

  // ─── Chat Actions ──────────────────────────────────────
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
          asignado_a: nombre
        }),
      });
      if (!res.ok) throw new Error();
      setCandidatoActivo(prev => prev ? { ...prev, escalado: true, estado: "ESCALADO", asignado_a: nombre } : prev);
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

  const tomarChat = async () => {
    if (!activePhone) return;
    setActionLoading("tomarChat");
    try {
      const res = await fetch("/api/db/mensajes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono: activePhone, asignado_a: nombre }),
      });
      if (!res.ok) throw new Error();
      setConversaciones(prev =>
        prev.map(c => c.telefono === activePhone ? { ...c, asignado_a: nombre } : c)
      );
      showToast("✅ Has tomado el chat. Ahora está en 'Mis Chats'.");
      setActiveTab("mis_chats");
    } catch {
      showToast("Error al tomar chat", true);
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
          asignado_a: null
        }),
      });
      if (!res.ok) throw new Error();
      await fetch("/api/db/mensajes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono: activePhone, asignado_a: null }),
      });
      setCandidatoActivo(prev => prev ? { ...prev, escalado: false, asignado_a: null } : prev);
      setConversaciones(prev =>
        prev.map(c => c.telefono === activePhone ? { ...c, escalado: false, asignado_a: null } : c)
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

  // ─── Derived State ─────────────────────────────────────
  const uniqueVacantes = misVacantes;
  const uniqueNaves = Array.from(new Set(conversaciones.map(c => normalize(c.nave_interes)).filter(Boolean))).sort() as string[];

  const filtradas = conversaciones.filter(c => {
    const matchesSearch = c.nombre.toLowerCase().includes(search.toLowerCase()) || c.telefono.includes(search);
    const matchesVacante = filterVacante ? normalize(c.vacante_interes) === filterVacante : true;
    const matchesNave = filterNave ? normalize(c.nave_interes) === filterNave : true;

    const isAsignadoAMi = c.asignado_a?.toLowerCase() === nombre.toLowerCase();
    const isCompartida = !c.asignado_a || c.asignado_a === 'Equipo de Reclutamiento' || c.asignado_a === 'Reclutador';
    const matchesTab = activeTab === "mis_chats" ? isAsignadoAMi : isCompartida;

    return matchesSearch && matchesVacante && matchesNave && matchesTab;
  });

  const convActiva = conversaciones.find(c => c.telefono === activePhone);
  const estaAtendidoPorOtro = Boolean(
    candidatoActivo?.escalado &&
    convActiva?.asignado_a &&
    convActiva.asignado_a.toLowerCase() !== nombre.toLowerCase()
  );

  return {
    // State
    activeTab, setActiveTab,
    loading,
    activePhone, setActivePhone,
    mensajes,
    candidatoActivo,
    loadingChat,
    sending,
    texto, setTexto,
    nombre,
    search, setSearch,
    filterVacante, setFilterVacante,
    filterNave, setFilterNave,
    toast, setToast,
    reclutadores,
    showTransferModal, setShowTransferModal,
    showPhoneModal, setShowPhoneModal,
    selectedReclutador, setSelectedReclutador,
    actionLoading,

    // Refs
    chatScrollRef,

    // Derived
    uniqueVacantes,
    uniqueNaves,
    filtradas,
    convActiva,
    estaAtendidoPorOtro,

    // Actions
    loadChat,
    enviarMensaje,
    tomarControl,
    tomarChat,
    devolverAlBot,
    transferir,
    confirmTransferir,
    handleKeyDown,
    handleScroll,
  };
}
