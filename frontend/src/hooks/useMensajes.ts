"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Conversacion, Mensaje, Candidato } from "@/types";
import { useLocalStorageValue } from "./useLocalStorageValue";
import { useTenantChange } from "./useTenant";

const normalize = (str?: string | null) => str ? str.trim().toUpperCase() : "";

/** "todos" sólo se ofrece a ROOT/ADMIN (ver `puedeVerTodo`). */
export type TabBandeja = "todos" | "mis_chats" | "compartida" | "descartados";

export function useMensajes() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ─── State ──────────────────────────────────────────────
  const nombre = useLocalStorageValue("tci_username") || "Reclutador";
  const reclutadorId = useLocalStorageValue("tci_reclutador_id");
  // ROOT y ADMIN supervisan a todos los reclutadores. Además NO tienen
  // `reclutador_id` (en la tabla `usuarios` va NULL), así que para ellos
  // "mis_chats" siempre sale vacío y "compartida" sólo trae las conversaciones
  // sin dueño: sin esta pestaña, todas las asignadas a un reclutador les
  // quedaban invisibles aunque el API sí se las devuelve.
  const role = useLocalStorageValue("tci_role") || "";
  const puedeVerTodo = role === "ROOT" || role === "ADMIN";

  const [activeTab, setActiveTab] = useState<TabBandeja>("mis_chats");
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePhone, setActivePhone] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [candidatoActivo, setCandidatoActivo] = useState<Candidato | null>(null);
  const [loadingChat, setLoadingChat] = useState(false);
  const [sending, setSending] = useState(false);
  const [texto, setTexto] = useState("");
  const [search, setSearch] = useState("");
  const [filterVacante, setFilterVacante] = useState("");
  const [filterNave, setFilterNave] = useState("");
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);
  const [reclutadores, setReclutadores] = useState<any[]>([]);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [selectedReclutador, setSelectedReclutador] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [todasVacantes, setTodasVacantes] = useState<string[]>([]);
  const [todasNaves, setTodasNaves] = useState<string[]>([]);

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

  // ─── Data Loading ──────────────────────────────────────
  const loadCatalogos = useCallback(async () => {
    try {
      const storedEmpresaId = localStorage.getItem("tci_empresa_id");
      let query = "";
      if (storedEmpresaId && storedEmpresaId !== "null" && storedEmpresaId !== "undefined") {
        query += `?empresa_id=${storedEmpresaId}`;
      }
      // 1. Cargar todas las vacantes de todos los reclutadores de la empresa
      const resVac = await fetch(`/api/db/vacantes${query}`);
      if (resVac.ok) {
        const data = await resVac.json();
        if (Array.isArray(data)) {
          const allVacs = data.flatMap((r: any) => r.vacantes || []).map((v: any) => normalize(v.nombre)).filter(Boolean);
          setTodasVacantes(Array.from(new Set(allVacs)) as string[]);
        }
      }

      // 2. Cargar todas las naves registradas
      const resCtx = await fetch(`/api/prompt-context${query}`);
      if (resCtx.ok) {
        const ctxData = await resCtx.json();
        if (ctxData.menu_naves && typeof ctxData.menu_naves === "string") {
          const lines = ctxData.menu_naves.split("\n").filter((l: string) => /^\d+\./.test(l.trim()));
          const navesList = lines.map((l: string) => normalize(l.replace(/^\d+\.\s*/, ""))).filter(Boolean);
          if (navesList.length > 0) {
            setTodasNaves(Array.from(new Set(navesList)) as string[]);
          }
        }
      }
    } catch (e) {
      console.error("Error cargando catálogos de vacantes y naves", e);
    }
  }, []);

  const loadReclutadores = useCallback(async () => {
    try {
      const storedEmpresaId = localStorage.getItem("tci_empresa_id");
      let query = "?grouped=true";
      if (storedEmpresaId && storedEmpresaId !== "null" && storedEmpresaId !== "undefined") {
        query += `&empresa_id=${storedEmpresaId}`;
      }
      const res = await fetch(`/api/db/reclutadores${query}`);
      if (res.ok) {
        const data = await res.json();
        if (data.grupos && Array.isArray(data.grupos)) {
          setReclutadores(data.grupos);
          const allRecs = data.grupos.flatMap((g: any) => g.reclutadores || []);
          if (allRecs.length > 0) {
            setSelectedReclutador(allRecs[0].id);
          }
        } else if (Array.isArray(data)) {
          // Fallback legacy
          setReclutadores([{
            grupo_nombre: "Otros",
            reclutadores: data.map(r => ({ nombre: r }))
          }]);
          if (data.length > 0) setSelectedReclutador(typeof data[0] === 'string' ? data[0] : data[0].nombre);
        }
      }
    } catch (e) {
      console.error("Error cargando reclutadores", e);
    }
  }, []);

  const loadConversaciones = useCallback(async (showLoad = true) => {
    if (showLoad) setLoading(true);
    try {
      const storedEmpresaId = localStorage.getItem("tci_empresa_id");
      const storedNaveId = localStorage.getItem("tci_nave_id");
      const storedGrupoId = localStorage.getItem("tci_grupo_id");
      let query = "";
      if (storedEmpresaId) query += `&empresa_id=${storedEmpresaId}`;
      if (storedGrupoId) query += `&grupo_id=${storedGrupoId}`;
      else if (storedNaveId) query += `&nave_id=${storedNaveId}`;
      const res = await fetch(`/api/db/mensajes?t=${Date.now()}${query}`);
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
      if (showLoad && safeData.length > 0) {
        // Se lee de localStorage y no del hook: esto corre dentro de un
        // callback estable (deps vacías) que no se recrea al hidratar.
        const rol = localStorage.getItem("tci_role") || "";
        if (rol === "ROOT" || rol === "ADMIN") {
          setActiveTab("todos");
        } else {
          const rId = localStorage.getItem("tci_reclutador_id");
          const hasMine = rId ? safeData.some(c => c.asignado_a_id === rId) : false;
          if (!hasMine) {
            setActiveTab("compartida");
          }
        }
      }
    } catch {
      if (showLoad) showToast("Error al cargar", true);
    } finally {
      if (showLoad) setLoading(false);
    }
  }, []);

  const loadChat = useCallback(async (tel: string, showLoad = true, isPreview = false) => {
    if (showLoad) { setLoadingChat(true); setMensajes([]); setCandidatoActivo(null); isNearBottom.current = true; prevMessagesLength.current = 0; }
    try {
      const storedEmpresaId = localStorage.getItem("tci_empresa_id");
      const storedNaveId = localStorage.getItem("tci_nave_id");
      let query = "";
      if (storedEmpresaId) query += `&empresa_id=${storedEmpresaId}`;
      if (storedNaveId) query += `&nave_id=${storedNaveId}`;
      const res = await fetch(`/api/db/mensajes/${tel}${isPreview ? "?preview=true&" : "?"}t=${Date.now()}${query}`);
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

  // ─── Init ───────────────────────────────────────────────
  useEffect(() => {
    const tel = searchParams.get("tel");
    const arrancar = async () => {
      if (tel) {
        setActivePhone(tel);
        await loadChat(tel, true);
      }
      await Promise.all([loadConversaciones(), loadReclutadores(), loadCatalogos()]);
    };
    arrancar();
    // Solo al montar: searchParams cambia con cada navegacion y relanzaria la
    // carga completa, y `nombre` solo se usa como semilla inicial.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadChat, loadConversaciones, loadReclutadores, loadCatalogos]);

  // ─── Tiempo real (SSE) ──────────────────────────────────
  // Reemplaza el polling de 4s: el backend empuja un evento apenas se
  // inserta un mensaje o cambia la bandeja (ver /api/db/mensajes/stream).
  // El orden ya no depende de "cuándo lo vio el polling" sino de que cada
  // fila en conversation_history trae su timestamp real (fix en agente.py).
  const conversacionesRefreshRef = useRef<NodeJS.Timeout | null>(null);
  const refrescarConversaciones = useCallback(() => {
    if (conversacionesRefreshRef.current) clearTimeout(conversacionesRefreshRef.current);
    // Se agrupan ráfagas de eventos (p.ej. una respuesta partida en varios
    // mensajes) en un solo refetch de la lista en vez de uno por evento.
    conversacionesRefreshRef.current = setTimeout(() => loadConversaciones(false), 600);
  }, [loadConversaciones]);

  useEffect(() => {
    const es = new EventSource("/api/db/mensajes/stream");
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        const phone = activePhoneRef.current;
        if (data?.telefono && phone && data.telefono === phone) {
          loadChat(phone, false);
        }
        refrescarConversaciones();
      } catch {
        // evento no parseable, se ignora
      }
    };
    return () => es.close();
  }, [loadChat, refrescarConversaciones]);

  // Red de seguridad por si el SSE se cae en silencio (proxy, reinicio del
  // servidor, etc.) -- mucho más espaciado que el polling anterior.
  useEffect(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(() => {
      const phone = activePhoneRef.current;
      if (phone) loadChat(phone, false);
      loadConversaciones(false);
    }, 30000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [loadChat, loadConversaciones]);

  // Re-cargar (sin recargar la página) cuando el usuario cambia de empresa/nave en el TopNavbar
  useTenantChange(() => {
    loadConversaciones();
    loadReclutadores();
    loadCatalogos();
    const phone = activePhoneRef.current;
    if (phone) loadChat(phone, false);
  });

  // ─── URL sync ──────────────────────────────────────────
  useEffect(() => {
    if (activePhone) {
      router.push(`?tel=${activePhone}`, { scroll: false });
    }
  }, [activePhone, router]);

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

  // ─── Chat Actions ──────────────────────────────────────
  const enviarMensaje = async () => {
    if (!texto.trim() || !activePhone || sending) return;
    const msgText = texto;
    setTexto("");
    setSending(true);
    isNearBottom.current = true;
    try {
      const storedEmpresaId = localStorage.getItem("tci_empresa_id");
      const storedNaveId = localStorage.getItem("tci_nave_id");
      let query = "";
      if (storedEmpresaId) query += `?empresa_id=${storedEmpresaId}`;
      if (storedNaveId) query += (query ? `&` : `?`) + `nave_id=${storedNaveId}`;
      await fetch(`/api/db/mensajes/${activePhone}${query}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto: msgText, asignado_a_id: reclutadorId }) });
      await loadChat(activePhone, false);
    } catch { showToast("Error al enviar", true); } finally { setSending(false); }
  };

  const enviarImagen = async (file: File) => {
    if (!file || !activePhone || sending) return;
    setSending(true);
    isNearBottom.current = true;
    try {
      const formData = new FormData();
      formData.append("data", file);
      formData.append("telefono", activePhone);

      const uploadRes = await fetch(`/api/upload-cv?telefono=${activePhone}`, {
        method: "POST",
        body: formData,
      });

      if (!uploadRes.ok) throw new Error("Error al subir imagen");
      const { url: mediaUrl } = await uploadRes.json();

      const storedEmpresaId = localStorage.getItem("tci_empresa_id");
      const storedNaveId = localStorage.getItem("tci_nave_id");
      let query = "";
      if (storedEmpresaId) query += `?empresa_id=${storedEmpresaId}`;
      if (storedNaveId) query += (query ? `&` : `?`) + `nave_id=${storedNaveId}`;

      await fetch(`/api/db/mensajes/${activePhone}${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          texto: "",
          media_url: mediaUrl,
          message_type: "image",
          asignado_a_id: reclutadorId
        })
      });

      await loadChat(activePhone, false);
      showToast("📷 Imagen enviada correctamente");
    } catch {
      showToast("Error al enviar imagen", true);
    } finally {
      setSending(false);
    }
  };

  const tomarControl = async () => {
    if (!activePhone) return;
    setActionLoading("tomarControl");
    try {
      const storedEmpresaId = localStorage.getItem("tci_empresa_id");
      const storedNaveId = localStorage.getItem("tci_nave_id");
      let query = "";
      if (storedEmpresaId) query += `?empresa_id=${storedEmpresaId}`;
      if (storedNaveId) query += (query ? `&` : `?`) + `nave_id=${storedNaveId}`;
      
      const res = await fetch(`/api/db/candidato${query}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telefono: activePhone,
          escalado: true,
          estado: "ESCALADO",
          escalation_reason: `Atendido manualmente por ${nombre}`,
          asignado_a_id: reclutadorId
        }),
      });
      if (!res.ok) throw new Error();
      setCandidatoActivo(prev => prev ? { ...prev, escalado: true, estado: "ESCALADO", asignado_a_id: reclutadorId } : prev);
      setConversaciones(prev =>
        prev.map(c => c.telefono === activePhone ? { ...c, escalado: true, asignado_a_id: reclutadorId, asignado_a_nombre: nombre } : c)
      );
      await fetch(`/api/db/mensajes${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono: activePhone, asignado_a_id: reclutadorId }),
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
      const storedEmpresaId = localStorage.getItem("tci_empresa_id");
      const storedNaveId = localStorage.getItem("tci_nave_id");
      let query = "";
      if (storedEmpresaId) query += `?empresa_id=${storedEmpresaId}`;
      if (storedNaveId) query += (query ? `&` : `?`) + `nave_id=${storedNaveId}`;

      const res = await fetch(`/api/db/mensajes${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono: activePhone, asignado_a_id: reclutadorId }),
      });
      if (!res.ok) throw new Error();
      setConversaciones(prev =>
        prev.map(c => c.telefono === activePhone ? { ...c, asignado_a_id: reclutadorId, asignado_a_nombre: nombre } : c)
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
      const storedEmpresaId = localStorage.getItem("tci_empresa_id");
      const storedNaveId = localStorage.getItem("tci_nave_id");
      let query = "";
      if (storedEmpresaId) query += `?empresa_id=${storedEmpresaId}`;
      if (storedNaveId) query += (query ? `&` : `?`) + `nave_id=${storedNaveId}`;

      const res = await fetch(`/api/db/candidato${query}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telefono: activePhone,
          escalado: false,
          estado: "INTERESADO",
          escalation_reason: null,
          asignado_a_id: null
        }),
      });
      if (!res.ok) throw new Error();
      await fetch(`/api/db/mensajes${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono: activePhone, asignado_a_id: null }),
      });
      setCandidatoActivo(prev => prev ? { ...prev, escalado: false, asignado_a_id: null } : prev);
      setConversaciones(prev =>
        prev.map(c => c.telefono === activePhone ? { ...c, escalado: false, asignado_a_id: null, asignado_a_nombre: null } : c)
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
    loadReclutadores();
    setShowTransferModal(true);
  };

  const confirmTransferir = async () => {
    if (!activePhone || !selectedReclutador) return;

    // Find the target reclutador (por id) para saber su nombre y si hay que cambiar empresa_id
    let targetEmpresaId: string | null = null;
    let targetNombre: string = selectedReclutador;
    if (reclutadores && reclutadores.length > 0) {
      for (const grupo of reclutadores) {
        const found = grupo.reclutadores?.find((r: any) => r.id === selectedReclutador);
        if (found) {
          targetNombre = found.nombre || targetNombre;
          if (grupo.empresa_id) targetEmpresaId = grupo.empresa_id;
          break;
        }
      }
    }

    setActionLoading("transferir");
    try {
      const storedEmpresaId = localStorage.getItem("tci_empresa_id");
      const storedNaveId = localStorage.getItem("tci_nave_id");
      let query = "";
      if (storedEmpresaId) query += `?empresa_id=${storedEmpresaId}`;
      if (storedNaveId) query += (query ? `&` : `?`) + `nave_id=${storedNaveId}`;

      const bodyData: any = {
        telefono: activePhone,
        escalado: true,
        estado: "ESCALADO",
        escalation_reason: `Transferido a ${targetNombre} por ${nombre}`,
        asignado_a_id: selectedReclutador
      };

      if (targetEmpresaId && targetEmpresaId !== storedEmpresaId) {
        bodyData.empresa_id = targetEmpresaId;
      }

      const res = await fetch(`/api/db/candidato${query}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyData),
      });
      if (!res.ok) throw new Error();
      setCandidatoActivo(prev => prev ? { ...prev, escalado: true, estado: "ESCALADO", asignado_a_id: selectedReclutador } : prev);
      setConversaciones(prev =>
        prev.map(c => c.telefono === activePhone ? { ...c, escalado: true, asignado_a_id: selectedReclutador, asignado_a_nombre: targetNombre } : c)
      );
      await fetch(`/api/db/mensajes${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono: activePhone, asignado_a_id: selectedReclutador }),
      });
      showToast(`✅ Conversación transferida a ${targetNombre}`);
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
  const isPlaceholderVal = (val?: string | null) => {
    if (!val) return true;
    const norm = val.trim().toLowerCase().replace(/[{}]/g, "");
    return !norm || norm === "1" || norm === "2" || norm === "ninguna" || norm === "general" || norm === "pendiente" || norm === "sin sucursal";
  };

  const normalizarNave = (nave?: string | null): string | null => {
    if (!nave) return null;
    const upper = nave.trim().toUpperCase();
    if (upper === '1' || upper.includes('DULCERIA') || upper.includes('DULCERÍA')) return 'DULCERIA';
    if (upper === '2' || upper.includes('CEDIS')) return 'CEDIS';
    return nave.trim();
  };

  const convVacantes = conversaciones
    .map(c => normalize(c.vacante_interes))
    .filter((v): v is string => Boolean(v) && !isPlaceholderVal(v));
  const uniqueVacantes = Array.from(
    new Set([...todasVacantes.filter(v => !isPlaceholderVal(v)), ...convVacantes])
  ).sort() as string[];

  const convNaves = conversaciones
    .map(c => normalizarNave(c.nave_interes))
    .filter((n): n is string => Boolean(n) && !isPlaceholderVal(n));
  const uniqueNaves = Array.from(
    new Set([...todasNaves.map(n => normalizarNave(n)).filter((n): n is string => Boolean(n) && !isPlaceholderVal(n)), ...convNaves])
  ).sort() as string[];

  const filtradas = conversaciones.filter(c => {
    const matchesSearch = c.nombre.toLowerCase().includes(search.toLowerCase()) || c.telefono.includes(search);
    const matchesVacante = filterVacante ? normalize(c.vacante_interes) === filterVacante : true;

    const matchesNave = filterNave ? (() => {
      const cNave = normalize(c.nave_interes);
      if (!cNave) return false;
      if (cNave === filterNave) return true;
      const naveAliases: Record<string, string[]> = {
        "DULCERIA": ["1", "DULCERIA", "DULCERÍA"],
        "CEDIS": ["2", "CEDIS"],
        "MATERIAS PRIMAS": ["3", "MATERIAS PRIMAS"]
      };
      const aliases = naveAliases[filterNave];
      if (aliases) {
        return aliases.includes(cNave);
      }
      return cNave.includes(filterNave) || filterNave.includes(cNave);
    })() : true;

    const isDescartado = c.estado === "RECHAZADO" || c.estado === "INACTIVO" || c.estado === "OTRA_CIUDAD";
    const isAsignadoAMi = !!reclutadorId && c.asignado_a_id === reclutadorId;
    const isCompartida = !c.asignado_a_id;

    let matchesTab = false;
    if (activeTab === "descartados") {
      matchesTab = isDescartado;
    } else if (activeTab === "todos") {
      // Sin filtro de dueño: incluye las asignadas a otros reclutadores.
      matchesTab = !isDescartado;
    } else if (activeTab === "mis_chats") {
      matchesTab = !isDescartado && isAsignadoAMi;
    } else {
      // compartida
      matchesTab = !isDescartado && isCompartida;
    }

    return matchesSearch && matchesVacante && matchesNave && matchesTab;
  });

  const convActiva = conversaciones.find(c => c.telefono === activePhone);
  // ROOT/ADMIN quedan fuera: como no tienen `reclutador_id`, cualquier chat con
  // dueño les salía como "atendido por otro" y con el input bloqueado. Siguen
  // viendo el aviso de quién lo atiende (lo pinta la propia pantalla).
  const estaAtendidoPorOtro = Boolean(
    !puedeVerTodo &&
    candidatoActivo?.escalado &&
    convActiva?.asignado_a_id &&
    convActiva.asignado_a_id !== reclutadorId
  );

  // Contraparte informativa de lo anterior: ROOT/ADMIN sí pueden escribir en un
  // chat ajeno, pero deben ver de quién es antes de intervenir.
  const supervisandoChatDeOtro = Boolean(
    puedeVerTodo &&
    convActiva?.asignado_a_id &&
    convActiva.asignado_a_id !== reclutadorId
  );

  return {
    // State
    activeTab, setActiveTab,
    puedeVerTodo,
    supervisandoChatDeOtro,
    loading,
    activePhone, setActivePhone,
    mensajes,
    candidatoActivo,
    loadingChat,
    sending,
    texto, setTexto,
    nombre,
    reclutadorId,
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
    enviarImagen,
    tomarControl,
    tomarChat,
    devolverAlBot,
    transferir,
    confirmTransferir,
    handleKeyDown,
    handleScroll,
  };
}
