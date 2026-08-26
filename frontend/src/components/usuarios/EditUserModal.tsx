import React, { useState } from "react";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import type { Empresa, Grupo, Nave, Usuario } from "@/types";

interface EditUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  // El componente ya se cierra solo con `!props.user` (línea de abajo), así
  // que el null es parte del contrato, no un descuido.
  user: Usuario | null;
  usuarios: Usuario[];
  empresas: Empresa[];
  grupos: Grupo[];
  naves: Nave[];
  showToast: (msg: string, isError?: boolean) => void;
}

/**
 * Separa un telefono guardado (lada + numero) en sus dos partes, replicando las
 * ladas que maneja el formulario. Es puro: se llama al inicializar el estado,
 * no hace falta un efecto que copie el prop al estado.
 */
function separarTelefono(fullPhone: string): { prefix: string; num: string } {
  if (fullPhone.startsWith("521")) return { prefix: "521", num: fullPhone.substring(3) };
  if (fullPhone.startsWith("502")) return { prefix: "502", num: fullPhone.substring(3) };
  if (fullPhone.startsWith("52")) return { prefix: "52", num: fullPhone.substring(2) };
  if (["57", "54", "56", "58", "51"].some(l => fullPhone.startsWith(l))) {
    return { prefix: fullPhone.substring(0, 2), num: fullPhone.substring(2) };
  }
  if (fullPhone.startsWith("1")) return { prefix: "1", num: fullPhone.substring(1) };
  return { prefix: "521", num: fullPhone };
}

// Wrapper: monta el contenido solo mientras el modal está abierto y lo remonta
// (key) al cambiar de usuario, así el formulario arranca con los datos del prop
// y se limpia al cerrar. Antes eso se hacía copiando el prop al estado desde un
// useEffect, lo que provoca un render en cascada
// (react-hooks/set-state-in-effect).
export default function EditUserModal(props: EditUserModalProps) {
  const { user } = props;
  if (!props.isOpen || !user) return null;
  // Se pasa `user` aparte para que TypeScript conserve el estrechamiento que
  // acaba de hacer la guarda de arriba (el spread lo perdería).
  return <EditUserModalContent key={user.id} {...props} user={user} />;
}

// El wrapper de arriba ya descartó el caso `user === null`, así que el
// contenido lo exige de verdad en lugar de comprobarlo otra vez en cada uso.
type EditUserModalContentProps = Omit<EditUserModalProps, "user"> & { user: Usuario };

