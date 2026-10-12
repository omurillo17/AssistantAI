"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell /* NOSONAR */, Legend,
  AreaChart, Area,
  RadialBarChart, RadialBar, PolarAngleAxis,
} from "recharts";
import {
  Users, UserCheck, TrendingUp,
  Trophy, MessageSquare, Briefcase, Activity, Building2, Clock, Bot,
  X, Search, ChevronRight,
  Maximize2, Minimize2
} from "lucide-react";
import { ESTADOS, getEstado, getEstadoColor, type EstadoKey } from "@/lib/estados";
import type { Candidato } from "@/types";
import { CandidateModal } from "@/components/CandidateModal";
import { useTenantChange } from "@/hooks/useTenant";
import { useBackdropClose } from "@/hooks/useBackdropClose";
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

// Recharts entrega estas propiedades en tiempo de ejecución pero no las
// declara en el tipo del handler, así que se nombran aquí en vez de apagar el
// tipado con `any`: si un día dejaran de llegar, el fallo sería el mismo, pero
// al menos queda escrito qué se está asumiendo.
type EstadoClickGrafica = { activePayload?: { payload?: { key?: string } }[] };
type PayloadLeyenda = { payload?: { key?: string } };

export interface TimelineBucket {
  bucket: string;
  count: number;
}

export interface ResumenDashboard {
  total: number;
  escalados: number;
  otra_ciudad?: number;
  estados: { estado: string; count: number }[];
  vacantes: { vacante: string; total: number; contratados: number; rechazados: number }[];
  reclutadores: { nombre: string; asignados: number; contratados: number }[];
  naves: { nave: string; count: number }[];
  timeline: TimelineBucket[];
}

const RESUMEN_VACIO: ResumenDashboard = {
  total: 0, escalados: 0, otra_ciudad: 0, estados: [], vacantes: [], reclutadores: [], naves: [], timeline: [],
};

function buildHourlyTimelinePoints(addPoint: (key: string, label: string, fullDate: string) => void) {
  for (let h = 0; h < 24; h++) {
    const key = String(h).padStart(2, "0") + ":00";
    addPoint(key, key, `${key} hrs`);
  }
}

function buildDailyTimelinePoints(
  range: "7d" | "1m",
  now: Date,
  addPoint: (key: string, label: string, fullDate: string) => void
) {
  const isoLocal = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const dias = range === "7d" ? 7 : 30;
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const label = range === "7d"
      ? `${DIAS_SEMANA[d.getDay()]} ${d.getDate()}`
      : `${d.getDate()} ${MESES[d.getMonth()]}`;
    const fullDate = range === "7d"
      ? `${DIAS_SEMANA_COMPLETO[d.getDay()]} ${d.getDate()} de ${MESES_COMPLETO[d.getMonth()]}`
      : `${d.getDate()} de ${MESES_COMPLETO[d.getMonth()]} ${d.getFullYear()}`;
    addPoint(isoLocal(d), label, fullDate);
  }
}

function buildMonthlyTimelinePoints(
  range: "6m" | "1y",
  now: Date,
  addPoint: (key: string, label: string, fullDate: string) => void
) {
  const meses = range === "6m" ? 6 : 12;
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    addPoint(key, `${MESES[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`, `${MESES_COMPLETO[d.getMonth()]} ${d.getFullYear()}`);
  }
}

function buildTimelinePoints(
  range: TimeRange,
  now: Date,
  addPoint: (key: string, label: string, fullDate: string) => void
) {
  if (range === "1d") {
    buildHourlyTimelinePoints(addPoint);
  } else if (range === "7d" || range === "1m") {
    buildDailyTimelinePoints(range, now, addPoint);
  } else {
    buildMonthlyTimelinePoints(range, now, addPoint);
  }
}

