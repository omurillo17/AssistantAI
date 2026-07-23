import React, { useState, useEffect } from "react";
import { Trash2 } from "lucide-react";

interface GroupsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  empresas: any[];
  grupos: any[];
  naves: any[];
  showToast: (msg: string, isError?: boolean) => void;
}

export default function GroupsModal({
  isOpen,
  onClose,
  onSuccess,
  empresas,
  grupos,
  naves,
  showToast,
}: GroupsModalProps) {
  const [grupoNombreInput, setGrupoNombreInput] = useState("");
  const [grupoEmpresaInput, setGrupoEmpresaInput] = useState("");
  const [grupoNavesInput, setGrupoNavesInput] = useState<string[]>([]);
  const [creatingGrupo, setCreatingGrupo] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setGrupoNombreInput("");
      setGrupoEmpresaInput("");
      setGrupoNavesInput([]);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const crearGrupo = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingGrupo(true);

    try {
      const res = await fetch("/api/db/grupos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: grupoNombreInput.toUpperCase(),
          empresa_id: grupoEmpresaInput,
          naves_asignadas: grupoNavesInput,
        }),
      });

      if (res.ok) {
        showToast("Grupo creado exitosamente");
        setGrupoNombreInput("");
        setGrupoEmpresaInput("");
        setGrupoNavesInput([]);
        onSuccess();
      } else {
        const d = await res.json();
        showToast(d.error || "Error al crear grupo", true);
      }
    } catch (e) {
      showToast("Error de red al crear grupo", true);
    } finally {
      setCreatingGrupo(false);
    }
  };

  const eliminarGrupo = async (grupoId: string) => {
    if (!confirm("¿Estás seguro de eliminar este grupo?")) return;

    try {
      const res = await fetch(`/api/db/grupos?id=${grupoId}`, { method: "DELETE" });
      if (res.ok) {
        showToast("Grupo eliminado");
        onSuccess();
      } else {
        const d = await res.json();
        showToast(d.error || "Error al eliminar", true);
      }
    } catch (e) {
      showToast("Error de red", true);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1500] p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl p-6 md:p-8 shadow-2xl relative" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-slate-800">Grupos de Reclutamiento</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl">&times;</button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Formulario Crear Grupo */}
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 h-fit">
            <h3 className="font-bold text-slate-700 mb-4">Nuevo Grupo</h3>
            <form onSubmit={crearGrupo} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-1">Nombre del Grupo</label>
                <input 
                  required 
                  type="text" 
                  className="w-full p-2 border rounded uppercase" 
                  value={grupoNombreInput} 
                  onChange={e => setGrupoNombreInput(e.target.value.toUpperCase())} 
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-1">Empresa</label>
                <select 
                  required 
                  className="w-full p-2 border rounded" 
                  value={grupoEmpresaInput} 
                  onChange={e => {
                    setGrupoEmpresaInput(e.target.value);
                    setGrupoNavesInput([]);
                  }}
                >
                  <option value="">Selecciona una empresa...</option>
                  {empresas.map(emp => <option key={emp.id} value={emp.id}>{emp.nombre}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-1">Naves Asignadas</label>
                <div className="max-h-40 overflow-y-auto bg-white border rounded p-2">
                  {grupoEmpresaInput ? (
                    naves.filter(n => String(n.empresa_id) === String(grupoEmpresaInput)).map(n => (
                      <label key={n.id} className="flex items-center gap-2 text-sm cursor-pointer mb-1">
                        <input 
                          type="checkbox" 
                          checked={grupoNavesInput.includes(n.id)} 
                          onChange={e => {
                            if(e.target.checked) setGrupoNavesInput([...grupoNavesInput, n.id]);
                            else setGrupoNavesInput(grupoNavesInput.filter(id => id !== n.id));
                          }} 
                        />
                        {n.nombre}
                      </label>
                    ))
                  ) : (
                    <p className="text-xs text-slate-400 italic text-center py-2">Selecciona una empresa primero</p>
                  )}

                  {grupoEmpresaInput && naves.filter(n => String(n.empresa_id) === String(grupoEmpresaInput)).length === 0 && (
                    <p className="text-xs text-slate-500 text-center py-2">Esta empresa no tiene naves registradas</p>
                  )}
                </div>
              </div>

              <button 
                type="submit" 
                disabled={creatingGrupo} 
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 rounded transition-colors disabled:bg-slate-400"
              >
                {creatingGrupo ? "Guardando..." : "Guardar Grupo"}
              </button>
            </form>
          </div>

          {/* Listado de Grupos */}
          <div className="bg-white border rounded p-4 max-h-[60vh] overflow-y-auto">
            <h3 className="font-bold text-slate-700 mb-4">Grupos Existentes</h3>
            <div className="space-y-3">
              {grupos.map(g => {
                const emp = empresas.find(e => e.id === g.empresa_id);
                const nvs = naves.filter(n => g.naves_asignadas?.includes(n.id)).map(n => n.nombre).join(", ");
                return (
                  <div key={g.id} className="p-3 bg-slate-50 rounded border border-slate-100 flex justify-between items-start gap-2">
                    <div>
                      <h4 className="font-bold text-slate-800 text-sm">{g.nombre}</h4>
                      <p className="text-xs text-slate-500 font-medium">Empresa: {emp ? emp.nombre : "Sin Asignar"}</p>
                      <p className="text-xs text-slate-400 mt-1">Naves: {nvs || "Ninguna"}</p>
                    </div>
                    <button 
                      onClick={() => eliminarGrupo(g.id)} 
                      className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                      title="Eliminar Grupo"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              })}
              {grupos.length === 0 && (
                <p className="text-xs text-slate-450 italic text-center py-4">No hay grupos de reclutamiento creados.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
