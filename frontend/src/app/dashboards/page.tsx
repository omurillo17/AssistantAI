"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line,
} from "recharts";
import {
  Users, UserCheck, CalendarDays, AlertTriangle, TrendingUp,
  RefreshCw, Trophy, MessageSquare, Briefcase, Activity
} from "lucide-react";
import { ESTADOS, ESTADOS_ORDENADOS, ESTADOS_CRM, GRUPOS, getEstado, type EstadoKey } from "@/lib/estados";
import type { Candidato, ChatMessage } from "@/types";

const CHART_COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#f59e0b", "#10b981", "#0ea5e9"];

function getNombre(c: Candidato) {
  return c.nombre_chat || c.nombre_solicitud || c.nombre_ine || c.nombre || "Candidato Desconocido";
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
  const [activeTab, setActiveTab] = useState<"ejecutivo" | "ia">("ejecutivo");
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [mensajes, setMensajes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);


  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const storedEmpresaId = localStorage.getItem("tci_empresa_id");
      const storedNaveId = localStorage.getItem("tci_nave_id");
      
      let queryCand = "";
      if (storedEmpresaId) queryCand += `&empresa_id=${storedEmpresaId}`;
      if (storedNaveId) queryCand += `&nave_id=${storedNaveId}`;
      
      let queryMensajes = "";
      if (storedEmpresaId) queryMensajes += `?empresa_id=${storedEmpresaId}`;
      if (storedNaveId) queryMensajes += (queryMensajes ? `&` : `?`) + `nave_id=${storedNaveId}`;

      const [candRes, msgsRes] = await Promise.all([
        fetch(`/api/db/candidatos?limit=2000${queryCand}`),
        fetch(`/api/db/mensajes${queryMensajes}`)
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

            {activeTab === "ia" && (
              <div className="animate-fade-in flex flex-col items-center justify-center py-20 text-center">
                <div className="w-20 h-20 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center mb-6 text-4xl">
                  🤖
                </div>
                <h2 className="text-2xl font-extrabold text-slate-800 mb-2">Dashboard de IA (Sofía)</h2>
                <p className="text-slate-500 max-w-md">Aquí mediremos el % de automatización, documentos procesados, y precisión de los análisis de nuestra asistente virtual. (Fase 3)</p>
              </div>
            )}
          </div>
        </main>
      )}
    </div>
  );
}

