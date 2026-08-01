import React, { useState, useEffect } from "react";
import { X } from "lucide-react";

interface LigarModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  empresas: any[];
  showToast: (msg: string, isError?: boolean) => void;
}

export default function LigarModal({
  isOpen,
  onClose,
  onSuccess,
  empresas,
  showToast,
}: LigarModalProps) {
  const [empresaA, setEmpresaA] = useState("");
  const [empresaB, setEmpresaB] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setEmpresaA("");
      setEmpresaB("");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSaveLigar = async () => {
    if (!empresaA || !empresaB) {
      return showToast("Selecciona ambas empresas", true);
    }

    try {
      const res = await fetch("/api/db/empresas-ligadas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa_origen_id: empresaA, empresa_destino_id: empresaB })
      });
      const data = await res.json();
      if (data.success) {
        showToast("Empresas ligadas correctamente");
        onSuccess();
        onClose();
        setEmpresaA("");
        setEmpresaB("");
      } else {
        showToast(data.error || "Error al ligar", true);
      }
    } catch (e) {
      showToast("Error de conexión", true);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 opacity-100 animate-in fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">Ligar Empresas</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 bg-white rounded-md shadow-sm border border-slate-200"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label htmlFor="ligar-empresa-a" className="block text-sm font-bold text-slate-700 mb-1.5">Empresa A</label>
            <select
              id="ligar-empresa-a"
              name="empresa_a"
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 transition-all font-medium text-slate-800"
              value={empresaA}
              onChange={(e) => {
                setEmpresaA(e.target.value);
                if (e.target.value === empresaB) setEmpresaB("");
              }}
            >
              <option value="">Selecciona Empresa A</option>
              {empresas.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          </div>
          <div className="flex justify-center text-slate-400 my-2">↔</div>
          <div>
            <label htmlFor="ligar-empresa-b" className="block text-sm font-bold text-slate-700 mb-1.5">Empresa B</label>
            <select
              id="ligar-empresa-b"
              name="empresa_b"
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 transition-all font-medium text-slate-800"
              value={empresaB}
              onChange={(e) => setEmpresaB(e.target.value)}
              disabled={!empresaA}
            >
              <option value="">Selecciona Empresa B</option>
              {empresas.filter(e => e.id !== empresaA).map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          </div>
        </div>
        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 font-bold text-slate-600 hover:bg-slate-200 bg-slate-100 rounded-xl transition-colors">Cancelar</button>
          <button onClick={handleSaveLigar} className="px-5 py-2.5 font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md transition-all">Ligar Empresas</button>
        </div>
      </div>
    </div>
  );
}
