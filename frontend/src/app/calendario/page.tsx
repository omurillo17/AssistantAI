"use client";

import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Calendar, dateFnsLocalizer, View, Views, type ToolbarProps } from "react-big-calendar";
import { format, parse, startOfWeek, getDay, addMonths, subMonths, addWeeks, subWeeks, addDays, subDays } from "date-fns";
import { es } from "date-fns/locale";
import { MessageSquare, ChevronDown, ChevronRight, XCircle, ChevronLeft, RefreshCw, Calendar as CalendarIcon, LayoutList } from "lucide-react";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { useTenantChange } from "@/hooks/useTenant";
import { useBackdropClose } from "@/hooks/useBackdropClose";

const locales = { es };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales,
});

const BACKEND_BASE_URL = "/api/backend";

import type { Candidato, Recruiter } from "@/types";

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource: Candidato;
}

// Forma de un evento tal y como lo devuelve /api/calendario (Google Calendar).
// Todo opcional a propósito: la API los reenvía tal cual llegan y no garantiza
// ningún campo salvo el id.
type GoogleEvent = {
  id?: string;
  title?: string;
  summary?: string;
  description?: string;
  // Google los manda como objeto; algunos caminos de nuestra API los aplanan
  // a string, y el código de abajo contempla las dos formas.
  start?: string | { dateTime?: string; date?: string };
  end?: string | { dateTime?: string; date?: string };
  calendarId?: string;
  creator?: { email?: string };
  organizer?: { email?: string };
};