function buildCandidatosTimeline(
  buckets: TimelineBucket[],
  range: TimeRange,
): { points: TimelinePoint[]; metrics: TimelineMetrics } {
  const now = new Date();
  const points: TimelinePoint[] = [];
  const counts = new Map<string, number>();

  // Los buckets llegan ya agrupados por Postgres en hora de México
  // (/api/db/dashboard/resumen). Aquí solo se arma el esqueleto de puntos —
  // incluidos los tramos vacíos, que el SQL no devuelve — y se rellena.
  const porBucket = new Map(buckets.map((b) => [b.bucket, b.count]));

  const addPoint = (key: string, label: string, fullDate: string) => {
    counts.set(key, porBucket.get(key) || 0);
    points.push({ key, label, fullDate, count: 0 });
  };

  buildTimelinePoints(range, now, addPoint);

  points.forEach((p) => { p.count = counts.get(p.key) || 0; });
  const total = points.reduce((acc, p) => acc + p.count, 0);
  const promedio = points.length > 0 ? Math.round((total / points.length) * 10) / 10 : 0;
  const max = points.reduce((prev, curr) => (curr.count > prev.count ? curr : prev), { label: "N/A", count: 0, fullDate: "Sin datos" });

  return { points, metrics: { total, promedio, max } };
}

function getRankColor(i: number): string {
  if (i === 0) return "bg-amber-500";
  if (i === 1) return "bg-slate-400";
  if (i === 2) return "bg-amber-700";
  return "bg-indigo-300";
}

function getHeatmapColor(count: number, intensity: number): string {
  if (count === 0) return "#f1f5f9";
  if (intensity > 0.66) return "#4f46e5";
  if (intensity > 0.33) return "#818cf8";
  return "#c7d2fe";
}

function getConversionBarColor(rate: number): string {
  if (rate >= 20) return "bg-emerald-500";
  if (rate >= 5) return "bg-amber-500";
  return "bg-slate-300";
}

function buildDashboardQueries(
  storedEmpresaId: string | null,
  storedNaveId: string | null,
  storedGrupoId: string | null,
  timeRange: TimeRange
) {
  const common = new URLSearchParams();
  if (storedEmpresaId) common.set("empresa_id", storedEmpresaId);
  if (storedGrupoId) common.set("grupo_id", storedGrupoId);
  else if (storedNaveId) common.set("nave_id", storedNaveId);

  const msgParams = new URLSearchParams(common);
  msgParams.set("count", "1");
  const queryMensajes = `?${msgParams.toString()}`;

  const actParams = new URLSearchParams(common);
  actParams.set("time_range", timeRange);
  const queryActividad = `?${actParams.toString()}`;

  const resParams = new URLSearchParams(common);
  resParams.set("time_range", timeRange);
  const queryResumen = `?${resParams.toString()}`;

  return {
    queryResumen,
    queryMensajes,
    queryActividad,
  };
}

function resolveNavesMap(empresasData: Record<string, unknown>, storedEmpresaId: string | null): Record<string, string> {
  const empresas = Array.isArray(empresasData?.empresas) ? empresasData.empresas : [];
  let empresaMatch = null;
  if (storedEmpresaId) {
    empresaMatch = empresas.find((e: { id: string }) => e.id === storedEmpresaId);
  } else if (empresas.length === 1) {
    empresaMatch = empresas[0];
  }
  const navesOrdenadas: NaveInfo[] = empresaMatch?.naves || [];
  const mapa: Record<string, string> = {};
  navesOrdenadas.forEach((n, i) => { mapa[String(i + 1)] = n.nombre; });
  return mapa;
}

