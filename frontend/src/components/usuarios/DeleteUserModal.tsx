import React, { useState } from "react";
import type { Usuario } from "@/types";

interface DeleteUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  userId: number | null;
  username: string;
  usuarios: Usuario[];
  showToast: (msg: string, isError?: boolean) => void;
}

// Wrapper: al cerrarse desmonta el contenido, y con el desmontaje se reinicia
// el formulario. Reiniciarlo desde un useEffect provocaba un render en cascada
// (react-hooks/set-state-in-effect).
export default function DeleteUserModal(props: DeleteUserModalProps) {
  if (!props.isOpen || props.userId === null) return null;
  return <DeleteUserModalContent {...props} />;
}

function DeleteUserModalContent({
  onClose,
  onSuccess,
  userId,
  username,
  usuarios,
  showToast,
}: DeleteUserModalProps) {
  const [deleteTransferTo, setDeleteTransferTo] = useState("");
  const [deleting, setDeleting] = useState(false);

  const ejecutarEliminar = async () => {
    setDeleting(true);

    try {
      const url = `/api/db/usuarios?id=${userId}` +
                  (deleteTransferTo ? `&transferTo=${deleteTransferTo}` : '');

      const res = await fetch(url, { method: "DELETE" });

      if (res.ok) {
        showToast("Usuario eliminado exitosamente");
        onSuccess();
        onClose();
      } else {
        const data = await res.json();
        showToast(data.error || "Error al eliminar", true);
      }
    } catch {
      showToast("Error de red al eliminar", true);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1500]" onClick={onClose}>
      <div className="bg-white w-[90%] max-w-md rounded-2xl p-7 shadow-2xl relative" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-bold text-slate-800 mb-2">Eliminar Usuario</h2>
        <p className="text-slate-600 text-sm mb-5">
          Estás a punto de eliminar el acceso para <strong>{username}</strong>. 
          Si este usuario tiene chats asignados, se perderán a menos que los transfieras.
        </p>

        <div className="mb-6">
          <label htmlFor="delete-user-transfer" className="block text-sm font-semibold mb-2 text-slate-700">Transferir chats activos a:</label>
          <select
            id="delete-user-transfer"
            name="transfer_to"
            className="w-full p-2 border rounded-lg focus:outline-none focus:border-red-500 bg-slate-50 transition-colors"
            value={deleteTransferTo}
            onChange={e => setDeleteTransferTo(e.target.value)}
          >
            <option value="">No transferir (Perder chats)</option>
            {usuarios.filter(u => u.id !== userId && u.reclutador_id).map(u => (
              <option key={u.id} value={u.reclutador_id ?? ""}>{u.usuario} ({u.rol})</option>
            ))}
          </select>
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 font-semibold text-slate-700 transition-colors">Cancelar</button>
          <button onClick={ejecutarEliminar} disabled={deleting} className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-700 font-bold text-white transition-colors">
            {deleting ? "Eliminando..." : "Sí, eliminar"}
          </button>
        </div>
      </div>
    </div>
  );
}
