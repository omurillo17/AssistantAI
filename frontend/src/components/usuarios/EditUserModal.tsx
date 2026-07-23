import React, { useState, useEffect } from "react";

interface EditUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  user: any;
  usuarios: any[];
  empresas: any[];
  grupos: any[];
  naves: any[];
  showToast: (msg: string, isError?: boolean) => void;
}

export default function EditUserModal({
  isOpen,
  onClose,
  onSuccess,
  user,
  usuarios,
  empresas,
  grupos,
  naves,
  showToast,
}: EditUserModalProps) {
  const creatorRole = typeof window !== 'undefined' ? localStorage.getItem("tci_role") : "USER";
  const creatorEmpresaId = typeof window !== 'undefined' ? localStorage.getItem("tci_empresa_id") : null;

  const [newRol, setNewRol] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [editingCorreo, setEditingCorreo] = useState("");
  const [editingTelefono, setEditingTelefono] = useState("");
  const [editingTelPrefix, setEditingTelPrefix] = useState("521");
  const [editingTransferTo, setEditingTransferTo] = useState("");
  const [editingSelectedGrupo, setEditingSelectedGrupo] = useState("");
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (user && isOpen) {
      setNewRol(user.rol || "");
      setNewPassword("");
      setAdminPassword("");
      setEditingCorreo(user.correo || "");

      const fullPhone = user.telefono || "";
      let prefix = "521";
      let num = fullPhone;

      if (fullPhone.startsWith("521")) {
        prefix = "521";
        num = fullPhone.substring(3);
      } else if (fullPhone.startsWith("52")) {
        prefix = "52";
        num = fullPhone.substring(2);
      } else if (fullPhone.startsWith("502")) {
        prefix = "502";
        num = fullPhone.substring(3);
      } else if (
        fullPhone.startsWith("57") ||
        fullPhone.startsWith("54") ||
        fullPhone.startsWith("56") ||
        fullPhone.startsWith("58") ||
        fullPhone.startsWith("51")
      ) {
        prefix = fullPhone.substring(0, 2);
        num = fullPhone.substring(2);
      } else if (fullPhone.startsWith("1")) {
        prefix = "1";
        num = fullPhone.substring(1);
      }

      setEditingTelPrefix(prefix);
      setEditingTelefono(num);
      setEditingTransferTo("");
      setEditingSelectedGrupo(user.grupo_id || "");
    }
    if (!isOpen) {
      setNewRol("");
      setNewPassword("");
      setAdminPassword("");
      setEditingCorreo("");
      setEditingTelefono("");
      setEditingTelPrefix("521");
      setEditingTransferTo("");
      setEditingSelectedGrupo("");
    }
  }, [user, isOpen]);

  if (!isOpen || !user) return null;

  const guardarEdicion = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdating(true);

    try {
      const res = await fetch("/api/db/usuarios", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId: user.id,
          newPassword,
          adminPassword,
          newRol,
          correo: editingCorreo.toLowerCase(),
          telefono: editingTelefono ? editingTelPrefix + editingTelefono : "",
          transferTo: editingTransferTo,
          grupo_id: editingSelectedGrupo || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Error al actualizar usuario", true);
      } else {
        showToast("Usuario actualizado exitosamente");
        onSuccess();
        onClose();
      }
    } catch (e) {
      showToast("Error de red al actualizar usuario", true);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1000] p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl p-6 md:p-8 shadow-2xl relative" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-slate-800">Editar Usuario: {user.usuario}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl">&times;</button>
        </div>
        <form onSubmit={guardarEdicion} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-1 text-slate-600">Rol del Sistema</label>
            <select 
              className="w-full p-2 border rounded focus:outline-none focus:border-indigo-500 bg-slate-50 focus:bg-white transition-colors"
              value={newRol}
              onChange={(e) => setNewRol(e.target.value)}
              disabled={user.usuario === "admin"}
            >
              <option value="RECLUTADOR">RECLUTADOR (Bandeja filtrada)</option>
              <option value="ENCARGADO">ENCARGADO (Jefe de Reclutadores)</option>
              <option value="ADMIN">ADMIN (Acceso Total)</option>
            </select>
          </div>

          {/* Ascenso / Edición a RECLUTADOR */}
          {(newRol === "RECLUTADOR" || newRol === "ENCARGADO") && (
            <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-lg space-y-3">
              <p className="text-xs text-indigo-800 font-medium">Datos del perfil CRM para este usuario:</p>
              <div>
                <label className="block text-xs font-semibold mb-1 text-indigo-700">Correo (Google Calendar)</label>
                <input 
                  type="email" 
                  required
                  className="w-full p-2 border rounded focus:outline-none focus:border-indigo-500 bg-white"
                  value={editingCorreo}
                  onChange={(e) => setEditingCorreo(e.target.value.toLowerCase())}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-indigo-700">Teléfono (WhatsApp)</label>
                <div className="flex gap-2">
                  <select 
                    className="p-2 border rounded focus:outline-none focus:border-indigo-500 bg-slate-50 focus:bg-white transition-colors text-slate-800 text-sm"
                    value={editingTelPrefix}
                    onChange={(e) => setEditingTelPrefix(e.target.value)}
                  >
                    <option value="521">+52 1 (MX WA)</option>
                    <option value="52">+52 (MX)</option>
                    <option value="1">+1 (US/CA)</option>
                    <option value="57">+57 (CO)</option>
                    <option value="54">+54 (AR)</option>
                    <option value="56">+56 (CL)</option>
                    <option value="58">+58 (VE)</option>
                    <option value="51">+51 (PE)</option>
                    <option value="502">+502 (GT)</option>
                  </select>
                  <input 
                    type="tel" 
                    className="flex-1 p-2 border rounded focus:outline-none focus:border-indigo-500 bg-white"
                    value={editingTelefono}
                    onChange={(e) => setEditingTelefono(e.target.value.replace(/\D/g, ""))}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Descenso de RECLUTADOR */}
          {(user.rol === "RECLUTADOR" || user.rol === "ENCARGADO") && (newRol !== "RECLUTADOR" && newRol !== "ENCARGADO") && (
            <div className="p-4 bg-red-50 border border-red-100 rounded-lg space-y-3">
              <p className="text-xs text-red-800 font-medium">Este usuario dejará de recibir chats. Si tiene candidatos activos, transfiérelos a:</p>
              <select 
                className="w-full p-2 border border-red-200 rounded focus:outline-none focus:border-red-500 bg-white"
                value={editingTransferTo}
                onChange={e => setEditingTransferTo(e.target.value)}
              >
                <option value="">No transferir (Perder chats)</option>
                {usuarios.filter(u => u.id !== user.id && (u.rol === 'RECLUTADOR' || u.rol === 'ENCARGADO')).map(u => (
                  <option key={u.id} value={u.usuario}>{u.usuario}</option>
                ))}
              </select>
            </div>
          )}

          {/* Grupo Asignado (Editar Usuario) */}
          {(newRol === "RECLUTADOR" || newRol === "ENCARGADO") && (
            <div className="pt-2">
              <label className="block text-sm font-semibold mb-2 text-slate-600">Grupo de Reclutamiento</label>
              <select 
                className="w-full p-2 border rounded focus:outline-none focus:border-indigo-500 bg-slate-50 focus:bg-white transition-colors"
                value={editingSelectedGrupo}
                onChange={(e) => setEditingSelectedGrupo(e.target.value)}
              >
                <option value="">(Ninguno - Sin Acceso)</option>
                {empresas
                  .filter((emp: any) => creatorRole !== "ENCARGADO" || emp.id === creatorEmpresaId)
                  .map((empresa: any) => (
                    <optgroup key={empresa.id} label={empresa.nombre}>
                      {grupos.filter(g => g.empresa_id === empresa.id).map(g => (
                        <option key={g.id} value={g.id}>
                          {g.nombre} ({naves.filter((n:any) => g.naves_asignadas?.includes(n.id)).map((n:any)=>n.nombre).join(", ")})
                        </option>
                      ))}
                    </optgroup>
                  ))}
                {creatorRole !== "ENCARGADO" && grupos.filter(g => !g.empresa_id).length > 0 && (
                  <optgroup label="Sin Empresa Asignada (Legacy)">
                    {grupos.filter(g => !g.empresa_id).map(g => (
                      <option key={g.id} value={g.id}>
                        {g.nombre} ({naves.filter((n:any) => g.naves_asignadas?.includes(n.id)).map((n:any)=>n.nombre).join(", ")})
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <p className="text-xs text-slate-400 mt-1">El grupo define qué naves podrá ver.</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold mb-1 text-slate-600">Nueva Contraseña (Opcional)</label>
            <input 
              type="password" 
              minLength={5}
              placeholder="Dejar en blanco para no cambiar"
              className="w-full p-2 border rounded focus:outline-none focus:border-indigo-500 bg-slate-50 focus:bg-white transition-colors"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>

          <div className="pt-4 border-t border-slate-100">
            <label className="block text-sm font-semibold mb-1 text-red-500">Autorización Requerida</label>
            <p className="text-xs text-slate-500 mb-2">Ingresa tu contraseña de Administrador para confirmar los cambios.</p>
            <input 
              type="password" 
              required
              className="w-full p-2 border border-red-200 rounded focus:outline-none focus:border-red-500 bg-red-50 focus:bg-white transition-colors"
              placeholder="Contraseña de administrador"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
            />
          </div>

          <div className="flex gap-3 mt-6">
            <button 
              type="button"
              onClick={onClose}
              className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded transition-colors"
            >
              Cancelar
            </button>
            <button 
              type="submit"
              disabled={updating}
              className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded transition-colors disabled:bg-slate-400"
            >
              {updating ? "Guardando..." : "Guardar Cambios"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
