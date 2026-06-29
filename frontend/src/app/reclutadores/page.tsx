"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Recruiter = {
  reclutador_id: string;
  nombre: string;
  emoji: string;
  telefono: string;
  calendar_id: string;
  naves: string[];
  activo: boolean;
  vacantes: any[];
};

const N8N_BASE_URL = "http://localhost:5678";
const API_URL = `${N8N_BASE_URL}/webhook/api-vacantes`;

export default function ReclutadoresPage() {
  const router = useRouter();

  const [recruiters, setRecruiters] = useState<Recruiter[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [rNombre, setRNombre] = useState("");
  const [rEmoji, setREmoji] = useState("");
  const [rTelefono, setRTelefono] = useState("");
  const [rCalendar, setRCalendar] = useState("");
  const [rNaves, setRNaves] = useState<string[]>([]);

  useEffect(() => {
    document.title = "Gestión de Reclutadores | TCi";
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

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch(API_URL);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const raw = Array.isArray(data) ? data : data.data || [];

      const normalized = raw.map((rec: any, i: number) => ({
        ...rec,
        reclutador_id: rec.reclutador_id || `rec_${i}_${Date.now()}`,
        activo: rec.activo !== false,
        vacantes: rec.vacantes || []
      }));

      setRecruiters(normalized);
      showToast("Datos cargados", false);
    } catch (e) {
      showToast("Error al cargar datos de n8n.", true);
    } finally {
      setLoading(false);
    }
  };

  const saveData = async () => {
    try {
      showToast("Guardando...", false);
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(recruiters),
      });
      if (!res.ok) throw new Error();
      showToast("✅ Cambios guardados con éxito", false);
    } catch (e) {
      showToast("❌ Error al guardar en n8n.", true);
    }
  };

  const removeRecruiter = (recId: string) => {
    const rec = recruiters.find(r => r.reclutador_id === recId);
    if (!rec) return;

    if (!confirm(`¿Estás SEGURO de eliminar al reclutador "${rec.nombre}"? ESTO BORRARÁ TODAS SUS VACANTES ASIGNADAS DE FORMA PERMANENTE.`)) {
      return;
    }

    const updated = recruiters.filter(r => r.reclutador_id !== recId);
    setRecruiters(updated);
  };

  const openModal = (recId?: string) => {
    if (recId) {
      const rec = recruiters.find(r => r.reclutador_id === recId);
      if (rec) {
        setEditingId(rec.reclutador_id);
        setRNombre(rec.nombre);
        setREmoji(rec.emoji || "👤");
        setRTelefono(rec.telefono || "");
        setRCalendar(rec.calendar_id || "");
        setRNaves(rec.naves || []);
      }
    } else {
      setEditingId(null);
      setRNombre("");
      setREmoji("👤");
      setRTelefono("521");
      setRCalendar("");
      setRNaves([]);
    }
    setIsModalOpen(true);
  };

  const saveRecruiter = () => {
    if (!rNombre || !rTelefono) {
      alert("El Nombre y Teléfono son obligatorios.");
      return;
    }

    const updated = [...recruiters];

    if (editingId) {
      // Edit
      const index = updated.findIndex(r => r.reclutador_id === editingId);
      if (index > -1) {
        updated[index] = {
          ...updated[index],
          nombre: rNombre,
          emoji: rEmoji,
          telefono: rTelefono,
          calendar_id: rCalendar,
          naves: rNaves
        };
      }
    } else {
      // Create
      updated.push({
        reclutador_id: `rec_new_${Date.now()}`,
        nombre: rNombre,
        emoji: rEmoji,
        telefono: rTelefono,
        calendar_id: rCalendar,
        naves: rNaves,
        activo: true,
        vacantes: []
      });
    }

    setRecruiters(updated);
    setIsModalOpen(false);
  };

  const toggleNave = (n: string) => {
    if (rNaves.includes(n)) {
      setRNaves(rNaves.filter((x) => x !== n));
    } else {
      setRNaves([...rNaves, n]);
    }
  };

  if (loading) return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500">Cargando...</div>;

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 text-slate-800">
      <header className="px-10 py-5 bg-white/90 backdrop-blur-md border-b border-black/10 flex justify-between items-center sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/")}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg transition-colors text-sm border border-black/10"
          >
            ⬅ Atrás
          </button>
          <div className="text-2xl font-extrabold bg-gradient-to-br from-indigo-500 to-purple-500 bg-clip-text text-transparent">
            Gestión de Reclutadores
          </div>
        </div>
        <div className="flex gap-4">
          <button onClick={loadData} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg transition-all border border-slate-200">
            Descartar Cambios
          </button>
          <button onClick={saveData} className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white font-semibold rounded-lg shadow-md transition-all">
            Guardar
          </button>
        </div>
      </header>

      <main className="flex-1 p-10 max-w-5xl mx-auto w-full">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-xl font-bold text-slate-700">Reclutadores Activos</h1>
          <button
            onClick={() => openModal()}
            className="px-6 py-3 bg-white border border-indigo-200 text-indigo-600 font-bold rounded-xl shadow-sm hover:shadow-md hover:bg-indigo-50 transition-all"
          >
            + Añadir Nuevo Reclutador
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {recruiters.map((rec) => (
            <div key={rec.reclutador_id} className="bg-white p-6 rounded-2xl border border-black/10 shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
              <div>
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className="text-4xl bg-slate-50 p-2 rounded-xl border border-black/5">{rec.emoji || "👤"}</div>
                    <div>
                      <h2 className="text-lg font-bold text-slate-800">{rec.nombre}</h2>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${rec.activo ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                        {rec.activo ? "ACTIVO" : "INACTIVO"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 mb-6">
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <span className="font-semibold text-slate-400 w-24">Teléfono:</span>
                    {rec.telefono || <span className="text-slate-300 italic">No asignado</span>}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <span className="font-semibold text-slate-400 w-24">Calendar ID:</span>
                    <span className="truncate" title={rec.calendar_id}>{rec.calendar_id || <span className="text-slate-300 italic">No asignado</span>}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <span className="font-semibold text-slate-400 w-24">Naves:</span>
                    <div className="flex gap-1">
                      {rec.naves && rec.naves.length > 0 ? rec.naves.map(n => (
                        <span key={n} className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded text-xs font-bold">{n}</span>
                      )) : <span className="text-slate-300 italic text-xs">Ninguna</span>}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-2 border-t border-slate-100 pt-4">
                <button
                  onClick={() => openModal(rec.reclutador_id)}
                  className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-sm transition-colors"
                >
                  ✏️ Editar
                </button>
                <button
                  onClick={() => removeRecruiter(rec.reclutador_id)}
                  className="flex-1 py-2 bg-red-50 hover:bg-red-100 text-red-600 font-semibold rounded-lg text-sm transition-colors"
                >
                  🗑️ Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Modal Añadir/Editar Reclutador */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1000]">
          <div className="bg-white w-[90%] max-w-lg rounded-2xl p-8 shadow-2xl relative">
            <h3 className="text-xl font-bold text-slate-800 mb-6 pb-4 border-b border-black/10">
              {editingId ? "Editar Reclutador" : "Agregar Reclutador"}
            </h3>

            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="w-24">
                  <label className="block text-sm text-slate-500 font-medium mb-1">Emoji</label>
                  <input
                    type="text"
                    className="w-full p-3 rounded-lg border border-black/10 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none text-center text-xl transition-all shadow-sm"
                    value={rEmoji}
                    onChange={(e) => setREmoji(e.target.value)}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm text-slate-500 font-medium mb-1">Nombre</label>
                  <input
                    type="text"
                    className="w-full p-3 rounded-lg border border-black/10 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none transition-all shadow-sm"
                    placeholder="Ej: Michelle"
                    value={rNombre}
                    onChange={(e) => setRNombre(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-slate-500 font-medium mb-1">Teléfono (Con código de país, ej: 521...)</label>
                <input
                  type="text"
                  className="w-full p-3 rounded-lg border border-black/10 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none font-mono transition-all shadow-sm"
                  placeholder="5213314057808"
                  value={rTelefono}
                  onChange={(e) => setRTelefono(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm text-slate-500 font-medium mb-1">ID de Google Calendar (Correo)</label>
                <input
                  type="email"
                  className="w-full p-3 rounded-lg border border-black/10 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none transition-all shadow-sm"
                  placeholder="ejemplo@gmail.com"
                  value={rCalendar}
                  onChange={(e) => setRCalendar(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm text-slate-500 font-medium mb-2">Naves asignadas por defecto</label>
                <div className="flex gap-4 p-4 bg-slate-50 border border-black/10 rounded-xl">
                  {["1", "2", "3"].map((n) => (
                    <label key={n} className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700">
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-indigo-500"
                        checked={rNaves.includes(n)}
                        onChange={() => toggleNave(n)}
                      />
                      Nave {n}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-8">
              <button onClick={() => setIsModalOpen(false)} className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors">
                Cancelar
              </button>
              <button onClick={saveRecruiter} className="flex-1 py-3 bg-indigo-500 hover:bg-indigo-600 text-white font-semibold rounded-xl shadow-md transition-all">
                Guardar Cambios
              </button>
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
