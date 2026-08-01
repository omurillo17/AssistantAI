"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Calendar, dateFnsLocalizer, View, Views } from "react-big-calendar";
import { format, parse, startOfWeek, getDay, addMonths, subMonths, addWeeks, subWeeks, addDays, subDays, startOfMonth } from "date-fns";
import { es } from "date-fns/locale";
import { MessageSquare, ChevronDown, ChevronRight, XCircle, ChevronLeft, RefreshCw, Calendar as CalendarIcon, LayoutList, Users } from "lucide-react";
import "react-big-calendar/lib/css/react-big-calendar.css";

const locales = { es };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales,
});

const N8N_BASE_URL = "/api/n8n";
const CANCEL_PASSWORD = "virgo2024"; // contraseña para confirmar cancelación

const normalizeStr = (str: string) =>
  String(str || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

import type { Candidato, ChatMessage } from "@/types";

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource: Candidato;
}

// ─── Custom Toolbar ──────────────────────────────────────────────────────────
function CustomToolbar({ date, view, onNavigate, onView }: any) {
  const views: { key: View; label: string }[] = [
    { key: Views.MONTH, label: "Mes" },
    { key: Views.WEEK, label: "Semana" },
    { key: Views.DAY, label: "Día" },
    { key: Views.AGENDA, label: "Agenda" },
  ];

  const navigatePrev = () => {
    if (view === Views.MONTH) onNavigate("prev", subMonths(date, 1));
    else if (view === Views.WEEK) onNavigate("prev", subWeeks(date, 1));
    else onNavigate("prev", subDays(date, 1));
  };
  const navigateNext = () => {
    if (view === Views.MONTH) onNavigate("next", addMonths(date, 1));
    else if (view === Views.WEEK) onNavigate("next", addWeeks(date, 1));
    else onNavigate("next", addDays(date, 1));
  };

  const getLabel = () => {
    if (view === Views.MONTH) return format(date, "MMMM yyyy", { locale: es });
    if (view === Views.WEEK) {
      const start = startOfWeek(date, { weekStartsOn: 1 });
      const end = addDays(start, 6);
      return `${format(start, "d MMM", { locale: es })} – ${format(end, "d MMM yyyy", { locale: es })}`;
    }
    if (view === Views.DAY) return format(date, "EEEE d 'de' MMMM yyyy", { locale: es });
    return format(date, "MMMM yyyy", { locale: es });
  };

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mb-4 pb-4 border-b border-slate-100">
      {/* Navegación */}
      <div className="flex items-center gap-2">
        <button
          onClick={navigatePrev}
          className="p-2 rounded-lg hover:bg-slate-100 transition-colors border border-slate-200"
          title="Anterior"
        >
          <ChevronLeft size={18} className="text-slate-600" />
        </button>
        <button
          onClick={() => onNavigate("today", new Date())}
          className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 transition-colors"
        >
          Hoy
        </button>
        <button
          onClick={navigateNext}
          className="p-2 rounded-lg hover:bg-slate-100 transition-colors border border-slate-200"
          title="Siguiente"
        >
          <ChevronRight size={18} className="text-slate-600" />
        </button>
        <span className="ml-2 font-bold text-slate-800 text-base capitalize">
          {getLabel()}
        </span>
      </div>

      {/* Selector de vista */}
      <div className="flex items-center bg-slate-100 rounded-xl p-1 gap-1">
        {views.map((v) => (
          <button
            key={v.key}
            onClick={() => onView(v.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${view === v.key
                ? "bg-white text-indigo-700 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
              }`}
          >
            {v.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function CalendarioPage() {
  const router = useRouter();
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [googleEvents, setGoogleEvents] = useState<any[]>([]);
  const [recruiterColors, setRecruiterColors] = useState<Record<string, string>>({});
  const [recruiterNames, setRecruiterNames] = useState<Record<string, string>>({});
  const [recruiterIdToEmail, setRecruiterIdToEmail] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);
  const [myCalId, setMyCalId] = useState("");
  const [navesList, setNavesList] = useState<{ id: string; nombre: string }[]>([]);
  const [misNaveIds, setMisNaveIds] = useState<Set<string>>(new Set());
  const [selectedNave, setSelectedNave] = useState<string>("TODOS");

  // Panel lateral
  const [expandedRecruiters, setExpandedRecruiters] = useState<Record<string, boolean>>({});
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  // Modal de detalles
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

  // Modal de confirmación de cancelación
  const [cancelTarget, setCancelTarget] = useState<CalendarEvent | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [recruiterPhone, setRecruiterPhone] = useState("");
  const [cancelPassword, setCancelPassword] = useState("");
  const [cancelError, setCancelError] = useState("");

  // Modal de reagendar
  const [rescheduleTarget, setRescheduleTarget] = useState<CalendarEvent | null>(null);
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [rescheduling, setRescheduling] = useState(false);

  // Modal de crear bloqueo por rango (días, horas, minutos)
  const [blockTarget, setBlockTarget] = useState<{ start: Date; end: Date } | null>(null);
  const [blockStartStr, setBlockStartStr] = useState("");
  const [blockEndStr, setBlockEndStr] = useState("");
  const [blockTitle, setBlockTitle] = useState("Vacaciones / Bloqueo");
  const [blocking, setBlocking] = useState(false);

  // Modal de chat
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);

  // Vista del calendario
  const [view, setView] = useState<View>(Views.MONTH);
  const [date, setDate] = useState(new Date());

  useEffect(() => {
    document.title = "Calendario Entrevistas | TCi";
    loadData();
  }, [router]);

  const showToast = (msg: string, isError: boolean) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3500);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${N8N_BASE_URL}/webhook/crm-candidatos-get`);
      if (!res.ok) throw new Error("Error API DB");
      const data = await res.json();
      setCandidatos(Array.isArray(data) ? data : data.data || []);

      // Cargar Naves de la empresa
      try {
        const resE = await fetch("/api/db/empresas");
        if (resE.ok) {
          const eData = await resE.json();
          const empList = eData.empresas || [];
          const allNaves: { id: string; nombre: string }[] = [];
          empList.forEach((e: any) => {
            (e.naves || []).forEach((n: any) => {
              allNaves.push({ id: n.id, nombre: n.nombre || "" });
            });
          });
          setNavesList(allNaves);
        }
      } catch (err) {
        console.error("Error cargando naves:", err);
      }

      try {
        const startStr = subMonths(new Date(), 2).toISOString();
        const endStr = addMonths(new Date(), 3).toISOString();
        const resGcal = await fetch(`${N8N_BASE_URL}/webhook/google-calendar?start=${startStr}&end=${endStr}`);
        if (resGcal.ok) {
          const gcalData = await resGcal.json();
          setGoogleEvents(Array.isArray(gcalData) ? gcalData : gcalData.events || gcalData.data || []);
        }
      } catch { }

      try {
        const resRec = await fetch(`/api/db/vacantes`);
        if (resRec.ok) {
          const recData = await resRec.json();
          const recs: any[] = Array.isArray(recData) ? recData : recData.data || [];
          const colorMap: Record<string, string> = {};
          const nameMap: Record<string, string> = {};
          const idToEmailMap: Record<string, string> = {};
          const palette = ["#6366f1", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
          let myCalIdLocal = "";
          const myRecruiterId = localStorage.getItem("tci_reclutador_id");

          const misNaves = new Set<string>();

          recs.forEach((r: any, i: number) => {
            const calId = (r.calendar_id || "").toLowerCase();
            if (calId) {
              colorMap[calId] = r.color || palette[i % palette.length];
              nameMap[calId] = r.nombre || r.name || calId;
              if (r.reclutador_id) idToEmailMap[r.reclutador_id] = calId;
              if (r.reclutador_id == myRecruiterId) {
                myCalIdLocal = calId;
              }
            }
            if (r.reclutador_id == myRecruiterId) {
              // vacantes_def.naves guarda IDs de nave (no nombres), ver VacancyModal.tsx
              (r.vacantes || []).forEach((v: any) => {
                (v.naves || []).forEach((navId: string) => misNaves.add(navId));
              });
            }
          });
          setRecruiterColors(colorMap);
          setRecruiterNames(nameMap);
          setRecruiterIdToEmail(idToEmailMap);
          if (myCalIdLocal) setMyCalId(myCalIdLocal);
          setMisNaveIds(misNaves);
        }
      } catch { }

      showToast("Datos cargados", false);
    } catch {
      showToast("Error al cargar datos", true);
    } finally {
      setLoading(false);
    }
  };

  // ── Events ──────────────────────────────────────────────────────────────
  const events: CalendarEvent[] = useMemo(() => {
    const dbEvents = candidatos
      .filter((c) => c.fecha_entrevista?.trim())
      .map((c) => {
        const fechaStr = c.fecha_entrevista!;
        let startDate = new Date(fechaStr);
        if (isNaN(startDate.getTime())) startDate = parse(fechaStr, "dd/MM/yyyy HH:mm", new Date());
        if (isNaN(startDate.getTime())) {
          startDate = parse(fechaStr, "dd/MM/yyyy", new Date());
          if (!isNaN(startDate.getTime())) startDate.setHours(10, 0, 0, 0);
        }
        if (isNaN(startDate.getTime())) return null;
        return {
          id: c.telefono,
          title: `${c.nombre_chat || c.nombre_solicitud || "Candidato"} – ${c.vacante_interes || "Sin vacante"}`,
          start: startDate,
          end: new Date(startDate.getTime() + 60 * 60 * 1000),
          resource: {
            ...c,
            creator_email: c.asignado_a ? (recruiterIdToEmail[c.asignado_a] || "sin_asignar") : "sin_asignar",
          },
        };
      }).filter(Boolean) as CalendarEvent[];

    const parsedGcalEvents = googleEvents.map((ge) => {
      let nombre = ge.title || ge.summary || "Candidato";
      let vacante = "Sin especificar";
      let telefono = "No registrado";
      let nave = "No especificada";
      const desc = ge.description || "";

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

      const nombreMatch = desc.match(/Nombre:\s*(.+)/i);
      if (nombreMatch) nombre = nombreMatch[1].trim();
      const naveMatch = desc.match(/Nave\/Sucursal:\s*(.+)/i);
      if (naveMatch) nave = naveMatch[1].trim();
      const telMatch = desc.match(/(?:Tel[ée]fono|Tel):\s*([0-9+\s]+)/i);
      if (telMatch) telefono = telMatch[1].trim();
      const vacanteMatch = desc.match(/Vacante:\s*(.+)/i);
      if (vacanteMatch) vacante = vacanteMatch[1].trim();

      const creatorEmail = String(
        ge.calendarId || ge.creator?.email || ge.organizer?.email || (typeof ge.creator === 'string' ? ge.creator : '') || "desconocido"
      ).toLowerCase();

      return {
        id: ge.id || Math.random().toString(),
        title: ge.title || ge.summary || "Entrevista",
        start: new Date(ge.start?.dateTime || ge.start?.date || ge.start || new Date()),
        end: new Date(ge.end?.dateTime || ge.end?.date || ge.end || new Date()),
        resource: {
          ...ge,
          es_google_calendar: true,
          resumen_ia: desc,
          creator_email: creatorEmail,
          nombre_chat: nombre,
          vacante_interes: vacante,
          telefono,
          nave_interes: nave,
          estado: "Agendado (GCal)",
        },
      };
    });

    // Deduplicate GCal events by id (since multiple calendars might share the same event)
    const uniqueGcalEventsMap = new Map();
    parsedGcalEvents.forEach(ev => {
      if (!uniqueGcalEventsMap.has(ev.id)) {
        uniqueGcalEventsMap.set(ev.id, ev);
      }
    });

    let allEvents: CalendarEvent[] = [...dbEvents, ...Array.from(uniqueGcalEventsMap.values())];

    // Filter by role if not ADMIN or ENCARGADO
    const role = typeof window !== "undefined" ? localStorage.getItem("tci_role") : "USER";
    if (role !== "ADMIN" && role !== "ENCARGADO" && role !== "ROOT") {
      const myRecruiterId = typeof window !== "undefined" ? localStorage.getItem("tci_reclutador_id") : null;
      allEvents = allEvents.filter((ev) => {
        const evEmail = (ev.resource.creator_email || "").toLowerCase();
        const matchesEmail = myCalId && evEmail === myCalId;
        const matchesId = myRecruiterId && ev.resource.asignado_a === myRecruiterId;
        return matchesEmail || matchesId;
      });
    }

    // Filter by selectedNave if not 'TODOS'
    if (selectedNave !== "TODOS") {
      const naveTarget = navesList.find((n) => n.id === selectedNave);
      const targetClean = normalizeStr(naveTarget?.nombre || "");
      const targetDigits = targetClean.match(/\d+/g) || [];
      const targetWords = targetClean
        .replace(/sucursal\s*/gi, "")
        .replace(/nave\s*/gi, "")
        .split(/[\s:-]+/)
        .filter((w) => w.length > 2);

      allEvents = allEvents.filter((ev: CalendarEvent) => {
        const resObj = ev.resource as any;

        // 1. Coincidencia por ID directo de Nave
        if (resObj.nave_id && resObj.nave_id === selectedNave) return true;

        // 2. Coincidencia por candidato en DB (por teléfono)
        const rawTelStr = String(resObj.telefono || resObj.summary || ev.title || "");
        const eventTel = rawTelStr.replace(/\D/g, "");
        if (eventTel.length >= 8) {
          const candMatch = candidatos.find((c) => {
            const cTel = String(c.telefono || "").replace(/\D/g, "");
            return cTel.length >= 8 && cTel.slice(-10) === eventTel.slice(-10);
          });
          if (candMatch) {
            const candObj = candMatch as any;
            if (candObj.nave_id && candObj.nave_id === selectedNave) return true;
            const candNaveClean = normalizeStr(candMatch.nave_interes || "");
            if (candNaveClean) {
              if (candNaveClean.includes(targetClean) || targetClean.includes(candNaveClean)) return true;
              if (targetWords.length > 0 && targetWords.some((w) => candNaveClean.includes(w))) return true;
            }
          }
        }

        // 3. Coincidencia por texto del evento (nave_interes, nave, titulo, descripcion)
        const fullText = normalizeStr(
          `${resObj.nave_interes || ""} ${resObj.nave || ""} ${ev.title || ""} ${resObj.resumen_ia || ""}`
        );

        if (fullText) {
          if (fullText.includes(targetClean)) return true;
          const matchesWord = targetWords.length > 0 && targetWords.some((w) => fullText.includes(w));
          const matchesDigit = targetDigits.length > 0 && targetDigits.some((d) => fullText.includes(d));
          if (matchesWord && (targetDigits.length === 0 || matchesDigit)) return true;
        }

        return false;
      });
    }

    return allEvents;
  }, [candidatos, googleEvents, myCalId, selectedNave, navesList]);

  // Naves que el usuario actual puede usar para filtrar (segun su rol)
  const naveOptions = useMemo(() => {
    if (typeof window === "undefined") return [];
    const role = localStorage.getItem("tci_role");
    if (role === "ADMIN" || role === "ROOT") return navesList;
    if (role === "ENCARGADO") {
      let asignadas: string[] = [];
      try { asignadas = JSON.parse(localStorage.getItem("tci_naves_asignadas") || "[]"); } catch { }
      return navesList.filter((n) => asignadas.includes(n.id));
    }
    // RECLUTADOR: solo las naves de sus propias vacantes
    return navesList.filter((n) => misNaveIds.has(n.id));
  }, [navesList, misNaveIds]);

  const formatVisualDate = (d: Date) => format(d, "dd/MM/yyyy HH:mm");

  // ── Panel lateral agrupado ───────────────────────────────────────────────
  const eventsByRecruiter = useMemo(() => {
    const today = new Date(new Date().setHours(0, 0, 0, 0));
    const grouped: Record<string, CalendarEvent[]> = {};

    events.forEach((e) => {
      if (e.start < today) return;
      // Para eventos de DB sin creator_email, los ponemos en 'sin_asignar'
      const email = e.resource.creator_email
        ? String(e.resource.creator_email).toLowerCase()
        : "sin_asignar";
      if (!grouped[email]) grouped[email] = [];
      grouped[email].push(e);
    });

    Object.keys(grouped).forEach((key) => {
      grouped[key].sort((a, b) => a.start.getTime() - b.start.getTime());
    });

    return grouped;
  }, [events]);

  const toggleRecruiter = (email: string) =>
    setExpandedRecruiters((prev) => ({ ...prev, [email]: !prev[email] }));

  // ── Cancelación ─────────────────────────────────────────────────────────
  const openCancelModal = (e: React.MouseEvent, event: CalendarEvent) => {
    e.stopPropagation();
    setCancelTarget(event);
    setCancelPassword("");
    setCancelError("");
    setCancelReason("Por imprevistos de agenda en el equipo de reclutamiento.");
    const defaultTel = typeof window !== "undefined" ? localStorage.getItem("tci_telefono") : "";
    setRecruiterPhone(defaultTel || "5213323379399");
  };

  const confirmCancel = async () => {
    if (!cancelPassword) {
      setCancelError("Ingresa tu contraseña para confirmar.");
      return;
    }
    if (!cancelTarget) return;

    setCancelingId(cancelTarget.id);
    setCancelError("");

    try {
      // 1. Verificar la contraseña con el backend usando la sesión del usuario actual
      const authRes = await fetch("/api/auth/verify-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: cancelPassword })
      });

      const authData = await authRes.json();
      if (!authRes.ok || !authData.success) {
        setCancelError(authData.error || "Contraseña incorrecta.");
        setCancelingId(null);
        return;
      }

      // 2. Si es correcta, procedemos a cancelar en n8n
      setCancelTarget(null);
      const myRecruiterName = typeof window !== "undefined" ? localStorage.getItem("tci_nombre") : "";
      const payload = {
        telefono: cancelTarget.resource.telefono,
        event_id: cancelTarget.resource.event_id || (cancelTarget.resource.es_google_calendar ? cancelTarget.id : null),
        calendar_id: cancelTarget.resource.creator_email,
        motivo: cancelReason,
        telefono_reclutador: recruiterPhone,
        nombre_reclutador: myRecruiterName || getRecruiterDisplayName(cancelTarget.resource.creator_email || ""),
        nombre_candidato: cancelTarget.resource.nombre_chat || cancelTarget.resource.nombre_solicitud || "Candidato"
      };
      const res = await fetch(`${N8N_BASE_URL}/webhook/crm-cancelar-cita`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      showToast("✅ Cita cancelada y candidato notificado por WhatsApp", false);
      setSelectedEvent(null);
      loadData();
    } catch {
      showToast("❌ Error al cancelar la cita", true);
    } finally {
      setCancelingId(null);
    }
  };

  const openRescheduleModal = (e: React.MouseEvent, event: CalendarEvent) => {
    e.stopPropagation();
    setRescheduleTarget(event);
    setNewDate(format(event.start, "yyyy-MM-dd"));
    setNewTime(format(event.start, "HH:mm"));
    setRescheduleReason("Por reorganización de agenda de entrevistas.");
    const defaultTel = typeof window !== "undefined" ? localStorage.getItem("tci_telefono") : "";
    setRecruiterPhone(defaultTel || "5213323379399");
  };

  const confirmReschedule = async () => {
    if (!rescheduleTarget || !newDate || !newTime) return;
    setRescheduling(true);

    const startStr = `${newDate}T${newTime}:00`;
    const start = new Date(startStr);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    try {
      const myRecruiterName = typeof window !== "undefined" ? localStorage.getItem("tci_nombre") : "";
      const payload = {
        telefono: rescheduleTarget.resource.telefono,
        event_id: rescheduleTarget.resource.event_id || (rescheduleTarget.resource.es_google_calendar ? rescheduleTarget.id : null),
        calendar_id: rescheduleTarget.resource.creator_email,
        start: start.toISOString(),
        end: end.toISOString(),
        motivo: rescheduleReason,
        telefono_reclutador: recruiterPhone,
        nombre_reclutador: myRecruiterName || getRecruiterDisplayName(rescheduleTarget.resource.creator_email || ""),
        nombre_candidato: rescheduleTarget.resource.nombre_chat || rescheduleTarget.resource.nombre_solicitud || "Candidato"
      };
      const res = await fetch(`${N8N_BASE_URL}/webhook/crm-reagendar-cita`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      showToast("✅ Cita reagendada y candidato notificado por WhatsApp", false);
      setSelectedEvent(null);
      setRescheduleTarget(null);
      loadData();
    } catch {
      showToast("❌ Error al reagendar", true);
    } finally {
      setRescheduling(false);
    }
  };

  const openBlockModalForRange = (start: Date, end: Date) => {
    setBlockTarget({ start, end });
    setBlockStartStr(format(start, "yyyy-MM-dd'T'HH:mm"));
    setBlockEndStr(format(end, "yyyy-MM-dd'T'HH:mm"));
    setBlockTitle("Bloqueo de Horario");
  };

  const confirmBlock = async () => {
    if (!blockTarget || !blockTitle) return;
    setBlocking(true);
    try {
      const startDate = blockStartStr ? new Date(blockStartStr) : blockTarget.start;
      const endDate = blockEndStr ? new Date(blockEndStr) : blockTarget.end;

      const payload = {
        calendar_id: myCalId,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        summary: blockTitle,
        description: "Bloqueo manual creado desde CRM"
      };
      const res = await fetch(`${N8N_BASE_URL}/webhook/crm-crear-bloqueo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      showToast("✅ Bloqueo de horario creado correctamente", false);
      setBlockTarget(null);
      loadData();
    } catch {
      showToast("❌ Error al crear bloqueo", true);
    } finally {
      setBlocking(false);
    }
  };

  const handleSelectEvent = (event: CalendarEvent) => setSelectedEvent(event);

  const getRecruiterDisplayName = (email: string) => {
    if (email === "sin_asignar") return "Sin Reclutador";
    return recruiterNames[email] || email;
  };

  const getColorForEmail = (email: string) => {
    if (recruiterColors[email]) return recruiterColors[email];
    const palette = ["#6366f1", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
    let hash = 0;
    for (let i = 0; i < email.length; i++) hash = email.charCodeAt(i) + ((hash << 5) - hash);
    return palette[Math.abs(hash) % palette.length];
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const totalProximas = Object.values(eventsByRecruiter).reduce((s, arr) => s + arr.length, 0);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] bg-slate-50 text-slate-800">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 px-8 pt-6 pb-4 bg-white border-b border-slate-100 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-2.5 py-1 rounded-full">
            {totalProximas} próximas
          </span>

          {/* FILTRO DE NAVE/SUCURSAL */}
          {naveOptions.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider hidden sm:inline-flex items-center gap-1">
                <Users size={14} className="text-indigo-600" /> Nave:
              </span>
              <select
                id="calendario-nave-filter"
                name="nave_filter"
                value={selectedNave}
                onChange={(e) => setSelectedNave(e.target.value)}
                className="px-3.5 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-800 text-xs font-bold focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all cursor-pointer shadow-xs"
              >
                <option value="TODOS">Todas mis Naves</option>
                {naveOptions.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <button
          onClick={loadData}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-sm transition-all text-sm"
        >
          <RefreshCw size={14} /> Actualizar
        </button>
      </div>

      <main className="flex-1 p-6 overflow-hidden flex flex-col md:flex-row max-w-[1500px] mx-auto w-full gap-5">

        {/* PANEL LATERAL */}
        <div className="w-full md:w-72 bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden shrink-0">
          <div className="p-4 bg-gradient-to-r from-indigo-600 to-indigo-500 text-white">
            <div className="flex items-center gap-2">
              <LayoutList size={16} />
              <h2 className="font-bold text-sm">Próximas Citas</h2>
            </div>
            <p className="text-xs text-indigo-200 mt-0.5">{totalProximas} cita{totalProximas !== 1 ? "s" : ""} desde hoy</p>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {Object.keys(eventsByRecruiter).length === 0 ? (
              <div className="p-8 text-center">
                <CalendarIcon size={32} className="mx-auto text-slate-200 mb-2" />
                <p className="text-sm text-slate-400 font-medium">Sin citas futuras</p>
              </div>
            ) : (
              Object.entries(eventsByRecruiter).map(([email, recruiterEvents]) => (
                <div key={email}>
                  <button
                    onClick={() => toggleRecruiter(email)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2.5 overflow-hidden">
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: getColorForEmail(email) }}
                      />
                      <span className="font-semibold text-slate-700 text-sm truncate">
                        {getRecruiterDisplayName(email)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className="text-[11px] font-bold px-2 py-0.5 rounded-full text-white"
                        style={{ backgroundColor: getColorForEmail(email) }}
                      >
                        {recruiterEvents.length}
                      </span>
                      {expandedRecruiters[email]
                        ? <ChevronDown size={14} className="text-slate-400" />
                        : <ChevronRight size={14} className="text-slate-400" />}
                    </div>
                  </button>

                  {expandedRecruiters[email] && (
                    <div className="bg-slate-50 divide-y divide-slate-100">
                      {recruiterEvents.map((ev) => (
                        <div
                          key={ev.id}
                          className="px-4 py-3 hover:bg-white transition-colors cursor-pointer group"
                          onClick={() => handleSelectEvent(ev)}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="overflow-hidden flex-1">
                              <p className="font-semibold text-slate-800 text-sm truncate">
                                {ev.resource.nombre_chat || ev.resource.nombre_solicitud || "Candidato"}
                              </p>
                              <p className="text-[11px] text-slate-400 truncate mt-0.5">
                                {ev.resource.vacante_interes || "Sin vacante"}
                              </p>
                              <p className="text-[11px] text-indigo-500 font-semibold mt-1">
                                {format(ev.start, "EEE d MMM · HH:mm", { locale: es })}
                              </p>
                            </div>
                            <button
                              onClick={(e) => openCancelModal(e, ev)}
                              disabled={cancelingId === ev.id}
                              className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                              title="Cancelar cita"
                            >
                              {cancelingId === ev.id
                                ? <span className="w-3 h-3 border-2 border-red-400 border-t-transparent rounded-full animate-spin block" />
                                : <XCircle size={16} />}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* CALENDARIO PRINCIPAL */}
        <div className="bg-white flex-1 rounded-2xl shadow-sm border border-slate-200 p-5 flex flex-col min-w-0 overflow-hidden">
          <Calendar
            localizer={localizer}
            events={events}
            startAccessor="start"
            endAccessor="end"
            culture="es"
            view={view}
            date={date}
            onView={setView}
            onNavigate={(d) => setDate(d)}
            onSelectEvent={handleSelectEvent}
            selectable={true}
            onSelectSlot={({ start, end }) => {
              if (start < new Date()) {
                showToast("❌ No puedes bloquear fechas pasadas", true);
                return;
              }
              if (!myCalId) {
                showToast("❌ No tienes un calendario asignado para bloquear", true);
                return;
              }
              openBlockModalForRange(start, end);
            }}
            components={{ toolbar: CustomToolbar }}
            messages={{
              next: "›",
              previous: "‹",
              today: "Hoy",
              month: "Mes",
              week: "Semana",
              day: "Día",
              agenda: "Agenda",
              date: "Fecha",
              time: "Hora",
              event: "Evento",
              noEventsInRange: "No hay entrevistas en este período.",
            }}
            eventPropGetter={(event) => {
              const email = event.resource.creator_email
                ? String(event.resource.creator_email).toLowerCase()
                : "";
              const bgColor = getColorForEmail(email || "default");
              return {
                style: {
                  backgroundColor: bgColor,
                  borderRadius: "6px",
                  border: "none",
                  color: "white",
                  fontWeight: "600",
                  fontSize: "12px",
                  padding: "2px 6px",
                },
              };
            }}
            style={{ flex: 1 }}
          />
        </div>
      </main>

      {/* ─── MODAL CONFIRMACIÓN CANCELACIÓN ─── */}
      {cancelTarget && (
        <div
          className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-[2000]"
          onClick={() => setCancelTarget(null)}
        >
          <div
            className="bg-white w-[90%] max-w-md rounded-2xl p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <XCircle size={20} className="text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800 text-lg">Cancelar Entrevista</h3>
                <p className="text-sm font-semibold text-indigo-600">
                  {cancelTarget.resource.nombre_chat || cancelTarget.resource.nombre_solicitud || "Candidato"} ({cancelTarget.resource.vacante_interes || "General"})
                </p>
              </div>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-xs text-red-700">
              ⚠️ Esta acción eliminará el evento de Google Calendar y le enviará un mensaje de WhatsApp al candidato con el motivo y tu número de contacto.
            </div>

            <div className="space-y-4 mb-5">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Motivo / Explicación para el candidato
                </label>
                <textarea
                  id="cancel-reason"
                  name="cancel_reason"
                  rows={2}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Explica la razón de la cancelación..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:border-red-400 focus:bg-white outline-none text-xs text-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Teléfono del Reclutador (para aclaraciones)
                </label>
                <input
                  id="cancel-recruiter-phone"
                  name="recruiter_phone"
                  type="text"
                  value={recruiterPhone}
                  onChange={(e) => setRecruiterPhone(e.target.value)}
                  placeholder="521..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:border-indigo-400 focus:bg-white outline-none text-xs text-slate-800 font-mono"
                />
              </div>

              <div>
                <label htmlFor="cancel-password" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Contraseña de confirmación
                </label>
                <input
                  id="cancel-password"
                  name="cancel_password"
                  type="password"
                  value={cancelPassword}
                  onChange={(e) => { setCancelPassword(e.target.value); setCancelError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && confirmCancel()}
                  placeholder="••••••••"
                  autoFocus
                  className={`w-full px-3 py-2 rounded-xl border outline-none text-xs transition-all ${cancelError
                      ? "border-red-400 bg-red-50 focus:border-red-500"
                      : "border-slate-200 bg-slate-50 focus:border-indigo-400 focus:bg-white"
                    }`}
                />
                {cancelError && (
                  <p className="text-xs text-red-500 mt-1 font-medium">{cancelError}</p>
                )}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setCancelTarget(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition-colors"
              >
                No, volver
              </button>
              <button
                onClick={confirmCancel}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm transition-colors shadow-sm"
              >
                Sí, cancelar cita
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL DETALLE EVENTO ─── */}
      {selectedEvent && !isChatOpen && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1000]"
          onClick={() => setSelectedEvent(null)}
        >
          <div
            className="bg-white w-[90%] max-w-md rounded-2xl p-7 shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setSelectedEvent(null)}
              className="absolute top-5 right-5 text-slate-400 hover:text-slate-700 transition-colors"
            >
              <XCircle size={22} />
            </button>

            <h2 className="text-xl font-bold text-slate-800 mb-0.5">
              {selectedEvent.resource.nombre_chat || selectedEvent.resource.nombre_solicitud || "Candidato"}
            </h2>
            <p className="text-indigo-600 font-semibold text-sm mb-5">
              {selectedEvent.resource.vacante_interes || "Sin vacante"}
            </p>

            <div className="space-y-2 mb-5 bg-slate-50 p-4 rounded-xl border border-slate-100 text-sm">
              {[
                ["📅 Fecha", formatVisualDate(selectedEvent.start)],
                ["📞 Teléfono", selectedEvent.resource.telefono],
                ["🏭 Nave", selectedEvent.resource.nave_interes || "N/A"],
                ["📌 Estado", selectedEvent.resource.estado],
              ].map(([label, val]) => (
                <div key={label} className="flex justify-between items-center">
                  <span className="text-slate-500">{label}</span>
                  <span className="font-semibold text-slate-800">{val}</span>
                </div>
              ))}
            </div>

            {selectedEvent.resource.resumen_ia && (
              <div className="mb-5">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Resumen IA</p>
                <div className="text-sm text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100 whitespace-pre-wrap max-h-28 overflow-y-auto">
                  {selectedEvent.resource.resumen_ia}
                </div>
              </div>
            )}

            <div className="flex gap-3 mb-3">
              <button
                onClick={(e) => openCancelModal(e, selectedEvent)}
                disabled={cancelingId === selectedEvent.id}
                className="flex-1 py-2.5 bg-red-50 text-red-600 hover:bg-red-100 font-bold rounded-xl transition-colors flex items-center justify-center gap-2 text-sm border border-red-200"
              >
                <XCircle size={16} /> Cancelar
              </button>

              <button
                onClick={(e) => openRescheduleModal(e, selectedEvent)}
                className="flex-1 py-2.5 bg-amber-50 text-amber-600 hover:bg-amber-100 font-bold rounded-xl transition-colors flex items-center justify-center gap-2 text-sm border border-amber-200"
              >
                <RefreshCw size={16} /> Reagendar
              </button>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => window.open(`https://wa.me/${selectedEvent.resource.telefono}`, "_blank")}
                className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 text-sm"
              >
                <MessageSquare size={16} /> WhatsApp
              </button>
              {selectedEvent.resource.telefono && selectedEvent.resource.telefono !== "No registrado" && (
                <button
                  onClick={() => router.push(`/mensajes?tel=${selectedEvent.resource.telefono}`)}
                  className="flex-1 bg-indigo-500 hover:bg-indigo-600 text-white font-semibold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 text-sm"
                >
                  Ver Chat
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL REAGENDAR ─── */}
      {rescheduleTarget && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[2000]"
          onClick={() => setRescheduleTarget(null)}
        >
          <div
            className="bg-white w-[90%] max-w-md rounded-2xl p-6 shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-slate-800 text-lg mb-1">Reagendar Entrevista</h3>
            <p className="text-xs text-indigo-600 font-semibold mb-4">
              Candidato: {rescheduleTarget.resource.nombre_chat || rescheduleTarget.resource.nombre_solicitud || "Candidato"}
            </p>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label htmlFor="reschedule-date" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Nueva Fecha</label>
                <input
                  id="reschedule-date"
                  name="reschedule_date"
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:border-indigo-400 outline-none text-xs"
                />
              </div>

              <div>
                <label htmlFor="reschedule-time" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Nueva Hora</label>
                <input
                  id="reschedule-time"
                  name="reschedule_time"
                  type="time"
                  value={newTime}
                  onChange={(e) => setNewTime(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:border-indigo-400 outline-none text-xs"
                />
              </div>
            </div>

            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Motivo / Explicación del cambio
                </label>
                <textarea
                  id="reschedule-reason"
                  name="reschedule_reason"
                  rows={2}
                  value={rescheduleReason}
                  onChange={(e) => setRescheduleReason(e.target.value)}
                  placeholder="Explica la razón del cambio..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:border-indigo-400 outline-none text-xs text-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Teléfono del Reclutador (para aclaraciones)
                </label>
                <input
                  id="reschedule-recruiter-phone"
                  name="recruiter_phone"
                  type="text"
                  value={recruiterPhone}
                  onChange={(e) => setRecruiterPhone(e.target.value)}
                  placeholder="521..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:border-indigo-400 outline-none text-xs text-slate-800 font-mono"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setRescheduleTarget(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmReschedule}
                disabled={rescheduling}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm transition-colors disabled:opacity-50 shadow-sm"
              >
                {rescheduling ? "Guardando..." : "Reagendar y Notificar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL CREAR BLOQUEO DE RANGO (DÍAS, HORAS, MINUTOS) ─── */}
      {blockTarget && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[2000]"
          onClick={() => setBlockTarget(null)}
        >
          <div
            className="bg-white w-[90%] max-w-md rounded-2xl p-6 shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-slate-800 text-lg mb-1">Bloquear Rango de Horario</h3>
            <p className="text-xs text-slate-500 mb-4">
              Bloquea tu disponibilidad por días, horas o minutos exactos en Google Calendar.
            </p>

            <div className="mb-4">
              <label htmlFor="block-title" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Motivo / Título del Bloqueo</label>
              <input
                id="block-title"
                name="block_title"
                type="text"
                value={blockTitle}
                onChange={(e) => setBlockTitle(e.target.value)}
                placeholder="Ej. Vacaciones, Junta de equipo, Capacitación..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:border-indigo-400 outline-none text-xs font-medium text-slate-800"
              />
            </div>

            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  📅 Fecha y Hora de Inicio
                </label>
                <input
                  id="block-start"
                  name="block_start"
                  type="datetime-local"
                  value={blockStartStr}
                  onChange={(e) => setBlockStartStr(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:border-indigo-400 outline-none text-xs text-slate-800 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  🏁 Fecha y Hora de Fin
                </label>
                <input
                  id="block-end"
                  name="block_end"
                  type="datetime-local"
                  value={blockEndStr}
                  onChange={(e) => setBlockEndStr(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:border-indigo-400 outline-none text-xs text-slate-800 font-mono"
                />
              </div>
            </div>

            {/* PRESETS RÁPIDOS DE RANGO */}
            <div className="mb-6">
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Accesos Rápidos de Rango</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!blockStartStr) return;
                    const st = new Date(blockStartStr);
                    const end = new Date(st.getTime() + 60 * 60 * 1000);
                    setBlockEndStr(format(end, "yyyy-MM-dd'T'HH:mm"));
                  }}
                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-600 rounded-lg text-xs font-bold transition-all border border-slate-200"
                >
                  ⏱️ +1 Hora
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (!blockStartStr) return;
                    const st = new Date(blockStartStr);
                    const end = new Date(st.getTime() + 4 * 60 * 60 * 1000);
                    setBlockEndStr(format(end, "yyyy-MM-dd'T'HH:mm"));
                  }}
                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-600 rounded-lg text-xs font-bold transition-all border border-slate-200"
                >
                  ⏳ +4 Horas (Media jornada)
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (!blockStartStr) return;
                    const datePart = blockStartStr.split("T")[0];
                    setBlockStartStr(`${datePart}T08:00`);
                    setBlockEndStr(`${datePart}T18:00`);
                  }}
                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-600 rounded-lg text-xs font-bold transition-all border border-slate-200"
                >
                  ☀️ Todo el Día (8 AM - 6 PM)
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (!blockStartStr) return;
                    const st = new Date(blockStartStr);
                    const end = new Date(st.getTime() + 48 * 60 * 60 * 1000);
                    setBlockEndStr(format(end, "yyyy-MM-dd'T'HH:mm"));
                  }}
                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-600 rounded-lg text-xs font-bold transition-all border border-slate-200"
                >
                  🏖️ +2 Días (48 Horas)
                </button>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setBlockTarget(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmBlock}
                disabled={blocking}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm transition-colors disabled:opacity-50 shadow-sm"
              >
                {blocking ? "Bloqueando..." : "Confirmar Bloqueo"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
      <div className={`fixed bottom-6 right-6 px-5 py-3 rounded-xl font-bold text-white shadow-xl transition-all duration-300 z-[3000] ${toast ? "translate-y-0 opacity-100" : "translate-y-16 opacity-0"
        } ${toast?.isError ? "bg-red-500" : "bg-emerald-500"}`}>
        {toast?.msg}
      </div>
    </div>
  );
}
