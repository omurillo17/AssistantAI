"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  Users, UserCheck, CalendarDays, AlertTriangle, TrendingUp,
  Search, LayoutGrid, List, RefreshCw, ChevronDown, Trophy,
  MessageSquare, FileText,
} from "lucide-react";
import {
  ESTADOS, ESTADOS_ORDENADOS, ESTADOS_CRM, GRUPOS, KANBAN_COLUMNAS,
  getEstado, type EstadoKey,
} from "@/lib/estados";

// ─── TIPOS ──────────────────────────────────────────────────
type Candidato = {
  id: string;
  telefono: string;
  estado: string;
  nombre: string | null;
  nombre_chat: string | null;
  nombre_solicitud: string | null;
  nombre_ine: string | null;
  vacante_interes: string | null;
  nave_interes: string | null;
  fecha_entrevista: string | null;
  resumen_ia: string | null;
  motivo_analisis: string | null;
  veredicto: string | null;
  escalado: boolean;
  tiene_cv: boolean;
  datos_ine: object | null;
  datos_rfc: string | null;
  cv_manual: object | null;
  ultima_interaccion: string;
  updated_at: string;
  edad: string | null;
  correo: string | null;
  privacidad_aceptada: boolean;
  nombre_confirmado: boolean;
  link_cv: string | null;
};

type ChatMessage = {
  role: string;
  content: string;
  timestamp: string;
};

const N8N_BASE_URL = "/api/n8n";
const CHART_COLORS = [
  "#6366f1", "#3b82f6", "#06b6d4", "#8b5cf6",
  "#f59e0b", "#10b981", "#ef4444", "#ec4899",
];

// ─── HELPER: nombre display ─────────────────────────────────
function getNombre(c: Candidato) {
  return c.nombre_chat || c.nombre_solicitud || c.nombre_ine || c.nombre || "Sin nombre";
}

// ─── COMPONENTE: Badge de estado ────────────────────────────
function EstadoBadge({ estado, small = false }: { estado: string; small?: boolean }) {
  const def = getEstado(estado);
  return (
    <span className={`inline-flex items-center gap-1 font-bold rounded-full ${small ? "text-[10px] px-2 py-0.5" : "text-xs px-2.5 py-1"} ${def.bg} ${def.color}`}>
      <span>{def.emoji}</span>
      <span>{small ? def.labelCorto : def.label}</span>
    </span>
  );
}

// ─── COMPONENTE: Select de estado para CRM ──────────────────
function EstadoSelect({ estado, onChange }: { estado: string; onChange: (v: string) => void }) {
  const def = getEstado(estado);
  return (
    <select
      className={`text-xs font-bold px-2.5 py-1.5 rounded-full cursor-pointer appearance-none text-center outline-none transition-all border hover:opacity-80 ${def.bg} ${def.color} border-transparent`}
      value={estado}
      onChange={(e) => onChange(e.target.value)}
    >
      {/* Estado actual (puede ser de bot) */}
      <option value={estado}>{def.emoji} {def.label}</option>
      {/* Separador */}
      <option disabled>── Cambiar a ──</option>
      {/* Solo los estados asignables por CRM */}
      {ESTADOS_CRM.filter(k => k !== estado).map(k => (
        <option key={k} value={k}>
          {ESTADOS[k].emoji} {ESTADOS[k].label}
        </option>
      ))}
    </select>
  );
}

