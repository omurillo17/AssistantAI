"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  Plus,
  Trash2,
  Save,
  ChevronLeft,
  AlertTriangle,
  CheckCircle2,
  Users,
  Filter,
  ToggleLeft,
  ToggleRight,
  HelpCircle,
  X,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────
import type { TipoFiltro, Filtro, Vacante, Recruiter } from "@/types";

// ─── Template Filters ────────────────────────────────────────────────────────
const FILTROS_TEMPLATE: Omit<Filtro, "id" | "activo">[] = [
  {
    clave: "genero",
    etiqueta: "Género",
    tipo: "opcion",
    pregunta: "¿Cuál es tu género?",
    opciones: ["MASCULINO", "FEMENINO"],
    valor_requerido: "MASCULINO",
  },
  {
    clave: "edad",
    etiqueta: "Rango de Edad",
    tipo: "rango_edad",
    pregunta: "¿Cuántos años tienes?",
    edad_min: 18,
    edad_max: 45,
  },
  {
    clave: "licencia",
    etiqueta: "Licencia de Chofer",
    tipo: "booleano",
    pregunta: "¿Cuentas con licencia de chofer tipo A o B vigente?",
    requiere_si: true,
  },
  {
    clave: "experiencia_reparto",
    etiqueta: "Experiencia en Reparto",
    tipo: "booleano",
    pregunta: "¿Tienes experiencia previa en reparto o distribución?",
    requiere_si: true,
  },
  {
    clave: "disponibilidad_sabados",
    etiqueta: "Disponibilidad Sábados",
    tipo: "booleano",
    pregunta: "¿Tienes disponibilidad para trabajar los sábados?",
    requiere_si: true,
  },
  {
    clave: "escolaridad",
    etiqueta: "Escolaridad Mínima",
    tipo: "opcion",
    pregunta: "¿Cuál es tu nivel de estudios?",
    opciones: ["PRIMARIA", "SECUNDARIA", "PREPARATORIA", "UNIVERSIDAD"],
    valor_requerido: "SECUNDARIA",
  },
];

const PREGUNTAS_BASE_PREDEFINIDAS: Omit<Filtro, "id" | "activo">[] = [
  { clave: "edad", etiqueta: "Edad", tipo: "texto", pregunta: "¿Cuántos años tienes?", es_pregunta_base: true },
  { clave: "municipio", etiqueta: "Municipio/Colonia", tipo: "texto", pregunta: "¿En qué municipio o colonia vives?", es_pregunta_base: true },
  { clave: "experiencia", etiqueta: "Último trabajo y duración", tipo: "texto", pregunta: "¿Cuál fue tu último trabajo y cuánto tiempo duraste?", es_pregunta_base: true },
  { clave: "habilidades", etiqueta: "Habilidades principales", tipo: "texto", pregunta: "¿Cuáles son tus habilidades principales?", es_pregunta_base: true },
  { clave: "correo", etiqueta: "Correo electrónico", tipo: "texto", pregunta: "¿Cuál es tu correo electrónico?", es_pregunta_base: true },
  { clave: "laborando", etiqueta: "¿Laborando actualmente?", tipo: "booleano", pregunta: "¿Te encuentras laborando actualmente?", requiere_si: true, es_pregunta_base: true },
  { clave: "computadora", etiqueta: "¿Computadora en casa?", tipo: "booleano", pregunta: "¿Cuentas con computadora en casa?", requiere_si: true, es_pregunta_base: true },
];

const API_URL = `/api/db/vacantes`;

