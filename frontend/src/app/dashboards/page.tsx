"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line,
  AreaChart, Area,
  RadialBarChart, RadialBar, PolarAngleAxis,
} from "recharts";
import {
  Users, UserCheck, TrendingUp,
  Trophy, MessageSquare, Briefcase, Activity, Building2, Clock, Bot,
  X, Search, ChevronRight, User, ExternalLink, Calendar, Filter,
  Maximize2, Minimize2, Sparkles, ArrowUpRight, CalendarDays
} from "lucide-react";
import { ESTADOS, getEstado, getEstadoColor, type EstadoKey } from "@/lib/estados";
import type { Candidato } from "@/types";
import { CandidateModal } from "@/components/CandidateModal";
import { useTenantChange } from "@/hooks/useTenant";
import { formatNaveName, getCandidateDisplayName } from "@/lib/formatters";

const CHART_COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#f59e0b", "#10b981", "#0ea5e9"];

type NaveInfo = { id: string; nombre: string; created_at: string };
type HoraActividad = { dia_semana: number; hora: number; total: number };

export type TimeRange = "1d" | "7d" | "1m" | "6m" | "1y";

export interface TimelinePoint {
  key: string;
  label: string;
  fullDate: string;
  count: number;
}

export interface TimelineMetrics {
  total: number;
  promedio: number;
  max: { label: string; count: number; fullDate: string };
}

const DIAS_SEMANA = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const DIAS_SEMANA_COMPLETO = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MESES_COMPLETO = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function buildCandidatosTimeline(candidatos: Candidato[], range: TimeRange): { points: TimelinePoint[]; metrics: TimelineMetrics } {
  const now = new Date();
  const points: TimelinePoint[] = [];
  const counts = new Map<string, number>();

  const getCandidateDate = (c: Candidato): Date | null => {
    const raw = c.created_at || c.ultima_interaccion || c.updated_at;
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  };

  if (range === "1d") {
    for (let h = 0; h < 24; h++) {
      
      const key = String(h).padStart(2, "0") + ":00";
      counts.set(key, 0);
      points.push({ key, label: key, fullDate: `${key} hrs`, count: 0 });
    }
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    candidatos.forEach((c) => {
      const d = getCandidateDate(c);
      if (d && d >= cutoff) {
        const key = String(d.getHours()).padStart(2, "0") + ":00";
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    });
  } else if (range === "7d") {
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const iso = d.toISOString().split("T")[0];
      const label = `${DIAS_SEMANA[d.getDay()]} ${d.getDate()}`;
      counts.set(iso, 0);
      points.push({ key: iso, label, fullDate: `${DIAS_SEMANA_COMPLETO[d.getDay()]} ${d.getDate()} de ${MESES_COMPLETO[d.getMonth()]}`, count: 0 });
    }
    const cutoff = new Date(now);
    cutoff.setDate(now.getDate() - 6);
    cutoff.setHours(0, 0, 0, 0);
    candidatos.forEach((c) => {
      const d = getCandidateDate(c);
      if (d && d >= cutoff) {
        const iso = d.toISOString().split("T")[0];
        if (counts.has(iso)) counts.set(iso, (counts.get(iso) || 0) + 1);
      }
    });
  } else if (range === "1m") {
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const iso = d.toISOString().split("T")[0];
      const label = `${d.getDate()} ${MESES[d.getMonth()]}`;
      counts.set(iso, 0);
      points.push({ key: iso, label, fullDate: `${d.getDate()} de ${MESES_COMPLETO[d.getMonth()]} ${d.getFullYear()}`, count: 0 });
    }
    const cutoff = new Date(now);
    cutoff.setDate(now.getDate() - 29);
    cutoff.setHours(0, 0, 0, 0);
    candidatos.forEach((c) => {
      const d = getCandidateDate(c);
      if (d && d >= cutoff) {
        const iso = d.toISOString().split("T")[0];
        if (counts.has(iso)) counts.set(iso, (counts.get(iso) || 0) + 1);
      }
    });
  } else if (range === "6m") {
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = `${MESES[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`;
      counts.set(key, 0);
      points.push({ key, label, fullDate: `${MESES_COMPLETO[d.getMonth()]} ${d.getFullYear()}`, count: 0 });
    }
    const cutoff = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    candidatos.forEach((c) => {
      const d = getCandidateDate(c);
      if (d && d >= cutoff) {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (counts.has(key)) counts.set(key, (counts.get(key) || 0) + 1);
      }
    });
  } else if (range === "1y") {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = `${MESES[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`;
      counts.set(key, 0);
      points.push({ key, label, fullDate: `${MESES_COMPLETO[d.getMonth()]} ${d.getFullYear()}`, count: 0 });
    }
    const cutoff = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    candidatos.forEach((c) => {
      const d = getCandidateDate(c);
      if (d && d >= cutoff) {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (counts.has(key)) counts.set(key, (counts.get(key) || 0) + 1);
      }
    });
  }

  points.forEach((p) => { p.count = counts.get(p.key) || 0; });
  const total = points.reduce((acc, p) => acc + p.count, 0);
  const promedio = points.length > 0 ? Math.round((total / points.length) * 10) / 10 : 0;
  const max = points.reduce((prev, curr) => (curr.count > prev.count ? curr : prev), { label: "N/A", count: 0, fullDate: "Sin datos" });

  return { points, metrics: { total, promedio, max } };
}

