"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend
} from "recharts";
import { Users, UserCheck, CalendarDays, AlertTriangle, Info, Search } from "lucide-react";

type Candidato = {
  telefono: string;
  estado: string;
  nombre_chat: string;
  nombre_solicitud: string;
  vacante_interes: string;
  nave_interes: string;
  fecha_entrevista: string;
  resumen_ia: string;
  ultima_interaccion: string;
};

type ChatMessage = {
  role: string;
  content: string;
  timestamp: string;
};

const N8N_BASE_URL = "/api/n8n";

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  NUEVO: { label: "Nuevos", color: "text-slate-600", bg: "bg-slate-100" },
  INFORMACION: { label: "Info. General", color: "text-indigo-600", bg: "bg-indigo-100" },
  INTERESADO: { label: "Interesado", color: "text-blue-600", bg: "bg-blue-100" },
  CITA_AGENDADA: { label: "Cita Agendada", color: "text-amber-600", bg: "bg-amber-100" },
  ENTREVISTADO: { label: "Entrevistado", color: "text-emerald-600", bg: "bg-emerald-100" },
  ESCALADO: { label: "Escalado (Agente)", color: "text-purple-600", bg: "bg-purple-100" },
  RECHAZADO: { label: "Descartado", color: "text-red-600", bg: "bg-red-100" },
  CV_RECIBIDO: { label: "Interesado (CV)", color: "text-blue-600", bg: "bg-blue-100" },
};