// ─── Component ───────────────────────────────────────────────────────────────
export default function VacanteFiltrosPage() {
  const router = useRouter();
  const params = useParams();
  const vacId = params.id as string;

  const [vacante, setVacante] = useState<Vacante | null>(null);
  const [recruiterNombre, setRecruiterNombre] = useState("");
  const [recruiters, setRecruiters] = useState<Recruiter[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);
  const [showTemplatePanel, setShowTemplatePanel] = useState(false);
  const [showPreguntasBaseModal, setShowPreguntasBaseModal] = useState(false);

  // New filter form state
  const [newFiltro, setNewFiltro] = useState<Omit<Filtro, "id" | "activo">>({
    clave: "",
    etiqueta: "",
    tipo: "booleano",
    pregunta: "",
    requiere_si: true,
  });

  const showToast = (msg: string, isError: boolean) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3500);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(API_URL);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const raw: any[] = Array.isArray(data) ? data : data.data || [];

      const normalized = raw.map((rec: any, i: number) => ({
        ...rec,
        reclutador_id: rec.reclutador_id || `rec_${i}`,
        activo: rec.activo !== false,
        telefono: rec.telefono || '',
        calendar_id: rec.calendar_id || '',
        color: rec.color || '#6366f1',
        vacantes: (rec.vacantes || []).map((vac: any, j: number) => ({
          ...vac,
          id: vac.id || `vac_${i}_${j}`,
          activa: vac.activa !== false,
          filtros: vac.filtros || [],
        })),
      }));

      setRecruiters(normalized);

      // Find the specific vacancy
      let found: Vacante | null = null;
      let foundRec = "";
      for (const rec of normalized) {
        const v = rec.vacantes.find((v: Vacante) => v.id === vacId);
        if (v) {
          found = v;
          foundRec = rec.nombre;
          break;
        }
      }

      if (!found) {
        showToast("Vacante no encontrada", true);
        router.push("/vacantes");
        return;
      }

      setVacante(found);
      setRecruiterNombre(foundRec);
    } catch {
      showToast("Error al cargar datos", true);
    } finally {
      setLoading(false);
    }
  }, [vacId, router]);

  useEffect(() => {
    loadData();
  }, [loadData, router]);

  const saveFiltros = async (updatedFiltros: Filtro[]) => {
    if (!vacante) return;
    setSaving(true);
    try {
      const updatedRecruiters = recruiters.map((rec) => ({
        ...rec,
        vacantes: rec.vacantes.map((v) =>
          v.id === vacId ? { ...v, filtros: updatedFiltros } : v
        ),
      }));

      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedRecruiters),
      });
      if (!res.ok) throw new Error();

      setRecruiters(updatedRecruiters);
      setVacante({ ...vacante, filtros: updatedFiltros });
      showToast("✅ Filtros guardados", false);
    } catch {
      showToast("❌ Error al guardar", true);
    } finally {
      setSaving(false);
    }
  };

  const addFiltroFromTemplate = (template: Omit<Filtro, "id" | "activo">) => {
    if (!vacante) return;
    const existing = (vacante.filtros || []).find((f) => f.clave === template.clave);
    if (existing) { showToast("Este filtro ya está agregado", true); return; }
    const newF: Filtro = { ...template, id: `f_${Date.now()}`, activo: true };
    const updated = [...(vacante.filtros || []), newF];
    saveFiltros(updated);
    setShowTemplatePanel(false);
  };

  const addCustomFiltro = () => {
    if (!newFiltro.clave || !newFiltro.etiqueta || !newFiltro.pregunta) {
      showToast("Completa todos los campos del filtro", true);
      return;
    }
    const newF: Filtro = { ...newFiltro, id: `f_${Date.now()}`, activo: true };
    const updated = [...(vacante?.filtros || []), newF];
    saveFiltros(updated);
    setNewFiltro({ clave: "", etiqueta: "", tipo: "booleano", pregunta: "", requiere_si: true });
  };

  const toggleFiltro = (filtroId: string) => {
    if (!vacante) return;
    const updated = (vacante.filtros || []).map((f) =>
      f.id === filtroId ? { ...f, activo: !f.activo } : f
    );
    saveFiltros(updated);
  };

  const togglePreguntaBase = (template: Omit<Filtro, "id" | "activo">) => {
    if (!vacante) return;
    const existing = (vacante.filtros || []).find((f) => f.clave === template.clave);
    let updated;
    if (existing) {
      updated = (vacante.filtros || []).filter((f) => f.clave !== template.clave);
    } else {
      const newF: Filtro = { ...template, id: `fb_${Date.now()}_${Math.floor(Math.random() * 1000)}`, activo: true, es_pregunta_base: true };
      updated = [...(vacante.filtros || []), newF];
    }
    saveFiltros(updated);
  };

  const removeFiltro = (filtroId: string) => {
    if (!confirm("¿Eliminar este filtro?")) return;
    if (!vacante) return;
    const updated = (vacante.filtros || []).filter((f) => f.id !== filtroId);
    saveFiltros(updated);
  };

  const getTipoLabel = (tipo: TipoFiltro) => {
    const map: Record<TipoFiltro, string> = {
      booleano: "Sí / No",
      opcion: "Opción múltiple",
      rango_edad: "Rango de Edad",
      texto: "Texto libre",
      numero: "Número",
      si_no: "Sí / No",
    };
    return map[tipo];
  };

  const getTipoBadgeColor = (tipo: TipoFiltro) => {
    const map: Record<TipoFiltro, string> = {
      booleano: "bg-emerald-100 text-emerald-700",
      opcion: "bg-blue-100 text-blue-700",
      rango_edad: "bg-amber-100 text-amber-700",
      texto: "bg-slate-100 text-slate-600",
      numero: "bg-purple-100 text-purple-700",
      si_no: "bg-emerald-100 text-emerald-700",
    };
    return map[tipo];
  };

  const getFiltroDescription = (f: Filtro) => {
    if (f.tipo === "booleano") return f.requiere_si ? "Requiere respuesta: SÍ" : "Requiere respuesta: NO";
    if (f.tipo === "opcion") return `Valor requerido: ${f.valor_requerido || "cualquiera"}`;
    if (f.tipo === "rango_edad") return `Entre ${f.edad_min ?? "?"} y ${f.edad_max ?? "?"} años`;
    return "Respuesta abierta";
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!vacante) return null;

  const filtros = vacante.filtros || [];
  const activoCount = filtros.filter((f) => f.activo).length;

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 text-slate-800">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4 px-8 pt-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/vacantes")}
            className="flex items-center gap-1 px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 font-semibold rounded-lg shadow-sm transition-colors text-sm border border-slate-200"
          >
            <ChevronLeft size={16} /> Vacantes
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">{vacante.nombre}</h1>
            <p className="text-sm text-slate-500">{recruiterNombre} · Naves: {vacante.naves.join(", ")}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg border border-indigo-200 text-sm font-semibold">
            <Filter size={14} />
            {activoCount} filtro{activoCount !== 1 ? "s" : ""} activo{activoCount !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      <main className="flex-1 px-8 pb-12 max-w-5xl mx-auto w-full grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LEFT: Current Filters */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-slate-700 text-lg flex items-center gap-2">
              <Filter size={18} /> Filtros Configurados
            </h2>
            <button
              onClick={() => setShowTemplatePanel(!showTemplatePanel)}
              className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm"
            >
              <Plus size={14} /> Agregar Filtro
            </button>
          </div>

          {filtros.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center">
              <Filter size={32} className="mx-auto text-slate-300 mb-3" />
              <p className="text-slate-500 font-semibold">Sin filtros configurados</p>
              <p className="text-sm text-slate-400 mt-1">Agrega filtros para que la IA los aplique durante la conversación.</p>
              <button
                onClick={() => setShowTemplatePanel(true)}
                className="mt-4 px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg text-sm hover:bg-indigo-700 transition-colors"
              >
                + Agregar primer filtro
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {filtros.map((f) => (
                <div
                  key={f.id}
                  className={`bg-white rounded-xl border p-4 shadow-sm transition-all ${
                    f.activo ? "border-black/10" : "border-slate-200 opacity-60"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-bold text-slate-800">{f.etiqueta}</span>
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${getTipoBadgeColor(f.tipo)}`}>
                          {getTipoLabel(f.tipo)}
                        </span>
                        {!f.activo && (
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                            INACTIVO
                          </span>
                        )}
                        {f.es_pregunta_base && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 flex items-center gap-1" title="Pregunta Base">
                            <Users size={10} /> Base
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-600 mb-1">
                        <span className="font-medium text-slate-400">Pregunta: </span>
                        {f.pregunta}
                      </p>
                      <p className="text-xs text-slate-400">
                        <span className="font-medium">Criterio: </span>
                        {getFiltroDescription(f)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => toggleFiltro(f.id)}
                        className="text-slate-400 hover:text-indigo-600 transition-colors"
                        title={f.activo ? "Desactivar" : "Activar"}
                      >
                        {f.activo ? <ToggleRight size={24} className="text-indigo-500" /> : <ToggleLeft size={24} />}
                      </button>
                      <button
                        onClick={() => removeFiltro(f.id)}
                        className="text-slate-300 hover:text-red-500 transition-colors"
                        title="Eliminar filtro"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* How it works info box */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mt-4">
            <div className="flex items-start gap-3">
              <HelpCircle size={18} className="text-blue-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-blue-700 text-sm">¿Cómo funcionan los filtros?</p>
                <p className="text-blue-600 text-xs mt-1 leading-relaxed">
                  La IA hará las preguntas marcadas como <strong>activas</strong> a cada candidato que aplique a esta vacante.
                  Las respuestas quedan guardadas en la base de datos. Desde la pantalla de Candidatos podrás ver si cada candidato
                  cumple o no con los criterios y descartarlo con un clic.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: Add Filter Panel */}
        <div className="space-y-4">
          {/* Base Questions Button */}
          <button
            onClick={() => setShowPreguntasBaseModal(true)}
            className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold p-4 rounded-2xl flex items-center justify-between transition-colors shadow-sm"
          >
            <div className="flex items-center gap-3">
              <Users size={20} className="text-slate-300" />
              <div className="text-left">
                <div className="text-sm">Preguntas Base</div>
                <div className="text-xs text-slate-400 font-normal">Para candidatos sin CV</div>
              </div>
            </div>
            <ChevronLeft size={20} className="rotate-180" />
          </button>

          {/* Template Panel */}
          {showTemplatePanel && (
            <div className="bg-white rounded-2xl border border-black/10 shadow-sm overflow-hidden">
              <div className="p-4 bg-indigo-50 border-b border-indigo-100">
                <h3 className="font-bold text-indigo-800">Filtros Predefinidos</h3>
                <p className="text-xs text-indigo-600">Haz clic para agregar</p>
              </div>
              <div className="p-3 space-y-2 max-h-72 overflow-y-auto">
                {FILTROS_TEMPLATE.map((t) => {
                  const already = filtros.some((f) => f.clave === t.clave);
                  return (
                    <button
                      key={t.clave}
                      disabled={already}
                      onClick={() => addFiltroFromTemplate(t)}
                      className={`w-full text-left p-3 rounded-lg border transition-all text-sm ${
                        already
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700 cursor-not-allowed"
                          : "border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-slate-700"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{t.etiqueta}</span>
                        {already ? (
                          <CheckCircle2 size={14} className="text-emerald-500" />
                        ) : (
                          <Plus size={14} className="text-slate-400" />
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5 truncate">{t.pregunta}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Custom Filter Form */}
          <div className="bg-white rounded-2xl border border-black/10 shadow-sm p-5">
            <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
              <Plus size={16} /> Filtro Personalizado
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-500 block mb-1">Tipo de filtro</label>
                <select
                  value={newFiltro.tipo}
                  onChange={(e) => setNewFiltro({ ...newFiltro, tipo: e.target.value as TipoFiltro })}
                  className="w-full p-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:border-indigo-400 outline-none"
                >
                  <option value="booleano">Sí / No</option>
                  <option value="opcion">Opción múltiple</option>
                  <option value="rango_edad">Rango de Edad</option>
                  <option value="texto">Texto libre</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 block mb-1">Nombre (etiqueta)</label>
                <input
                  type="text"
                  placeholder="Ej: Manejo de montacargas"
                  value={newFiltro.etiqueta}
                  onChange={(e) => setNewFiltro({ ...newFiltro, etiqueta: e.target.value, clave: e.target.value.toLowerCase().replace(/\s+/g, "_") })}
                  className="w-full p-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:border-indigo-400 outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 block mb-1">Pregunta que hará la IA</label>
                <textarea
                  placeholder="Ej: ¿Tienes experiencia con montacargas?"
                  value={newFiltro.pregunta}
                  onChange={(e) => setNewFiltro({ ...newFiltro, pregunta: e.target.value })}
                  className="w-full p-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:border-indigo-400 outline-none h-16 resize-none"
                />
              </div>

              {newFiltro.tipo === "booleano" && (
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Para aprobar, el candidato debe responder</label>
                  <div className="flex gap-3">
                    {["Sí", "No"].map((opt) => (
                      <label key={opt} className="flex items-center gap-2 cursor-pointer text-sm">
                        <input
                          type="radio"
                          name="requiere_si"
                          checked={opt === "Sí" ? newFiltro.requiere_si === true : newFiltro.requiere_si === false}
                          onChange={() => setNewFiltro({ ...newFiltro, requiere_si: opt === "Sí" })}
                          className="accent-indigo-500"
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {newFiltro.tipo === "rango_edad" && (
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs font-medium text-slate-500 block mb-1">Edad mín.</label>
                    <input type="number" min={0} placeholder="18" value={newFiltro.edad_min ?? ""}
                      onChange={(e) => setNewFiltro({ ...newFiltro, edad_min: Number(e.target.value) })}
                      className="w-full p-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:border-indigo-400 outline-none" />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs font-medium text-slate-500 block mb-1">Edad máx.</label>
                    <input type="number" min={0} placeholder="45" value={newFiltro.edad_max ?? ""}
                      onChange={(e) => setNewFiltro({ ...newFiltro, edad_max: Number(e.target.value) })}
                      className="w-full p-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:border-indigo-400 outline-none" />
                  </div>
                </div>
              )}

              {newFiltro.tipo === "opcion" && (
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Opciones (separadas por coma)</label>
                  <input
                    type="text"
                    placeholder="MASCULINO, FEMENINO"
                    value={(newFiltro.opciones || []).join(", ")}
                    onChange={(e) => setNewFiltro({ ...newFiltro, opciones: e.target.value.split(",").map((s) => s.trim().toUpperCase()) })}
                    className="w-full p-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:border-indigo-400 outline-none"
                  />
                  <label className="text-xs font-medium text-slate-500 block mb-1 mt-2">Valor requerido</label>
                  <input
                    type="text"
                    placeholder="MASCULINO"
                    value={newFiltro.valor_requerido || ""}
                    onChange={(e) => setNewFiltro({ ...newFiltro, valor_requerido: e.target.value.toUpperCase() })}
                    className="w-full p-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:border-indigo-400 outline-none"
                  />
                </div>
              )}

              <button
                onClick={addCustomFiltro}
                disabled={saving}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
              >
                {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save size={14} />}
                Agregar Filtro
              </button>
            </div>
          </div>

          {/* Vacancy summary card */}
          <div className="bg-white rounded-2xl border border-black/10 shadow-sm p-5">
            <h3 className="font-bold text-slate-700 mb-3 flex items-center gap-2">
              <Users size={16} /> Resumen de la Vacante
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Estado</span>
                <span className={`font-semibold ${vacante.activa ? "text-emerald-600" : "text-red-500"}`}>
                  {vacante.activa ? "✅ Activa" : "❌ Inactiva"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Naves</span>
                <span className="font-semibold">{vacante.naves.join(", ")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Filtros activos</span>
                <span className="font-semibold text-indigo-600">{activoCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Filtros inactivos</span>
                <span className="font-semibold text-slate-400">{filtros.length - activoCount}</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Toast */}
      <div className={`fixed bottom-6 right-6 px-5 py-3 rounded-xl font-bold text-white shadow-xl transition-all duration-300 z-[2000] ${
        toast ? "translate-y-0 opacity-100" : "translate-y-16 opacity-0"
      } ${toast?.isError ? "bg-red-500" : "bg-emerald-500"}`}>
        {toast?.msg}
      </div>
      {/* Modal Preguntas Base */}
      {showPreguntasBaseModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1000] p-4" onClick={() => setShowPreguntasBaseModal(false)}>
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl relative flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50 rounded-t-2xl">
              <div>
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <Users size={20} className="text-indigo-500" />
                  Preguntas Base
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Marca las preguntas que se le harán a los candidatos que no envíen CV para armar su perfil manual.
                </p>
              </div>
              <button onClick={() => setShowPreguntasBaseModal(false)} className="text-slate-400 hover:text-slate-700 bg-white p-1 rounded-full shadow-sm">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-2 overflow-y-auto">
              <div className="space-y-1">
                {PREGUNTAS_BASE_PREDEFINIDAS.map((pb) => {
                  const isSelected = (vacante?.filtros || []).some((f) => f.clave === pb.clave);
                  return (
                    <label key={pb.clave} className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-colors ${isSelected ? "bg-indigo-50/50" : "hover:bg-slate-50"}`}>
                      <div className="mt-0.5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => togglePreguntaBase(pb)}
                          className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-bold text-slate-700">{pb.etiqueta}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{pb.pregunta}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
            
            <div className="p-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex justify-end">
              <button
                onClick={() => setShowPreguntasBaseModal(false)}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-colors shadow-sm"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
