"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line,
  RadialBarChart, RadialBar, PolarAngleAxis,
} from "recharts";
import {
  Users, UserCheck, TrendingUp,
  Trophy, MessageSquare, Briefcase, Activity, Building2, Clock, Bot
} from "lucide-react";
import { ESTADOS, type EstadoKey } from "@/lib/estados";
import type { Candidato } from "@/types";
import { useTenantChange } from "@/hooks/useTenant";

const CHART_COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#f59e0b", "#10b981", "#0ea5e9"];

type NaveInfo = { id: string; nombre: string; created_at: string };
type HoraActividad = { dia_semana: number; hora: number; total: number };

const DIAS_SEMANA = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export default function DashboardsPage() {
  const [activeTab, setActiveTab] = useState<"ejecutivo" | "ia">("ejecutivo");
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [mensajes, setMensajes] = useState<any[]>([]);
  const [naveNombrePorNumero, setNaveNombrePorNumero] = useState<Record<string, string>>({});
  const [actividadHoraria, setActividadHoraria] = useState<HoraActividad[]>([]);
  const [loading, setLoading] = useState(true);


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

    return { total, contratados, nuevos, chatsActivos, barrasVacante, donutEstados, funnel };
  }, [candidatos, mensajes]);

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
      const numero = (c.nave_interes || "").trim();
      const nombre = naveNombrePorNumero[numero] || (numero && numero !== "Pendiente" ? `Sucursal ${numero}` : "Sin sucursal");
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
    actividadHoraria.forEach(({ dia_semana, hora, total }) => {
      if (dia_semana >= 0 && dia_semana < 7 && hora >= 0 && hora < 24) {
        grid[dia_semana][hora] = total;
        if (total > max) max = total;
      }
    });
    return { grid, max };
  }, [actividadHoraria]);

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

                  {/* RENDIMIENTO POR RECLUTADOR */}
                  <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-sm">
                    <h3 className="text-base font-bold text-slate-700 mb-6 flex items-center gap-2">
                      <Users size={18} className="text-indigo-500"/> Rendimiento por Reclutador
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
                      <Building2 size={18} className="text-indigo-500"/> Distribución por Nave
                    </h3>
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={naveDist} margin={{ top: 0, right: 20, left: 0, bottom: 20 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                          <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} angle={-15} textAnchor="end" height={50} />
                          <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                          <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }} cursor={{fill: '#f8fafc'}} />
                          <Bar dataKey="count" radius={[6, 6, 0, 0]} barSize={32}>
                            {naveDist.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* HORAS CON MAYOR ACTIVIDAD */}
                  <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-sm">
                    <h3 className="text-base font-bold text-slate-700 mb-4 flex items-center gap-2">
                      <Clock size={18} className="text-indigo-500"/> Horas con Mayor Actividad
                    </h3>
                    {actividadHoraria.length === 0 ? (
                      <div className="h-56 flex items-center justify-center text-slate-400 text-sm italic">Sin actividad registrada en los últimos 90 días.</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <div className="min-w-[560px]">
                          <div className="flex gap-[2px] pl-8 mb-1">
                            {Array.from({ length: 24 }, (_, h) => (
                              <div key={h} className="flex-1 text-center text-[9px] text-slate-400">{h % 3 === 0 ? h : ""}</div>
                            ))}
                          </div>
                          {heatmap.grid.map((row, dia) => (
                            <div key={dia} className="flex items-center gap-[2px] mb-[2px]">
                              <div className="w-7 text-[10px] font-semibold text-slate-500 text-right pr-1">{DIAS_SEMANA[dia]}</div>
                              {row.map((count, hora) => {
                                const intensity = heatmap.max > 0 ? count / heatmap.max : 0;
                                return (
                                  <div
                                    key={hora}
                                    title={`${DIAS_SEMANA[dia]} ${hora}:00 — ${count} mensajes`}
                                    className="flex-1 aspect-square rounded-sm"
                                    style={{ backgroundColor: intensity === 0 ? "#f1f5f9" : `rgba(99, 102, 241, ${0.15 + intensity * 0.85})` }}
                                  />
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
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

                {/* CONVERSIÓN POR VACANTE */}
                <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-sm">
                  <h3 className="text-base font-bold text-slate-700 mb-6 flex items-center gap-2">
                    <TrendingUp size={18} className="text-indigo-500"/> Conversión por Vacante
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
                    <Bot size={18} className="text-purple-500"/> Automatización de Sofía
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
    </div>
  );
}