// ─── COMPONENTE: Tarjeta Kanban ──────────────────────────────
function KanbanCard({ cand, onClick, onStatusChange }: {
  cand: Candidato;
  onClick: () => void;
  onStatusChange: (tel: string, st: string) => void;
}) {
  const def = getEstado(cand.estado);
  const hasINE = !!cand.datos_ine;
  const hasRFC = !!cand.datos_rfc;
  const hasCV = cand.tiene_cv || !!cand.cv_manual;

  return (
    <div
      className={`bg-white rounded-xl border-l-4 ${def.border} border border-slate-100 p-3 shadow-sm hover:shadow-md transition-all cursor-pointer group`}
      onClick={onClick}
    >
      <div className="flex justify-between items-start mb-2">
        <div className="font-bold text-slate-800 text-sm leading-tight truncate max-w-[65%]">
          {getNombre(cand)}
        </div>
        <EstadoBadge estado={cand.estado} small />
      </div>
      {cand.vacante_interes && (
        <div className="text-xs text-indigo-600 font-semibold mb-2 truncate">
          💼 {cand.vacante_interes}
        </div>
      )}
      <div className="flex gap-1.5 mt-2">
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${hasINE ? "bg-info/20 text-info" : "bg-slate-100 text-slate-400"}`}>INE</span>
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${hasCV ? "bg-info/20 text-info" : "bg-slate-100 text-slate-400"}`}>CV</span>
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${hasRFC ? "bg-success/20 text-success" : "bg-slate-100 text-slate-400"}`}>RFC</span>
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
            <option key={k} value={k}>{ESTADOS[k].emoji} {ESTADOS[k].label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ─── PÁGINA PRINCIPAL ────────────────────────────────────────
export default function CRMDashboard() {
  const router = useRouter();
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);
  const [vista, setVista] = useState<"tabla" | "kanban">("tabla");
  const [mostrarFiltros, setMostrarFiltros] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Filtros
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("TODOS");

  // Modals
  const [selectedCandidate, setSelectedCandidate] = useState<Candidato | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);

  useEffect(() => {
    document.title = "CRM Reclutamiento | Grupo Virgo";
    const auth = localStorage.getItem("tci_authenticated");
    if (!auth) router.push("/login");
    else loadData();
  }, [router]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/db/candidatos?limit=1000");
      if (!res.ok) throw new Error("Error API");
      const data = await res.json();
      setCandidatos(Array.isArray(data) ? data : []);
      showToast("Datos sincronizados ✓", false);
    } catch {
      showToast("Error al cargar datos", true);
    } finally {
      setLoading(false);
    }
  }, []);

  const showToast = (msg: string, isError: boolean) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3000);
  };

  const updateStatus = async (telefono: string, newStatus: string) => {
    const cand = candidatos.find(c => c.telefono === telefono);
    if (!cand || cand.estado === newStatus) return;
    const oldStatus = cand.estado;

    setCandidatos(prev => prev.map(c => c.telefono === telefono ? { ...c, estado: newStatus } : c));
    showToast("Actualizando estado...", false);

    try {
      const res = await fetch("/api/db/candidato", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono, estado: newStatus }),
      });
      if (!res.ok) throw new Error();
      showToast(`Estado → ${getEstado(newStatus).label} ✓`, false);
    } catch {
      setCandidatos(prev => prev.map(c => c.telefono === telefono ? { ...c, estado: oldStatus } : c));
      showToast("Error al actualizar estado", true);
    }
  };

  const handleSaveStateAndChat = async () => {
    if (!selectedCandidate) return;
    setUpdatingStatus(true);
    await updateStatus(selectedCandidate.telefono, selectedCandidate.estado);
    setUpdatingStatus(false);
    setSelectedCandidate(null);
  };

  const handleAtencionManual = async () => {
    if (!selectedCandidate) return;
    derivarAAgente(selectedCandidate.telefono);
  };

  const loadChat = async (telefono: string) => {
    setIsChatOpen(true);
    setLoadingChat(true);
    setChatHistory([]);
    try {
      const res = await fetch(`${N8N_BASE_URL}/webhook/crm-chat-history?telefono=${telefono}`);
      if (!res.ok) throw new Error();
      const history = await res.json();
      let parsed: ChatMessage[] = [];
      if (Array.isArray(history)) parsed = history.map((r: any) => r.message || r);
      else if (Array.isArray(history?.data)) parsed = history.data.map((r: any) => r.message || r);
      setChatHistory(parsed);
    } catch {
      showToast("Error al obtener historial", true);
    } finally {
      setLoadingChat(false);
    }
  };

  const derivarAAgente = async (telefono: string) => {
    showToast("Derivando a atención humana...", false);
    try {
      const res = await fetch("/api/db/candidato", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telefono,
          estado: "ESCALADO",
          escalado: true,
          escalation_reason: "Derivado manualmente desde CRM",
        }),
      });
      if (!res.ok) throw new Error();
      setCandidatos(prev =>
        prev.map(c => c.telefono === telefono ? { ...c, estado: "ESCALADO", escalado: true } : c)
      );
      showToast("✅ Candidato derivado — redirigiendo a bandeja...", false);
      setTimeout(() => router.push(`/mensajes?tel=${telefono}`), 1200);
    } catch {
      showToast("Error al derivar al agente", true);
    }
  };

  // ─── KPIs ─────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const counts: Record<string, number> = {};
    ESTADOS_ORDENADOS.forEach(k => { counts[k] = 0; });
    candidatos.forEach(c => {
      const st = c.estado || "NUEVO";
      counts[st] = (counts[st] || 0) + 1;
    });
    const total = candidatos.length;
    const pipeline = GRUPOS.pipeline.estados.reduce((a, k) => a + (counts[k] || 0), 0);
    const alertas = GRUPOS.alerta.estados.reduce((a, k) => a + (counts[k] || 0), 0);
    const exitosos = GRUPOS.exitoso.estados.reduce((a, k) => a + (counts[k] || 0), 0);
    const tasaConversion = total > 0 ? ((counts.CONTRATADO || 0) / total * 100).toFixed(1) : "0";
    return { total, pipeline, alertas, exitosos, tasaConversion, counts };
  }, [candidatos]);

  // ─── DATOS GRÁFICAS ───────────────────────────────────────
  const embudo = useMemo(() => {
    return ESTADOS_ORDENADOS
      .filter(k => k !== "CV_MANUAL")
      .map(k => ({ name: ESTADOS[k].emoji + " " + ESTADOS[k].labelCorto, count: kpis.counts[k] || 0 }))
      .filter(d => d.count > 0);
  }, [kpis]);

  const pieData = useMemo(() => {
    return Object.entries(GRUPOS).map(([, g]) => ({
      name: g.label,
      value: g.estados.reduce((a, k) => a + (kpis.counts[k] || 0), 0),
    })).filter(d => d.value > 0);
  }, [kpis]);

  // ─── TABLA FILTRADA ───────────────────────────────────────
  const filteredTable = useMemo(() => {
    return candidatos.filter(c => {
      const nombre = getNombre(c).toLowerCase();
      const matchSearch = nombre.includes(searchTerm.toLowerCase()) || c.telefono.includes(searchTerm);
      const matchStatus = statusFilter === "TODOS" || c.estado === statusFilter;
      return matchSearch && matchStatus;
    }).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }, [candidatos, searchTerm, statusFilter]);

  // ─── KANBAN ───────────────────────────────────────────────
  const kanbanData = useMemo(() => {
    const map: Record<string, Candidato[]> = {};
    KANBAN_COLUMNAS.forEach(col => { map[col.key] = []; });
    candidatos.forEach(c => {
      const st = (c.estado || "NUEVO") as EstadoKey;
      const col = KANBAN_COLUMNAS.find(col => col.estados.includes(st));
      if (col) map[col.key].push(c);
    });
    return map;
  }, [candidatos]);

  // ─── RENDER ───────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full text-slate-800">
      {/* PAGE HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 font-semibold rounded shadow-sm transition-colors text-sm border border-slate-200"
          >
            ⬅ Atrás
          </button>
          <h1 className="text-2xl font-bold text-slate-800">
            CRM Candidatos
          </h1>
        </div>
        <div className="flex gap-3 items-center">
          {/* Toggle vista */}
          <div className="flex bg-white shadow-sm border border-slate-200 p-1 rounded gap-1">
            <button
              onClick={() => setVista("tabla")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-bold transition-all ${vista === "tabla" ? "bg-primary text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              <List size={14} /> Tabla
            </button>
            <button
              onClick={() => setVista("kanban")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-bold transition-all ${vista === "kanban" ? "bg-primary text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              <LayoutGrid size={14} /> Kanban
            </button>
          </div>
          {loading && <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />}
          <button
            onClick={loadData}
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white font-bold rounded shadow-sm transition-all text-sm"
          >
            <RefreshCw size={14} /> Actualizar
          </button>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-screen-2xl mx-auto space-y-6">

          {/* ── KPI CARDS ─────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {[
              { label: "Total Candidatos", value: kpis.total, icon: <Users size={22} />, color: "text-slate-600", bg: "bg-slate-100" },
              { label: "En Pipeline", value: kpis.pipeline, icon: <TrendingUp size={22} />, color: "text-primary", bg: "bg-primary/10" },
              { label: "Citas / Entrevistados", value: kpis.counts.CITA_AGENDADA + kpis.counts.ENTREVISTADO, icon: <CalendarDays size={22} />, color: "text-warning", bg: "bg-warning/20" },
              { label: "Requieren Atención", value: kpis.alertas, icon: <AlertTriangle size={22} />, color: "text-danger", bg: "bg-danger/10" },
              { label: "Contratados", value: kpis.counts.CONTRATADO || 0, icon: <Trophy size={22} />, color: "text-success", bg: "bg-success/20" },
            ].map((kpi, i) => (
              <div key={kpi.label} className="bg-white p-5 rounded-2xl border border-black/5 shadow-sm flex items-center gap-4 hover:-translate-y-0.5 transition-transform">
                <div className={`p-3 ${kpi.bg} ${kpi.color} rounded-xl`}>{kpi.icon}</div>
                <div>
                  <div className="text-xs text-slate-500 font-bold uppercase tracking-wider leading-tight">{kpi.label}</div>
                  <div className="text-3xl font-extrabold text-slate-800">{kpi.value}</div>
                </div>
              </div>
            ))}
          </div>

          {/* ── ALERTAS ACTIVAS ───────────────────────────── */}
          {kpis.alertas > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-center gap-4">
              <AlertTriangle className="text-red-500 flex-shrink-0" size={24} />
              <div>
                <div className="font-bold text-red-700">
                  {kpis.counts.ESCALADO > 0 && `${kpis.counts.ESCALADO} candidato(s) escalado(s) esperando atención. `}
                  {kpis.counts.DOCUMENTOS_NO_COINCIDEN > 0 && `${kpis.counts.DOCUMENTOS_NO_COINCIDEN} candidato(s) con documentos que no coinciden.`}
                </div>
                <div className="text-sm text-red-500 mt-0.5">Filtra por "Requieren Atención" para verlos.</div>
              </div>
              <button
                onClick={() => setMostrarFiltros(!mostrarFiltros)}
                className="ml-auto px-4 py-2 bg-primary text-white text-sm font-bold rounded shadow-sm hover:bg-primary/90 transition-colors flex-shrink-0"
              >
                {mostrarFiltros ? "Cerrar Filtros" : "Más Filtros"}
              </button>
            </div>
          )}

          {/* ── GRÁFICAS ──────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Embudo */}
            <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-black/5 shadow-sm">
              <h3 className="text-base font-bold text-slate-700 mb-4">📊 Distribución por Estado</h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={embudo} layout="vertical" margin={{ left: 10, right: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                    <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis dataKey="name" type="category" width={120} tick={{ fill: "#475569", fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }} />
                    <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={18}>
                      {embudo.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            {/* Pie grupos */}
            <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-sm">
              <h3 className="text-base font-bold text-slate-700 mb-4">🎯 Por Grupo</h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={3} dataKey="value" stroke="none">
                      {pieData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px" }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* ── VISTA TABLA ───────────────────────────────── */}
          {vista === "tabla" && (
            <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
              {/* Toolbar */}
              <div className="p-5 border-b border-black/5 flex flex-col sm:flex-row justify-between items-center gap-3 bg-slate-50/50">
                <h3 className="text-base font-bold text-slate-800 flex-shrink-0">
                  Directorio de Candidatos <span className="text-slate-400 font-normal">({filteredTable.length})</span>
                </h3>
                <div className="flex gap-2 w-full sm:w-auto">
                  <div className="relative flex-1 sm:w-56">
                    <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                    <input
                      type="text"
                      placeholder="Buscar..."
                      className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                    />
                  </div>
                  <select
                    className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:outline-none cursor-pointer"
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value)}
                  >
                    <option value="TODOS">Todos los estados</option>
                    <optgroup label="── En Proceso ──">
                      {GRUPOS.pipeline.estados.map(k => <option key={k} value={k}>{ESTADOS[k].emoji} {ESTADOS[k].label}</option>)}
                    </optgroup>
                    <optgroup label="── Requieren Atención ──">
                      {GRUPOS.alerta.estados.map(k => <option key={k} value={k}>{ESTADOS[k].emoji} {ESTADOS[k].label}</option>)}
                    </optgroup>
                    <optgroup label="── Finalizados ──">
                      {GRUPOS.exitoso.estados.map(k => <option key={k} value={k}>{ESTADOS[k].emoji} {ESTADOS[k].label}</option>)}
                    </optgroup>
                    <optgroup label="── Descartados / Pool ──">
                      {[...GRUPOS.descartado.estados, ...GRUPOS.pool.estados].map(k => <option key={k} value={k}>{ESTADOS[k].emoji} {ESTADOS[k].label}</option>)}
                    </optgroup>
                  </select>
                </div>
              </div>
              {/* Tabla */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-black/5 text-slate-400 text-xs uppercase tracking-wider">
                      <th className="p-4 font-bold">Candidato</th>
                      <th className="p-4 font-bold">Teléfono</th>
                      <th className="p-4 font-bold">Vacante / Nave</th>
                      <th className="p-4 font-bold">Docs</th>
                      <th className="p-4 font-bold">Estado</th>
                      <th className="p-4 font-bold text-center">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTable.length === 0 ? (
                      <tr><td colSpan={6} className="p-10 text-center text-slate-400">No hay candidatos con esos filtros.</td></tr>
                    ) : (
                      filteredTable.map((cand, idx) => {
                        const hasINE = !!cand.datos_ine;
                        const hasPartialINE = false;
                        const hasRFC = !!cand.datos_rfc;
                        const hasCV = cand.tiene_cv || !!cand.cv_manual;
                        return (
                          <tr key={cand.telefono + idx} className="border-b border-slate-50 hover:bg-slate-50/80 transition-colors">
                            <td className="p-4">
                              <div className="font-bold text-slate-800 text-sm">{getNombre(cand)}</div>
                              {cand.fecha_entrevista && (
                                <div className="text-xs text-amber-600 mt-0.5 font-semibold">
                                  📅 {new Date(cand.fecha_entrevista).toLocaleString("es-MX", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                </div>
                              )}
                            </td>
                            <td className="p-4 font-mono text-xs text-slate-500">{cand.telefono}</td>
                            <td className="p-4">
                              <div className="font-semibold text-indigo-600 text-xs">{cand.vacante_interes || "—"}</div>
                              <div className="text-xs text-slate-400">{cand.nave_interes || "—"}</div>
                            </td>
                            <td className="p-4">
                              <div className="flex gap-1.5">
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${hasINE ? "bg-info/20 text-info" : hasPartialINE ? "bg-warning/20 text-warning" : "bg-slate-100 text-slate-400"}`}>INE</span>
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${hasCV ? "bg-info/20 text-info" : "bg-slate-100 text-slate-400"}`}>CV</span>
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${hasRFC ? "bg-success/20 text-success" : "bg-slate-100 text-slate-400"}`}>RFC</span>
                              </div>
                            </td>
                            <td className="p-4">
                              <EstadoSelect estado={cand.estado || "NUEVO"} onChange={(v) => updateStatus(cand.telefono, v)} />
                            </td>
                            <td className="p-4 text-center">
                              <button
                                onClick={() => setSelectedCandidate(cand)}
                                className="text-xs font-bold bg-white border border-slate-200 text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors shadow-sm"
                              >
                                Ver Detalles
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── VISTA KANBAN ──────────────────────────────── */}
          {vista === "kanban" && (
            <div className="flex gap-4 overflow-x-auto pb-4">
              {KANBAN_COLUMNAS.map(col => {
                const cards = kanbanData[col.key] || [];
                return (
                  <div key={col.key} className="flex-shrink-0 w-64">
                    <div className={`bg-white rounded-2xl border-t-4 ${col.color} border border-slate-100 shadow-sm overflow-hidden`}>
                      <div className="p-3 border-b border-slate-100 bg-slate-50/50">
                        <div className="font-bold text-slate-700 text-sm">{col.label}</div>
                        <div className="text-xs text-slate-400 font-semibold">{cards.length} candidato{cards.length !== 1 ? "s" : ""}</div>
                      </div>
                      <div className="p-2 space-y-2 max-h-[65vh] overflow-y-auto">
                        {cards.length === 0 ? (
                          <div className="text-center text-slate-300 py-6 text-xs">Sin candidatos</div>
                        ) : (
                          cards.map((cand, i) => (
                            <KanbanCard
                              key={cand.telefono + i}
                              cand={cand}
                              onClick={() => setSelectedCandidate(cand)}
                              onStatusChange={updateStatus}
                            />
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
      </main>

      {/* ── MODAL: DETALLE CANDIDATO ──────────────────────── */}
      {selectedCandidate && !isChatOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1000] p-4" onClick={() => setSelectedCandidate(null)}>
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto relative" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="h-20 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-t-2xl relative">
              <button
                onClick={() => setSelectedCandidate(null)}
                className="absolute top-4 right-4 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 w-8 h-8 flex items-center justify-center rounded-full transition-colors font-bold"
              >✕</button>
            </div>
            <div className="px-6 pb-6 -mt-10">
              <div className="w-20 h-20 bg-white rounded-full border-4 border-white shadow-md flex items-center justify-center mb-3">
                <UserCheck size={36} className="text-slate-300" />
              </div>
              <h2 className="text-2xl font-extrabold text-slate-800">{getNombre(selectedCandidate)}</h2>
              <div className="flex items-center gap-2 mt-1 mb-4">
                <EstadoBadge estado={selectedCandidate.estado || "NUEVO"} />
                {selectedCandidate.veredicto && (
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${selectedCandidate.veredicto === "VIABLE" ? "bg-success/20 text-success" : selectedCandidate.veredicto === "CARTERA_GENERAL" ? "bg-info/20 text-info" : "bg-warning/20 text-warning"}`}>
                    🤖 {selectedCandidate.veredicto}
                  </span>
                )}
              </div>

              {/* Resumen IA */}
              {selectedCandidate.resumen_ia && (
                <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-xl mb-4 text-sm text-indigo-800 leading-relaxed">
                  <div className="font-bold text-indigo-600 text-xs uppercase tracking-wider mb-1">🤖 Resumen IA</div>
                  <div className="whitespace-pre-wrap">{selectedCandidate.resumen_ia}</div>
                </div>
              )}

              {/* Datos */}
              <div className="space-y-2.5 mb-4 bg-slate-50 border border-slate-100 rounded-xl p-4 text-sm">
                {[
                  { label: "Teléfono", value: selectedCandidate.telefono },
                  { label: "Vacante", value: selectedCandidate.vacante_interes || "No definida" },
                  { label: "Sucursal", value: selectedCandidate.nave_interes || "No definida" },
                  { label: "Edad", value: selectedCandidate.edad || "No registrada" },
                  { label: "Correo", value: selectedCandidate.correo || "No registrado" },
                  selectedCandidate.fecha_entrevista ? { label: "Cita", value: new Date(selectedCandidate.fecha_entrevista).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) } : null,
                ].filter(Boolean).map(item => (
                  <div key={item!.label} className="flex justify-between items-center border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                    <span className="text-slate-500 font-medium">{item!.label}</span>
                    <span className="font-bold text-slate-700 text-right max-w-[60%] truncate">{item!.value}</span>
                  </div>
                ))}
              </div>

              {/* Documentos */}
              <div className="mb-4">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1"><FileText size={12} /> Documentos</div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "CV / Solicitud", has: selectedCandidate.tiene_cv || !!selectedCandidate.cv_manual, color: "cyan" },
                    { label: "INE", has: !!selectedCandidate.datos_ine, color: "violet" },
                    { label: "RFC / Constancia", has: !!selectedCandidate.datos_rfc, color: "green" },
                  ].map(doc => (
                    <div key={doc.label} className={`p-2.5 rounded-xl border text-center ${doc.has ? `bg-${doc.color}-50 border-${doc.color}-200` : "bg-slate-50 border-slate-200"}`}>
                      <div className="text-lg mb-0.5">{doc.has ? "✅" : "⬜"}</div>
                      <div className={`text-[10px] font-bold ${doc.has ? `text-${doc.color}-700` : "text-slate-400"}`}>{doc.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Cambio de estado desde modal */}
              <div className="mb-4">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Mover Estado</div>
                <div className="flex flex-wrap gap-2">
                  {ESTADOS_CRM.filter(k => k !== selectedCandidate.estado).map(k => (
                    <button
                      key={k}
                      onClick={() => setSelectedCandidate({ ...selectedCandidate, estado: k })}
                      className={`text-xs font-bold px-3 py-1.5 rounded-full border transition-all hover:opacity-80 ${ESTADOS[k].bg} ${ESTADOS[k].color} border-transparent`}
                    >
                      {ESTADOS[k].emoji} {ESTADOS[k].label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Acciones */}
              <div className="flex gap-3 flex-wrap">
                <button
                  onClick={() => window.open(`https://wa.me/${selectedCandidate.telefono}`, "_blank")}
                  className="flex-1 min-w-[120px] bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold py-3 rounded-xl transition-all text-sm flex items-center justify-center gap-2"
                >
                  <MessageSquare size={16} /> WhatsApp
                </button>
                <button
                  onClick={() => loadChat(selectedCandidate.telefono)}
                  className="flex-1 min-w-[120px] bg-info hover:bg-info/90 text-white font-bold py-3 rounded shadow-sm transition-all text-sm"
                >
                  Ver Chat IA
                </button>
                <button
                  onClick={() => handleSaveStateAndChat()}
                  disabled={updatingStatus}
                  className="flex-1 min-w-[120px] bg-primary hover:bg-primary/90 text-white font-bold py-3 rounded shadow-sm transition-all text-sm"
                >
                  {updatingStatus ? "Guardando..." : "Guardar Estado"}
                </button>
                <button
                  onClick={handleAtencionManual}
                  className="w-full bg-danger hover:bg-danger/90 text-white font-bold py-3 rounded shadow-sm transition-all text-sm flex items-center justify-center gap-2"
                >
                  👤 Atender Manualmente
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: CHAT ───────────────────────────────────── */}
      {isChatOpen && selectedCandidate && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1100] p-4" onClick={() => setIsChatOpen(false)}>
          <div className="bg-white w-full max-w-2xl h-[85vh] rounded-2xl shadow-2xl flex flex-col relative" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center p-5 border-b border-black/5">
              <h2 className="text-lg font-extrabold text-slate-800">Chat IA — {getNombre(selectedCandidate)}</h2>
              <button onClick={() => setIsChatOpen(false)} className="text-slate-400 hover:text-red-500 bg-slate-100 w-8 h-8 flex items-center justify-center rounded-full font-bold transition-colors">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 bg-slate-50 flex flex-col gap-3">
              {loadingChat ? (
                <div className="flex justify-center items-center h-full">
                  <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : chatHistory.length === 0 ? (
                <div className="text-center text-slate-400 mt-10">Sin mensajes registrados.</div>
              ) : (
                chatHistory
                  .filter(m => m.role !== "system" && !(typeof m.content === "string" && m.content.includes("[SISTEMA:")))
                  .map((msg, i) => {
                    const isUser = msg.role === "user" || msg.role === "user_temp";
                    return (
                      <div key={i} className={`max-w-[80%] p-3.5 rounded shadow-sm text-sm leading-relaxed ${isUser ? "self-start bg-white border border-slate-100 text-slate-800" : "self-end bg-primary text-white"}`}>
                        <div dangerouslySetInnerHTML={{ __html: (typeof msg.content === "string" ? msg.content : "").replace(/\n/g, "<br>") }} />
                        {msg.timestamp && (
                          <div className={`text-[9px] mt-1.5 text-right opacity-60`}>
                            {new Date(msg.timestamp).toLocaleString("es-MX", { hour: "2-digit", minute: "2-digit" })}
                          </div>
                        )}
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
      <div className={`fixed bottom-6 right-6 px-5 py-3 rounded font-bold text-white shadow-xl transition-all duration-300 z-[2000] ${toast ? "translate-y-0 opacity-100" : "translate-y-16 opacity-0"} ${toast?.isError ? "bg-danger" : "bg-success"}`}>
        {toast?.msg}
      </div>
    </div>
  );
}