function EditUserModalContent({
  onClose,
  onSuccess,
  user,
  usuarios,
  empresas,
  grupos,
  naves,
  showToast,
}: EditUserModalContentProps) {
  const creatorRole = typeof window !== 'undefined' ? localStorage.getItem("tci_role") : "USER";
  const creatorEmpresaId = typeof window !== 'undefined' ? localStorage.getItem("tci_empresa_id") : null;

  const telefonoInicial = separarTelefono(user.telefono || "");

  const [newRol, setNewRol] = useState(user.rol || "");
  const [nombreInput, setNombreInput] = useState(user.nombre || "");
  const [newPassword, setNewPassword] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [editingCorreo, setEditingCorreo] = useState(user.correo || "");
  const [editingTelefono, setEditingTelefono] = useState(telefonoInicial.num);
  const [editingTelPrefix, setEditingTelPrefix] = useState(telefonoInicial.prefix);
  const [editingTransferTo, setEditingTransferTo] = useState("");
  const [editingSelectedGrupo, setEditingSelectedGrupo] = useState(user.grupo_id || "");
  const [updating, setUpdating] = useState(false);

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
          nombre: nombreInput.trim(),
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
    } catch {
      showToast("Error de red al actualizar usuario", true);
    } finally {
      setUpdating(false);
    }
  };

  const backdropHandlers = useBackdropClose(onClose);

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1000] p-4"
      {...backdropHandlers}
    >
      {/* Formato apaisado, igual que el alta: rejilla de 2 columnas desde
          pantallas medianas, una sola columna en móvil. */}
      <div className="bg-white w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl p-6 md:p-8 shadow-2xl relative" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-6 pb-4 border-b border-black/10">
          <div>
            <h3 className="text-xl font-bold text-slate-800">Editar Usuario</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Inicia sesión como <span className="font-mono font-semibold">{user.usuario}</span> (no se puede cambiar)
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={guardarEdicion}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <label htmlFor="edit-user-nombre" className="block text-sm font-semibold mb-1 text-slate-600">Nombre completo</label>
            <input
              id="edit-user-nombre"
              name="nombre"
              type="text"
              required
              minLength={3}
              className="w-full p-2 border rounded focus:outline-none focus:border-indigo-500 bg-slate-50 focus:bg-white transition-colors"
              value={nombreInput}
              onChange={(e) => setNombreInput(e.target.value)}
            />
            <p className="text-xs text-slate-400 mt-1">Cambiarlo no afecta cómo inicia sesión.</p>
          </div>

          <div>
            <label htmlFor="edit-user-rol" className="block text-sm font-semibold mb-1 text-slate-600">Rol del Sistema</label>
            <select
              id="edit-user-rol"
              name="rol"
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
            <div className="md:col-span-2 p-4 bg-indigo-50 border border-indigo-100 rounded-lg grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
              <p className="md:col-span-2 text-xs text-indigo-800 font-medium">Datos del perfil CRM para este usuario:</p>
              <div>
                <label htmlFor="edit-user-email" className="block text-xs font-semibold mb-1 text-indigo-700">Correo (Google Calendar)</label>
                <input
                  id="edit-user-email"
                  name="email"
                  type="email"
                  required
                  className="w-full p-2 border rounded focus:outline-none focus:border-indigo-500 bg-white"
                  value={editingCorreo}
                  onChange={(e) => setEditingCorreo(e.target.value.toLowerCase())}
                />
              </div>
              <div>
                <label htmlFor="edit-user-phone" className="block text-xs font-semibold mb-1 text-indigo-700">Teléfono (WhatsApp)</label>
                <div className="flex gap-2">
                  <select
                    id="edit-user-phone-prefix"
                    name="phone_prefix"
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
                    id="edit-user-phone"
                    name="phone"
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
            <div className="md:col-span-2 p-4 bg-red-50 border border-red-100 rounded-lg space-y-3">
              <p className="text-xs text-red-800 font-medium">Este usuario dejará de recibir chats. Si tiene candidatos activos, transfiérelos a:</p>
              <select
                id="edit-user-transfer"
                name="transfer_to"
                className="w-full p-2 border border-red-200 rounded focus:outline-none focus:border-red-500 bg-white"
                value={editingTransferTo}
                onChange={e => setEditingTransferTo(e.target.value)}
              >
                <option value="">No transferir (Perder chats)</option>
                {usuarios.filter(u => u.id !== user.id && u.reclutador_id && (u.rol === 'RECLUTADOR' || u.rol === 'ENCARGADO')).map(u => (
                  <option key={u.id} value={u.reclutador_id ?? ""}>{u.usuario}</option>
                ))}
              </select>
            </div>
          )}

          {/* Grupo Asignado (Editar Usuario) */}
          {(newRol === "RECLUTADOR" || newRol === "ENCARGADO") && (
            <div className="md:col-span-2">
              <label htmlFor="edit-user-grupo" className="block text-sm font-semibold mb-2 text-slate-600">Grupo de Reclutamiento</label>
              <select
                id="edit-user-grupo"
                name="grupo"
                className="w-full p-2 border rounded focus:outline-none focus:border-indigo-500 bg-slate-50 focus:bg-white transition-colors"
                value={editingSelectedGrupo}
                onChange={(e) => setEditingSelectedGrupo(e.target.value)}
              >
                <option value="">(Ninguno - Sin Acceso)</option>
                {empresas
                  .filter((emp: Empresa) => creatorRole !== "ENCARGADO" || emp.id === creatorEmpresaId)
                  .map((empresa: Empresa) => (
                    <optgroup key={empresa.id} label={empresa.nombre}>
                      {grupos.filter(g => g.empresa_id === empresa.id).map(g => (
                        <option key={g.id} value={g.id}>
                          {g.nombre} ({naves.filter((n: Nave) => g.naves_asignadas?.includes(n.id)).map((n: Nave) => n.nombre).join(", ")})
                        </option>
                      ))}
                    </optgroup>
                  ))}
                {creatorRole !== "ENCARGADO" && grupos.filter(g => !g.empresa_id).length > 0 && (
                  <optgroup label="Sin Empresa Asignada (Legacy)">
                    {grupos.filter(g => !g.empresa_id).map(g => (
                      <option key={g.id} value={g.id}>
                        {g.nombre} ({naves.filter((n: Nave) => g.naves_asignadas?.includes(n.id)).map((n: Nave) => n.nombre).join(", ")})
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <p className="text-xs text-slate-400 mt-1">El grupo define qué naves podrá ver.</p>
            </div>
          )}

          <div className="md:col-span-2">
            <label htmlFor="edit-user-new-password" className="block text-sm font-semibold mb-1 text-slate-600">Nueva Contraseña (Opcional)</label>
            <input
              id="edit-user-new-password"
              name="new_password"
              type="password"
              minLength={5}
              placeholder="Dejar en blanco para no cambiar"
              className="w-full p-2 border rounded focus:outline-none focus:border-indigo-500 bg-slate-50 focus:bg-white transition-colors"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>

          <div className="md:col-span-2 pt-4 border-t border-slate-100">
            <label htmlFor="edit-user-admin-password" className="block text-sm font-semibold mb-1 text-red-500">Autorización Requerida</label>
            <p className="text-xs text-slate-500 mb-2">Ingresa tu contraseña de Administrador para confirmar los cambios.</p>
            <input
              id="edit-user-admin-password"
              name="admin_password"
              type="password"
              required
              className="w-full p-2 border border-red-200 rounded focus:outline-none focus:border-red-500 bg-red-50 focus:bg-white transition-colors"
              placeholder="Contraseña de administrador"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
            />
          </div>

          </div>

          <div className="flex gap-3 mt-8 pt-4 border-t border-black/10">
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
