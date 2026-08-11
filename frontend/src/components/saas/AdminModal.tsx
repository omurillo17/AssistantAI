import React, { useState } from "react";
import { X } from "lucide-react";
import type { Empresa } from "@/types";

interface AdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  empresa: Empresa | null;
  showToast: (msg: string, isError?: boolean) => void;
}

// Wrapper: al cerrarse desmonta el contenido, y con el desmontaje se reinicia
// el formulario. Reiniciarlo desde un useEffect provocaba un render en cascada
// (react-hooks/set-state-in-effect).
export default function AdminModal(props: AdminModalProps) {
  const { empresa } = props;
  if (!props.isOpen || !empresa) return null;
  return <AdminModalContent {...props} empresa={empresa} />;
}

function AdminModalContent({
  onClose,
  onSuccess,
  empresa,
  showToast,
}: AdminModalProps & { empresa: Empresa }) {
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSaveAdmin = async () => {
    if (!usuario || !password) {
      return showToast("El usuario y contraseña son obligatorios", true);
    }
    setSaving(true);

    try {
      const res = await fetch("/api/db/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usuario: usuario.toUpperCase(),
          password,
          rol: "ADMIN",
          empresa_id: empresa.id,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        showToast("Administrador creado exitosamente");
        onSuccess();
        onClose();
        setUsuario("");
        setPassword("");
      } else {
        showToast(data.error || "Error al crear administrador", true);
      }
    } catch {
      showToast("Error de conexión", true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 opacity-100 animate-in fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">Crear Administrador para {empresa.nombre}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 bg-white rounded-md shadow-sm border border-slate-200"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label htmlFor="admin-usuario" className="block text-sm font-bold text-slate-700 mb-1.5">Usuario</label>
            <input
              id="admin-usuario"
              name="username"
              type="text"
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 transition-all font-medium uppercase"
              placeholder="EJ. ADMIN_EMPRESA"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value.toUpperCase())}
            />
          </div>
          <div>
            <label htmlFor="admin-password" className="block text-sm font-bold text-slate-700 mb-1.5">Contraseña</label>
            <input
              id="admin-password"
              name="password"
              type="password"
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 transition-all font-medium"
              placeholder="MÍNIMO 5 CARACTERES"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 font-bold text-slate-600 hover:bg-slate-200 bg-slate-100 rounded-xl transition-colors">Cancelar</button>
          <button onClick={handleSaveAdmin} disabled={saving} className="px-5 py-2.5 font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-md transition-all">Crear Admin</button>
        </div>
      </div>
    </div>
  );
}