// ─── Custom Toolbar ──────────────────────────────────────────────────────────
function CustomToolbar({ date, view, onNavigate, onView }: Readonly<ToolbarProps<CalendarEvent, object>>) {
  // "DATE" es la acción con la que react-big-calendar acepta una fecha ya
  // calculada y la usa tal cual (ver utils/move.js). Antes se mandaba "prev" /
  // "next", que la librería no reconoce: funcionaba de rebote porque su
  // `switch` cae en `default` y devuelve la fecha sin tocarla. Con "PREV" sí
  // habría aplicado su propio salto encima del nuestro y el calendario habría
  // avanzado el doble; con "DATE" el camino es el previsto.
  const views: { key: View; label: string }[] = [
    { key: Views.MONTH, label: "Mes" },
    { key: Views.WEEK, label: "Semana" },
    { key: Views.DAY, label: "Día" },
    { key: Views.AGENDA, label: "Agenda" },
  ];

  const navigatePrev = () => {
    if (view === Views.MONTH) onNavigate("DATE", subMonths(date, 1));
    else if (view === Views.WEEK) onNavigate("DATE", subWeeks(date, 1));
    else onNavigate("DATE", subDays(date, 1));
  };
  const navigateNext = () => {
    if (view === Views.MONTH) onNavigate("DATE", addMonths(date, 1));
    else if (view === Views.WEEK) onNavigate("DATE", addWeeks(date, 1));
    else onNavigate("DATE", addDays(date, 1));
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
          onClick={() => onNavigate("TODAY")}
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

function cleanPhone(p: string | null | undefined): string {
  if (!p) return "";
  const digits = String(p).replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function parseFechaEntrevista(fechaStr: string | null | undefined): Date | null {
  if (!fechaStr?.trim()) return null;
  let d = new Date(fechaStr);
  if (Number.isNaN(d.getTime())) d = parse(fechaStr, "dd/MM/yyyy HH:mm", new Date());
  if (Number.isNaN(d.getTime())) {
    d = parse(fechaStr, "dd/MM/yyyy", new Date());
    if (!Number.isNaN(d.getTime())) d.setHours(10, 0, 0, 0);
  }
  return Number.isNaN(d.getTime()) ? null : d;
}

function findOrphanedCandidatoIds(
  candidatos: Candidato[],
  googleEvents: GoogleEvent[],
  gcalRange: { start: Date; end: Date } | null
): Set<string> {
  if (!gcalRange) return new Set<string>();
  const liveIds = new Set(googleEvents.map((ge) => ge.id).filter(Boolean));
  const ids = new Set<string>();
  for (const c of candidatos) {
    if (!c.id || !c.event_id) continue;
    if (!["CITA_AGENDADA", "RECORDATORIO_ENVIADO"].includes(c.estado)) continue;
    if (liveIds.has(c.event_id)) continue;
    const d = parseFechaEntrevista(c.fecha_entrevista);
    if (d && d >= gcalRange.start && d <= gcalRange.end) {
      ids.add(c.id);
    }
  }
  return ids;
}

function processRecruitersData(recs: Recruiter[], myRecruiterId: string | null) {
  const colorMap: Record<string, string> = {};
  const nameMap: Record<string, string> = {};
  const phoneMap: Record<string, string> = {};
  const idToEmailMap: Record<string, string> = {};
  const palette = ["#6366f1", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
  let myCalIdLocal = "";

  recs.forEach((r: Recruiter, i: number) => {
    const calId = (r.calendar_id || "").toLowerCase();
    if (calId) {
      colorMap[calId] = r.color || palette[i % palette.length];
      nameMap[calId] = r.nombre || (r as Recruiter & { name?: string }).name || calId;
      if (r.telefono) phoneMap[calId] = r.telefono;
      if (r.reclutador_id) {
        idToEmailMap[r.reclutador_id] = calId;
        if (r.telefono) phoneMap[r.reclutador_id] = r.telefono;
      }
      if (r.reclutador_id == myRecruiterId) {
        myCalIdLocal = calId;
      }
    }
  });

  return { colorMap, nameMap, phoneMap, idToEmailMap, myCalIdLocal };
}

function parseGCalEventTitleAndDesc(ge: GoogleEvent) {
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

  const nombreMatch = /Nombre:\s*(.+)/i.exec(desc);
  if (nombreMatch) nombre = nombreMatch[1].trim();
  const naveMatch = /Nave\/Sucursal:\s*(.+)/i.exec(desc);
  if (naveMatch) nave = naveMatch[1].trim();
  const telMatch = /(?:Tel[ée]fono|Tel):\s*([0-9+\s]+)/i.exec(desc);
  if (telMatch) telefono = telMatch[1].trim();
  const vacanteMatch = /Vacante:\s*(.+)/i.exec(desc);
  if (vacanteMatch) vacante = vacanteMatch[1].trim();

  return { nombre, vacante, telefono, nave, desc };
}

function filterEventsByPermissions(
  unifiedEvents: CalendarEvent[],
  recruiterColors: Record<string, string>,
  myCalId: string
): CalendarEvent[] {
  let allEvents = unifiedEvents;

  const storedEmpresaId = typeof window !== "undefined" ? localStorage.getItem("tci_empresa_id") : null;
  if (storedEmpresaId) {
    const allowedCalIds = new Set(Object.keys(recruiterColors));
    allEvents = allEvents.filter((ev) => {
      if (!ev.resource.es_google_calendar) return true;
      const email = (ev.resource.creator_email || "").toLowerCase();
      return allowedCalIds.has(email);
    });
  }

  const role = typeof window !== "undefined" ? localStorage.getItem("tci_role") : "USER";
  if (role !== "ADMIN" && role !== "ENCARGADO" && role !== "ROOT") {
    const myRecruiterId = typeof window !== "undefined" ? localStorage.getItem("tci_reclutador_id") : null;
    allEvents = allEvents.filter((ev) => {
      const evEmail = (ev.resource.creator_email || "").toLowerCase();
      const matchesEmail = myCalId && evEmail === myCalId;
      const matchesId = myRecruiterId && ev.resource.asignado_a_id === myRecruiterId;
      return matchesEmail || matchesId;
    });
  }
  return allEvents;
}

function buildCandidateIndexes(
  candidatos: Candidato[],
  orphanedCandidatoIds: Set<string>
) {
  const candByEventId = new Map<string, Candidato>();
  const candByPhone = new Map<string, Candidato>();
  const activeCandidates = candidatos.filter(
    (c) => c.fecha_entrevista?.trim() && !(c.id && orphanedCandidatoIds.has(c.id))
  );

  for (const c of activeCandidates) {
    if (c.event_id) candByEventId.set(c.event_id, c);
    const cTel = cleanPhone(c.telefono);
    if (cTel) candByPhone.set(cTel, c);
  }
  return { activeCandidates, candByEventId, candByPhone };
}

function resolveCreatorEmail(
  rawCreatorEmail: string,
  matchedCandidate: Candidato | null | undefined,
  recruiterIdToEmail: Record<string, string>
): string {
  if (rawCreatorEmail !== "desconocido") return rawCreatorEmail;
  if (matchedCandidate?.asignado_a_id && recruiterIdToEmail[matchedCandidate.asignado_a_id]) {
    return recruiterIdToEmail[matchedCandidate.asignado_a_id];
  }
  return "sin_asignar";
}

function buildGCalUnifiedEvent(
  gcalId: string,
  ge: GoogleEvent,
  matchedCandidate: Candidato | null | undefined,
  recruiterIdToEmail: Record<string, string>
): CalendarEvent {
  const parsedGcal = parseGCalEventTitleAndDesc(ge);
  const rawCreatorEmail = String(
    ge.calendarId || ge.creator?.email || ge.organizer?.email || (typeof ge.creator === 'string' ? ge.creator : '') || "desconocido"
  ).toLowerCase();

  const fechaDe = (v: GoogleEvent["start"]) => typeof v === "string" ? v : v?.dateTime || v?.date;
  const startDate = new Date(fechaDe(ge.start) || new Date());
  const endDate = new Date(fechaDe(ge.end) || new Date());

  if (matchedCandidate) {
    const candName = matchedCandidate.nombre_chat || matchedCandidate.nombre_ine || matchedCandidate.nombre_solicitud || matchedCandidate.nombre || parsedGcal.nombre;
    const candVacante = matchedCandidate.vacante_interes || parsedGcal.vacante;
    const resolvedCreatorEmail = resolveCreatorEmail(rawCreatorEmail, matchedCandidate, recruiterIdToEmail);

    return {
      id: gcalId || matchedCandidate.event_id || matchedCandidate.telefono,
      title: `${candName} – ${candVacante}`,
      start: startDate,
      end: endDate,
      resource: {
        ...matchedCandidate,
        ...ge,
        event_id: gcalId || matchedCandidate.event_id,
        es_google_calendar: true,
        creator_email: resolvedCreatorEmail,
        nombre_chat: candName,
        vacante_interes: candVacante,
        telefono: matchedCandidate.telefono || parsedGcal.telefono,
        nave_interes: matchedCandidate.nave_interes || parsedGcal.nave,
        estado: matchedCandidate.estado || "Agendado (GCal)",
        resumen_ia: matchedCandidate.resumen_ia || parsedGcal.desc,
      },
    };
  }

  return {
    id: gcalId,
    title: ge.title || ge.summary || "Entrevista",
    start: startDate,
    end: endDate,
    resource: {
      ...ge,
      nombre: parsedGcal.nombre,
      escalado: false,
      es_google_calendar: true,
      resumen_ia: parsedGcal.desc,
      creator_email: rawCreatorEmail,
      nombre_chat: parsedGcal.nombre,
      vacante_interes: parsedGcal.vacante,
      telefono: parsedGcal.telefono,
      nave_interes: parsedGcal.nave,
      estado: "Agendado (GCal)",
    } as Candidato,
  };
}

function buildUnrepresentedCandidateEvents(
  activeCandidates: Candidato[],
  representedCandidateIds: Set<string>,
  representedPhones: Set<string>,
  recruiterIdToEmail: Record<string, string>
): CalendarEvent[] {
  const candidateEvents: CalendarEvent[] = [];
  for (const c of activeCandidates) {
    if (c.id && representedCandidateIds.has(c.id)) continue;
    const cPhone = cleanPhone(c.telefono);
    if (cPhone && representedPhones.has(cPhone)) continue;

    const startDate = parseFechaEntrevista(c.fecha_entrevista);
    if (!startDate) continue;

    candidateEvents.push({
      id: c.event_id || c.telefono,
      title: `${c.nombre_chat || c.nombre_ine || c.nombre_solicitud || c.nombre || "Candidato"} – ${c.vacante_interes || "Sin vacante"}`,
      start: startDate,
      end: new Date(startDate.getTime() + 60 * 60 * 1000),
      resource: {
        ...c,
        creator_email: c.asignado_a_id ? (recruiterIdToEmail[c.asignado_a_id] || "sin_asignar") : "sin_asignar",
      },
    });
  }
  return candidateEvents;
}

function buildUnifiedCalendarEvents(
  candidatos: Candidato[],
  googleEvents: GoogleEvent[],
  orphanedCandidatoIds: Set<string>,
  recruiterColors: Record<string, string>,
  recruiterIdToEmail: Record<string, string>,
  myCalId: string
): CalendarEvent[] {
  const { activeCandidates, candByEventId, candByPhone } = buildCandidateIndexes(candidatos, orphanedCandidatoIds);

  const representedCandidateIds = new Set<string>();
  const representedPhones = new Set<string>();

  const uniqueGcalMap = new Map<string, GoogleEvent>();
  for (const ge of googleEvents) {
    if (ge?.id && !uniqueGcalMap.has(ge.id)) {
      uniqueGcalMap.set(ge.id, ge);
    }
  }

  const unifiedEvents: CalendarEvent[] = [];

  for (const [gcalId, ge] of uniqueGcalMap.entries()) {
    const parsedGcal = parseGCalEventTitleAndDesc(ge);
    const gePhoneClean = cleanPhone(parsedGcal.telefono);
    const matchedCandidate = candByEventId.get(gcalId) || (gePhoneClean ? candByPhone.get(gePhoneClean) : null);

    if (matchedCandidate) {
      if (matchedCandidate.id) representedCandidateIds.add(matchedCandidate.id);
      const cPhone = cleanPhone(matchedCandidate.telefono);
      if (cPhone) representedPhones.add(cPhone);
    }

    unifiedEvents.push(buildGCalUnifiedEvent(gcalId, ge, matchedCandidate, recruiterIdToEmail));
  }

  const unrepEvents = buildUnrepresentedCandidateEvents(activeCandidates, representedCandidateIds, representedPhones, recruiterIdToEmail);
  unifiedEvents.push(...unrepEvents);

  return filterEventsByPermissions(unifiedEvents, recruiterColors, myCalId);
}

async function fetchCandidatosList(storedEmpresaId: string | null, storedGrupoId: string | null): Promise<Candidato[]> {
  const candidatosParams = new URLSearchParams();
  if (storedEmpresaId) candidatosParams.set("empresa_id", storedEmpresaId);
  if (storedGrupoId) candidatosParams.set("grupo_id", storedGrupoId);
  candidatosParams.set("limit", "2000");
  const res = await fetch(`/api/db/candidatos?${candidatosParams.toString()}`);
  if (!res.ok) throw new Error("Error API DB");
  const data = await res.json();
  return Array.isArray(data) ? data : data.data || [];
}

async function fetchGoogleCalendarList(): Promise<{ events: GoogleEvent[]; range: { start: Date; end: Date } | null }> {
  try {
    const rangeStart = subMonths(new Date(), 2);
    const rangeEnd = addMonths(new Date(), 3);
    const resGcal = await fetch(`${BACKEND_BASE_URL}/internal/citas/google-calendar?start=${rangeStart.toISOString()}&end=${rangeEnd.toISOString()}`);
    if (resGcal.ok) {
      const gcalData = await resGcal.json();
      const rawEvents: Record<string, unknown>[] = Array.isArray(gcalData) ? gcalData : gcalData.events || gcalData.data || [];
      const realEvents = rawEvents.filter((ge) => ge && typeof ge.id === "string" && ge.id.length > 0 && !ge.error);
      return { events: realEvents, range: { start: rangeStart, end: rangeEnd } };
    }
  } catch { }
  return { events: [], range: null };
}

async function fetchRecruitersConfig(tenantQuery: string, myRecruiterId: string | null) {
  try {
    const resRec = await fetch(`/api/db/vacantes${tenantQuery}`);
    if (resRec.ok) {
      const recData = await resRec.json();
      const recs: Recruiter[] = Array.isArray(recData) ? recData : recData.data || [];
      return processRecruitersData(recs, myRecruiterId);
    }
  } catch { }
  return null;
}

async function submitCancelCita({
  cancelTarget,
  cancelReason,
  recruiterPhone,
  nombreReclutador,
}: {
  cancelTarget: CalendarEvent;
  cancelReason: string;
  recruiterPhone: string;
  nombreReclutador: string;
}) {
  const payload = {
    telefono: cancelTarget.resource.telefono,
    event_id: cancelTarget.resource.event_id || (cancelTarget.resource.es_google_calendar ? cancelTarget.id : null),
    calendar_id: cancelTarget.resource.creator_email,
    motivo: cancelReason,
    telefono_reclutador: recruiterPhone,
    nombre_reclutador: nombreReclutador,
    nombre_candidato: cancelTarget.resource.nombre_chat || cancelTarget.resource.nombre_solicitud || "Candidato"
  };
  const res = await fetch(`${BACKEND_BASE_URL}/internal/citas/cancelar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Error al cancelar la cita");
}

async function submitRescheduleCita({
  rescheduleTarget,
  newDate,
  newTime,
  rescheduleReason,
  recruiterPhone,
  nombreReclutador,
}: {
  rescheduleTarget: CalendarEvent;
  newDate: string;
  newTime: string;
  rescheduleReason: string;
  recruiterPhone: string;
  nombreReclutador: string;
}) {
  const startStr = `${newDate}T${newTime}:00`;
  const start = new Date(startStr);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  const payload = {
    telefono: rescheduleTarget.resource.telefono,
    event_id: rescheduleTarget.resource.event_id || (rescheduleTarget.resource.es_google_calendar ? rescheduleTarget.id : null),
    calendar_id: rescheduleTarget.resource.creator_email,
    start: start.toISOString(),
    end: end.toISOString(),
    motivo: rescheduleReason,
    telefono_reclutador: recruiterPhone,
    nombre_reclutador: nombreReclutador,
    nombre_candidato: rescheduleTarget.resource.nombre_chat || rescheduleTarget.resource.nombre_solicitud || "Candidato",
    correo: rescheduleTarget.resource.correo || ""
  };
  const res = await fetch(`${BACKEND_BASE_URL}/internal/citas/reagendar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Error al reagendar la cita");
}

async function submitBlockCita({
  blockMode,
  blockTarget,
  blockStartStr,
  blockEndStr,
  blockTimeStart,
  blockTimeEnd,
  blockDays,
  blockTitle,
  myCalId,
}: {
  blockMode: "continuo" | "recurrente";
  blockTarget: { start: Date; end: Date };
  blockStartStr: string;
  blockEndStr: string;
  blockTimeStart: string;
  blockTimeEnd: string;
  blockDays: string[];
  blockTitle: string;
  myCalId: string;
}) {
  let payload: Record<string, any>;
  if (blockMode === "recurrente") {
    const startDatePart = (blockStartStr || format(blockTarget.start, "yyyy-MM-dd")).split("T")[0];
    const endDatePart = (blockEndStr || format(blockTarget.end, "yyyy-MM-dd")).split("T")[0];
    const startIso = `${startDatePart}T${blockTimeStart}:00`;
    const endIso = `${startDatePart}T${blockTimeEnd}:00`;
    const untilStr = endDatePart.replace(/-/g, "") + "T235959Z";
    const daysStr = blockDays.length > 0 ? blockDays.join(",") : "MO,TU,WE,TH,FR";
    const rrule = `RRULE:FREQ=WEEKLY;BYDAY=${daysStr};UNTIL=${untilStr}`;

    payload = {
      calendar_id: myCalId,
      start: startIso,
      end: endIso,
      summary: blockTitle,
      description: `Bloqueo recurrente (${daysStr} de ${blockTimeStart} a ${blockTimeEnd})`,
      recurrence: [rrule],
    };
  } else {
    const startDate = blockStartStr ? new Date(blockStartStr) : blockTarget.start;
    const endDate = blockEndStr ? new Date(blockEndStr) : blockTarget.end;
    payload = {
      calendar_id: myCalId,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      summary: blockTitle,
      description: "Bloqueo manual creado desde CRM",
    };
  }

  const res = await fetch(`${BACKEND_BASE_URL}/internal/citas/bloqueo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Error al crear bloqueo");
}

function resolveAssignedPhone(event: CalendarEvent, recruiterPhones: Record<string, string>): string {
  const recEmail = (event.resource.creator_email || "").toLowerCase();
  const recId = event.resource.asignado_a_id;
  const assignedPhone = (recEmail && recruiterPhones[recEmail]) || (recId && recruiterPhones[recId]) || "";
  const defaultTel = typeof window !== "undefined" ? localStorage.getItem("tci_telefono") : "";
  return assignedPhone || defaultTel || "";
}

function groupEventsByRecruiter(events: CalendarEvent[], recruiterNames: Record<string, string>): Record<string, CalendarEvent[]> {
  const today = new Date(new Date().setHours(0, 0, 0, 0));
  const grouped: Record<string, CalendarEvent[]> = {};

  Object.keys(recruiterNames).forEach((email) => {
    grouped[email] = [];
  });

  events.forEach((e) => {
    if (e.start < today) return;
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
}

function getRecruiterColor(email: string, recruiterColors: Record<string, string>): string {
  if (recruiterColors[email]) return recruiterColors[email];
  const palette = ["#6366f1", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = (email.codePointAt(i) || 0) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

function resolveRecruiterDisplayName(email: string, recruiterNames: Record<string, string>): string {
  if (email === "sin_asignar") return "Sin Reclutador";
  return recruiterNames[email] || email;
}

function markCandidatesAsCancelled(candidatos: Candidato[], cancelledIds: string[]): Candidato[] {
  return candidatos.map((c) =>
    c.id && cancelledIds.includes(c.id)
      ? { ...c, estado: "CITA_CANCELADA", event_id: undefined, fecha_entrevista: null }
      : c
  );
}

function getDatePart(str: string): string {
  return str ? str.split("T")[0] : "";
}

function getTimePart(str: string, fallback: string): string {
  return str.includes("T") ? str.split("T")[1] : fallback;
}

function addHoursToDate(dateStr: string, hours: number): string {
  if (!dateStr) return "";
  const st = new Date(dateStr);
  const end = new Date(st.getTime() + hours * 60 * 60 * 1000);
  return format(end, "yyyy-MM-dd'T'HH:mm");
}

interface BloquearHorarioModalProps {
  blockTarget: { start: Date; end: Date } | null;
  blockBackdrop: ReturnType<typeof useBackdropClose>;
  blockTitle: string;
  setBlockTitle: (val: string) => void;
  blockMode: "continuo" | "recurrente";
  setBlockMode: (val: "continuo" | "recurrente") => void;
  blockStartStr: string;
  setBlockStartStr: (val: string) => void;
  blockEndStr: string;
  setBlockEndStr: (val: string) => void;
  blockTimeStart: string;
  setBlockTimeStart: (val: string) => void;
  blockTimeEnd: string;
  setBlockTimeEnd: (val: string) => void;
  blockDays: string[];
  setBlockDays: React.Dispatch<React.SetStateAction<string[]>>;
  blocking: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

function BloquearHorarioModal(props: Readonly<BloquearHorarioModalProps>) {
  const {
    blockTarget,
    blockBackdrop,
    blockTitle,
    setBlockTitle,
    blockMode,
    setBlockMode,
    blockStartStr,
    setBlockStartStr,
    blockEndStr,
    setBlockEndStr,
    blockTimeStart,
    setBlockTimeStart,
    blockTimeEnd,
    setBlockTimeEnd,
    blockDays,
    setBlockDays,
    blocking,
    onClose,
    onConfirm,
  } = props;

  if (!blockTarget) return null;

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[2000]"
      {...blockBackdrop}
    >
      <div className="bg-white w-[90%] max-w-md rounded-2xl p-6 shadow-2xl relative">
        <h3 className="font-bold text-slate-800 text-lg mb-1">Bloquear Horario</h3>
        <p className="text-xs text-slate-500 mb-4">
          Bloquea tu disponibilidad en Google Calendar (continuo o recurrente diario).
        </p>

        {/* TOGGLE TIPO DE BLOQUEO */}
        <div className="flex bg-slate-100 p-1 rounded-xl mb-4 text-xs font-bold">
          <button
            type="button"
            onClick={() => setBlockMode("continuo")}
            className={`flex-1 py-1.5 rounded-lg transition-all ${
              blockMode === "continuo"
                ? "bg-white text-indigo-600 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            📌 Continuo (Vacaciones)
          </button>
          <button
            type="button"
            onClick={() => setBlockMode("recurrente")}
            className={`flex-1 py-1.5 rounded-lg transition-all ${
              blockMode === "recurrente"
                ? "bg-white text-indigo-600 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            ⏰ Diario (Comida / Fijo)
          </button>
        </div>

        <div className="mb-4">
          <label htmlFor="block-title" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
            Motivo / Título del Bloqueo
          </label>
          <input
            id="block-title"
            name="block_title"
            type="text"
            value={blockTitle}
            onChange={(e) => setBlockTitle(e.target.value)}
            placeholder={blockMode === "recurrente" ? "Ej. Hora de Comida" : "Ej. Vacaciones, Junta de equipo..."}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:border-indigo-400 outline-none text-xs font-medium text-slate-800"
          />
        </div>

        {blockMode === "continuo" ? (
          <>
            <div className="space-y-3 mb-4">
              <div>
                <label htmlFor="block-start" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
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
                <label htmlFor="block-end" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
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
              <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                Accesos Rápidos de Rango
              </span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const end = addHoursToDate(blockStartStr, 1);
                    if (end) setBlockEndStr(end);
                  }}
                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-600 rounded-lg text-xs font-bold transition-all border border-slate-200"
                >
                  ⏱️ +1 Hora
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const end = addHoursToDate(blockStartStr, 4);
                    if (end) setBlockEndStr(end);
                  }}
                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-600 rounded-lg text-xs font-bold transition-all border border-slate-200"
                >
                  ⏳ +4 Horas (Media jornada)
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (!blockStartStr) return;
                    const datePart = getDatePart(blockStartStr);
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
                    const end = addHoursToDate(blockStartStr, 48);
                    if (end) setBlockEndStr(end);
                  }}
                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-600 rounded-lg text-xs font-bold transition-all border border-slate-200"
                >
                  🏖️ +2 Días (48 Horas)
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* CONFIGURACIÓN BLOQUEO RECURRENTE */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label htmlFor="block-recurrente-start-date" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  📅 Desde fecha
                </label>
                <input
                  id="block-recurrente-start-date"
                  name="block_start_date"
                  type="date"
                  value={getDatePart(blockStartStr)}
                  onChange={(e) => {
                    const timePart = getTimePart(blockStartStr, "08:00");
                    setBlockStartStr(`${e.target.value}T${timePart}`);
                  }}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:border-indigo-400 outline-none text-xs text-slate-800 font-mono"
                />
              </div>
              <div>
                <label htmlFor="block-recurrente-end-date" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  🏁 Hasta fecha
                </label>
                <input
                  id="block-recurrente-end-date"
                  name="block_end_date"
                  type="date"
                  value={getDatePart(blockEndStr)}
                  onChange={(e) => {
                    const timePart = getTimePart(blockEndStr, "18:00");
                    setBlockEndStr(`${e.target.value}T${timePart}`);
                  }}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:border-indigo-400 outline-none text-xs text-slate-800 font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label htmlFor="block-recurrente-time-start" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  ⏰ Hora Inicio Diaria
                </label>
                <input
                  id="block-recurrente-time-start"
                  name="block_time_start"
                  type="time"
                  value={blockTimeStart}
                  onChange={(e) => setBlockTimeStart(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:border-indigo-400 outline-none text-xs text-slate-800 font-mono font-bold"
                />
              </div>
              <div>
                <label htmlFor="block-recurrente-time-end" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  🏁 Hora Fin Diaria
                </label>
                <input
                  id="block-recurrente-time-end"
                  name="block_time_end"
                  type="time"
                  value={blockTimeEnd}
                  onChange={(e) => setBlockTimeEnd(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:border-indigo-400 outline-none text-xs text-slate-800 font-mono font-bold"
                />
              </div>
            </div>

            {/* DÍAS DE LA SEMANA */}
            <div className="mb-6">
              <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                Días a Bloquear
              </span>
              <div className="flex gap-1.5">
                {[
                  { id: "MO", label: "L" },
                  { id: "TU", label: "M" },
                  { id: "WE", label: "M" },
                  { id: "TH", label: "J" },
                  { id: "FR", label: "V" },
                  { id: "SA", label: "S" },
                  { id: "SU", label: "D" },
                ].map((d) => {
                  const active = blockDays.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => {
                        setBlockDays((prev) =>
                          prev.includes(d.id) ? prev.filter((x) => x !== d.id) : [...prev, d.id]
                        );
                      }}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all border ${
                        active
                          ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                          : "bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={blocking}
            className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm transition-colors disabled:opacity-50 shadow-sm"
          >
            {blocking ? "Bloqueando..." : "Confirmar Bloqueo"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function CalendarioPage() {
  const router = useRouter();
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [googleEvents, setGoogleEvents] = useState<GoogleEvent[]>([]);
  const [gcalRange, setGcalRange] = useState<{ start: Date; end: Date } | null>(null);
  const reconciledRef = useRef<Set<string>>(new Set());
  const [recruiterColors, setRecruiterColors] = useState<Record<string, string>>({});
  const [recruiterNames, setRecruiterNames] = useState<Record<string, string>>({});
  const [recruiterPhones, setRecruiterPhones] = useState<Record<string, string>>({});
  const [recruiterIdToEmail, setRecruiterIdToEmail] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);
  const [myCalId, setMyCalId] = useState("");

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

  // Modal de crear bloqueo por rango o recurrente
  const [blockTarget, setBlockTarget] = useState<{ start: Date; end: Date } | null>(null);
  const [blockStartStr, setBlockStartStr] = useState("");
  const [blockEndStr, setBlockEndStr] = useState("");
  const [blockTitle, setBlockTitle] = useState("Vacaciones / Bloqueo");
  const [blockMode, setBlockMode] = useState<"continuo" | "recurrente">("continuo");
  const [blockDays, setBlockDays] = useState<string[]>(["MO", "TU", "WE", "TH", "FR"]);
  const [blockTimeStart, setBlockTimeStart] = useState("13:30");
  const [blockTimeEnd, setBlockTimeEnd] = useState("15:30");
  const [blocking, setBlocking] = useState(false);

  const cancelBackdrop = useBackdropClose(() => setCancelTarget(null));
  const eventBackdrop = useBackdropClose(() => setSelectedEvent(null));
  const rescheduleBackdrop = useBackdropClose(() => setRescheduleTarget(null));
  const blockBackdrop = useBackdropClose(() => setBlockTarget(null));

  // Vista del calendario
  const [view, setView] = useState<View>(Views.MONTH);
  const [date, setDate] = useState(new Date());

  const showToast = (msg: string, isError: boolean) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3500);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const storedEmpresaId = localStorage.getItem("tci_empresa_id");
      const storedGrupoId = localStorage.getItem("tci_grupo_id");
      const tenantParams = new URLSearchParams();
      if (storedEmpresaId) tenantParams.set("empresa_id", storedEmpresaId);
      const tenantQuery = tenantParams.toString() ? `?${tenantParams.toString()}` : "";

      const cands = await fetchCandidatosList(storedEmpresaId, storedGrupoId);
      setCandidatos(cands);

      const gcal = await fetchGoogleCalendarList();
      if (gcal.range) {
        setGoogleEvents(gcal.events);
        setGcalRange(gcal.range);
      }

      const myRecruiterId = localStorage.getItem("tci_reclutador_id");
      const recConfig = await fetchRecruitersConfig(tenantQuery, myRecruiterId);
      if (recConfig) {
        setRecruiterColors(recConfig.colorMap);
        setRecruiterNames(recConfig.nameMap);
        setRecruiterPhones(recConfig.phoneMap);
        setRecruiterIdToEmail(recConfig.idToEmailMap);
        if (recConfig.myCalIdLocal) setMyCalId(recConfig.myCalIdLocal);
      }

      showToast("Datos cargados", false);
    } catch {
      showToast("Error al cargar datos", true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = "Calendario Entrevistas | TCi";
    const cargar = async () => { await loadData(); };
    cargar();
  }, [loadData]);

  // Re-cargar (sin recargar la página) cuando el usuario cambia de empresa/grupo en el TopNavbar
  useTenantChange(() => loadData());



  // ── Citas huérfanas ──────────────────────────────────────────────────────
  const orphanedCandidatoIds = useMemo(() => {
    return findOrphanedCandidatoIds(candidatos, googleEvents, gcalRange);
  }, [candidatos, googleEvents, gcalRange]);

  // Manda a corregir en BD las citas huérfanas detectadas (una sola vez por id)
  useEffect(() => {
    const pendientes = Array.from(orphanedCandidatoIds).filter((id) => !reconciledRef.current.has(id));
    if (pendientes.length === 0) return;
    pendientes.forEach((id) => reconciledRef.current.add(id));

    fetch("/api/db/citas/reconciliar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidato_ids: pendientes }),
    })
      .then((res) => {
        if (!res.ok) return;
        setCandidatos((prev) => markCandidatesAsCancelled(prev, pendientes));
      })
      .catch(() => {
        pendientes.forEach((id) => reconciledRef.current.delete(id));
      });
  }, [orphanedCandidatoIds]);

  // ── Events ──────────────────────────────────────────────────────────────
  const events: CalendarEvent[] = useMemo(() => {
    return buildUnifiedCalendarEvents(
      candidatos,
      googleEvents,
      orphanedCandidatoIds,
      recruiterColors,
      recruiterIdToEmail,
      myCalId
    );
  }, [candidatos, googleEvents, myCalId, orphanedCandidatoIds, recruiterColors, recruiterIdToEmail]);

  const formatVisualDate = (d: Date) => format(d, "dd/MM/yyyy HH:mm");

  // ── Panel lateral agrupado ───────────────────────────────────────────────
  const eventsByRecruiter = useMemo(
    () => groupEventsByRecruiter(events, recruiterNames),
    [events, recruiterNames]
  );

  const toggleRecruiter = (email: string) =>
    setExpandedRecruiters((prev) => ({ ...prev, [email]: !prev[email] }));

  // ── Cancelación ─────────────────────────────────────────────────────────
  const openCancelModal = (e: React.MouseEvent, event: CalendarEvent) => {
    e.stopPropagation();
    setCancelTarget(event);
    setCancelPassword("");
    setCancelError("");
    setCancelReason("Por imprevistos de agenda en el equipo de reclutamiento.");
    setRecruiterPhone(resolveAssignedPhone(event, recruiterPhones));
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

      // 2. Si es correcta, procedemos a cancelar
      setCancelTarget(null);
      const myRecruiterName = typeof window !== "undefined" ? localStorage.getItem("tci_nombre") : "";
      const nombreReclutador = myRecruiterName || resolveRecruiterDisplayName(cancelTarget.resource.creator_email || "", recruiterNames);
      await submitCancelCita({ cancelTarget, cancelReason, recruiterPhone, nombreReclutador });
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
    setRecruiterPhone(resolveAssignedPhone(event, recruiterPhones));
  };

  const confirmReschedule = async () => {
    if (!rescheduleTarget || !newDate || !newTime) return;
    setRescheduling(true);

    try {
      const myRecruiterName = typeof window !== "undefined" ? localStorage.getItem("tci_nombre") : "";
      const nombreReclutador = myRecruiterName || resolveRecruiterDisplayName(rescheduleTarget.resource.creator_email || "", recruiterNames);
      await submitRescheduleCita({
        rescheduleTarget,
        newDate,
        newTime,
        rescheduleReason,
        recruiterPhone,
        nombreReclutador,
      });
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
    setBlockMode("continuo");
    setBlockTimeStart(format(start, "HH:mm") || "13:30");
    setBlockTimeEnd(format(end, "HH:mm") || "15:30");
    setBlockDays(["MO", "TU", "WE", "TH", "FR"]);
    setBlockTitle("Bloqueo de Horario");
  };

  const confirmBlock = async () => {
    if (!blockTarget || !blockTitle) return;
    setBlocking(true);
    try {
      await submitBlockCita({
        blockMode,
        blockTarget,
        blockStartStr,
        blockEndStr,
        blockTimeStart,
        blockTimeEnd,
        blockDays,
        blockTitle,
        myCalId,
      });
      showToast(blockMode === "recurrente" ? "✅ Bloqueo diario recurrente creado correctamente" : "✅ Bloqueo de horario creado correctamente", false);
      setBlockTarget(null);
      loadData();
    } catch {
      showToast("❌ Error al crear bloqueo", true);
    } finally {
      setBlocking(false);
    }
  };

  const handleSelectEvent = (event: CalendarEvent) => setSelectedEvent(event);

  const getRecruiterDisplayName = (email: string) => resolveRecruiterDisplayName(email, recruiterNames);

  const getColorForEmail = (email: string) => getRecruiterColor(email, recruiterColors);

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
                          className="px-4 py-3 hover:bg-white transition-colors group flex items-start justify-between gap-2"
                        >
                          <button
                            type="button"
                            className="overflow-hidden flex-1 text-left cursor-pointer"
                            onClick={() => handleSelectEvent(ev)}
                          >
                            <p className="font-semibold text-slate-800 text-sm truncate">
                              {ev.resource.nombre_chat || ev.resource.nombre_solicitud || "Candidato"}
                            </p>
                            <p className="text-[11px] text-slate-400 truncate mt-0.5">
                              {ev.resource.vacante_interes || "Sin vacante"}
                            </p>
                            <p className="text-[11px] text-indigo-500 font-semibold mt-1">
                              {format(ev.start, "EEE d MMM · HH:mm", { locale: es })}
                            </p>
                          </button>
                          <button
                            type="button"
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
          {...cancelBackdrop}
        >
          <div
            className="bg-white w-[90%] max-w-md rounded-2xl p-6 shadow-2xl"
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
                <label htmlFor="cancel-reason" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
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
                <label htmlFor="cancel-recruiter-phone" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
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
                  <p className="text-red-500 text-xs mt-1 font-medium">{cancelError}</p>
                )}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setCancelTarget(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition-colors"
              >
                Volver
              </button>
              <button
                onClick={confirmCancel}
                disabled={cancelingId === cancelTarget.id}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm transition-colors disabled:opacity-50 shadow-sm"
              >
                {cancelingId === cancelTarget.id ? "Cancelando..." : "Confirmar y Notificar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL DETALLE EVENTO ─── */}
      {selectedEvent && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1000]"
          {...eventBackdrop}
        >
          <div
            className="bg-white w-[90%] max-w-md rounded-2xl p-7 shadow-2xl relative"
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
          {...rescheduleBackdrop}
        >
          <div
            className="bg-white w-[90%] max-w-md rounded-2xl p-6 shadow-2xl relative"
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
                <label htmlFor="reschedule-reason" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
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
                <label htmlFor="reschedule-recruiter-phone" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
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
      <BloquearHorarioModal
        blockTarget={blockTarget}
        blockBackdrop={blockBackdrop}
        blockTitle={blockTitle}
        setBlockTitle={setBlockTitle}
        blockMode={blockMode}
        setBlockMode={setBlockMode}
        blockStartStr={blockStartStr}
        setBlockStartStr={setBlockStartStr}
        blockEndStr={blockEndStr}
        setBlockEndStr={setBlockEndStr}
        blockTimeStart={blockTimeStart}
        setBlockTimeStart={setBlockTimeStart}
        blockTimeEnd={blockTimeEnd}
        setBlockTimeEnd={setBlockTimeEnd}
        blockDays={blockDays}
        setBlockDays={setBlockDays}
        blocking={blocking}
        onClose={() => setBlockTarget(null)}
        onConfirm={confirmBlock}
      />

      {/* TOAST */}
      <div className={`fixed bottom-6 right-6 px-5 py-3 rounded-xl font-bold text-white shadow-xl transition-all duration-300 z-[3000] ${toast ? "translate-y-0 opacity-100" : "translate-y-16 opacity-0"
        } ${toast?.isError ? "bg-red-500" : "bg-emerald-500"}`}>
        {toast?.msg}
      </div>
    </div>
  );
}