const COLORS = ['#6366f1', '#3b82f6', '#14b8a6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export default function CRMDashboard() {
  const router = useRouter();
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);

  // Filtros de tabla
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("TODOS");

  // Modals state
  const [selectedCandidate, setSelectedCandidate] = useState<Candidato | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);

  useEffect(() => {
    document.title = "Dashboard Analítico | TCi";
    const auth = localStorage.getItem("tci_authenticated");
    if (!auth) {
      router.push("/login");
    } else {
      loadData();
    }
  }, [router]);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${N8N_BASE_URL}/webhook/crm-candidatos-get`);
      if (!res.ok) throw new Error("Error API");
      const data = await res.json();
      setCandidatos(Array.isArray(data) ? data : data.data || []);
      showToast("Datos sincronizados", false);
    } catch (err) {
      console.warn("No se pudo cargar desde n8n.", err);
      showToast("Error al cargar datos", true);
    } finally {
      setLoading(false);
    }
  };

  const showToast = (msg: string, isError: boolean) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3000);
  };

  const updateStatus = async (telefono: string, newStatus: string) => {
    const cand = candidatos.find((c) => c.telefono === telefono);
    if (!cand) return;
    const oldStatus = cand.estado;
    if (oldStatus === newStatus) return;

    // Optimistic update
    setCandidatos((prev) =>
      prev.map((c) => (c.telefono === telefono ? { ...c, estado: newStatus } : c))
    );
    showToast("Actualizando estado...", false);

    try {
      const res = await fetch(`${N8N_BASE_URL}/webhook/crm-candidatos-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono, estado: newStatus }),
      });
      if (!res.ok) throw new Error("API Error");
      showToast("Estado actualizado correctamente", false);
    } catch (err) {
      setCandidatos((prev) =>
        prev.map((c) => (c.telefono === telefono ? { ...c, estado: oldStatus } : c))
      );
      showToast("Error de conexión con n8n", true);
    }
  };

  const loadChat = async (telefono: string) => {
    setIsChatOpen(true);
    setLoadingChat(true);
    setChatHistory([]);
    try {
      const res = await fetch(`${N8N_BASE_URL}/webhook/crm-chat-history?telefono=${telefono}`);
      if (!res.ok) throw new Error("Error API");
      const history = await res.json();
      setChatHistory(history || []);
    } catch (err) {
      showToast("Error al obtener historial", true);
    } finally {
      setLoadingChat(false);
    }
  };

  // --- DERIVED DATA FOR CHARTS & KPIS ---
  const kpis = useMemo(() => {
    let total = 0, nuevos = 0, info = 0, interesados = 0, agendados = 0, escalados = 0;
    candidatos.forEach(c => {
      total++;
      const st = c.estado || "NUEVO";
      if (st === "NUEVO") nuevos++;
      else if (st === "INFORMACION") info++;
      else if (st === "INTERESADO" || st === "CV_RECIBIDO") interesados++;
      else if (st === "CITA_AGENDADA" || st === "ENTREVISTADO") agendados++;
      else if (st === "ESCALADO") escalados++;
    });
    return { total, nuevos, info, interesados, agendados, escalados };
  }, [candidatos]);

  const funnelData = useMemo(() => {
    return [
      { name: "Iniciaron Chat (Nuevos)", count: kpis.nuevos + kpis.info + kpis.interesados + kpis.agendados + kpis.escalados },
      { name: "Filtro Superado (Interesados)", count: kpis.interesados + kpis.agendados },
      { name: "Conversión Exitosa (Agendados)", count: kpis.agendados },
    ];
  }, [kpis]);

  const vacantesData = useMemo(() => {
    const counts: Record<string, number> = {};
    candidatos.forEach(c => {
      const v = c.vacante_interes || "Sin Especificar";
      counts[v] = (counts[v] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8); // Top 8
  }, [candidatos]);

  const filteredTable = useMemo(() => {
    return candidatos.filter(c => {
      const matchSearch = (c.nombre_chat || c.telefono || "").toLowerCase().includes(searchTerm.toLowerCase());
      let st = c.estado || "NUEVO";
      if (st === "CV_RECIBIDO") st = "INTERESADO";
      const matchStatus = statusFilter === "TODOS" || st === statusFilter;
      return matchSearch && matchStatus;
    }).sort((a, b) => {
      const dateA = a.fecha_entrevista ? new Date(a.fecha_entrevista).getTime() : 0;
      const dateB = b.fecha_entrevista ? new Date(b.fecha_entrevista).getTime() : 0;
      return dateB - dateA;
    });
  }, [candidatos, searchTerm, statusFilter]);

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-800 overflow-hidden">
      <header className="px-10 py-5 bg-white/90 backdrop-blur-md border-b border-black/10 flex justify-between items-center z-50">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/")}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg transition-colors text-sm border border-black/10"
          >
            ⬅ Inicio
          </button>
          <div className="text-2xl font-extrabold bg-gradient-to-br from-indigo-500 to-purple-500 bg-clip-text text-transparent">
            Dashboard de Reclutamiento AI
          </div>
        </div>
        <div className="flex gap-4 items-center">
          {loading && <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>}
          <button
            onClick={loadData}
            className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:shadow-lg transition-all"
          >
            Actualizar Métricas
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <div className="max-w-7xl mx-auto space-y-8">
          
          {/* KPI CARDS */}
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-black/5 shadow-sm flex items-center gap-4 hover:-translate-y-1 transition-transform">
              <div className="p-3 bg-slate-100 text-slate-600 rounded-xl"><Users size={24} /></div>
              <div>
                <div className="text-sm text-slate-500 font-bold uppercase tracking-wider">Total</div>
                <div className="text-3xl font-extrabold text-slate-800">{kpis.total}</div>
              </div>
            </div>
            <div className="bg-white p-5 rounded-2xl border border-black/5 shadow-sm flex items-center gap-4 hover:-translate-y-1 transition-transform">
              <div className="p-3 bg-indigo-100 text-indigo-600 rounded-xl"><Info size={24} /></div>
              <div>
                <div className="text-sm text-slate-500 font-bold uppercase tracking-wider">Info / Nuevos</div>
                <div className="text-3xl font-extrabold text-slate-800">{kpis.nuevos + kpis.info}</div>
              </div>
            </div>
            <div className="bg-white p-5 rounded-2xl border border-black/5 shadow-sm flex items-center gap-4 hover:-translate-y-1 transition-transform">
              <div className="p-3 bg-blue-100 text-blue-600 rounded-xl"><UserCheck size={24} /></div>
              <div>
                <div className="text-sm text-slate-500 font-bold uppercase tracking-wider">Interesados</div>
                <div className="text-3xl font-extrabold text-slate-800">{kpis.interesados}</div>
              </div>
            </div>
            <div className="bg-white p-5 rounded-2xl border border-black/5 shadow-sm flex items-center gap-4 hover:-translate-y-1 transition-transform">
              <div className="p-3 bg-emerald-100 text-emerald-600 rounded-xl"><CalendarDays size={24} /></div>
              <div>
                <div className="text-sm text-slate-500 font-bold uppercase tracking-wider">Agendados</div>
                <div className="text-3xl font-extrabold text-slate-800">{kpis.agendados}</div>
              </div>
            </div>
            <div className="bg-white p-5 rounded-2xl border border-black/5 shadow-sm flex items-center gap-4 hover:-translate-y-1 transition-transform">
              <div className="p-3 bg-purple-100 text-purple-600 rounded-xl"><AlertTriangle size={24} /></div>
              <div>
                <div className="text-sm text-slate-500 font-bold uppercase tracking-wider">Escalados</div>
                <div className="text-3xl font-extrabold text-slate-800">{kpis.escalados}</div>
              </div>
            </div>
          </div>

          {/* CHARTS */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-sm">
              <h3 className="text-lg font-bold text-slate-700 mb-6">Embudo de Conversión (IA)</h3>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={funnelData} layout="vertical" margin={{ top: 0, right: 30, left: 20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#e2e8f0" />
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" width={150} tick={{ fill: '#475569', fontSize: 12, fontWeight: 600 }} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                    <Bar dataKey="count" fill="#6366f1" radius={[0, 8, 8, 0]} barSize={32}>
                      {funnelData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-sm">
              <h3 className="text-lg font-bold text-slate-700 mb-6">Vacantes Más Solicitadas</h3>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={vacantesData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="none"
                    >
                      {vacantesData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                    <Legend layout="vertical" verticalAlign="middle" align="right" iconType="circle" />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* DATA TABLE */}
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden flex flex-col">
            <div className="p-6 border-b border-black/5 flex flex-col sm:flex-row justify-between items-center gap-4 bg-slate-50/50">
              <h3 className="text-lg font-bold text-slate-800">Directorio de Candidatos</h3>
              <div className="flex gap-3 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-64">
                  <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
                  <input 
                    type="text" 
                    placeholder="Buscar nombre o teléfono..." 
                    className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                  />
                </div>
                <select 
                  className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer"
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                >
                  <option value="TODOS">Todos los Estados</option>
                  <option value="NUEVO">Nuevos</option>
                  <option value="INFORMACION">Info. General</option>
                  <option value="INTERESADO">Interesados</option>
                  <option value="CITA_AGENDADA">Citas Agendadas</option>
                  <option value="ENTREVISTADO">Entrevistados</option>
                  <option value="ESCALADO">Escalados</option>
                  <option value="RECHAZADO">Descartados</option>
                </select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-black/5 text-slate-500 text-xs uppercase tracking-wider">
                    <th className="p-4 font-bold">Candidato</th>
                    <th className="p-4 font-bold">Teléfono</th>
                    <th className="p-4 font-bold">Vacante / Sucursal</th>
                    <th className="p-4 font-bold">Estado (IA)</th>
                    <th className="p-4 font-bold text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTable.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-400 font-semibold">No se encontraron candidatos con esos filtros.</td>
                    </tr>
                  ) : (
                    filteredTable.map((cand, idx) => {
                      let st = cand.estado || "NUEVO";
                      if (st === "CV_RECIBIDO") st = "INTERESADO";
                      const statusDef = STATUS_MAP[st] || STATUS_MAP.NUEVO;

                      return (
                        <tr key={cand.telefono + idx} className="border-b border-slate-100 hover:bg-slate-50/80 transition-colors group">
                          <td className="p-4">
                            <div className="font-bold text-slate-800">{cand.nombre_chat || cand.nombre_solicitud || "Desconocido"}</div>
                            {cand.fecha_entrevista && (
                              <div className="text-xs text-slate-500 mt-1 font-semibold flex items-center gap-1">
                                📅 {new Date(cand.fecha_entrevista).toLocaleString("es-MX", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                              </div>
                            )}
                          </td>
                          <td className="p-4 font-mono text-sm text-slate-600">{cand.telefono}</td>
                          <td className="p-4">
                            <div className="font-semibold text-indigo-600 text-sm">{cand.vacante_interes || "---"}</div>
                            <div className="text-xs text-slate-500 font-medium">Nave: {cand.nave_interes || "---"}</div>
                          </td>
                          <td className="p-4">
                            <select 
                              className={`text-xs font-bold px-3 py-1.5 rounded-full cursor-pointer appearance-none text-center outline-none transition-colors border border-transparent hover:border-black/10 ${statusDef.bg} ${statusDef.color}`}
                              value={st}
                              onChange={(e) => updateStatus(cand.telefono, e.target.value)}
                            >
                              {Object.keys(STATUS_MAP).filter(k => k !== "CV_RECIBIDO").map(k => (
                                <option key={k} value={k}>{STATUS_MAP[k].label}</option>
                              ))}
                            </select>
                          </td>
                          <td className="p-4 text-center">
                            <button 
                              onClick={() => setSelectedCandidate(cand)}
                              className="text-sm font-semibold bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-100 transition-colors shadow-sm"
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
        </div>
      </main>

      {/* Candidate Modal (Reused) */}
      {selectedCandidate && !isChatOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1000] p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl p-8 shadow-2xl max-h-[90vh] overflow-y-auto relative">
            <button
              onClick={() => setSelectedCandidate(null)}
              className="absolute top-6 right-6 text-slate-400 hover:text-slate-800 text-xl font-bold transition-colors"
            >
              ✕
            </button>
            <h2 className="text-2xl font-bold text-slate-800 mb-1">
              {selectedCandidate.nombre_chat || selectedCandidate.nombre_solicitud || "Candidato"}
            </h2>
            <div className="text-indigo-600 font-bold mb-6 text-sm bg-indigo-50 inline-block px-3 py-1 rounded-full">
              {selectedCandidate.vacante_interes || "Sin vacante asignada"}
            </div>

            <div className="bg-slate-50 border border-slate-100 p-5 rounded-xl mb-6 text-sm text-slate-700 leading-relaxed shadow-inner">
              <strong className="text-indigo-600 block mb-2 uppercase tracking-wider text-xs">🤖 Resumen de la Inteligencia Artificial:</strong>
              <div className="whitespace-pre-wrap">{selectedCandidate.resumen_ia || "La IA no ha generado un resumen detallado todavía. Probablemente la conversación apenas inició."}</div>
            </div>

            <div className="space-y-4 mb-8 bg-white border border-slate-100 rounded-xl p-5 shadow-sm">
              <div className="flex justify-between border-b border-slate-50 pb-3 text-sm">
                <span className="text-slate-500 font-medium flex items-center gap-2"><UserCheck size={16}/> Teléfono</span>
                <span className="font-bold text-slate-700">{selectedCandidate.telefono}</span>
              </div>
              <div className="flex justify-between border-b border-slate-50 pb-3 text-sm items-center">
                <span className="text-slate-500 font-medium">Estado Actual</span>
                <span className={`font-bold px-3 py-1 rounded-full text-xs ${STATUS_MAP[selectedCandidate.estado || "NUEVO"]?.bg} ${STATUS_MAP[selectedCandidate.estado || "NUEVO"]?.color}`}>
                  {STATUS_MAP[selectedCandidate.estado || "NUEVO"]?.label}
                </span>
              </div>
              <div className="flex justify-between border-b border-slate-50 pb-3 text-sm">
                <span className="text-slate-500 font-medium">Nave / Sucursal</span>
                <span className="font-bold text-slate-700">{selectedCandidate.nave_interes || "N/A"}</span>
              </div>
              <div className="flex justify-between text-sm items-center">
                <span className="text-slate-500 font-medium flex items-center gap-2"><CalendarDays size={16}/> Fecha Agendada</span>
                <span className="font-bold text-amber-600 bg-amber-50 px-3 py-1 rounded-lg">
                  {selectedCandidate.fecha_entrevista
                    ? new Date(selectedCandidate.fecha_entrevista).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })
                    : "No asignada"}
                </span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => window.open(`https://wa.me/${selectedCandidate.telefono}`, "_blank")}
                className="flex-1 bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold py-3.5 rounded-xl transition-all shadow-md hover:shadow-lg text-sm text-center"
              >
                Escribir en WhatsApp
              </button>
              <button
                onClick={() => loadChat(selectedCandidate.telefono)}
                className="flex-1 bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-3.5 rounded-xl transition-all shadow-md hover:shadow-lg text-sm"
              >
                Ver Historial de Chat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chat Modal (Reused) */}
      {isChatOpen && selectedCandidate && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1100] p-4">
          <div className="bg-white w-full max-w-2xl h-[85vh] rounded-2xl p-6 shadow-2xl flex flex-col relative">
            <div className="flex justify-between items-center mb-4 pb-4 border-b border-black/5">
              <h2 className="text-xl font-extrabold text-slate-800">
                Historial de IA: {selectedCandidate.nombre_chat || "Candidato"}
              </h2>
              <button
                onClick={() => setIsChatOpen(false)}
                className="text-slate-400 hover:text-red-500 bg-slate-100 hover:bg-red-50 w-8 h-8 flex items-center justify-center rounded-full transition-colors font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 bg-[url('https://i.pinimg.com/736x/8c/98/99/8c98994518b575bfd8c949e91d20548b.jpg')] bg-cover bg-center rounded-xl border inset-0 border-black/10 overflow-y-auto p-4 flex flex-col gap-4 shadow-inner relative">
              <div className="absolute inset-0 bg-white/70 backdrop-blur-[2px] rounded-xl pointer-events-none"></div>
              {loadingChat ? (
                <div className="flex justify-center items-center h-full relative z-10">
                  <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : chatHistory.length === 0 ? (
                <div className="text-center bg-white/80 p-4 rounded-xl shadow-sm text-slate-500 mt-10 relative z-10 mx-auto font-medium">No hay mensajes registrados.</div>
              ) : (
                chatHistory
                  .filter(msg => msg.role !== "system" && (!msg.content || (typeof msg.content === 'string' && !msg.content.includes("[SISTEMA:"))))
                  .map((msg, idx) => {
                    const isUser = msg.role === "user" || msg.role === "user_temp";
                    return (
                      <div
                        key={idx}
                        className={`max-w-[85%] p-3.5 rounded-2xl text-[15px] leading-relaxed relative shadow-md z-10 font-medium ${isUser
                          ? "self-start bg-white text-slate-800 border-none rounded-tl-sm"
                          : "self-end bg-[#dcf8c6] text-slate-800 rounded-tr-sm"
                          }`}
                      >
                        <div dangerouslySetInnerHTML={{ __html: (typeof msg.content === 'string' ? msg.content : "").replace(/\n/g, "<br>") }} />
                        {msg.timestamp && (
                          <div
                            className={`text-[10px] mt-1.5 text-right opacity-60 font-bold`}
                          >
                            {new Date(msg.timestamp).toLocaleString("es-MX", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
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

      {/* Toast */}
      <div
        className={`fixed bottom-6 right-6 px-6 py-3 rounded-xl font-bold text-white shadow-xl transition-all duration-300 transform z-[2000] ${toast ? "translate-y-0 opacity-100" : "translate-y-20 opacity-0"
          } ${toast?.isError ? "bg-red-500" : "bg-emerald-500"}`}
      >
        {toast?.msg}
      </div>
    </div>
  );
}
