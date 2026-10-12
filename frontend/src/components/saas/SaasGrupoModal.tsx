import React, { useState } from "react";
import { X } from "lucide-react";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import type { Empresa, Grupo, Nave } from "@/types";

interface SaasGrupoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  // El wrapper de abajo ya se cierra con `!props.empresa`, así que el null
  // forma parte del contrato.
  empresa: Empresa | null;
  grupo?: Grupo | null;
  showToast: (msg: string, isError?: boolean) => void;
}

// Wrapper: monta el contenido solo mientras el modal está abierto y lo remonta
// (key) al cambiar de registro, así el formulario arranca con los valores del
// prop y se limpia al cerrar. Antes eso se hacía copiando el prop al estado
// desde un useEffect, lo que provoca un render en cascada
// (react-hooks/set-state-in-effect).
export default function SaasGrupoModal(props: Readonly<SaasGrupoModalProps>) {
  const { empresa } = props;
  if (!props.isOpen || !empresa) return null;
  // `empresa` va aparte para conservar el estrechamiento que el spread perdería.
  return <SaasGrupoModalContent key={props.grupo?.id ?? "nuevo"} {...props} empresa={empresa} />;
}

type SaasGrupoModalContentProps = Omit<SaasGrupoModalProps, "empresa"> & { empresa: Empresa };

function SaasGrupoModalContent({
  onClose,
  onSuccess,
  empresa,
  grupo,
  showToast,
}: Readonly<SaasGrupoModalContentProps>) {
  const backdropHandlers = useBackdropClose(onClose);
  const [grupoNombre, setGrupoNombre] = useState(grupo?.nombre || "");
  const [grupoNaves, setGrupoNaves] = useState<string[]>(grupo?.naves_asignadas || []);
  const [grupoTelefono, setGrupoTelefono] = useState(grupo?.telefono_whatsapp || "");
  const [savingGrupo, setSavingGrupo] = useState(false);

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
    } catch {
      showToast("Error de conexión", true);
    } finally {
      setSavingGrupo(false);
    }
  };

  let submitLabel = "Crear Grupo";
  if (savingGrupo) {
    submitLabel = "Guardando...";
  } else if (isEditing) {
    submitLabel = "Actualizar Grupo";
  }

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
      {...backdropHandlers}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95"
      >
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
              <span className="block text-sm font-bold text-slate-700 mb-2">Naves que pertenecen a este grupo</span>
              <div className="flex flex-col gap-2 max-h-52 overflow-y-auto border border-slate-200 rounded-xl p-3 bg-slate-50">
                {(empresa.naves || []).map((n: Nave) => (
                  <label key={n.id} htmlFor={`saas-grupo-nave-${n.id}`} className="flex items-center gap-2.5 cursor-pointer p-1.5 hover:bg-white rounded-lg transition-colors">
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
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
