"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line,
} from "recharts";
import {
  Users, UserCheck, CalendarDays, AlertTriangle, TrendingUp,
  LayoutGrid, List, RefreshCw, Trophy,
  MessageSquare, Filter, Briefcase, Activity, Search
} from "lucide-react";
import { ESTADOS, ESTADOS_ORDENADOS, ESTADOS_CRM, GRUPOS, getEstado, KANBAN_COLUMNAS, type EstadoKey } from "@/lib/estados";
import type { Candidato, ChatMessage } from "@/types";

const CHART_COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#f59e0b", "#10b981", "#0ea5e9"];

function getNombre(c: Candidato) {
  return c.nombre_chat || c.nombre_solicitud || c.nombre_ine || c.nombre || "Candidato Desconocido";
}

// ─── COMPONENTE: TARJETA KANBAN ────────────────────────────────
function KanbanCard({ cand, onClick, onStatusChange }: { cand: Candidato, onClick: () => void, onStatusChange: (t: string, s: string) => void }) {
  const hasCV = cand.tiene_cv || !!cand.cv_manual;
  const hasINE = !!cand.datos_ine;
  const hasRFC = !!cand.datos_rfc;

  return (
    <div
      onClick={onClick}
      className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-indigo-300 transition-all cursor-pointer group flex flex-col relative"
    >
      <div className="flex justify-between items-start mb-1.5">
        <div className="font-bold text-slate-800 text-sm leading-tight group-hover:text-indigo-600 transition-colors line-clamp-2">
          {getNombre(cand)}
        </div>
        {cand.escalado && (
          <div className="bg-rose-100 text-rose-600 p-1 rounded-full animate-pulse" title="¡Requiere atención humana!">
            <AlertTriangle size={12} />
          </div>
        )}
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
            {cand.nave_interes}
          </span>
        )}
      </div>

      <div className="flex gap-1.5 items-center mb-2">
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

