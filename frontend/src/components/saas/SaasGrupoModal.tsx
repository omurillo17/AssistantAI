import React, { useState, useEffect } from "react";
import { X } from "lucide-react";

interface SaasGrupoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  empresa: any;
  grupo?: any;
  showToast: (msg: string, isError?: boolean) => void;
}

export default function SaasGrupoModal({
  isOpen,
  onClose,
  onSuccess,
  empresa,
  grupo,
  showToast,
}: SaasGrupoModalProps) {
  const [grupoNombre, setGrupoNombre] = useState("");
  const [grupoNaves, setGrupoNaves] = useState<string[]>([]);
  const [grupoTelefono, setGrupoTelefono] = useState("");
  const [savingGrupo, setSavingGrupo] = useState(false);

  useEffect(() => {
    if (isOpen && grupo) {
      setGrupoNombre(grupo.nombre || "");
      setGrupoNaves(grupo.naves_asignadas || []);
      setGrupoTelefono(grupo.telefono_whatsapp || "");
    } else if (!isOpen) {
      setGrupoNombre("");
      setGrupoNaves([]);
      setGrupoTelefono("");
    }
  }, [isOpen, grupo]);

  if (!isOpen || !empresa) return null;

  const isEditing = !!grupo?.id;

  const handleSaveGrupo = async () => {
    if (!grupoNombre) return showToast("El nombre del grupo es obligatorio", true);
    setSavingGrupo(true);

    try {
      const res = await fetch("/api/db/grupos", {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: grupo?.id,
          nombre: grupoNombre.toUpperCase(),
          empresa_id: empresa.id,
          naves_asignadas: grupoNaves,
          telefono_whatsapp: grupoTelefono,
        }),
      });

      if (res.ok) {
        showToast(isEditing ? "Grupo actualizado correctamente" : "Grupo creado correctamente");
        onSuccess();
        onClose();
        setGrupoNombre("");
        setGrupoNaves([]);
      } else {
        showToast("Error al guardar grupo", true);
      }
    } catch (e) {
      showToast("Error de conexión", true);
    } finally {
      setSavingGrupo(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h2 className="text-xl font-bold text-slate-800">{isEditing ? "Editar Grupo de Naves" : "Nuevo Grupo de Naves"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 bg-white rounded-md shadow-sm border border-slate-200"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label htmlFor="saas-grupo-nombre" className="block text-sm font-bold text-slate-700 mb-1.5">Nombre del Grupo</label>
            <input
              id="saas-grupo-nombre"
              name="grupo_nombre"
              type="text"
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-violet-500 transition-all font-medium uppercase"
              placeholder="EJ. GRUPO NORTE, GRUPO CENTRO..."
              value={grupoNombre}
              onChange={(e) => setGrupoNombre(e.target.value.toUpperCase())}
            />
          </div>
          <div>
            <label htmlFor="saas-grupo-whatsapp" className="block text-sm font-bold text-slate-700 mb-1.5">WhatsApp de este grupo (Opcional)</label>
            <input
              id="saas-grupo-whatsapp"
              name="grupo_whatsapp"
              type="text"
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-violet-500 transition-all font-medium"
              placeholder="EJ. 5213322114455"
              value={grupoTelefono}
              onChange={(e) => setGrupoTelefono(e.target.value.replace(/[^\d]/g, ""))}
            />
            <p className="text-xs text-slate-400 mt-1">Cada grupo tiene su propia línea de WhatsApp para recibir mensajes.</p>
          </div>
          {empresa.naves && empresa.naves.length > 0 && (
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Naves que pertenecen a este grupo</label>
              <div className="flex flex-col gap-2 max-h-52 overflow-y-auto border border-slate-200 rounded-xl p-3 bg-slate-50">
                {empresa.naves.map((n: any) => (
                  <label key={n.id} className="flex items-center gap-2.5 cursor-pointer p-1.5 hover:bg-white rounded-lg transition-colors">
                    <input
                      id={`saas-grupo-nave-${n.id}`}
                      name="grupo_naves"
                      type="checkbox"
                      className="w-4 h-4 accent-violet-600 rounded cursor-pointer"
                      checked={grupoNaves.includes(n.id)}
                      onChange={(e) => {
                        if (e.target.checked) setGrupoNaves(prev => [...prev, n.id]);
                        else setGrupoNaves(prev => prev.filter(id => id !== n.id));
                      }}
                    />
                    <span className="text-sm font-medium text-slate-700">{n.nombre}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 font-bold text-slate-600 hover:bg-slate-200 bg-slate-100 rounded-xl transition-colors">Cancelar</button>
          <button onClick={handleSaveGrupo} disabled={savingGrupo} className="px-5 py-2.5 font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-xl shadow-md transition-all disabled:opacity-60">
            {savingGrupo ? "Guardando..." : (isEditing ? "Actualizar Grupo" : "Crear Grupo")}
          </button>
        </div>
      </div>
    </div>
  );
}
