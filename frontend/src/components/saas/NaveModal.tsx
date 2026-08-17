import React, { useState, useRef } from "react";
import { MapPin, X, Save } from "lucide-react";
import type { Nave } from "@/types";

interface NaveModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  nave: Nave | null;
  empresaId: string;
  showToast: (msg: string, isError?: boolean) => void;
}

// Wrapper: monta el contenido solo mientras el modal está abierto y lo remonta
// (key) al cambiar de registro, así el formulario arranca con los valores del
// prop y se limpia al cerrar. Antes eso se hacía copiando el prop al estado
// desde un useEffect, lo que provoca un render en cascada
// (react-hooks/set-state-in-effect).
export default function NaveModal(props: NaveModalProps) {
  if (!props.isOpen) return null;
  return <NaveModalContent key={props.nave?.id ?? "nueva"} {...props} />;
}

function NaveModalContent({
  onClose,
  onSuccess,
  nave,
  empresaId,
  showToast,
}: NaveModalProps) {
  const isBackdropMouseDown = useRef(false);
  const [nombre, setNombre] = useState(nave?.nombre || "");
  const [rfc, setRfc] = useState(nave?.rfc || "");
  const [ubicacionMaps, setUbicacionMaps] = useState(nave?.ubicacion_maps || "");
  const [saving, setSaving] = useState(false);

  const handleSaveNave = async () => {
    if (!nombre) return showToast("El nombre de la nave es obligatorio", true);
    setSaving(true);

    try {
      const isEditing = !!nave?.id;
      const url = "/api/db/naves";
      const method = isEditing ? "PATCH" : "POST";
      
      const payload = {
        id: nave?.id,
        empresa_id: empresaId,
        nombre: nombre.toUpperCase(),
        rfc: rfc.toUpperCase(),
        ubicacion_maps: ubicacionMaps.trim(),
      };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      
      if (data.success) {
        showToast(isEditing ? "Nave actualizada" : "Nave creada");
        onSuccess();
        onClose();
      } else {
        showToast(data.error || "Error al guardar", true);
      }
    } catch {
      showToast("Error de conexión", true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 opacity-100 animate-in fade-in"
      onMouseDown={(e) => { isBackdropMouseDown.current = (e.target === e.currentTarget); }}
      onMouseUp={(e) => {
        if (isBackdropMouseDown.current && e.target === e.currentTarget) {
          onClose();
        }
        isBackdropMouseDown.current = false;
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <MapPin size={20} className="text-indigo-600" />
            {nave?.id ? "Editar Nave" : "Nueva Nave"}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 bg-white rounded-md shadow-sm border border-slate-200">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label htmlFor="nave-nombre" className="block text-sm font-bold text-slate-700 mb-1.5">Nombre / Identificador de la Nave</label>
            <input
              id="nave-nombre"
              name="nombre"
              type="text"
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all font-medium uppercase"
              placeholder="EJ. NAVE 1, PLANTA NORTE, CEDIS SUR..."
              value={nombre}
              onChange={(e) => setNombre(e.target.value.toUpperCase())}
            />
          </div>
          <div>
            <label htmlFor="nave-rfc" className="block text-sm font-bold text-slate-700 mb-1.5">RFC de la Nave</label>
            <input
              id="nave-rfc"
              name="rfc"
              type="text"
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all font-medium uppercase"
              placeholder="EJ. XAXX010101000"
              value={rfc}
              onChange={(e) => setRfc(e.target.value.toUpperCase())}
            />
          </div>
          <div>
            <label htmlFor="nave-ubicacion" className="block text-sm font-bold text-slate-700 mb-1.5">Enlace de Google Maps (Ubicación)</label>
            <input
              id="nave-ubicacion"
              name="ubicacion_maps"
              type="text"
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all font-medium"
              placeholder="https://maps.app.goo.gl/..."
              value={ubicacionMaps}
              onChange={(e) => setUbicacionMaps(e.target.value)}
            />
          </div>
        </div>
        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 font-bold text-slate-600 hover:bg-slate-200 bg-slate-100 rounded-xl transition-colors">
            Cancelar
          </button>
          <button onClick={handleSaveNave} disabled={saving} className="px-5 py-2.5 font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md shadow-indigo-600/20 flex items-center gap-2 transition-all disabled:opacity-65">
            <Save size={18} /> {saving ? "Guardando..." : (nave?.id ? "Actualizar" : "Guardar Nave")}
          </button>
        </div>
      </div>
    </div>
  );
}
