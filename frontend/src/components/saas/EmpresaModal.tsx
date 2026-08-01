import React, { useState, useEffect } from "react";
import { Building2, X, Save } from "lucide-react";

interface EmpresaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  empresa: any;
  showToast: (msg: string, isError?: boolean) => void;
}

export default function EmpresaModal({
  isOpen,
  onClose,
  onSuccess,
  empresa,
  showToast,
}: EmpresaModalProps) {
  const [nombre, setNombre] = useState("");
  const [telefonoWhatsapp, setTelefonoWhatsapp] = useState("");
  const [promptIa, setPromptIa] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (empresa && isOpen) {
      setNombre(empresa.nombre || "");
      setTelefonoWhatsapp(empresa.telefono_whatsapp || "");
      setPromptIa(empresa.prompt_ia || "");
    } else if (!isOpen) {
      setNombre("");
      setTelefonoWhatsapp("");
      setPromptIa("");
    }
  }, [empresa, isOpen]);

  if (!isOpen) return null;

  const handleSaveEmpresa = async () => {
    if (!nombre) return showToast("El nombre de la empresa es obligatorio", true);
    setSaving(true);

    try {
      const isEditing = !!empresa?.id;
      const url = "/api/db/empresas";
      const method = isEditing ? "PATCH" : "POST";

      const payload = {
        id: empresa?.id,
        nombre: nombre.toUpperCase(),
        telefono_whatsapp: telefonoWhatsapp.toUpperCase(),
        prompt_ia: promptIa,
      };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (data.success) {
        showToast(isEditing ? "Empresa actualizada" : "Empresa creada");
        onSuccess();
        onClose();
      } else {
        showToast(data.error || "Error al guardar", true);
      }
    } catch (e) {
      showToast("Error de conexión", true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 opacity-100 animate-in fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Building2 size={20} className="text-indigo-600" />
            {empresa?.id ? "Editar Empresa" : "Nueva Empresa"}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 bg-white rounded-md shadow-sm border border-slate-200">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label htmlFor="empresa-nombre" className="block text-sm font-bold text-slate-700 mb-1.5">Nombre de la Empresa</label>
            <input
              id="empresa-nombre"
              name="nombre"
              type="text"
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all font-medium uppercase"
              placeholder="EJ. GRUPO INDUSTRIAL M"
              value={nombre}
              onChange={(e) => setNombre(e.target.value.toUpperCase())}
            />
          </div>
          <div>
            <label htmlFor="empresa-whatsapp" className="block text-sm font-bold text-slate-700 mb-1.5">WhatsApp Principal (Opcional)</label>
            <input
              id="empresa-whatsapp"
              name="telefono_whatsapp"
              type="text"
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all font-medium uppercase"
              placeholder="EJ. 5213322114455"
              value={telefonoWhatsapp}
              onChange={(e) => setTelefonoWhatsapp(e.target.value.toUpperCase())}
            />
          </div>
          <div>
            <label htmlFor="empresa-prompt" className="block text-sm font-bold text-slate-700 mb-1.5">System Prompt de la Empresa (Opcional)</label>
            <textarea
              id="empresa-prompt"
              name="prompt_ia"
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all font-mono text-sm resize-none h-32"
              placeholder="Sobreescribe el prompt global de Virgo para esta empresa en específico..."
              value={promptIa}
              onChange={(e) => setPromptIa(e.target.value)}
            />
          </div>
        </div>
        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 font-bold text-slate-600 hover:bg-slate-200 bg-slate-100 rounded-xl transition-colors">
            Cancelar
          </button>
          <button onClick={handleSaveEmpresa} disabled={saving} className="px-5 py-2.5 font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md shadow-indigo-600/20 flex items-center gap-2 transition-all disabled:opacity-65">
            <Save size={18} /> {saving ? "Guardando..." : (empresa?.id ? "Actualizar" : "Crear Empresa")}
          </button>
        </div>
      </div>
    </div>
  );
}
