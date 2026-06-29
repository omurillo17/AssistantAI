"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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

const COLUMNS = [
  { id: "NUEVO", title: "Nuevos / Chat Bot", color: "#94a3b8" },
  { id: "INTERESADO", title: "Interesados", color: "#3b82f6" },
  { id: "CITA_AGENDADA", title: "Cita Agendada", color: "#f59e0b" },
  { id: "ENTREVISTADO", title: "Entrevistados", color: "#10b981" },
  { id: "RECHAZADO", title: "Descartados", color: "#ef4444" },
];

const N8N_BASE_URL = "http://localhost:5678";

export default function CRMPage() {
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);

  // Modals state
  const [selectedCandidate, setSelectedCandidate] = useState<Candidato | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);

  const router = useRouter();

  useEffect(() => {
    document.title = "CRM Candidatos | TCi";
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
      showToast("Sincronizado con Postgres", false);
    } catch (err) {
      console.warn("No se pudo cargar desde n8n. Mostrando vacío.", err);
      showToast("Error al cargar datos", true);
    } finally {
      setLoading(false);
    }
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
    showToast("Actualizando...", false);

    try {
      const res = await fetch(`${N8N_BASE_URL}/webhook/crm-candidatos-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono, estado: newStatus }),
      });
      if (!res.ok) throw new Error("API Error");
      showToast("Estado actualizado correctamente", false);
    } catch (err) {
      // Revert on error
      setCandidatos((prev) =>
        prev.map((c) => (c.telefono === telefono ? { ...c, estado: oldStatus } : c))
      );
      showToast("Error de conexión con n8n", true);
    }
  };

  const showToast = (msg: string, isError: boolean) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3000);
  };

  const handleDragStart = (e: React.DragEvent, telefono: string) => {
    e.dataTransfer.setData("telefono", telefono);
  };

  const handleDrop = (e: React.DragEvent, statusId: string) => {
    e.preventDefault();
    const telefono = e.dataTransfer.getData("telefono");
    updateStatus(telefono, statusId);
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

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-800">
      <header className="px-10 py-4 bg-white/90 backdrop-blur-md border-b border-black/10 flex justify-between items-center z-50">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg transition-colors text-sm border border-black/10"
          >
            ⬅ Atrás
          </button>
          <div className="text-2xl font-extrabold bg-gradient-to-br from-cyan-500 to-amber-500 bg-clip-text text-transparent">
            TCi CRM
          </div>
        </div>
        <div className="flex gap-4 items-center">
          {loading && <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>}
          <button
            onClick={loadData}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg shadow-md hover:shadow-lg transition-all"
          >
            Refrescar
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-x-auto p-6">
        <div className="flex gap-6 min-w-max h-full">
          {COLUMNS.map((col) => {
            const columnCandidates = candidatos.filter((c) => {
              let status = c.estado;
              if (status === "CV_RECIBIDO") status = "INTERESADO";
              return status === col.id || (!c.estado && col.id === "NUEVO");
            });

            return (
              <div
                key={col.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleDrop(e, col.id)}
                className="w-80 flex flex-col bg-slate-100/80 rounded-xl border border-black/10 shadow-sm"
              >
                <div
                  className="px-4 py-4 flex justify-between items-center border-b border-black/10 bg-slate-100/50 rounded-t-xl"
                  style={{ borderTop: `3px solid ${col.color}` }}
                >
                  <h3 className="font-bold text-slate-800">{col.title}</h3>
                  <span className="bg-black/5 text-slate-800 px-2 py-0.5 rounded-full text-xs font-semibold">
                    {columnCandidates.length}
                  </span>
                </div>
                <div className="flex-1 p-4 overflow-y-auto flex flex-col gap-3">
                  {columnCandidates.map((cand) => (
                    <div
                      key={cand.telefono}
                      draggable
                      onDragStart={(e) => handleDragStart(e, cand.telefono)}
                      onClick={() => setSelectedCandidate(cand)}
                      className="bg-white p-4 rounded-lg border border-black/10 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all cursor-grab active:cursor-grabbing hover:border-cyan-500"
                    >
                      <div className="font-bold text-slate-800 mb-1">
                        {cand.nombre_chat || cand.nombre_solicitud || "Candidato"}
                      </div>
                      <div className="text-sm text-cyan-600 font-semibold mb-2">
                        {cand.vacante_interes || "Sin vacante"}
                      </div>
                      {cand.fecha_entrevista && (
                        <div className="text-xs text-amber-600 font-semibold bg-amber-50 inline-block px-2 py-1 rounded">
                          📅 {new Date(cand.fecha_entrevista).toLocaleString("es-MX", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {/* Candidate Modal */}
      {selectedCandidate && !isChatOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1000]">
          <div className="bg-white w-[90%] max-w-lg rounded-2xl p-8 shadow-2xl max-h-[90vh] overflow-y-auto relative">
            <button
              onClick={() => setSelectedCandidate(null)}
              className="absolute top-6 right-6 text-slate-500 hover:text-slate-800 text-xl font-bold"
            >
              ✕
            </button>
            <h2 className="text-2xl font-bold text-slate-800 mb-1">
              {selectedCandidate.nombre_chat || selectedCandidate.nombre_solicitud || "Candidato"}
            </h2>
            <div className="text-cyan-600 font-semibold mb-6">
              {selectedCandidate.vacante_interes || "Sin vacante"}
            </div>

            <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl mb-6 text-sm text-slate-700 leading-relaxed">
              <strong className="text-emerald-600 block mb-1">🤖 Resumen IA:</strong>
              {selectedCandidate.resumen_ia || "La IA no ha generado un resumen todavía."}
            </div>

            <div className="space-y-3 mb-6">
              <div className="flex justify-between border-b border-slate-100 pb-2 text-sm">
                <span className="text-slate-500 font-medium">Teléfono</span>
                <span className="font-semibold">{selectedCandidate.telefono}</span>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2 text-sm">
                <span className="text-slate-500 font-medium">Estado</span>
                <span className="font-semibold">{selectedCandidate.estado}</span>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2 text-sm">
                <span className="text-slate-500 font-medium">Nave / Sucursal</span>
                <span className="font-semibold">{selectedCandidate.nave_interes || "N/A"}</span>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2 text-sm">
                <span className="text-slate-500 font-medium">Fecha de Cita</span>
                <span className="font-semibold">
                  {selectedCandidate.fecha_entrevista
                    ? new Date(selectedCandidate.fecha_entrevista).toLocaleString()
                    : "No asignada"}
                </span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => window.open(`https://wa.me/${selectedCandidate.telefono}`, "_blank")}
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-semibold py-3 rounded-xl transition-all shadow-md hover:shadow-lg"
              >
                WhatsApp 💬
              </button>
              <button
                onClick={() => loadChat(selectedCandidate.telefono)}
                className="flex-1 bg-cyan-500 hover:bg-cyan-600 text-white font-semibold py-3 rounded-xl transition-all shadow-md hover:shadow-lg"
              >
                Ver Historial 📜
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chat Modal */}
      {isChatOpen && selectedCandidate && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1000]">
          <div className="bg-white w-[90%] max-w-2xl h-[80vh] rounded-2xl p-6 shadow-2xl flex flex-col relative">
            <div className="flex justify-between items-center mb-4 pb-4 border-b border-black/5">
              <h2 className="text-xl font-bold text-slate-800">
                Chat con {selectedCandidate.nombre_chat || "Candidato"}
              </h2>
              <button
                onClick={() => setIsChatOpen(false)}
                className="text-slate-500 hover:text-slate-800 text-xl font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 bg-slate-100 rounded-xl border inset-0 border-black/5 overflow-y-auto p-4 flex flex-col gap-3">
              {loadingChat ? (
                <div className="flex justify-center items-center h-full">
                  <div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : chatHistory.length === 0 ? (
                <div className="text-center text-slate-400 mt-10">No hay mensajes registrados.</div>
              ) : (
                chatHistory
                  .filter(msg => msg.role !== "system" && (!msg.content || (typeof msg.content === 'string' && !msg.content.includes("[SISTEMA:"))))
                  .map((msg, idx) => {
                    const isUser = msg.role === "user" || msg.role === "user_temp";
                    return (
                      <div
                        key={idx}
                        className={`max-w-[80%] p-3 rounded-2xl text-sm leading-relaxed relative shadow-sm ${isUser
                          ? "self-start bg-white text-slate-800 border border-black/5 rounded-bl-sm"
                          : "self-end bg-cyan-500 text-white rounded-br-sm"
                          }`}
                      >
                        <div dangerouslySetInnerHTML={{ __html: (typeof msg.content === 'string' ? msg.content : "").replace(/\n/g, "<br>") }} />
                        {msg.timestamp && (
                          <div
                            className={`text-[10px] mt-1 text-right ${isUser ? "text-slate-400" : "text-white/80"
                              }`}
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
        className={`fixed bottom-6 right-6 px-6 py-3 rounded-xl font-semibold text-white shadow-lg transition-all duration-300 transform ${toast ? "translate-y-0 opacity-100" : "translate-y-20 opacity-0"
          } ${toast?.isError ? "bg-red-500" : "bg-emerald-500"}`}
      >
        {toast?.msg}
      </div>
    </div>
  );
}