export default function DashboardsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"ejecutivo" | "operativo" | "ia">("operativo");
  const [vista, setVista] = useState<"tabla" | "kanban">("tabla");
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [mensajes, setMensajes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filtros
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("TODOS");
  const [vacanteFilter, setVacanteFilter] = useState("TODAS");
  const [naveFilter, setNaveFilter] = useState("TODAS");

  const [selectedCandidate, setSelectedCandidate] = useState<Candidato | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [candRes, msgsRes] = await Promise.all([
        fetch("/api/db/candidatos?limit=2000"),
        fetch("/api/db/mensajes")
      ]);
      const candData = await candRes.json();
      const msgsData = await msgsRes.json();
      setCandidatos(Array.isArray(candData) ? candData : []);
      setMensajes(Array.isArray(msgsData) ? msgsData : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = "Dashboards | Grupo Virgo";
    loadData();
  }, [loadData]);

  // Actualización de estado
  const updateStatus = async (telefono: string, newStatus: string) => {
    try {
      const res = await fetch("/api/db/candidato", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono, estado: newStatus })
      });
      if (res.ok) {
        setCandidatos(prev => prev.map(c => c.telefono === telefono ? { ...c, estado: newStatus } : c));
      }
    } catch (e) {
      console.error("Error updating status", e);
    }
  };

  // ─── UNIQUE LISTS PARA FILTROS ─────────────────────────────────
  const uniqueVacantes = useMemo(() => {
    return Array.from(new Set(candidatos.map(c => c.vacante_interes?.trim().toUpperCase()).filter(Boolean))).sort();
  }, [candidatos]);

  const uniqueNaves = useMemo(() => {
    return Array.from(new Set(candidatos.map(c => c.nave_interes?.trim().toUpperCase()).filter(Boolean))).sort();
  }, [candidatos]);

  // ─── TABLA FILTRADA ───────────────────────────────────────
  const filteredTable = useMemo(() => {
    return candidatos.filter(c => {
      const nombre = getNombre(c).toLowerCase();
      const matchSearch = nombre.includes(searchTerm.toLowerCase()) || c.telefono.includes(searchTerm);
      const matchStatus = statusFilter === "TODOS" || c.estado === statusFilter;
      const matchVacante = vacanteFilter === "TODAS" || c.vacante_interes?.trim().toUpperCase() === vacanteFilter;
      const matchNave = naveFilter === "TODAS" || c.nave_interes?.trim().toUpperCase() === naveFilter;
      return matchSearch && matchStatus && matchVacante && matchNave;
    }).sort((a, b) => new Date(b.updated_at!).getTime() - new Date(a.updated_at!).getTime());
  }, [candidatos, searchTerm, statusFilter, vacanteFilter, naveFilter]);

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

  // ─── EJECUTIVO KPI CALCS ─────────────────────────────────────
  const kpis = useMemo(() => {
    let total = candidatos.length;
    let contratados = 0;
    let nuevos = 0;
    let chatsActivos = mensajes.length;

    const vacanteCounts: Record<string, number> = {};
    const estadosCounts: Record<string, number> = {};
    const reclutadorCounts: Record<string, number> = {};
    const pipeline: Record<string, number> = {};

    candidatos.forEach(c => {
      const st = c.estado || "NUEVO";
      if (st === "NUEVO") nuevos++;
      if (st === "CONTRATADO") contratados++;

      // Vacantes
      if (st === "CONTRATADO") {
        const v = c.vacante_interes || "General";
        vacanteCounts[v] = (vacanteCounts[v] || 0) + 1;
      }

      // Estados
      estadosCounts[st] = (estadosCounts[st] || 0) + 1;

      // Pipeline (Funnel)
      if (["NUEVO", "DOCUMENTOS_RECIBIDOS", "CITA_AGENDADA", "ENTREVISTADO", "CONTRATADO"].includes(st)) {
        pipeline[st] = (pipeline[st] || 0) + 1;
      }
    });

    mensajes.forEach(m => {
      if (m.asignado_a && m.asignado_a !== "Equipo de Reclutamiento" && m.asignado_a !== "Reclutador") {
        reclutadorCounts[m.asignado_a] = (reclutadorCounts[m.asignado_a] || 0) + 1;
      }
    });

    // Ranking
    const ranking = Object.entries(reclutadorCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // Barras Contratacion
    const barrasVacante = Object.entries(vacanteCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Donut Estados
    const donutEstados = Object.entries(estadosCounts)
      .map(([name, value]) => ({ name: ESTADOS[name as EstadoKey]?.label || name, value }))
      .filter(d => d.value > 0);

    // Funnel
    const funnelSteps = ["NUEVO", "CV_RECIBIDO", "CITA_AGENDADA", "ENTREVISTADO", "CONTRATADO"] as EstadoKey[];
    const funnel = funnelSteps.map(step => ({
      name: ESTADOS[step as EstadoKey]?.labelCorto || step,
      count: pipeline[step] || 0
    }));

    return { total, contratados, nuevos, chatsActivos, ranking, barrasVacante, donutEstados, funnel };
  }, [candidatos, mensajes]);

  // Línea de tiempo simple (agrupada por fecha de última interacción para demo)
  const timelineData = useMemo(() => {
    const dates: Record<string, number> = {};
    candidatos.forEach(c => {
      if (!c.ultima_interaccion) return;
      const d = new Date(c.ultima_interaccion).toISOString().split('T')[0];
      dates[d] = (dates[d] || 0) + 1;
    });
    return Object.entries(dates)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14); // Últimos 14 días
  }, [candidatos]);

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
            onClick={() => setActiveTab("operativo")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md font-bold text-sm transition-all ${activeTab === "operativo" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            <LayoutGrid size={16} /> Operativo
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
                    <h3 className="text-base font-bold text-slate-700 mb-6 flex items-center gap-2">
                      <TrendingUp size={18} className="text-indigo-500"/> Embudo de Reclutamiento
                    </h3>
                    <div className="h-72 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={kpis.funnel} layout="vertical" margin={{ top: 0, right: 30, left: 40, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                          <XAxis type="number" hide />
                          <YAxis dataKey="name" type="category" width={140} tick={{ fill: "#475569", fontSize: 12, fontWeight: 600 }} axisLine={false} tickLine={false} />
                          <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }} cursor={{fill: '#f8fafc'}} />
                          <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={24} label={{ position: 'right', fill: '#64748b', fontWeight: 'bold' }}>
                            {kpis.funnel.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* DONUT */}
                  <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-sm">
                    <h3 className="text-base font-bold text-slate-700 mb-2">Distribución de Estados</h3>
                    <div className="h-72 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={kpis.donutEstados} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value" stroke="none">
                            {kpis.donutEstados.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                          </Pie>
                          <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }} />
                          <Legend iconType="circle" wrapperStyle={{ fontSize: "12px" }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* LINE CHART */}
                  <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-sm lg:col-span-2">
                    <h3 className="text-base font-bold text-slate-700 mb-6 flex items-center gap-2">
                      <Activity size={18} className="text-indigo-500"/> Candidatos por Día
                    </h3>
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={timelineData} margin={{ top: 5, right: 20, left: -20, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                          <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                          <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }} />
                          <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* RANKING RECLUTADORES */}
                  <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-sm">
                    <h3 className="text-base font-bold text-slate-700 mb-6 flex items-center gap-2">
                      <Users size={18} className="text-indigo-500"/> Ranking (Chats Activos)
                    </h3>
                    <div className="space-y-4">
                      {kpis.ranking.length === 0 ? (
                        <div className="text-slate-400 text-sm italic">Sin datos de reclutadores activos.</div>
                      ) : (
                        kpis.ranking.map((r, i) => (
                          <div key={r.name} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                            <div className="flex items-center gap-3">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-white ${i === 0 ? 'bg-amber-500' : i === 1 ? 'bg-slate-400' : i === 2 ? 'bg-amber-700' : 'bg-indigo-300'}`}>
                                {i + 1}
                              </div>
                              <span className="font-bold text-slate-700">{r.name}</span>
                            </div>
                            <span className="font-extrabold text-indigo-600 bg-indigo-100 px-3 py-1 rounded-full text-sm">{r.count}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {/* BARRAS CONTRATACION */}
                <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-sm">
                  <h3 className="text-base font-bold text-slate-700 mb-6 flex items-center gap-2">
                    <Briefcase size={18} className="text-indigo-500"/> Contrataciones por Vacante (Top 10)
                  </h3>
                  <div className="h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={kpis.barrasVacante} margin={{ top: 0, right: 30, left: 40, bottom: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }} cursor={{fill: '#f8fafc'}} />
                        <Bar dataKey="count" radius={[6, 6, 0, 0]} barSize={32} label={{ position: 'top', fill: '#64748b', fontWeight: 'bold' }}>
                          {kpis.barrasVacante.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "operativo" && (
              <div className="animate-fade-in space-y-6">
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
                    <button onClick={() => setVista("tabla")} className={`flex items-center gap-2 px-4 py-2 rounded-md font-bold text-sm transition-all ${vista === "tabla" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                      <List size={16} /> Directorio
                    </button>
                    <button onClick={() => setVista("kanban")} className={`flex items-center gap-2 px-4 py-2 rounded-md font-bold text-sm transition-all ${vista === "kanban" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                      <LayoutGrid size={16} /> Tablero
                    </button>
                  </div>
                  <div className="flex gap-2 w-full xl:w-auto flex-wrap">
                    <div className="relative flex-1 min-w-[200px]">
                      <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                      <input type="text" placeholder="Buscar por nombre o teléfono..." className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-indigo-500 focus:bg-white transition-colors" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                    </div>
                    <select className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer min-w-[140px]" value={naveFilter} onChange={e => setNaveFilter(e.target.value)}>
                      <option value="TODAS">Todas las Naves</option>
                      {uniqueNaves.map(n => <option key={String(n)} value={String(n)}>{n}</option>)}
                    </select>
                    <select className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer min-w-[140px]" value={vacanteFilter} onChange={e => setVacanteFilter(e.target.value)}>
                      <option value="TODAS">Todas las Vacantes</option>
                      {uniqueVacantes.map(v => <option key={String(v)} value={String(v)}>{v}</option>)}
                    </select>
                    <select className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer min-w-[140px]" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
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
                  <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
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
                            filteredTable.map((cand, idx) => (
                              <tr key={cand.telefono + idx} onClick={() => setSelectedCandidate(cand)} className="border-b border-slate-50 hover:bg-indigo-50/50 cursor-pointer transition-colors group">
                                <td className="p-4">
                                  <div className="font-bold text-slate-800 group-hover:text-indigo-700">{getNombre(cand)}</div>
                                  {cand.fecha_entrevista && (
                                    <div className="text-xs text-amber-600 mt-0.5 font-semibold">
                                      📅 {new Date(cand.fecha_entrevista).toLocaleString("es-MX", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                    </div>
                                  )}
                                </td>
                                <td className="p-4 font-mono text-xs text-slate-500">{cand.telefono}</td>
                                <td className="p-4">
                                  <div className="font-semibold text-slate-700 text-xs">{cand.vacante_interes || "—"}</div>
                                  <div className="text-xs text-slate-400">{cand.nave_interes || "—"}</div>
                                </td>
                                <td className="p-4">
                                  <div className="flex gap-1.5 items-center">
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 ${(cand.tiene_cv || !!cand.cv_manual) ? "bg-cyan-50 text-cyan-700" : "bg-slate-50 text-slate-400"}`}>📄 CV</span>
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 ${!!cand.datos_ine ? "bg-violet-50 text-violet-700" : "bg-slate-50 text-slate-400"}`}>🪪 INE</span>
                                  </div>
                                </td>
                                <td className="p-4">
                                  <EstadoBadge estado={cand.estado || "NUEVO"} />
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-4 overflow-x-auto pb-4 custom-scrollbar">
                    {KANBAN_COLUMNAS.map(col => {
                      const cards = kanbanData[col.key] || [];
                      if (cards.length === 0 && col.key === "pool") return null; // Hide empty pool
                      return (
                        <div key={col.key} className="w-[300px] flex-shrink-0 flex flex-col">
                          <div className={`bg-white rounded-2xl border-t-4 ${col.color} border border-slate-100 shadow-sm overflow-hidden`}>
                            <div className="p-3 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                              <div className="font-bold text-slate-700 text-sm">{col.label}</div>
                              <div className="text-xs text-slate-500 font-bold bg-white px-2 py-0.5 border border-slate-200 rounded-full shadow-sm">{cards.length}</div>
                            </div>
                            <div className="p-2 space-y-2 max-h-[65vh] overflow-y-auto">
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
              </div>
            )}

            {activeTab === "ia" && (
              <div className="animate-fade-in flex flex-col items-center justify-center py-20 text-center">
                <div className="w-20 h-20 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center mb-6 text-4xl">
                  🤖
                </div>
                <h2 className="text-2xl font-extrabold text-slate-800 mb-2">Dashboard de IA (Sofía)</h2>
                <p className="text-slate-500 max-w-md">Aquí mediremos el % de automatización, documentos procesados, y precisión de los análisis de nuestra asistente virtual. (Fase 3)</p>
              </div>
            )}

            {/* MODAL PLACEHOLDER */}
            {selectedCandidate && (
              <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1000] p-4" onClick={() => setSelectedCandidate(null)}>
                <div className="bg-white p-6 rounded-2xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
                  <h3 className="text-xl font-bold text-slate-800 mb-4">{getNombre(selectedCandidate)}</h3>
                  <p className="text-slate-600 mb-6">Esta es una vista rápida del expediente. El modal completo de detalles (con historial de chat e IA) se reconstruirá en breve.</p>
                  <button onClick={() => setSelectedCandidate(null)} className="w-full py-2 bg-indigo-600 text-white hover:bg-indigo-700 font-bold rounded-xl transition-colors">Cerrar</button>
                </div>
              </div>
            )}
          </div>
        </main>
      )}
    </div>
  );
}

