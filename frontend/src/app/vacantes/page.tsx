"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Vacante = {
  id: string;
  nombre: string;
  naves: string[];
  detalles: string;
  activa: boolean;
};

type Recruiter = {
  reclutador_id: string;
  nombre: string;
  activo: boolean;
  vacantes: Vacante[];
};

const N8N_BASE_URL = "http://localhost:5678";
const API_URL = `${N8N_BASE_URL}/webhook/api-vacantes`;

export default function VacantesPage() {
  const router = useRouter();

  const [recruiters, setRecruiters] = useState<Recruiter[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);

  useEffect(() => {
    document.title = "Gestión de Vacantes | TCi";
    const auth = localStorage.getItem("tci_authenticated");
    if (!auth) {
      router.push("/login");
    } else {
      loadData();
    }
  }, [router]);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalRecruiterId, setModalRecruiterId] = useState<string | null>(null);
  const [modalVacancyId, setModalVacancyId] = useState<string | null>(null);

  const [vNombre, setVNombre] = useState("");
  const [vDetalles, setVDetalles] = useState("");
  const [vNaves, setVNaves] = useState<string[]>([]);

  // Drag and Drop state
  const [draggedItem, setDraggedItem] = useState<{ recIndex: number; vacIndex: number } | null>(null);

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
        activo: rec.activo !== false, // default to true
        vacantes: (rec.vacantes || []).map((vac: any, j: number) => ({
          ...vac,
          id: vac.id || `vac_${i}_${j}_${Date.now()}`,
          activa: vac.activa !== false // default to true
        }))
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

  const toggleRecruiter = (recIndex: number) => {
    const updated = [...recruiters];
    updated[recIndex].activo = !updated[recIndex].activo;
    setRecruiters(updated);
  };

  const toggleVacancy = (recIndex: number, vacIndex: number) => {
    const updated = [...recruiters];
    updated[recIndex].vacantes[vacIndex].activa = !updated[recIndex].vacantes[vacIndex].activa;
    setRecruiters(updated);
  };

  const removeVacancy = (recIndex: number, vacIndex: number) => {
    if (!confirm("¿Seguro que deseas ELIMINAR esta vacante permanentemente?")) return;
    const updated = [...recruiters];
    updated[recIndex].vacantes.splice(vacIndex, 1);
    setRecruiters(updated);
  };

  const openModal = (recId: string, vac?: Vacante) => {
    setModalRecruiterId(recId);
    if (vac) {
      setModalVacancyId(vac.id);
      setVNombre(vac.nombre);
      setVDetalles(vac.detalles || "");
      setVNaves(Array.isArray(vac.naves) ? vac.naves : typeof vac.naves === "string" ? [vac.naves] : []);
    } else {
      setModalVacancyId(null);
      setVNombre("");
      setVDetalles("");
      setVNaves([]);
    }
    setIsModalOpen(true);
  };

  const saveVacancy = () => {
    if (!vNombre || vNaves.length === 0) {
      alert("Debes ingresar un nombre y seleccionar al menos una nave.");
      return;
    }
    const updated = [...recruiters];
    const recIndex = updated.findIndex((r) => r.reclutador_id === modalRecruiterId);
    if (recIndex === -1) return;

    if (modalVacancyId) {
      // Edit
      const vacIndex = updated[recIndex].vacantes.findIndex((v) => v.id === modalVacancyId);
      if (vacIndex > -1) {
        updated[recIndex].vacantes[vacIndex] = {
          ...updated[recIndex].vacantes[vacIndex],
          nombre: vNombre.toUpperCase(),
          detalles: vDetalles,
          naves: vNaves,
        };
      }
    } else {
      // Create
      updated[recIndex].vacantes.push({
        id: "v_" + Date.now().toString(),
        nombre: vNombre.toUpperCase(),
        detalles: vDetalles,
        naves: vNaves,
        activa: true,
      });
    }

    setRecruiters(updated);
    setIsModalOpen(false);
  };

  const toggleNave = (n: string) => {
    if (vNaves.includes(n)) {
      setVNaves(vNaves.filter((x) => x !== n));
    } else {
      setVNaves([...vNaves, n]);
    }
  };

  const handleDragStart = (recIndex: number, vacIndex: number) => {
    setDraggedItem({ recIndex, vacIndex });
  };

  const handleDrop = (e: React.DragEvent, targetRecIndex: number, targetVacIndex: number) => {
    e.preventDefault();
    if (!draggedItem) return;

    const updated = [...recruiters];
    const sourceList = updated[draggedItem.recIndex].vacantes;
    const targetList = updated[targetRecIndex].vacantes;

    const [moved] = sourceList.splice(draggedItem.vacIndex, 1);

    // Si lo movemos al final o a un array vacío
    if (targetVacIndex === -1) {
      targetList.push(moved);
    } else {
      targetList.splice(targetVacIndex, 0, moved);
    }

    setRecruiters(updated);
    setDraggedItem(null);
  };

  if (loading) return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500">Cargando...</div>;

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 text-slate-800">
      <header className="px-10 py-5 bg-white/90 backdrop-blur-md border-b border-black/10 flex justify-between items-center sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg transition-colors text-sm border border-black/10"
          >
            ⬅ Atrás
          </button>
          <div className="text-2xl font-extrabold bg-gradient-to-br from-indigo-500 to-purple-500 bg-clip-text text-transparent">
            Gestión de Vacantes TCi
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

      <main className="flex-1 p-10 max-w-7xl mx-auto w-full">
        {loading ? (
          <div className="flex justify-center mt-20">
            <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {recruiters.map((rec, recIndex) => (
              <div
                key={rec.reclutador_id}
                className={`flex flex-col bg-white rounded-2xl border transition-all shadow-sm hover:shadow-md ${!rec.activo ? "border-red-500/30 opacity-75" : "border-black/10 hover:border-indigo-500"
                  }`}
              >
                <div className={`p-5 border-b border-black/10 flex items-center justify-between rounded-t-2xl ${!rec.activo ? "bg-red-50" : "bg-slate-100/80"}`}>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">👤</span>
                    <h3 className={`font-bold text-lg ${!rec.activo ? "text-red-500" : "text-slate-800"}`}>{rec.nombre}</h3>
                  </div>
                  <label className="flex items-center cursor-pointer">
                    <div className="relative">
                      <input type="checkbox" className="sr-only" checked={rec.activo} onChange={() => toggleRecruiter(recIndex)} />
                      <div className={`block w-10 h-6 rounded-full transition-colors ${rec.activo ? "bg-indigo-500" : "bg-slate-300"}`}></div>
                      <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${rec.activo ? "transform translate-x-4" : ""}`}></div>
                    </div>
                  </label>
                </div>

                <div
                  className="p-5 flex-1 max-h-[400px] overflow-y-auto flex flex-col gap-3 custom-scrollbar min-h-[100px]"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDrop(e, recIndex, -1)}
                >
                  {rec.vacantes.map((vac, vacIndex) => (
                    <div
                      key={vac.id}
                      draggable
                      onDragStart={() => handleDragStart(recIndex, vacIndex)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.stopPropagation();
                        handleDrop(e, recIndex, vacIndex);
                      }}
                      className={`p-3 rounded-xl border transition-all cursor-grab active:cursor-grabbing ${!vac.activa ? "bg-slate-50 border-slate-200 opacity-60" : "bg-white border-black/10 hover:bg-slate-50 hover:border-black/20"
                        }`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-semibold text-[15px]">{vac.nombre}</div>
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-indigo-500 cursor-pointer"
                          checked={vac.activa}
                          onChange={() => toggleVacancy(recIndex, vacIndex)}
                        />
                      </div>
                      <div className="flex flex-wrap gap-1 mb-3">
                        {Array.isArray(vac.naves) &&
                          vac.naves.map((n) => (
                            <span key={n} className="bg-indigo-500/10 text-indigo-600 px-2 py-0.5 rounded-full text-[11px] font-bold">
                              Nave {n}
                            </span>
                          ))}
                      </div>
                      <div className="flex gap-2 border-t border-black/5 pt-3">
                        <button onClick={() => openModal(rec.reclutador_id, vac)} className="text-xs bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1.5 rounded-lg flex-1 font-semibold transition-colors">
                          Editar
                        </button>
                        <button onClick={() => removeVacancy(recIndex, vacIndex)} className="text-xs bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg font-semibold transition-colors">
                          Eliminar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {rec.activo && (
                  <div className="p-4 border-t border-black/10 bg-slate-100/50 rounded-b-2xl">
                    <button onClick={() => openModal(rec.reclutador_id)} className="w-full py-2 border border-black/10 text-slate-700 font-semibold rounded-lg hover:bg-black/5 transition-colors">
                      + Añadir Vacante
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Modal Añadir/Editar Vacante */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1000]">
          <div className="bg-white w-[90%] max-w-lg rounded-2xl p-8 shadow-2xl relative">
            <h3 className="text-xl font-bold text-slate-800 mb-6 pb-4 border-b border-black/10">
              {modalVacancyId ? "Editar Vacante" : "Agregar Vacante"}
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-500 font-medium mb-1">Nombre de la Vacante</label>
                <input
                  type="text"
                  className="w-full p-3 rounded-lg border border-black/10 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none uppercase transition-all shadow-sm"
                  placeholder="EJ: OPERADOR GENERAL"
                  value={vNombre}
                  onChange={(e) => setVNombre(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm text-slate-500 font-medium mb-2">Nave / Sucursal (Selecciona una o varias)</label>
                <div className="flex gap-4 p-4 bg-slate-50 border border-black/10 rounded-xl">
                  {["1", "2", "3"].map((n) => (
                    <label key={n} className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700">
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-indigo-500"
                        checked={vNaves.includes(n)}
                        onChange={() => toggleNave(n)}
                      />
                      Nave {n}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm text-slate-500 font-medium mb-1">Detalles (Sueldo, Horario, Requisitos)</label>
                <textarea
                  className="w-full p-3 rounded-lg border border-black/10 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none font-mono text-sm h-32 resize-y transition-all shadow-sm"
                  placeholder="-[REQUISITO EXCLUSIVO]&#10;-*Prestaciones de ley*&#10;-*$2,500 Semanales*..."
                  value={vDetalles}
                  onChange={(e) => setVDetalles(e.target.value)}
                ></textarea>
              </div>
            </div>

            <div className="flex gap-3 mt-8">
              <button onClick={() => setIsModalOpen(false)} className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors">
                Cancelar
              </button>
              <button onClick={saveVacancy} className="flex-1 py-3 bg-indigo-500 hover:bg-indigo-600 text-white font-semibold rounded-xl shadow-md transition-all">
                Guardar
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