export default function DashboardsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"ejecutivo" | "ia">("ejecutivo");
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [mensajes, setMensajes] = useState<any[]>([]);
  const [naveNombrePorNumero, setNaveNombrePorNumero] = useState<Record<string, string>>({});
  const [actividadHoraria, setActividadHoraria] = useState<HoraActividad[]>([]);
  const [loading, setLoading] = useState(true);

  const [timeRange, setTimeRange] = useState<TimeRange>("1m");
  const [isTimelineExpanded, setIsTimelineExpanded] = useState(false);
  const isBackdropMouseDown = useRef(false);

  // Drill-down interactivo al hacer clic en estados
  const [selectedEstadoModal, setSelectedEstadoModal] = useState<string | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidato | null>(null);
  const [modalSearch, setModalSearch] = useState<string>("");


  const loadData = useCallback(async () => {
    setLoading(true);
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

      let queryActividad = storedEmpresaId ? `?empresa_id=${storedEmpresaId}` : "";
      if (storedGrupoId) queryActividad += (queryActividad ? `&` : `?`) + `grupo_id=${storedGrupoId}`;

      const [candRes, msgsRes, empresasRes, actividadRes] = await Promise.all([
        fetch(`/api/db/candidatos?limit=2000${queryCand}`),
        fetch(`/api/db/mensajes${queryMensajes}`),
        fetch(`/api/db/empresas`),
        fetch(`/api/db/actividad-horaria${queryActividad}`),
      ]);
      const candData = await candRes.json();
      const msgsData = await msgsRes.json();
      const empresasData = await empresasRes.json();
      const actividadData = await actividadRes.json();
      setCandidatos(Array.isArray(candData) ? candData : []);
      setMensajes(Array.isArray(msgsData) ? msgsData : []);
      setActividadHoraria(Array.isArray(actividadData) ? actividadData : []);

      // candidatos.nave_interes guarda el numero secuencial de la sucursal (por
      // orden de creacion dentro de su empresa, "1", "2"...), no el nombre — se
      // resuelve aqui con el mismo orden que usa /api/prompt-context para la IA.
      const empresas = Array.isArray(empresasData?.empresas) ? empresasData.empresas : [];
      const empresaMatch = storedEmpresaId
        ? empresas.find((e: { id: string }) => e.id === storedEmpresaId)
        : (empresas.length === 1 ? empresas[0] : null);
      const navesOrdenadas: NaveInfo[] = empresaMatch?.naves || [];
      const mapa: Record<string, string> = {};
      navesOrdenadas.forEach((n, i) => { mapa[String(i + 1)] = n.nombre; });
      setNaveNombrePorNumero(mapa);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = "Dashboards | Grupo Virgo";
    const cargar = async () => { await loadData(); };
    cargar();
  }, [loadData]);

  // Re-cargar actividad horaria cuando cambia el filtro de tiempo
  useEffect(() => {
    const fetchActividad = async () => {
      try {
        const storedEmpresaId = localStorage.getItem("tci_empresa_id");
        const storedGrupoId = localStorage.getItem("tci_grupo_id");
        let queryActividad = storedEmpresaId ? `?empresa_id=${storedEmpresaId}` : "";
        if (storedGrupoId) queryActividad += (queryActividad ? `&` : `?`) + `grupo_id=${storedGrupoId}`;
        queryActividad += (queryActividad ? `&` : `?`) + `time_range=${timeRange}`;
        const res = await fetch(`/api/db/actividad-horaria${queryActividad}`);
        const data = await res.json();
        setActividadHoraria(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error(e);
      }
    };
    fetchActividad();
  }, [timeRange]);

  // Re-cargar (sin recargar la página) cuando el usuario cambia de empresa/nave en el TopNavbar
  useTenantChange(loadData);


  // ─── EJECUTIVO KPI CALCS ─────────────────────────────────────
  const kpis = useMemo(() => {
    const total = candidatos.length;
    let contratados = 0;
    let nuevos = 0;
    const chatsActivos = mensajes.length;

    const vacanteCounts: Record<string, number> = {};
    const estadosCounts: Record<string, number> = {};

    candidatos.forEach(c => {
      const st = (c.estado || "NUEVO") as EstadoKey;
      if (st === "NUEVO") nuevos++;
      if (st === "CONTRATADO") contratados++;

      // Vacantes
      if (st === "CONTRATADO") {
        const v = c.vacante_interes || "General";
        vacanteCounts[v] = (vacanteCounts[v] || 0) + 1;
      }

      // Conteo de todos los estados existentes
      estadosCounts[st] = (estadosCounts[st] || 0) + 1;
    });

    // Barras Contratacion
    const barrasVacante = Object.entries(vacanteCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Donut Estados (con semaforización fija por estado)
    const donutEstados = Object.entries(estadosCounts)
      .map(([key, value]) => ({
        key,
        name: ESTADOS[key as EstadoKey]?.label || key,
        value,
        color: getEstadoColor(key),
      }))
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value);

    // Embudo de Reclutamiento (Flujo de conversión con todos los pasos del pipeline)
    const funnelSteps: EstadoKey[] = [
      "NUEVO",
      "INTERESADO",
      "CV_RECIBIDO",
      "FILTROS_COMPLETADOS",
      "INE_VALIDADA",
      "CITA_AGENDADA",
      "RECORDATORIO_ENVIADO",
      "ENTREVISTADO",
      "CONTRATADO",
    ];

    const funnel = funnelSteps.map(step => ({
      key: step,
      name: ESTADOS[step]?.label || step,
      shortName: ESTADOS[step]?.labelCorto || step,
      count: estadosCounts[step] || 0,
      color: getEstadoColor(step),
    }));

    return { total, contratados, nuevos, chatsActivos, barrasVacante, donutEstados, funnel };
  }, [candidatos, mensajes]);

  // ─── ACCIONES DE CANDIDATO Y MODAL ───────────────────────────
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

  const filteredModalCandidatos = useMemo(() => {
    if (!selectedEstadoModal) return [];
    let list = candidatos.filter(c => (c.estado || "NUEVO") === selectedEstadoModal);
    if (modalSearch.trim()) {
      const q = modalSearch.toLowerCase().trim();
      list = list.filter(c => {
        const name = getCandidateDisplayName(c).toLowerCase();
        const tel = (c.telefono || "").toLowerCase();
        const vac = (c.vacante_interes || "").toLowerCase();
        const rec = (c.asignado_a_nombre || "").toLowerCase();
        return name.includes(q) || tel.includes(q) || vac.includes(q) || rec.includes(q);
      });
    }
    return list;
  }, [candidatos, selectedEstadoModal, modalSearch]);

  // ─── RENDIMIENTO POR RECLUTADOR ───────────────────────────────
  // Candidatos asignados/contratados por reclutador (no volumen de chats):
  // mide a quién se le está asignando trabajo y quién efectivamente contrata.
  const reclutadorPerf = useMemo(() => {
    const counts: Record<string, { asignados: number; contratados: number }> = {};
    candidatos.forEach(c => {
      const nombre = c.asignado_a_nombre;
      if (!nombre) return;
      if (!counts[nombre]) counts[nombre] = { asignados: 0, contratados: 0 };
      counts[nombre].asignados++;
      if (c.estado === "CONTRATADO") counts[nombre].contratados++;
    });
    return Object.entries(counts)
      .map(([nombre, v]) => ({
        nombre,
        asignados: v.asignados,
        contratados: v.contratados,
        tasaConversion: v.asignados > 0 ? Math.round((v.contratados / v.asignados) * 100) : 0,
      }))
      .sort((a, b) => b.contratados - a.contratados || b.asignados - a.asignados);
  }, [candidatos]);

  // ─── DISTRIBUCIÓN POR NAVE ─────────────────────────────────────
  const naveDist = useMemo(() => {
    const counts: Record<string, number> = {};
    candidatos.forEach(c => {
      const raw = (c.nave_interes || "").trim();
      let nombre = "Sin sucursal";
      if (raw && raw !== "Pendiente") {
        const resolved = naveNombrePorNumero[raw] || raw;
        nombre = formatNaveName(resolved);
      }
      counts[nombre] = (counts[nombre] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [candidatos, naveNombrePorNumero]);

  // ─── AUTOMATIZACIÓN DE SOFÍA ────────────────────────────────────
  // % de candidatos que Sofía atendió de principio a fin sin escalar a un humano.
  const automatizacion = useMemo(() => {
    const total = candidatos.length;
    const escalados = candidatos.filter(c => c.escalado).length;
    const pct = total > 0 ? Math.round(((total - escalados) / total) * 100) : 0;
    return { pct, total, escalados, sinEscalar: total - escalados };
  }, [candidatos]);

  // ─── CONVERSIÓN POR VACANTE ─────────────────────────────────────
  const conversionPorVacante = useMemo(() => {
    const counts: Record<string, { total: number; contratados: number; rechazados: number }> = {};
    candidatos.forEach(c => {
      const v = c.vacante_interes || "General";
      if (!counts[v]) counts[v] = { total: 0, contratados: 0, rechazados: 0 };
      counts[v].total++;
      if (c.estado === "CONTRATADO") counts[v].contratados++;
      if (c.estado === "RECHAZADO") counts[v].rechazados++;
    });
    return Object.entries(counts)
      .map(([vacante, v]) => ({
        vacante,
        total: v.total,
        contratados: v.contratados,
        rechazados: v.rechazados,
        tasaConversion: v.total > 0 ? Math.round((v.contratados / v.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [candidatos]);

  // ─── HORAS CON MAYOR ACTIVIDAD (heatmap) ────────────────────────
  const heatmap = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    let max = 0;
    let peakDia = 0;
    let peakHora = 0;
    let totalMsgs = 0;

    actividadHoraria.forEach(({ dia_semana, hora, total }) => {
      if (dia_semana >= 0 && dia_semana < 7 && hora >= 0 && hora < 24) {
        grid[dia_semana][hora] = total;
        totalMsgs += total;
        if (total > max) {
          max = total;
          peakDia = dia_semana;
          peakHora = hora;
        }
      }
    });

    return { grid, max, peakDia, peakHora, totalMsgs };
  }, [actividadHoraria]);

  // ─── LÍNEA DE TIEMPO INTERACTIVA Y ESCALABLE ────────────────────
  const { points: timelineData, metrics: timelineMetrics } = useMemo(() => {
    return buildCandidatosTimeline(candidatos, timeRange);
  }, [candidatos, timeRange]);

  return (
    <div className="flex flex-col h-full bg-[#f8fafc] text-slate-800">
      {/* ─── TABS NAV ─── */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 z-10 shadow-sm relative">
        <h1 className="text-2xl font-extrabold text-slate-800">Dashboards</h1>
        <div className="flex bg-slate-100 p-1 rounded-lg gap-1 border border-slate-200">
          <button
            onClick={() => setActiveTab("ejecutivo")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md font-bold text-sm transition-all ${activeTab === "ejecutivo" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            <Activity size={16} /> Ejecutivo
          </button>
          <button
            onClick={() => setActiveTab("ia")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md font-bold text-sm transition-all ${activeTab === "ia" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            🤖 IA Sofía
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
          <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4" />
          <p className="font-medium animate-pulse">Sincronizando datos...</p>
        </div>
      ) : (
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-screen-2xl mx-auto space-y-6">

            {activeTab === "ejecutivo" && (
              <div className="animate-fade-in space-y-6">
                {/* KPI CARDS */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white p-5 rounded-2xl border border-black/5 shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl"><Users size={24} /></div>
                    <div>
                      <div className="text-xs text-slate-500 font-bold uppercase tracking-wider">Candidatos Totales</div>
                      <div className="text-3xl font-extrabold text-slate-800">{kpis.total}</div>
                    </div>
                  </div>
                  <div className="bg-white p-5 rounded-2xl border border-black/5 shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl"><Trophy size={24} /></div>
                    <div>
                      <div className="text-xs text-slate-500 font-bold uppercase tracking-wider">Contratados</div>
                      <div className="text-3xl font-extrabold text-slate-800">{kpis.contratados}</div>
                    </div>
                  </div>
                  <div className="bg-white p-5 rounded-2xl border border-black/5 shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-amber-50 text-amber-600 rounded-xl"><UserCheck size={24} /></div>
                    <div>
                      <div className="text-xs text-slate-500 font-bold uppercase tracking-wider">Nuevos (Hoy)</div>
                      <div className="text-3xl font-extrabold text-slate-800">{kpis.nuevos}</div>
                    </div>
                  </div>
                  <div className="bg-white p-5 rounded-2xl border border-black/5 shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-rose-50 text-rose-600 rounded-xl"><MessageSquare size={24} /></div>
                    <div>
                      <div className="text-xs text-slate-500 font-bold uppercase tracking-wider">Chats Activos</div>
                      <div className="text-3xl font-extrabold text-slate-800">{kpis.chatsActivos}</div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* FUNNEL */}
                  <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-sm lg:col-span-2">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-base font-bold text-slate-700 flex items-center gap-2">
                          <TrendingUp size={18} className="text-indigo-500" /> Embudo de Reclutamiento
                        </h3>
                        <p className="text-xs text-slate-400 mt-0.5">Haz clic en una etapa para ver sus candidatos</p>
                      </div>
                      <span className="text-[11px] text-indigo-600 bg-indigo-50 border border-indigo-100/80 px-2.5 py-1 rounded-full font-bold flex items-center gap-1">
                        👆 Clic para listar
                      </span>
                    </div>
                    <div className="h-80 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={kpis.funnel}
                          layout="vertical"
                          margin={{ top: 0, right: 35, left: 35, bottom: 0 }}
                          onClick={(state: any) => {
                            const k = state?.activePayload?.[0]?.payload?.key;
                            if (k) {
                              setSelectedEstadoModal(String(k));
                              setModalSearch("");
                            }
                          }}
                        >
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                          <XAxis type="number" hide />
                          <YAxis dataKey="name" type="category" width={145} tick={{ fill: "#475569", fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false} />
                          <Tooltip
                            contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }}
                            cursor={{ fill: '#f8fafc' }}
                            formatter={(value: any) => [`${value} candidatos (clic para ver)`, "Candidatos"]}
                          />
                          <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={18} label={{ position: 'right', fill: '#64748b', fontWeight: 'bold', fontSize: 11 }}>
                            {kpis.funnel.map((entry, i) => (
                              <Cell
                                key={`funnel-${entry.key || i}`}
                                fill={entry.color}
                                cursor="pointer"
                                className="transition-all hover:opacity-80"
                                onClick={() => {
                                  setSelectedEstadoModal(String(entry.key));
                                  setModalSearch("");
                                }}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* DONUT */}
                  <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <h3 className="text-base font-bold text-slate-700">Distribución de Estados</h3>
                        <p className="text-xs text-slate-400">{kpis.total} en total</p>
                      </div>
                      <span className="text-[11px] text-indigo-600 bg-indigo-50 border border-indigo-100/80 px-2.5 py-1 rounded-full font-bold flex items-center gap-1">
                        👆 Clic para listar
                      </span>
                    </div>
                    <div className="h-80 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={kpis.donutEstados}
                            cx="50%"
                            cy="45%"
                            innerRadius={55}
                            outerRadius={95}
                            paddingAngle={2}
                            dataKey="value"
                            stroke="none"
                            cursor="pointer"
                            onClick={(data: any) => {
                              if (data && data.key) {
                                setSelectedEstadoModal(String(data.key));
                                setModalSearch("");
                              }
                            }}
                          >
                            {kpis.donutEstados.map((entry, i) => (
                              <Cell
                                key={`cell-${entry.key || i}`}
                                fill={entry.color}
                                cursor="pointer"
                                className="transition-all hover:opacity-80"
                                onClick={() => {
                                  setSelectedEstadoModal(String(entry.key));
                                  setModalSearch("");
                                }}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }}
                            formatter={(value: any, name: any) => [`${value} candidatos (clic para ver)`, name]}
                          />
                          <Legend
                            iconType="circle"
                            wrapperStyle={{ fontSize: "11px", paddingTop: "8px", cursor: "pointer" }}
                            onClick={(data: any) => {
                              const payloadKey = data?.payload?.key;
                              if (payloadKey) {
                                setSelectedEstadoModal(String(payloadKey));
                                setModalSearch("");
                              }
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* LINE / AREA CHART - CANDIDATOS EN EL TIEMPO */}
                  <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-sm lg:col-span-2 flex flex-col justify-between">
                    <div>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                        <div>
                          <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                            <Activity size={18} className="text-indigo-600" /> Candidatos en el Tiempo
                          </h3>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {timeRange === "1d" && "Actividad por hora en las últimas 24 horas"}
                            {timeRange === "7d" && "Registro diario de los últimos 7 días"}
                            {timeRange === "1m" && "Registro diario de los últimos 30 días"}
                            {timeRange === "6m" && "Registro mensual de los últimos 6 meses"}
                            {timeRange === "1y" && "Registro mensual del último año"}
                          </p>
                        </div>

                        {/* CONTROLES: FILTRO DE RANGO + EXPANDIR */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="inline-flex bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-semibold">
                            {(
                              [
                                { key: "1d", label: "1D", title: "Últimas 24 Horas" },
                                { key: "7d", label: "7D", title: "Última Semana" },
                                { key: "1m", label: "1M", title: "Último Mes" },
                                { key: "6m", label: "6M", title: "Últimos 6 Meses" },
                                { key: "1y", label: "1A", title: "Último Año" },
                              ] as const
                            ).map((tab) => (
                              <button
                                key={tab.key}
                                onClick={() => setTimeRange(tab.key)}
                                title={tab.title}
                                className={`px-2.5 py-1 rounded-lg transition-all ${
                                  timeRange === tab.key
                                    ? "bg-white text-indigo-600 shadow-xs font-bold"
                                    : "text-slate-500 hover:text-slate-800 hover:bg-slate-200/60"
                                }`}
                              >
                                {tab.label}
                              </button>
                            ))}
                          </div>

                          <button
                            onClick={() => setIsTimelineExpanded(true)}
                            title="Expandir gráfica a pantalla completa"
                            className="p-1.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 border border-slate-200 rounded-xl text-slate-600 transition-all flex items-center gap-1 text-xs font-semibold"
                          >
                            <Maximize2 size={15} />
                            <span className="hidden sm:inline">Expandir</span>
                          </button>
                        </div>
                      </div>

                      {/* STAT PILLS */}
                      <div className="grid grid-cols-3 gap-2 mb-4">
                        <div className="bg-slate-50 border border-slate-100 rounded-xl p-2.5">
                          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block">Total Período</span>
                          <span className="text-base font-extrabold text-slate-800">{timelineMetrics.total}</span>
                        </div>
                        <div className="bg-slate-50 border border-slate-100 rounded-xl p-2.5">
                          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block">Promedio</span>
                          <span className="text-base font-extrabold text-indigo-600">{timelineMetrics.promedio} <span className="text-[10px] text-slate-400 font-normal">/ intervalo</span></span>
                        </div>
                        <div className="bg-slate-50 border border-slate-100 rounded-xl p-2.5">
                          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block">Pico Máximo</span>
                          <span className="text-base font-extrabold text-emerald-600">{timelineMetrics.max.count} <span className="text-[10px] text-slate-400 font-normal truncate">({timelineMetrics.max.label})</span></span>
                        </div>
                      </div>
                    </div>

                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={timelineData} margin={{ top: 10, right: 15, left: -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorCandidatos" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                              <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                          <Tooltip
                            contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0", boxShadow: "0 10px 25px -5px rgba(0,0,0,0.1)", backgroundColor: "#ffffff" }}
                            formatter={(value: any) => [`${value} candidatos`, "Registros"]}
                            labelFormatter={(label: any, items: any) => {
                              const item = items?.[0]?.payload;
                              return item?.fullDate || label;
                            }}
                          />
                          <Area
                            type="monotone"
                            dataKey="count"
                            stroke="#6366f1"
                            strokeWidth={3}
                            fillOpacity={1}
                            fill="url(#colorCandidatos)"
                            dot={{ r: 3, fill: "#6366f1", strokeWidth: 1, stroke: "#ffffff" }}
                            activeDot={{ r: 6, fill: "#4f46e5", stroke: "#ffffff", strokeWidth: 2 }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* RENDIMIENTO POR RECLUTADOR */}
                  <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-sm">
                    <h3 className="text-base font-bold text-slate-700 mb-6 flex items-center gap-2">
                      <Users size={18} className="text-indigo-500" /> Rendimiento por Reclutador
                    </h3>
                    <div className="space-y-4">
                      {reclutadorPerf.length === 0 ? (
                        <div className="text-slate-400 text-sm italic">Sin candidatos asignados todavía.</div>
                      ) : (
                        reclutadorPerf.map((r, i) => (
                          <div key={r.nombre} className="p-3 bg-slate-50 rounded-xl">
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-2">
                                <div className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-white text-xs ${i === 0 ? 'bg-amber-500' : i === 1 ? 'bg-slate-400' : i === 2 ? 'bg-amber-700' : 'bg-indigo-300'}`}>
                                  {i + 1}
                                </div>
                                <span className="font-bold text-slate-700 text-sm">{r.nombre}</span>
                              </div>
                              <span className="font-extrabold text-indigo-600 text-sm">{r.contratados}/{r.asignados}</span>
                            </div>
                            <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                              <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${r.tasaConversion}%` }} />
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* DISTRIBUCIÓN POR NAVE */}
                  <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-sm">
                    <h3 className="text-base font-bold text-slate-700 mb-6 flex items-center gap-2">
                      <Building2 size={18} className="text-indigo-500" /> Distribución por Nave
                    </h3>
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={naveDist} margin={{ top: 0, right: 20, left: 0, bottom: 20 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                          <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} angle={-15} textAnchor="end" height={50} />
                          <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                          <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }} cursor={{ fill: '#f8fafc' }} />
                          <Bar dataKey="count" radius={[6, 6, 0, 0]} barSize={32}>
                            {naveDist.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* HORAS CON MAYOR ACTIVIDAD */}
                  <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-sm">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                      <div>
                        <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                          <Clock size={18} className="text-indigo-600" /> Horas con Mayor Actividad
                        </h3>
                        <p className="text-xs text-slate-400">
                          {timeRange === "1d" && "Mensajes de candidatos por día y hora (últimas 24 horas)"}
                          {timeRange === "7d" && "Mensajes de candidatos por día y hora (últimos 7 días)"}
                          {timeRange === "1m" && "Mensajes de candidatos por día y hora (últimos 30 días)"}
                          {timeRange === "6m" && "Mensajes de candidatos por día y hora (últimos 6 meses)"}
                          {timeRange === "1y" && "Mensajes de candidatos por día y hora (último año)"}
                        </p>
                      </div>

                      {heatmap.max > 0 && (
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200/70 px-2.5 py-1 rounded-full flex items-center gap-1">
                            🔥 Pico: {DIAS_SEMANA_COMPLETO[heatmap.peakDia]} {heatmap.peakHora}:00 hrs ({heatmap.max} msgs)
                          </span>
                        </div>
                      )}
                    </div>

                    {actividadHoraria.length === 0 ? (
                      <div className="h-56 flex flex-col items-center justify-center text-slate-400 text-sm gap-2">
                        <Clock size={32} className="opacity-30" />
                        <p className="italic">Sin actividad registrada en los últimos 90 días.</p>
                      </div>
                    ) : (
                      <div>
                        <div className="overflow-x-auto pb-2">
                          <div className="min-w-[560px]">
                            <div className="flex gap-[2px] pl-8 mb-1.5">
                              {Array.from({ length: 24 }, (_, h) => (
                                <div key={h} className="flex-1 text-center text-[9px] font-semibold text-slate-400">
                                  {h % 3 === 0 ? `${h}h` : ""}
                                </div>
                              ))}
                            </div>
                            {heatmap.grid.map((row, dia) => (
                              <div key={dia} className="flex items-center gap-[2px] mb-[3px]">
                                <div className="w-7 text-[10px] font-bold text-slate-500 text-right pr-1.5">
                                  {DIAS_SEMANA[dia]}
                                </div>
                                {row.map((count, hora) => {
                                  const intensity = heatmap.max > 0 ? count / heatmap.max : 0;
                                  return (
                                    <div
                                      key={hora}
                                      title={`${DIAS_SEMANA_COMPLETO[dia]} ${hora}:00 hrs — ${count} mensajes de candidatos`}
                                      className="flex-1 aspect-square rounded-xs transition-transform hover:scale-125 hover:z-10 hover:shadow-xs cursor-pointer"
                                      style={{
                                        backgroundColor:
                                          count === 0
                                            ? "#f1f5f9"
                                            : intensity > 0.66
                                            ? "#4f46e5"
                                            : intensity > 0.33
                                            ? "#818cf8"
                                            : "#c7d2fe",
                                      }}
                                    />
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* LEYENDA DEL HEATMAP */}
                        <div className="flex items-center justify-between text-[11px] text-slate-400 pt-3 border-t border-slate-100 mt-2">
                          <span>{heatmap.totalMsgs} mensajes en total</span>
                          <div className="flex items-center gap-1.5">
                            <span>Menos</span>
                            <div className="w-3 h-3 rounded-xs bg-[#f1f5f9]" />
                            <div className="w-3 h-3 rounded-xs bg-[#c7d2fe]" />
                            <div className="w-3 h-3 rounded-xs bg-[#818cf8]" />
                            <div className="w-3 h-3 rounded-xs bg-[#4f46e5]" />
                            <span>Más actividad</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* BARRAS CONTRATACION */}
                <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-sm">
                  <h3 className="text-base font-bold text-slate-700 mb-6 flex items-center gap-2">
                    <Briefcase size={18} className="text-indigo-500" /> Contrataciones por Vacante (Top 10)
                  </h3>
                  <div className="h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={kpis.barrasVacante} margin={{ top: 0, right: 30, left: 40, bottom: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }} cursor={{ fill: '#f8fafc' }} />
                        <Bar dataKey="count" radius={[6, 6, 0, 0]} barSize={32} label={{ position: 'top', fill: '#64748b', fontWeight: 'bold' }}>
                          {kpis.barrasVacante.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* CONVERSIÓN POR VACANTE */}
                <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-sm">
                  <h3 className="text-base font-bold text-slate-700 mb-6 flex items-center gap-2">
                    <TrendingUp size={18} className="text-indigo-500" /> Conversión por Vacante
                  </h3>
                  {conversionPorVacante.length === 0 ? (
                    <div className="text-slate-400 text-sm italic">Sin datos de vacantes todavía.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-slate-400 text-xs uppercase tracking-wider border-b border-slate-100">
                            <th className="pb-2 font-bold">Vacante</th>
                            <th className="pb-2 font-bold text-right">Candidatos</th>
                            <th className="pb-2 font-bold text-right">Contratados</th>
                            <th className="pb-2 font-bold text-right">Rechazados</th>
                            <th className="pb-2 font-bold text-right w-40">Conversión</th>
                          </tr>
                        </thead>
                        <tbody>
                          {conversionPorVacante.map((v) => (
                            <tr key={v.vacante} className="border-b border-slate-50 last:border-0">
                              <td className="py-2.5 font-semibold text-slate-700">{v.vacante}</td>
                              <td className="py-2.5 text-right text-slate-600">{v.total}</td>
                              <td className="py-2.5 text-right text-emerald-600 font-bold">{v.contratados}</td>
                              <td className="py-2.5 text-right text-rose-500">{v.rechazados}</td>
                              <td className="py-2.5">
                                <div className="flex items-center gap-2 justify-end">
                                  <div className="w-20 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${v.tasaConversion >= 20 ? "bg-emerald-500" : v.tasaConversion >= 5 ? "bg-amber-500" : "bg-slate-300"}`}
                                      style={{ width: `${Math.min(v.tasaConversion, 100)}%` }}
                                    />
                                  </div>
                                  <span className="font-bold text-slate-600 text-xs w-10 text-right">{v.tasaConversion}%</span>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "ia" && (
              <div className="animate-fade-in space-y-6">
                <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-sm">
                  <h3 className="text-base font-bold text-slate-700 mb-2 flex items-center gap-2">
                    <Bot size={18} className="text-purple-500" /> Automatización de Sofía
                  </h3>
                  <p className="text-xs text-slate-400 mb-4">Candidatos atendidos de principio a fin sin necesitar un reclutador humano.</p>
                  <div className="h-56 w-full relative">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadialBarChart
                        cx="50%" cy="65%" innerRadius="70%" outerRadius="100%"
                        barSize={22}
                        data={[{ name: "automatizacion", value: automatizacion.pct, fill: "#8b5cf6" }]}
                        startAngle={180} endAngle={0}
                      >
                        <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                        <RadialBar background dataKey="value" cornerRadius={12} />
                      </RadialBarChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pt-10">
                      <span className="text-4xl font-extrabold text-purple-600">{automatizacion.pct}%</span>
                      <span className="text-xs text-slate-400 font-semibold mt-1">automatizado</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mt-2">
                    <div className="bg-purple-50 rounded-xl p-4 text-center">
                      <div className="text-2xl font-extrabold text-purple-700">{automatizacion.sinEscalar}</div>
                      <div className="text-xs text-purple-500 font-semibold mt-1">Sin escalar</div>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-4 text-center">
                      <div className="text-2xl font-extrabold text-slate-700">{automatizacion.escalados}</div>
                      <div className="text-xs text-slate-500 font-semibold mt-1">Escalados a humano</div>
                    </div>
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                  <p className="text-blue-600 text-xs leading-relaxed">
                    El resto de métricas de IA (documentos procesados, precisión de validación, tiempo promedio de análisis)
                    requieren guardar cada evento de análisis de Gemini en la base de datos — hoy no se registra, así que
                    aquí solo mostramos lo que sí se puede calcular con datos reales.
                  </p>
                </div>
              </div>
            )}
          </div>
        </main>
      )}

      {/* ─── MODAL GRÁFICA EXPANDIDA DE CANDIDATOS EN EL TIEMPO ─── */}
      {isTimelineExpanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/70 backdrop-blur-sm animate-fade-in"
          onMouseDown={(e) => { isBackdropMouseDown.current = (e.target === e.currentTarget); }}
          onMouseUp={(e) => {
            if (isBackdropMouseDown.current && e.target === e.currentTarget) {
              setIsTimelineExpanded(false);
            }
            isBackdropMouseDown.current = false;
          }}
        >
          <div
            className="bg-white w-full max-w-5xl rounded-3xl shadow-2xl border border-slate-100 flex flex-col max-h-[95vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* HEADER */}
            <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/80">
              <div className="flex items-center gap-3">
                <span className="p-2 rounded-xl bg-indigo-100 text-indigo-600">
                  <Activity size={20} />
                </span>
                <div>
                  <h2 className="text-xl font-extrabold text-slate-800">
                    Candidatos en el Tiempo (Vista Ampliada)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Visualización detallada y métricas de tendencia en el período seleccionado.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {/* SELECTOR DE RANGO */}
                <div className="inline-flex bg-slate-200/70 p-1 rounded-xl text-xs font-semibold">
                  {(
                    [
                      { key: "1d", label: "1 Día" },
                      { key: "7d", label: "Semana" },
                      { key: "1m", label: "1 Mes" },
                      { key: "6m", label: "6 Meses" },
                      { key: "1y", label: "1 Año" },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setTimeRange(tab.key)}
                      className={`px-3 py-1.5 rounded-lg transition-all ${
                        timeRange === tab.key
                          ? "bg-white text-indigo-600 shadow-sm font-bold"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setIsTimelineExpanded(false)}
                  className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-xl transition-all"
                  title="Minimizar gráfica"
                >
                  <Minimize2 size={20} />
                </button>
              </div>
            </div>

            {/* BODY */}
            <div className="p-6 overflow-y-auto space-y-6">
              {/* METRICS ROW */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-slate-50 border border-slate-200/70 rounded-2xl p-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">
                    Total Registrados
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-black text-slate-800">{timelineMetrics.total}</span>
                    <span className="text-xs text-slate-500 font-medium">candidatos</span>
                  </div>
                </div>

                <div className="bg-indigo-50/50 border border-indigo-100 rounded-2xl p-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-indigo-400 block mb-1">
                    Promedio del Período
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-black text-indigo-600">{timelineMetrics.promedio}</span>
                    <span className="text-xs text-indigo-500 font-medium">candidatos / corte</span>
                  </div>
                </div>

                <div className="bg-emerald-50/50 border border-emerald-100 rounded-2xl p-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-500 block mb-1">
                    Pico Más Alto
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-black text-emerald-600">{timelineMetrics.max.count}</span>
                    <span className="text-xs text-emerald-600 font-medium truncate">
                      ({timelineMetrics.max.fullDate})
                    </span>
                  </div>
                </div>
              </div>

              {/* EXPANDED AREA CHART */}
              <div className="h-[420px] w-full bg-slate-50/50 rounded-2xl p-4 border border-slate-100">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timelineData} margin={{ top: 15, right: 20, left: -10, bottom: 10 }}>
                    <defs>
                      <linearGradient id="colorCandidatosModal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.45} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "#64748b", fontSize: 12, fontWeight: 500 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: "#64748b", fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: "16px",
                        border: "1px solid #e2e8f0",
                        boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
                        backgroundColor: "#ffffff",
                        padding: "12px 16px",
                      }}
                      formatter={(value: any) => [`${value} candidatos`, "Registros"]}
                      labelFormatter={(label: any, items: any) => {
                        const item = items?.[0]?.payload;
                        return item?.fullDate || label;
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="#6366f1"
                      strokeWidth={3.5}
                      fillOpacity={1}
                      fill="url(#colorCandidatosModal)"
                      dot={{ r: 4, fill: "#6366f1", strokeWidth: 2, stroke: "#ffffff" }}
                      activeDot={{ r: 7, fill: "#4f46e5", stroke: "#ffffff", strokeWidth: 2.5 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* FOOTER */}
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>{timelineData.length} puntos de datos evaluados</span>
              <button
                onClick={() => setIsTimelineExpanded(false)}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-xs"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL LISTADO DE CANDIDATOS POR ESTADO ─── */}
      {selectedEstadoModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in"
          onMouseDown={(e) => { isBackdropMouseDown.current = (e.target === e.currentTarget); }}
          onMouseUp={(e) => {
            if (isBackdropMouseDown.current && e.target === e.currentTarget) {
              setSelectedEstadoModal(null);
            }
            isBackdropMouseDown.current = false;
          }}
        >
          <div
            className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-100 flex flex-col max-h-[90vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* HEADER */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
              <div className="flex items-center gap-3">
                <span
                  className="w-4 h-4 rounded-full inline-block shadow-xs shrink-0"
                  style={{ backgroundColor: getEstadoColor(selectedEstadoModal) }}
                />
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-extrabold text-slate-800">
                      {getEstado(selectedEstadoModal).emoji} {getEstado(selectedEstadoModal).label}
                    </h2>
                    <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-200 text-slate-700">
                      {filteredModalCandidatos.length} {filteredModalCandidatos.length === 1 ? "candidato" : "candidatos"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {getEstado(selectedEstadoModal).descripcion}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedEstadoModal(null)}
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-xl transition-all"
              >
                <X size={20} />
              </button>
            </div>

            {/* SEARCH */}
            <div className="p-4 border-b border-slate-100 bg-white">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar por nombre, teléfono, vacante o reclutador..."
                  value={modalSearch}
                  onChange={(e) => setModalSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
                  autoFocus
                />
              </div>
            </div>

            {/* LIST */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5 bg-slate-50/40 custom-scrollbar">
              {filteredModalCandidatos.length === 0 ? (
                <div className="py-12 text-center text-slate-400">
                  <Users size={36} className="mx-auto mb-2 opacity-40 text-slate-400" />
                  <p className="text-sm font-semibold">No se encontraron candidatos en este estado</p>
                  {modalSearch && <p className="text-xs text-slate-400 mt-1">Prueba con otro término de búsqueda</p>}
                </div>
              ) : (
                filteredModalCandidatos.map((cand) => {
                  const displayName = getCandidateDisplayName(cand);
                  const rawNave = (cand.nave_interes || "").trim();
                  const naveName = rawNave && rawNave !== "Pendiente"
                    ? formatNaveName(naveNombrePorNumero[rawNave] || rawNave)
                    : null;

                  return (
                    <div
                      key={cand.id || cand.telefono}
                      className="p-4 bg-white rounded-xl border border-slate-200/80 hover:border-indigo-300 hover:shadow-md transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 group"
                    >
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-sm shrink-0 border border-indigo-100">
                          {displayName.charAt(0).toUpperCase() || "C"}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className="font-bold text-slate-800 text-sm hover:text-indigo-600 cursor-pointer transition-colors"
                              onClick={() => setSelectedCandidate(cand)}
                            >
                              {displayName}
                            </span>
                            {cand.escalado && (
                              <span className="text-[10px] bg-rose-100 text-rose-700 font-bold px-2 py-0.5 rounded-full border border-rose-200">
                                🚨 Escalado
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-slate-500 mt-1 flex-wrap">
                            <span className="font-mono font-medium text-slate-600">{cand.telefono}</span>
                            {cand.vacante_interes && (
                              <span className="bg-slate-100 px-2 py-0.5 rounded font-medium text-slate-600">
                                💼 {cand.vacante_interes}
                              </span>
                            )}
                            {naveName && (
                              <span className="bg-slate-100 px-2 py-0.5 rounded font-medium text-slate-600">
                                🏢 {naveName}
                              </span>
                            )}
                            {cand.asignado_a_nombre && (
                              <span className="text-slate-400">
                                👤 Reclutador: <strong className="text-slate-600">{cand.asignado_a_nombre}</strong>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                        <button
                          onClick={() => goToChat(cand.telefono)}
                          className="px-3 py-1.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all text-xs font-semibold flex items-center gap-1.5 border border-slate-200 hover:border-indigo-200"
                          title="Ir a conversación"
                        >
                          <MessageSquare size={14} />
                          <span>Chat</span>
                        </button>
                        <button
                          onClick={() => setSelectedCandidate(cand)}
                          className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
                        >
                          <span>Expediente</span>
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* FOOTER */}
            <div className="p-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>Mostrando {filteredModalCandidatos.length} candidatos</span>
              <button
                onClick={() => setSelectedEstadoModal(null)}
                className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg transition-all"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL DETALLE DE EXPEDIENTE ─── */}
      {selectedCandidate && (
        <CandidateModal
          candidato={selectedCandidate}
          onClose={() => setSelectedCandidate(null)}
          onStatusChange={updateStatus}
          onGoToChat={goToChat}
        />
      )}
    </div>
  );
}

