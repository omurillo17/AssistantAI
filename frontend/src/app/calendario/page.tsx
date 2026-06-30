"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Calendar, dateFnsLocalizer, View, Views } from "react-big-calendar";
import { format, parse, isValid, startOfWeek, getDay } from "date-fns";
import { es } from "date-fns/locale";
import "react-big-calendar/lib/css/react-big-calendar.css";

// Setup date-fns localizer for Spanish
const locales = {
  es: es,
};
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales,
});

const N8N_BASE_URL = "/api/n8n";

type Candidato = {
  telefono: string;
  estado: string;
  nombre_chat: string;
  nombre_solicitud: string;
  vacante_interes: string;
  nave_interes: string;
  fecha_entrevista: string;
  resumen_ia: string;
  creator_email?: string;
  es_google_calendar?: boolean;
};

type ChatMessage = {
  role: string;
  content: string;
  timestamp: string;
};

// Extensión para los eventos del calendario
interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource: Candidato;
}

export default function CalendarioPage() {
  const router = useRouter();
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [googleEvents, setGoogleEvents] = useState<any[]>([]);
  const [recruiterColors, setRecruiterColors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);

  // Modal de detalles
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

  // Modal de chat
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);

  // Vista actual del calendario
  const [view, setView] = useState<View>(Views.MONTH);
  const [date, setDate] = useState(new Date());

  useEffect(() => {
    document.title = "Calendario Entrevistas | TCi";
    const auth = localStorage.getItem("tci_authenticated");
    if (!auth) {
      router.push("/login");
    } else {
      loadData();
    }
  }, [router]);

  const showToast = (msg: string, isError: boolean) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3000);
  };

  const loadChat = async (telefono: string) => {
    if (!telefono || telefono === "No registrado" || telefono === "Sin registrar") {
      showToast("Teléfono no válido para chat", true);
      return;
    }
    setIsChatOpen(true);
    setLoadingChat(true);
    setChatHistory([]);
    try {
      const res = await fetch(`${N8N_BASE_URL}/webhook/crm-chat-history?telefono=${telefono}`);
      if (!res.ok) throw new Error("Error API");
      const history = await res.json();
      setChatHistory(history || []);
    } catch (err) {
      showToast("Error al obtener historial de chat", true);
    } finally {
      setLoadingChat(false);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Cargar desde la Base de Datos (Postgres)
      const res = await fetch(`${N8N_BASE_URL}/webhook/crm-candidatos-get`);
      if (!res.ok) throw new Error("Error API DB");
      const data = await res.json();
      setCandidatos(Array.isArray(data) ? data : data.data || []);

      // 2. Cargar desde Google Calendar (n8n workflow)
      try {
        const resGcal = await fetch(`${N8N_BASE_URL}/webhook/google-calendar`);
        if (resGcal.ok) {
          const gcalData = await resGcal.json();
          setGoogleEvents(Array.isArray(gcalData) ? gcalData : gcalData.events || gcalData.data || []);
        }
      } catch (errGcal) {
        console.warn("Webhook de Google Calendar no disponible aún en n8n.", errGcal);
      }

      // 3. Cargar Reclutadores para mapear colores
      try {
        const resRec = await fetch(`${N8N_BASE_URL}/webhook/api-vacantes`);
        if (resRec.ok) {
          const recData = await resRec.json();
          const recs = Array.isArray(recData) ? recData : recData.data || [];
          const colorMap: Record<string, string> = {};
          recs.forEach((r: any) => {
            if (r.calendar_id && r.color) {
              colorMap[r.calendar_id.toLowerCase()] = r.color;
            }
          });
          setRecruiterColors(colorMap);
        }
      } catch (errRec) {
        console.warn("No se pudieron cargar los colores de reclutadores.", errRec);
      }

      showToast("Datos cargados correctamente", false);
    } catch (err) {
      console.warn("No se pudo cargar la información.", err);
      showToast("Error al cargar datos", true);
    } finally {
      setLoading(false);
    }
  };

  // Filtrar candidatos con fecha de entrevista y convertirlos a eventos
  const events: CalendarEvent[] = useMemo(() => {
    const dbEvents = candidatos
      .filter((c) => c.fecha_entrevista && c.fecha_entrevista.trim() !== "")
      .map((c) => {
        let startDate = new Date(c.fecha_entrevista);

        // Si falló el parseo nativo (por ejemplo si es DD/MM/YYYY)
        if (isNaN(startDate.getTime())) {
          // Intentar con DD/MM/YYYY HH:mm
          startDate = parse(c.fecha_entrevista, "dd/MM/yyyy HH:mm", new Date());

          if (isNaN(startDate.getTime())) {
            // Intentar solo con DD/MM/YYYY
            startDate = parse(c.fecha_entrevista, "dd/MM/yyyy", new Date());
            if (!isNaN(startDate.getTime())) {
              // Asignar una hora por defecto si solo se dio el día
              startDate.setHours(10, 0, 0, 0);
            }
          }
        }

        // Si de todos modos es inválida, retornar null para filtrarlo
        if (isNaN(startDate.getTime())) {
          console.warn(`Fecha inválida ignorada: ${c.fecha_entrevista} para ${c.telefono}`);
          return null;
        }

        const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // +1 hora

        return {
          id: c.telefono,
          title: `${c.nombre_chat || c.nombre_solicitud || "Candidato"} - ${c.vacante_interes || "Sin vacante"}`,
          start: startDate,
          end: endDate,
          resource: c,
        };
      }).filter(Boolean) as CalendarEvent[];

    // Parsear eventos de Google Calendar
    const parsedGcalEvents = googleEvents.map((ge) => {
      let nombre = ge.title || ge.summary || "Candidato";
      let vacante = "Sin especificar";
      let telefono = "No registrado";
      let nave = "No especificada";
      const desc = ge.description || "";

      // 1. Extraer Nombre y Vacante del Título (ej. "Entrevista para EMPACADOR con Juan")
      if (nombre.toLowerCase().includes(" con ")) {
        const parts = nombre.split(/ con /i);
        vacante = parts[0].replace(/Entrevista para /i, "").replace(/Entrevista /i, "").trim();
        nombre = parts[1].trim();
      } else if (nombre.includes(" - ")) {
        const parts = nombre.split(" - ");
        nombre = parts[0].replace(/Entrevista /i, "").trim();
        vacante = parts[1].trim();
      } else {
        nombre = nombre.replace(/Entrevista con /i, "").replace(/Entrevista /i, "").trim();
      }

      // 2. Extraer campos de la descripción si existen
      const nombreMatch = desc.match(/Nombre:\s*(.+)/i);
      if (nombreMatch) nombre = nombreMatch[1].trim();

      const naveMatch = desc.match(/Nave\/Sucursal:\s*(.+)/i);
      if (naveMatch) nave = naveMatch[1].trim();

      const telMatch = desc.match(/(?:Tel[ée]fono|Tel):\s*([0-9\+\s]+)/i);
      if (telMatch) telefono = telMatch[1].trim();

      const vacanteMatch = desc.match(/Vacante:\s*(.+)/i);
      if (vacanteMatch) vacante = vacanteMatch[1].trim();

      return {
        id: ge.id || Math.random().toString(),
        title: ge.title || ge.summary || "Entrevista",
        start: new Date(ge.start?.dateTime || ge.start || new Date()),
        end: new Date(ge.end?.dateTime || ge.end || new Date()),
        resource: {
          ...ge,
          es_google_calendar: true,
          resumen_ia: desc,
          creator_email: ge.creator || ge.organizer || "desconocido",
          // Campos simulados para compatibilidad visual
          nombre_chat: nombre,
          vacante_interes: vacante,
          telefono: telefono,
          nave_interes: nave,
          estado: "Agendado (GCal)"
        }
      };
    });

    return [...dbEvents, ...parsedGcalEvents];
  }, [candidatos, googleEvents]);

  // Formateador visual explícito (DD/MM/YYYY HH:mm) como se pidió en el plan
  const formatVisualDate = (d: Date) => {
    return format(d, "dd/MM/yyyy HH:mm");
  };

  const handleSelectEvent = (event: CalendarEvent) => {
    setSelectedEvent(event);
  };

  if (loading) return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500">Cargando calendario...</div>;

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-800">
      <header className="px-10 py-5 bg-white/90 backdrop-blur-md border-b border-black/10 flex justify-between items-center z-50">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg transition-colors text-sm border border-black/10"
          >
            ⬅ Atrás
          </button>
          <div className="text-2xl font-extrabold bg-gradient-to-br from-indigo-500 to-purple-500 bg-clip-text text-transparent">
            Calendario de Entrevistas
          </div>
        </div>
        <button
          onClick={loadData}
          className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:shadow-lg transition-all"
        >
          Actualizar Datos
        </button>
      </header>

      <main className="flex-1 p-6 overflow-hidden flex flex-col max-w-7xl mx-auto w-full">
        <div className="bg-white flex-1 p-6 rounded-2xl shadow-sm border border-black/10 h-full flex flex-col">
          <Calendar
            localizer={localizer}
            events={events}
            startAccessor="start"
            endAccessor="end"
            culture="es"
            view={view}
            date={date}
            onView={(v) => setView(v)}
            onNavigate={(d) => setDate(d)}
            onSelectEvent={handleSelectEvent}
            messages={{
              next: "Sig",
              previous: "Ant",
              today: "Hoy",
              month: "Mes",
              week: "Semana",
              day: "Día",
              agenda: "Agenda",
              date: "Fecha",
              time: "Hora",
              event: "Evento",
              noEventsInRange: "No hay entrevistas en este rango.",
            }}
            eventPropGetter={(event) => {
              let bgColor = "#6366f1"; // indigo-500 (default)

              if (event.resource.creator_email) {
                const email = String(event.resource.creator_email).toLowerCase();
                if (recruiterColors[email]) {
                  bgColor = recruiterColors[email];
                } else {
                  // Fallback a color generado basado en el correo
                  const colors = ['#6366f1', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6'];
                  let hash = 0;
                  for (let i = 0; i < email.length; i++) {
                    hash = email.charCodeAt(i) + ((hash << 5) - hash);
                  }
                  bgColor = colors[Math.abs(hash) % colors.length];
                }
              }

              return {
                style: {
                  backgroundColor: bgColor,
                  borderRadius: "6px",
                  border: "none",
                  color: "white",
                  fontWeight: "bold",
                  fontSize: "12px",
                  padding: "2px 6px",
                },
              };
            }}
            className="font-sans flex-1"
          />
        </div>
      </main>

      {/* Modal de Detalles del Evento */}
      {selectedEvent && !isChatOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1000]">
          <div className="bg-white w-[90%] max-w-md rounded-2xl p-8 shadow-2xl relative">
            <button
              onClick={() => setSelectedEvent(null)}
              className="absolute top-6 right-6 text-slate-500 hover:text-slate-800 text-xl font-bold"
            >
              ✕
            </button>
            <h2 className="text-2xl font-bold text-slate-800 mb-1">
              {selectedEvent.resource.nombre_chat || selectedEvent.resource.nombre_solicitud || "Candidato"}
            </h2>
            <div className="text-indigo-600 font-semibold mb-6">
              {selectedEvent.resource.vacante_interes || "Sin vacante"}
            </div>

            <div className="space-y-3 mb-6 bg-slate-50 p-4 rounded-xl border border-black/5">
              <div className="flex justify-between border-b border-black/5 pb-2 text-sm">
                <span className="text-slate-500 font-medium">Fecha Visual:</span>
                {/* Mostramos estrictamente DD/MM/YYYY como pidió el usuario */}
                <span className="font-bold text-slate-800">{formatVisualDate(selectedEvent.start)}</span>
              </div>
              <div className="flex justify-between border-b border-black/5 pb-2 text-sm">
                <span className="text-slate-500 font-medium">Teléfono:</span>
                <span className="font-semibold">{selectedEvent.resource.telefono}</span>
              </div>
              <div className="flex justify-between border-b border-black/5 pb-2 text-sm">
                <span className="text-slate-500 font-medium">Estado:</span>
                <span className="font-semibold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-xs">
                  {selectedEvent.resource.estado}
                </span>
              </div>
              <div className="flex justify-between border-b border-black/5 pb-2 text-sm">
                <span className="text-slate-500 font-medium">Nave / Sucursal:</span>
                <span className="font-semibold">{selectedEvent.resource.nave_interes || "N/A"}</span>
              </div>
            </div>

            {selectedEvent.resource.resumen_ia && (
              <div className="mb-6">
                <span className="block text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">
                  Resumen de la IA
                </span>
                <div className="text-sm text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-lg border border-black/5 whitespace-pre-wrap">
                  {selectedEvent.resource.resumen_ia}
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => window.open(`https://wa.me/${selectedEvent.resource.telefono}`, "_blank")}
                className="flex-1 bg-[#25D366] hover:bg-emerald-600 text-white font-semibold py-3 rounded-xl transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
              >
                <span>Abrir WhatsApp</span>
              </button>
              {selectedEvent.resource.telefono && selectedEvent.resource.telefono !== "No registrado" && (
                <button
                  onClick={() => loadChat(selectedEvent.resource.telefono)}
                  className="flex-1 bg-cyan-500 hover:bg-cyan-600 text-white font-semibold py-3 rounded-xl transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
                >
                  <span>Ver Chat</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de Chat */}
      {isChatOpen && selectedEvent && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1100]">
          <div className="bg-white w-[90%] max-w-2xl h-[80vh] rounded-2xl p-6 shadow-2xl flex flex-col relative">
            <div className="flex justify-between items-center mb-4 pb-4 border-b border-black/5">
              <h2 className="text-xl font-bold text-slate-800">
                Chat con {selectedEvent.resource.nombre_chat || selectedEvent.resource.nombre_solicitud || selectedEvent.title || "Candidato"}
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
