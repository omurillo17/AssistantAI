"use client";

import { useEffect, useState, useMemo, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarDays, AlertTriangle,
  LayoutGrid, List, MessageSquare, Search
} from "lucide-react";
import { ESTADOS, ESTADOS_CRM, GRUPOS, getEstado, KANBAN_COLUMNAS, type EstadoKey } from "@/lib/estados";
import type { Candidato } from "@/types";
import { CandidateModal } from "@/components/CandidateModal";
import { getCandidateDisplayName as getNombre, formatNaveName } from "@/lib/formatters";
import { useTenantChange } from "@/hooks/useTenant";

// ─── COMPONENTE: TARJETA KANBAN ────────────────────────────────
function KanbanCard({ cand, onClick, onStatusChange }: { cand: Candidato, onClick: () => void, onStatusChange: (t: string, s: string) => void }) {
  const hasCV = cand.tiene_cv || !!cand.cv_manual || !!cand.link_cv;
  const hasINE = !!cand.datos_ine;
  const needsReview = cand.alerta_identidad_estado === 'PENDIENTE' || cand.estado === 'DOCUMENTOS_NO_COINCIDEN' || (cand.resumen_ia && cand.resumen_ia.toLowerCase().includes('revisión'));

  return (
    <div
      onClick={onClick}
      className={`bg-white p-3 rounded-xl border transition-all cursor-pointer group flex flex-col relative ${
        needsReview ? 'border-amber-300 shadow-amber-100 ring-2 ring-amber-400/30' : 'border-slate-200 shadow-sm hover:shadow-md hover:border-indigo-300'
      }`}
    >
      <div className="flex justify-between items-start mb-1.5 gap-1">
        <div className="font-bold text-slate-800 text-sm leading-tight group-hover:text-indigo-600 transition-colors line-clamp-2">
          {getNombre(cand)}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {needsReview && (
            <span className="bg-amber-500 text-white font-extrabold text-[9px] px-1.5 py-0.5 rounded shadow-2xs animate-pulse flex items-center gap-0.5">
              🚩 REVISAR
            </span>
          )}
          {cand.escalado && (
            <div className="bg-rose-100 text-rose-600 p-1 rounded-full animate-pulse" title="¡Requiere atención humana!">
              <AlertTriangle size={12} />
            </div>
          )}
        </div>
      </div>

      <div className="text-[10px] text-slate-500 font-mono mb-2">{cand.telefono}</div>

      <div className="flex flex-wrap gap-1 mb-2">
        {cand.vacante_interes && (
          <span className="text-[9px] font-bold bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded border border-indigo-100 uppercase tracking-wider">
            {cand.vacante_interes}
          </span>
        )}
        {cand.nave_interes && (
          <span className="text-[9px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200">
            {formatNaveName(cand.nave_interes)}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 items-center mb-2">
        <EstadoBadge estado={cand.estado} />
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 ${hasCV ? "bg-cyan-50 text-cyan-700 border border-cyan-100" : "bg-slate-50 text-slate-400 border border-slate-100"}`}>
          📄 CV
        </span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 ${hasINE ? "bg-violet-50 text-violet-700 border border-violet-100" : "bg-slate-50 text-slate-400 border border-slate-100"}`}>
          🪪 INE
        </span>
      </div>

      {cand.fecha_entrevista && (
        <div className="text-[10px] text-amber-600 font-bold">
          📅 {new Date(cand.fecha_entrevista).toLocaleString("es-MX", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        </div>
      )}
      <div className="mt-2 pt-2 border-t border-slate-50 flex gap-1" onClick={e => e.stopPropagation()}>
        <select
          id={`kanban-status-${cand.telefono}`}
          name="kanban_status"
          className="text-[9px] font-bold px-1.5 py-0.5 rounded-full cursor-pointer appearance-none bg-slate-50 text-slate-600 border border-slate-200 hover:border-slate-300 transition-colors flex-1"
          value={cand.estado}
          onChange={(e) => onStatusChange(cand.telefono, e.target.value)}
        >
          <option value={cand.estado}>{getEstado(cand.estado).emoji} {getEstado(cand.estado).labelCorto}</option>
          <option disabled>── Mover a ──</option>
          {ESTADOS_CRM.filter(k => k !== cand.estado).map(k => (
            <option key={k} value={k}>{ESTADOS[k as EstadoKey].emoji} {ESTADOS[k as EstadoKey].label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ─── BADGE ESTADO ──────────────────────────────────────────────
function EstadoBadge({ estado }: { estado: string }) {
  const def = getEstado(estado);
  return (
    <span className={`inline-flex items-center gap-1.5 font-bold rounded-full px-3 py-1 text-xs ${def.bg} ${def.color}`}>
      <span>{def.emoji}</span>
      <span>{def.label}</span>
    </span>
  );
}

function ExpedientesPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const telParam = searchParams.get("tel");
  const appliedTelRef = useRef(false);
  const [vista, setVista] = useState<"kanban" | "tabla">("kanban");
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [mensajes, setMensajes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filtros
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("TODOS");
  const [vacanteFilter, setVacanteFilter] = useState("TODAS");
  const [naveFilter, setNaveFilter] = useState("TODAS");

  const [selectedCandidate, setSelectedCandidate] = useState<Candidato | null>(null);
  // Ref con el candidato abierto actualmente, para que loadData (useCallback
  // con deps []) siempre lea el valor más reciente sin tener que recrearse.
  const selectedCandidateRef = useRef<Candidato | null>(null);
  useEffect(() => {
    selectedCandidateRef.current = selectedCandidate;
  }, [selectedCandidate]);

  // Lista de Naves y Vacantes desde BD para filtros
  const [dbNaves, setDbNaves] = useState<{ id: string; nombre: string }[]>([]);
  const [dbVacantes, setDbVacantes] = useState<string[]>([]);
  const [rawVacantesData, setRawVacantesData] = useState<any[]>([]);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const storedEmpresaId = localStorage.getItem("tci_empresa_id");
      const storedNaveId = localStorage.getItem("tci_nave_id");
      const storedGrupoId = localStorage.getItem("tci_grupo_id");

      let queryCand = "";
      if (storedEmpresaId) queryCand += `&empresa_id=${storedEmpresaId}`;
      if (storedGrupoId) queryCand += `&grupo_id=${storedGrupoId}`;
      else if (storedNaveId) queryCand += `&nave_id=${storedNaveId}`;

      let queryMensajes = "";
      if (storedEmpresaId) queryMensajes += `?empresa_id=${storedEmpresaId}`;
      if (storedGrupoId) queryMensajes += (queryMensajes ? `&` : `?`) + `grupo_id=${storedGrupoId}`;
      else if (storedNaveId) queryMensajes += (queryMensajes ? `&` : `?`) + `nave_id=${storedNaveId}`;

      let queryVac = "";
      if (storedEmpresaId) queryVac += `?empresa_id=${storedEmpresaId}`;
      if (storedGrupoId) queryVac += (queryVac ? `&` : `?`) + `grupo_id=${storedGrupoId}`;
      else if (storedNaveId) queryVac += (queryVac ? `&` : `?`) + `nave_id=${storedNaveId}`;

      const [candRes, msgsRes, empRes, vacRes] = await Promise.all([
        fetch(`/api/db/candidatos?limit=2000${queryCand}`),
        fetch(`/api/db/mensajes${queryMensajes}`),
        fetch(`/api/db/empresas`),
        fetch(`/api/db/vacantes${queryVac}`),
      ]);
      const candData = await candRes.json();
      const msgsData = await msgsRes.json();
      const newCandidatos: Candidato[] = Array.isArray(candData) ? candData : [];
      setCandidatos(newCandidatos);
      setMensajes(Array.isArray(msgsData) ? msgsData : []);

      // Si hay un expediente abierto y llegó información nueva para ese
      // candidato (p.ej. desde un webhook de WhatsApp), refrescamos el modal
      // con los datos frescos para que muestre el aviso de actualización.
      // No tocamos selectedCandidate si no hay cambios reales, para no
      // disparar el aviso sin motivo en cada poll silencioso.
      const openCand = selectedCandidateRef.current;
      if (openCand) {
        const fresh = newCandidatos.find((c) => c.telefono === openCand.telefono);
        if (fresh && JSON.stringify(fresh) !== JSON.stringify(openCand)) {
          setSelectedCandidate(fresh);
        }
      }

      if (empRes.ok) {
        const empData = await empRes.json();
        const empList = empData.empresas || [];
        const scopedEmpresas = storedEmpresaId
          ? empList.filter((e: any) => e.id === storedEmpresaId)
          : empList;
        const naves: { id: string; nombre: string }[] = [];
        scopedEmpresas.forEach((e: any) => {
          (e.naves || []).forEach((n: any) => {
            if (n.nombre) naves.push({ id: n.id, nombre: n.nombre });
          });
        });
        setDbNaves(naves);
      }

      if (vacRes.ok) {
        const vacData = await vacRes.json();
        const vacList = Array.isArray(vacData) ? vacData : vacData.data || [];
        setRawVacantesData(vacList);
        const vacNames = vacList.flatMap((r: any) => (r.vacantes || []).map((v: any) => v.nombre || v.name)).filter(Boolean);
        setDbVacantes(vacNames);
      }
    } catch (err) {
      console.error(err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = "Expedientes | Grupo Virgo";
    loadData();
  }, [loadData]);

  // Re-cargar (sin recargar la página) cuando el usuario cambia de empresa/nave en el TopNavbar
  useTenantChange(loadData);

  // Actualización automática en segundo plano: refresca candidatos/mensajes
  // cada 20s sin mostrar el spinner de carga completo (silent=true), para no
  // perder el scroll ni los filtros que el usuario ya tenía puestos.
  useEffect(() => {
    const interval = setInterval(() => loadData(true), 20000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Abrir perfil directamente si llega ?tel=
  useEffect(() => {
    if (telParam && !appliedTelRef.current && candidatos.length > 0) {
      const match = candidatos.find((c) => c.telefono === telParam);
      if (match) {
        setSelectedCandidate(match);
        appliedTelRef.current = true;
      }
    }
  }, [telParam, candidatos]);

  // Actualización de estado
  const updateStatus = async (telefono: string, newStatus: string) => {
    try {
      const storedEmpresaId = localStorage.getItem("tci_empresa_id");
      const storedNaveId = localStorage.getItem("tci_nave_id");
      let query = "";
      if (storedEmpresaId) query += `?empresa_id=${storedEmpresaId}`;
      if (storedNaveId) query += (query ? `&` : `?`) + `nave_id=${storedNaveId}`;

      const res = await fetch(`/api/db/candidato${query}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono, estado: newStatus }),
      });
      if (res.ok) {
        setCandidatos((prev) => prev.map((c) => (c.telefono === telefono ? { ...c, estado: newStatus } : c)));
        if (selectedCandidate?.telefono === telefono) {
          setSelectedCandidate((prev) => (prev ? { ...prev, estado: newStatus } : null));
        }
      }
    } catch (e) {
      console.error("Error updating status", e);
    }
  };

  const goToChat = (telefono: string) => {
    router.push(`/mensajes?tel=${telefono}`);
  };

  // Helper de normalización
  const normalizeStr = (str: string) =>
    String(str || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/_/g, " ")
      .trim();

  // ─── FILTRADO POR ROL / GRUPO DEL RECLUTADOR ─────────────────────
  const userRole = typeof window !== "undefined" ? localStorage.getItem("tci_role") || "USER" : "USER";
  const myRecruiterId = typeof window !== "undefined" ? localStorage.getItem("tci_reclutador_id") : null;

  const allowedNaveIds = useMemo(() => {
    if (typeof window === "undefined") return null;
    if (userRole === "ADMIN" || userRole === "ROOT") return null; // Acceso total

    let navesAsignadas: string[] = [];
    try {
      navesAsignadas = JSON.parse(localStorage.getItem("tci_naves_asignadas") || "[]");
    } catch { }

    return new Set(navesAsignadas);
  }, [userRole]);

  // Naves permitidas para el grupo/reclutador actual
  const scopedNaves = useMemo(() => {
    if (!allowedNaveIds) return dbNaves;
    if (allowedNaveIds.size === 0) return dbNaves;
    return dbNaves.filter((n) => allowedNaveIds.has(n.id));
  }, [dbNaves, allowedNaveIds]);

  // Vacantes permitidas para el grupo/reclutador actual
  const scopedVacantes = useMemo(() => {
    if (!allowedNaveIds && !myRecruiterId) return dbVacantes;
    if (userRole === "ADMIN" || userRole === "ROOT") return dbVacantes;

    return rawVacantesData
      .filter((r: any) => {
        const isMyRecruiter = myRecruiterId && r.reclutador_id === myRecruiterId;
        const isMyNave = allowedNaveIds && (r.vacantes || []).some((v: any) => (v.naves || []).some((navId: string) => allowedNaveIds.has(navId)));
        return isMyRecruiter || isMyNave;
      })
      .flatMap((r: any) => (r.vacantes || []).map((v: any) => v.nombre || v.name))
      .filter(Boolean);
  }, [dbVacantes, rawVacantesData, allowedNaveIds, myRecruiterId, userRole]);

  // ─── UNIQUE LISTS PARA FILTROS ─────────────────────────────────
  const isPlaceholderVal = (val?: string | null) => {
    if (!val) return true;
    const norm = val.trim().toLowerCase().replace(/[{}]/g, "");
    return !norm || norm === "ninguna" || norm === "general" || norm === "pendiente" || norm === "sin sucursal";
  };

  const uniqueVacantes = useMemo(() => {
    const fromCand = candidatos
      .map((c) => c.vacante_interes?.trim())
      .filter((v): v is string => Boolean(v) && !isPlaceholderVal(v));
    const fromScoped = scopedVacantes.filter((v) => !isPlaceholderVal(v));
    const combined = Array.from(new Set([...fromScoped, ...fromCand]));
    return combined.sort((a, b) => a.localeCompare(b));
  }, [candidatos, scopedVacantes]);

  const uniqueNaves = useMemo(() => {
    const fromCand = candidatos
      .map((c) => c.nave_interes?.trim())
      .filter((n): n is string => Boolean(n) && !isPlaceholderVal(n));
    const fromDb = scopedNaves.map((n) => n.nombre).filter((n) => !isPlaceholderVal(n));
    const combined = Array.from(new Set([...fromDb, ...fromCand]));
    return combined.sort((a, b) => a.localeCompare(b));
  }, [candidatos, scopedNaves]);

  // ─── TABLA FILTRADA ───────────────────────────────────────
  const filteredTable = useMemo(() => {
    const normSearch = normalizeStr(searchTerm);
    const normStatus = normalizeStr(statusFilter);
    const normVacante = normalizeStr(vacanteFilter);
    const normNave = normalizeStr(naveFilter);

    return candidatos
      .filter((c) => {
        const nombre = normalizeStr(getNombre(c));
        const tel = (c.telefono || "").replace(/\D/g, "");
        const matchSearch = !normSearch || nombre.includes(normSearch) || tel.includes(normSearch);

        const candStatus = normalizeStr(c.estado || "NUEVO");
        const matchStatus = statusFilter === "TODOS" || candStatus === normStatus;

        const candVacante = normalizeStr(c.vacante_interes || "");
        const isVacanteSinSeleccionar = !candVacante || candVacante === "general" || candVacante === "ninguna" || candVacante === "pendiente";

        let matchVacante = false;
        if (vacanteFilter === "TODAS") {
          matchVacante = true;
        } else if (vacanteFilter === "SIN_SELECCIONAR") {
          matchVacante = isVacanteSinSeleccionar;
        } else {
          matchVacante = !isVacanteSinSeleccionar && (
            candVacante === normVacante ||
            candVacante.includes(normVacante) ||
            normVacante.includes(candVacante)
          );
        }

        const candNave = normalizeStr(c.nave_interes || "");
        const isNaveSinSeleccionar = !candNave || candNave === "pendiente" || candNave === "sin sucursal";

        let matchNave = false;
        if (naveFilter === "TODAS") {
          matchNave = true;
        } else if (naveFilter === "SIN_SELECCIONAR") {
          matchNave = isNaveSinSeleccionar;
        } else {
          matchNave = !isNaveSinSeleccionar && (
            candNave === normNave ||
            candNave.includes(normNave) ||
            normNave.includes(candNave)
          );
        }

        // Control de permisos por Grupo/Reclutador
        if (allowedNaveIds && allowedNaveIds.size > 0 && userRole !== "ADMIN" && userRole !== "ROOT") {
          const candNaveId = (c as any).nave_id || "";
          const isUnassigned = !candNaveId && isNaveSinSeleccionar && isVacanteSinSeleccionar;
          const isMyNaveId = candNaveId && allowedNaveIds.has(candNaveId);
          const isMyNaveName =
            candNave &&
            scopedNaves.some(
              (n) => normalizeStr(n.nombre).includes(candNave) || candNave.includes(normalizeStr(n.nombre))
            );
          const isMyVacante =
            candVacante &&
            scopedVacantes.some(
              (v) => normalizeStr(v).includes(candVacante) || candVacante.includes(normalizeStr(v))
            );
          if (!isUnassigned && !isMyNaveId && !isMyNaveName && !isMyVacante) return false;
        }

        return matchSearch && matchStatus && matchVacante && matchNave;
      })
      .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
  }, [candidatos, searchTerm, statusFilter, vacanteFilter, naveFilter, allowedNaveIds, userRole, scopedNaves, scopedVacantes]);

  // ─── KANBAN ───────────────────────────────────────────────
  const kanbanData = useMemo(() => {
    const map: Record<string, Candidato[]> = {};
    KANBAN_COLUMNAS.forEach(col => { map[col.key] = []; });
    filteredTable.forEach(c => {
      const st = (c.estado || "NUEVO") as EstadoKey;
      const col = KANBAN_COLUMNAS.find(col => col.estados.includes(st));
      if (col) map[col.key].push(c);
    });
    return map;
  }, [filteredTable]);

  // ─── ALERTS ───────────────────────────────────────────────
  const pendingChats = useMemo(() => {
    return mensajes.filter(m => m.mensajes_no_leidos > 0);
  }, [mensajes]);

  const todayInterviews = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return candidatos.filter(c => c.fecha_entrevista && c.fecha_entrevista.startsWith(today));
  }, [candidatos]);

  return (
    <div className="flex flex-col h-full bg-[#f8fafc] text-slate-800">
      {/* ─── HEADER ─── */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 z-10 shadow-sm relative">
        <h1 className="text-2xl font-extrabold text-slate-800">Expedientes Operativos</h1>
      </div>

      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
          <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4" />
          <p className="font-medium animate-pulse">Cargando expedientes...</p>
        </div>
      ) : (
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-[1600px] mx-auto space-y-6">

            {/* PANEL DE ALERTAS */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-rose-50 border border-rose-200 p-5 rounded-2xl flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-white text-rose-600 rounded-xl shadow-sm"><MessageSquare size={24} /></div>
                  <div>
                    <div className="text-xs text-rose-800 font-bold uppercase tracking-wider">Chats Pendientes</div>
                    <div className="text-3xl font-extrabold text-rose-600">{pendingChats.length}</div>
                  </div>
                </div>
                {pendingChats.length > 0 && (
                  <button onClick={() => router.push('/mensajes')} className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg text-sm shadow-sm transition-colors">
                    Ir a Bandeja →
                  </button>
                )}
              </div>

              <div className="bg-amber-50 border border-amber-200 p-5 rounded-2xl flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-white text-amber-600 rounded-xl shadow-sm"><CalendarDays size={24} /></div>
                  <div>
                    <div className="text-xs text-amber-800 font-bold uppercase tracking-wider">Entrevistas para Hoy</div>
                    <div className="text-3xl font-extrabold text-amber-600">{todayInterviews.length}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* CONTROLES Y FILTROS */}
            <div className="bg-white p-5 rounded-2xl border border-black/5 shadow-sm flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
              <div className="flex bg-slate-100 p-1 rounded-lg gap-1 border border-slate-200">
                <button onClick={() => setVista("kanban")} className={`flex items-center gap-2 px-4 py-2 rounded-md font-bold text-sm transition-all ${vista === "kanban" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                  <LayoutGrid size={16} /> Tablero
                </button>
                <button onClick={() => setVista("tabla")} className={`flex items-center gap-2 px-4 py-2 rounded-md font-bold text-sm transition-all ${vista === "tabla" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                  <List size={16} /> Directorio
                </button>
              </div>
              <div className="flex gap-2 w-full xl:w-auto flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                  <input id="expedientes-search" name="search" type="text" placeholder="Buscar por nombre o teléfono..." className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-indigo-500 focus:bg-white transition-colors" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                </div>
                <select id="expedientes-nave-filter" name="nave_filter" className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer min-w-[140px]" value={naveFilter} onChange={e => setNaveFilter(e.target.value)}>
                  <option value="TODAS">Todas las Naves</option>
                  <option value="SIN_SELECCIONAR">SIN NAVE</option>
                  {uniqueNaves.map(n => <option key={String(n)} value={String(n)}>{n}</option>)}
                </select>
                <select id="expedientes-vacante-filter" name="vacante_filter" className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer min-w-[140px]" value={vacanteFilter} onChange={e => setVacanteFilter(e.target.value)}>
                  <option value="TODAS">Todas las Vacantes</option>
                  <option value="SIN_SELECCIONAR">SIN VACANTE</option>
                  {uniqueVacantes.map(v => <option key={String(v)} value={String(v)}>{v}</option>)}
                </select>
                <select id="expedientes-status-filter" name="status_filter" className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer min-w-[140px]" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                  <option value="TODOS">Todos los estados</option>
                  <optgroup label="── En Proceso ──">
                    {GRUPOS.pipeline.estados.map((k: EstadoKey) => <option key={k} value={k}>{ESTADOS[k].emoji} {ESTADOS[k].label}</option>)}
                  </optgroup>
                  <optgroup label="── Requieren Atención ──">
                    {GRUPOS.alerta.estados.map((k: EstadoKey) => <option key={k} value={k}>{ESTADOS[k].emoji} {ESTADOS[k].label}</option>)}
                  </optgroup>
                  <optgroup label="── Completados ──">
                    {GRUPOS.exitoso.estados.map((k: EstadoKey) => <option key={k} value={k}>{ESTADOS[k].emoji} {ESTADOS[k].label}</option>)}
                  </optgroup>
                  <optgroup label="── Pool / Rechazados ──">
                    {GRUPOS.pool.estados.map((k: EstadoKey) => <option key={k} value={k}>{ESTADOS[k].emoji} {ESTADOS[k].label}</option>)}
                    {GRUPOS.descartado.estados.map((k: EstadoKey) => <option key={k} value={k}>{ESTADOS[k].emoji} {ESTADOS[k].label}</option>)}
                  </optgroup>
                </select>
              </div>
            </div>

            {/* VISTAS */}
            {vista === "tabla" ? (
              <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden animate-fade-in">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-slate-50/80 border-b border-black/5 text-slate-600">
                      <tr>
                        <th className="p-4 font-bold">Candidato</th>
                        <th className="p-4 font-bold">Teléfono</th>
                        <th className="p-4 font-bold">Vacante / Nave</th>
                        <th className="p-4 font-bold">Docs</th>
                        <th className="p-4 font-bold">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTable.length === 0 ? (
                        <tr><td colSpan={5} className="p-10 text-center text-slate-400">No hay candidatos con esos filtros.</td></tr>
                      ) : (
                        filteredTable.map((cand, idx) => {
                          const needsReview = cand.alerta_identidad_estado === 'PENDIENTE' || cand.estado === 'DOCUMENTOS_NO_COINCIDEN' || (cand.resumen_ia && cand.resumen_ia.toLowerCase().includes('revisión'));
                          return (
                            <tr key={cand.telefono + idx} onClick={() => setSelectedCandidate(cand)} className={`border-b border-slate-50 hover:bg-indigo-50/50 cursor-pointer transition-colors group ${needsReview ? 'bg-amber-50/40' : ''}`}>
                              <td className="p-4">
                                <div className="flex items-center gap-2">
                                  <div className="font-bold text-slate-800 group-hover:text-indigo-700">{getNombre(cand)}</div>
                                  {needsReview && (
                                    <span className="bg-amber-500 text-white font-extrabold text-[9px] px-1.5 py-0.5 rounded shadow-2xs animate-pulse">
                                      🚩 REVISAR
                                    </span>
                                  )}
                                </div>
                                {cand.fecha_entrevista && (
                                  <div className="text-xs text-amber-600 mt-0.5 font-semibold">
                                    📅 {new Date(cand.fecha_entrevista).toLocaleString("es-MX", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                  </div>
                                )}
                              </td>
                            <td className="p-4 font-mono text-xs text-slate-500">{cand.telefono}</td>
                            <td className="p-4">
                              <div className="font-semibold text-slate-700 text-xs">{cand.vacante_interes || "—"}</div>
                              <div className="text-xs text-slate-400">{formatNaveName(cand.nave_interes) || "—"}</div>
                            </td>
                            <td className="p-4">
                              <div className="flex gap-1.5 items-center">
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 ${(cand.tiene_cv || !!cand.cv_manual || !!cand.link_cv) ? "bg-cyan-50 text-cyan-700" : "bg-slate-50 text-slate-400"}`}>📄 CV</span>
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 ${!!cand.datos_ine ? "bg-violet-50 text-violet-700" : "bg-slate-50 text-slate-400"}`}>🪪 INE</span>
                              </div>
                            </td>
                            <td className="p-4">
                              <EstadoBadge estado={cand.estado || "NUEVO"} />
                            </td>
                          </tr>
                        );
                      })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="flex gap-4 overflow-x-auto pb-4 custom-scrollbar animate-fade-in items-start h-[calc(100vh-320px)] min-h-[500px]">
                {KANBAN_COLUMNAS.map(col => {
                  const cards = kanbanData[col.key] || [];
                  if (cards.length === 0 && col.key === "pool") return null; // Hide empty pool
                  return (
                    <div key={col.key} className="w-[300px] flex-shrink-0 flex flex-col h-full">
                      <div className={`bg-white rounded-2xl border-t-4 ${col.color} border border-slate-100 shadow-sm overflow-hidden flex flex-col max-h-full`}>
                        <div className="p-3 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center shrink-0">
                          <div className="font-bold text-slate-700 text-sm">{col.label}</div>
                          <div className="text-xs text-slate-500 font-bold bg-white px-2 py-0.5 border border-slate-200 rounded-full shadow-sm">{cards.length}</div>
                        </div>
                        <div className="p-2 space-y-2 overflow-y-auto flex-1 bg-slate-50/30">
                          {cards.length === 0 ? (
                            <div className="text-center text-slate-300 py-6 text-xs font-semibold">Columna vacía</div>
                          ) : (
                            cards.map((cand, i) => (
                              <KanbanCard key={cand.telefono + i} cand={cand} onClick={() => setSelectedCandidate(cand)} onStatusChange={updateStatus} />
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* EXPEDIENTE MODAL */}
            {selectedCandidate && (
              <CandidateModal
                candidato={selectedCandidate}
                onClose={() => setSelectedCandidate(null)}
                onStatusChange={updateStatus}
                onGoToChat={goToChat}
              />
            )}
          </div>
        </main>
      )}
    </div>
  );
}

// ─── EXPORT CON SUSPENSE (requerido por useSearchParams) ───
export default function ExpedientesPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen text-slate-500">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <ExpedientesPageInner />
    </Suspense>
  );
}