export default function DashboardsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"ejecutivo" | "ia">("ejecutivo");
  const [resumen, setResumen] = useState<ResumenDashboard>(RESUMEN_VACIO);
  const [chatsActivos, setChatsActivos] = useState(0);
  const [naveNombrePorNumero, setNaveNombrePorNumero] = useState<Record<string, string>>({});
  const [actividadHoraria, setActividadHoraria] = useState<HoraActividad[]>([]);
  const [loading, setLoading] = useState(true);

  const [timeRange, setTimeRange] = useState<TimeRange>("1m");
  const [isTimelineExpanded, setIsTimelineExpanded] = useState(false);
  const timelineBackdrop = useBackdropClose(() => setIsTimelineExpanded(false));
  const estadoModalBackdrop = useBackdropClose(() => setSelectedEstadoModal(null));

  const [selectedEstadoModal, setSelectedEstadoModal] = useState<string | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidato | null>(null);
  const [modalSearch, setModalSearch] = useState<string>("");
  const [modalData, setModalData] = useState<{ estado: string; rows: Candidato[] } | null>(null);
  const [modalLoading, setModalLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const storedEmpresaId = localStorage.getItem("tci_empresa_id");
      const storedNaveId = localStorage.getItem("tci_nave_id");
      const storedGrupoId = localStorage.getItem("tci_grupo_id");

      const { queryResumen, queryMensajes, queryActividad } = buildDashboardQueries(
        storedEmpresaId,
        storedNaveId,
        storedGrupoId,
        timeRange
      );

      const [resumenRes, msgsRes, empresasRes, actividadRes] = await Promise.all([
        fetch(`/api/db/dashboard/resumen${queryResumen}`),
        fetch(`/api/db/mensajes${queryMensajes}`),
        fetch(`/api/db/empresas`),
        fetch(`/api/db/actividad-horaria${queryActividad}`),
      ]);
      const resumenData = await resumenRes.json();
      const msgsData = await msgsRes.json();
      const empresasData = await empresasRes.json();
      const actividadData = await actividadRes.json();

      setResumen(resumenRes.ok && resumenData && !resumenData.error ? resumenData : RESUMEN_VACIO);
      setChatsActivos(typeof msgsData?.total === "number" ? msgsData.total : 0);
      setActividadHoraria(Array.isArray(actividadData) ? actividadData : []);
      setNaveNombrePorNumero(resolveNavesMap(empresasData, storedEmpresaId));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    document.title = "Dashboards | Grupo Virgo";
    const cargar = async () => { await loadData(); };
    cargar();
  }, [loadData]);

  // Re-cargar (sin recargar la página) cuando el usuario cambia de empresa/nave en el TopNavbar
  useTenantChange(loadData);


  // ─── EJECUTIVO KPI CALCS ─────────────────────────────────────
  // Los conteos vienen ya agregados de /api/db/dashboard/resumen; aquí solo
  // se les pone etiqueta y color para las gráficas.
  const kpis = useMemo(() => {
    const estadosCounts: Record<string, number> = {};
    resumen.estados.forEach(({ estado, count }) => { estadosCounts[estado] = count; });

    const total = resumen.total;
    const nuevos = estadosCounts["NUEVO"] || 0;
    const contratados = estadosCounts["CONTRATADO"] || 0;

    // Barras de contratación: contratados por vacante, top 10.
    const barrasVacante = resumen.vacantes
      .filter((v) => v.contratados > 0)
      .map((v) => ({ name: v.vacante, count: v.contratados }))
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
  }, [resumen, chatsActivos]);

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
        // Al cambiar de estado el candidato sale de la lista del modal (que es
        // justamente "los de este estado") y los conteos del dashboard dejan de
        // cuadrar, así que se refresca el resumen desde el servidor.
        setModalData((prev) => (prev ? { ...prev, rows: prev.rows.filter((c) => c.telefono !== telefono) } : prev));
        if (selectedCandidate?.telefono === telefono) {
          setSelectedCandidate((prev) => (prev ? { ...prev, estado: newStatus } : null));
        }
        loadData();
      }
    } catch (e) {
      console.error("Error updating status", e);
    }
  };

  const goToChat = (telefono: string) => {
    router.push(`/mensajes?tel=${telefono}`);
  };

  // Carga las filas del estado seleccionado al abrir el modal. El filtro por
  // estado lo hace Postgres, así que ya no hace falta tener los 2000
  // candidatos en memoria "por si acaso" el usuario hace clic en una etapa.
  useEffect(() => {
    if (!selectedEstadoModal) return;
    let cancelado = false;
    const cargar = async () => {
      setModalLoading(true);
      try {
        const storedEmpresaId = localStorage.getItem("tci_empresa_id");
        const storedNaveId = localStorage.getItem("tci_nave_id");
        const storedGrupoId = localStorage.getItem("tci_grupo_id");
        let query = `?estado=${encodeURIComponent(selectedEstadoModal)}&limit=2000`;
        if (storedEmpresaId) query += `&empresa_id=${storedEmpresaId}`;
        if (storedGrupoId) query += `&grupo_id=${storedGrupoId}`;
        else if (storedNaveId) query += `&nave_id=${storedNaveId}`;

        const res = await fetch(`/api/db/candidatos${query}`);
        const data = await res.json();
        if (!cancelado) setModalData({ estado: selectedEstadoModal, rows: Array.isArray(data) ? data : [] });
      } catch (err) {
        console.error(err);
        if (!cancelado) setModalData({ estado: selectedEstadoModal, rows: [] });
      } finally {
        if (!cancelado) setModalLoading(false);
      }
    };
    cargar();
    return () => { cancelado = true; };
  }, [selectedEstadoModal]);

  const filteredModalCandidatos = useMemo(() => {
    if (!selectedEstadoModal) return [];
    // Si lo cargado es de otra etapa, aún no han llegado las filas de esta.
    let list = modalData?.estado === selectedEstadoModal ? modalData.rows : [];
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
  }, [modalData, selectedEstadoModal, modalSearch]);

  // ─── RENDIMIENTO POR RECLUTADOR ───────────────────────────────
  // Candidatos asignados/contratados por reclutador (no volumen de chats):
  // mide a quién se le está asignando trabajo y quién efectivamente contrata.
  const reclutadorPerf = useMemo(() => {
    return resumen.reclutadores.map((r) => ({
      nombre: r.nombre,
      asignados: r.asignados,
      contratados: r.contratados,
      tasaConversion: r.asignados > 0 ? Math.round((r.contratados / r.asignados) * 100) : 0,
    }));
  }, [resumen]);

  // ─── DISTRIBUCIÓN POR NAVE ─────────────────────────────────────
  const naveDist = useMemo(() => {
    // Postgres agrupa por el valor crudo de nave_interes; el nombre legible
    // depende del mapa "número secuencial -> sucursal" que solo existe aquí,
    // así que los grupos se consolidan al resolverlos.
    const counts: Record<string, number> = {};
    resumen.naves.forEach(({ nave, count }) => {
      const raw = (nave || "").trim();
      let nombre = "Sin sucursal";
      if (raw && raw !== "Pendiente") {
        const resolved = naveNombrePorNumero[raw] || raw;
        const formatted = formatNaveName(resolved);
        if (formatted) nombre = formatted;
      }
      counts[nombre] = (counts[nombre] || 0) + count;
    });
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [resumen, naveNombrePorNumero]);

  // ─── AUTOMATIZACIÓN DE SOFÍA ────────────────────────────────────
  // % de candidatos que Sofía atendió de principio a fin sin escalar a un humano.
  const automatizacion = useMemo(() => {
    const total = resumen.total;
    const escalados = resumen.escalados;
    const pct = total > 0 ? Math.round(((total - escalados) / total) * 100) : 0;
    return { pct, total, escalados, sinEscalar: total - escalados };
  }, [resumen]);

  // ─── CONVERSIÓN POR VACANTE ─────────────────────────────────────
  const conversionPorVacante = useMemo(() => {
    return resumen.vacantes.map((v) => ({
      vacante: v.vacante,
      total: v.total,
      contratados: v.contratados,
      rechazados: v.rechazados,
      tasaConversion: v.total > 0 ? Math.round((v.contratados / v.total) * 100) : 0,
    }));
  }, [resumen]);

  // ─── HORAS CON MAYOR ACTIVIDAD (heatmap) ────────────────────────
  const heatmap = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
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
    return buildCandidatosTimeline(resumen.timeline, timeRange);
  }, [resumen, timeRange]);

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
                          onClick={(state) => {
                            const k = (state as EstadoClickGrafica)?.activePayload?.[0]?.payload?.key;
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
                            formatter={(value) => [`${value} candidatos (clic para ver)`, "Candidatos"]}
                          />
                          <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={18} label={{ position: 'right', fill: '#64748b', fontWeight: 'bold', fontSize: 11 }}>
                            {kpis.funnel.map((entry, i) => (
                              <Cell /* NOSONAR */
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
                            onClick={(data) => {
                              if (data?.key) {
                                setSelectedEstadoModal(String(data.key));
                                setModalSearch("");
                              }
                            }}
                          >
                            {kpis.donutEstados.map((entry, i) => (
                              <Cell /* NOSONAR */
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
                            formatter={(value, name) => [`${value} candidatos (clic para ver)`, name]}
                          />
                          <Legend
                            iconType="circle"
                            wrapperStyle={{ fontSize: "11px", paddingTop: "8px", cursor: "pointer" }}
                            onClick={(data) => {
                              const payloadKey = (data as PayloadLeyenda)?.payload?.key;
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
                            formatter={(value) => [`${value} candidatos`, "Registros"]}
                            labelFormatter={(label, items) => {
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
                                <div className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-white text-xs ${getRankColor(i)}`}>
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
                            {naveDist.map((item, i) => <Cell /* NOSONAR */ key={item.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
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
                              <div key={DIAS_SEMANA_COMPLETO[dia]} className="flex items-center gap-[2px] mb-[3px]">
                                <div className="w-7 text-[10px] font-bold text-slate-500 text-right pr-1.5">
                                  {DIAS_SEMANA[dia]}
                                </div>
                                {row.map((count, hora) => {
                                  const intensity = heatmap.max > 0 ? count / heatmap.max : 0;
                                  return (
                                    <div
                                      key={`${DIAS_SEMANA[dia]}-${hora}`}
                                      title={`${DIAS_SEMANA_COMPLETO[dia]} ${hora}:00 hrs — ${count} mensajes de candidatos`}
                                      className="flex-1 aspect-square rounded-xs transition-transform hover:scale-125 hover:z-10 hover:shadow-xs cursor-pointer"
                                      style={{
                                        backgroundColor: getHeatmapColor(count, intensity),
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
                          {kpis.barrasVacante.map((item, i) => <Cell /* NOSONAR */ key={item.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
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
                                      className={`h-full rounded-full ${getConversionBarColor(v.tasaConversion)}`}
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

                  {Boolean(resumen.otra_ciudad) && (
                    <div className="mt-4 flex items-center gap-2.5 px-3.5 py-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs text-slate-600 font-medium">
                      <span className="text-sm">📍</span>
                      <span>
                        <strong className="text-slate-800 font-bold">{resumen.otra_ciudad} candidatos</strong> descalificados automáticamente por radicar en otra ciudad / fuera de Jalisco (no contabilizados en vacantes activas).
                      </span>
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
          {...timelineBackdrop}
        >
          <div
            className="bg-white w-full max-w-5xl rounded-3xl shadow-2xl border border-slate-100 flex flex-col max-h-[95vh] overflow-hidden"
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
                      formatter={(value) => [`${value} candidatos`, "Registros"]}
                      labelFormatter={(label, items) => {
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
          {...estadoModalBackdrop}
        >
          <div
            className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-100 flex flex-col max-h-[90vh] overflow-hidden"
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
              {(() => {
                if (modalLoading) {
                  return (
                    <div className="py-12 text-center text-slate-400">
                      <Users size={36} className="mx-auto mb-2 opacity-40 text-slate-400 animate-pulse" />
                      <p className="text-sm font-semibold">Cargando candidatos...</p>
                    </div>
                  );
                }
                if (filteredModalCandidatos.length === 0) {
                  return (
                    <div className="py-12 text-center text-slate-400">
                      <Users size={36} className="mx-auto mb-2 opacity-40 text-slate-400" />
                      <p className="text-sm font-semibold">No se encontraron candidatos en este estado</p>
                      {modalSearch && <p className="text-xs text-slate-400 mt-1">Prueba con otro término de búsqueda</p>}
                    </div>
                  );
                }
                return filteredModalCandidatos.map((cand) => {
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
                            <button
                              type="button"
                              className="font-bold text-slate-800 text-sm hover:text-indigo-600 cursor-pointer transition-colors text-left"
                              onClick={() => setSelectedCandidate(cand)}
                            >
                              {displayName}
                            </button>
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
                });
              })()}
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

