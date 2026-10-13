"use client";

import { useCallback, useEffect, useState } from "react";
import { Edit, Trash2, Eye, EyeOff, Copy, Check } from "lucide-react";
import NewUserModal from "@/components/usuarios/NewUserModal";
import EditUserModal from "@/components/usuarios/EditUserModal";
import GroupsModal from "@/components/usuarios/GroupsModal";
import DeleteUserModal from "@/components/usuarios/DeleteUserModal";
import { useLocalStorageValue } from "@/hooks/useLocalStorageValue";
import type { Usuario, Nave, Grupo, Empresa } from "@/types";

function getRolBadgeClass(rol: string): string {
  switch (rol) {
    case "ADMIN":
      return "bg-indigo-100 text-indigo-700";
    case "ROOT":
      return "bg-amber-100 text-amber-700";
    case "ENCARGADO":
      return "bg-sky-100 text-sky-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

export default function UsuariosPage() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [naves, setNaves] = useState<Nave[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [loading, setLoading] = useState(true);
  const role = useLocalStorageValue("tci_role") || "USER";
  const myGrupoId = useLocalStorageValue("tci_grupo_id");

  const [showPasswords, setShowPasswords] = useState<Record<number, boolean>>({});
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const togglePasswordVisibility = (id: number) => {
    setShowPasswords(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const copyPassword = (id: number, pass?: string | null) => {
    if (!pass) return;
    navigator.clipboard.writeText(pass);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const [showNewUserModal, setShowNewUserModal] = useState(false);
  const [showGruposModal, setShowGruposModal] = useState(false);
  const [editingUser, setEditingUser] = useState<Usuario | null>(null);
  const [deleteTargetUser, setDeleteTargetUser] = useState<Usuario | null>(null);

  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);

  const showToast = (msg: string, isError: boolean = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3000);
  };

  const cargarUsuarios = useCallback(async () => {
    try {
      const res = await fetch("/api/db/usuarios");
      if (res.ok) {
        setUsuarios(await res.json());
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const cargarGrupos = useCallback(async () => {
    try {
      const res = await fetch("/api/db/grupos");
      if (res.ok) setGrupos(await res.json());
    } catch {}
  }, []);

  const cargarNaves = useCallback(async () => {
    try {
      const res = await fetch("/api/db/empresas");
      if (res.ok) {
        const data = await res.json();
        const allNaves = data.empresas?.flatMap((e: Empresa) => (e.naves || []).map((n: Nave) => ({ ...n, empresa_id: e.id }))) || [];
        setNaves(allNaves);
        setEmpresas(data.empresas || []);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    document.title = "Gestión de Usuarios | TCi";
    const cargarTodo = async () => {
      await Promise.all([cargarUsuarios(), cargarNaves(), cargarGrupos()]);
    };
    cargarTodo();
  }, [cargarUsuarios, cargarNaves, cargarGrupos]);

  if (loading) return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500">Cargando...</div>;

  return (
    <div className="p-3 sm:p-6 lg:p-8 max-w-5xl mx-auto animate-fade-in text-slate-800">
      {/* Header Premium */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4 mb-6 sm:mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">Gestión de Usuarios</h1>
          <p className="text-slate-500 text-xs sm:text-sm mt-1">Administra las credenciales, roles y grupos de reclutamiento de la plataforma.</p>
        </div>
        <div className="flex flex-wrap gap-2 sm:gap-3 w-full sm:w-auto">
          {(role === "ADMIN" || role === "ROOT" || role === "ENCARGADO") && (
            <button
              onClick={() => setShowNewUserModal(true)}
              className="flex-1 sm:flex-initial bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl shadow-md transition-all flex items-center justify-center gap-2 text-xs sm:text-sm"
            >
              + Nuevo Usuario
            </button>
          )}
          {(role === "ADMIN" || role === "ROOT" || role === "ENCARGADO") && (
            <button
              onClick={() => setShowGruposModal(true)}
              className="flex-1 sm:flex-initial bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 text-xs sm:text-sm"
            >
              ⚙️ Grupos
            </button>
          )}
        </div>
      </div>

      {/* Tabla de Usuarios */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden mb-6 overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[650px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200/80">
              <th className="px-4 sm:px-6 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider">Nombre</th>
              <th className="px-4 sm:px-6 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider">Usuario</th>
              <th className="px-4 sm:px-6 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider">Contraseña</th>
              <th className="px-4 sm:px-6 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider">Rol</th>
              <th className="px-4 sm:px-6 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider">Grupo Asignado</th>
              <th className="px-4 sm:px-6 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {/* Sin filtro por nombre de usuario: quién puede ver a quién ya lo
                decide la API (el superusuario protegido no se devuelve a nadie
                más). Filtrarlo aquí por un nombre fijo además le impedía verse
                a sí mismo, que es justo lo que sí debe poder hacer. */}
            {usuarios.map(u => (
              <tr key={u.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-4 font-semibold text-slate-900">{u.nombre || u.usuario}</td>
                <td className="px-6 py-4 font-mono text-sm text-slate-500">{u.usuario}</td>
                <td className="px-6 py-4">
                  {(role === "ADMIN" || role === "ROOT") ? (
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm bg-slate-100/80 text-slate-700 px-2.5 py-1 rounded-lg border border-slate-200/50 min-w-[90px] text-center inline-block">
                        {showPasswords[u.id] ? (u.actual_password || "—") : "••••••••"}
                      </span>
                      <button
                        type="button"
                        onClick={() => togglePasswordVisibility(u.id)}
                        className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                        title={showPasswords[u.id] ? "Ocultar contraseña" : "Ver contraseña"}
                      >
                        {showPasswords[u.id] ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                      {u.actual_password && showPasswords[u.id] && (
                        <button
                          type="button"
                          onClick={() => copyPassword(u.id, u.actual_password)}
                          className="p-1 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                          title="Copiar contraseña"
                        >
                          {copiedId === u.id ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}
                        </button>
                      )}
                    </div>
                  ) : (
                    <span className="font-mono text-sm bg-slate-100/80 text-slate-700 px-2.5 py-1 rounded-lg border border-slate-200/50">
                      ••••••••
                    </span>
                  )}
                </td>
                <td className="px-6 py-4">
                  <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${getRolBadgeClass(u.rol)}`}>
                    {u.rol}
                  </span>
                </td>
                <td className="px-6 py-4">
                  {u.grupo_id ? (() => {
                    const g = grupos.find((gr: Grupo) => gr.id === u.grupo_id);
                    return g ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-violet-50 text-violet-700 text-xs font-bold rounded-full">
                        {g.nombre}
                      </span>
                    ) : <span className="text-xs text-slate-400">—</span>;
                  })() : <span className="text-xs text-slate-400">Sin grupo</span>}
                </td>
                <td className="px-6 py-4">
                  <div className="flex gap-2">
                    {((role === "ADMIN" || role === "ROOT") || (role === "ENCARGADO" && u.rol === "RECLUTADOR" && u.grupo_id === myGrupoId)) && (
                      <button 
                        onClick={() => setEditingUser(u)}
                        className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                        title="Editar Usuario"
                      >
                        <Edit size={18} />
                      </button>
                    )}
                    {typeof window !== 'undefined' && (localStorage.getItem('tci_role') === 'ADMIN' || localStorage.getItem('tci_role') === 'ROOT') && (
                      <button 
                        onClick={() => setDeleteTargetUser(u)}
                        disabled={u.usuario === "admin"}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        title={u.usuario === "admin" ? "No se puede borrar al super admin" : "Eliminar Usuario"}
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {usuarios.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                  No hay usuarios registrados
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modales Refactorizados */}
      <NewUserModal 
        isOpen={showNewUserModal} 
        onClose={() => setShowNewUserModal(false)} 
        onSuccess={cargarUsuarios} 
        empresas={empresas} 
        grupos={grupos} 
        naves={naves} 
        showToast={showToast} 
      />

      <EditUserModal 
        isOpen={editingUser !== null} 
        onClose={() => setEditingUser(null)} 
        onSuccess={() => { cargarUsuarios(); cargarGrupos(); }} 
        user={editingUser} 
        usuarios={usuarios} 
        empresas={empresas} 
        grupos={grupos} 
        naves={naves} 
        showToast={showToast} 
      />

      <GroupsModal 
        isOpen={showGruposModal} 
        onClose={() => setShowGruposModal(false)} 
        onSuccess={cargarGrupos} 
        empresas={empresas} 
        grupos={grupos} 
        naves={naves} 
        showToast={showToast} 
      />

      <DeleteUserModal 
        isOpen={deleteTargetUser !== null} 
        onClose={() => setDeleteTargetUser(null)} 
        onSuccess={cargarUsuarios} 
        userId={deleteTargetUser ? deleteTargetUser.id : null} 
        username={deleteTargetUser ? deleteTargetUser.usuario : ""} 
        usuarios={usuarios} 
        showToast={showToast} 
      />

      {/* Toast Notification */}
      <div className={`fixed bottom-6 right-6 px-5 py-3 rounded-xl font-semibold text-white shadow-xl transition-all duration-300 transform z-[2000] ${
        toast ? "translate-y-0 opacity-100" : "translate-y-16 opacity-0"
      } ${toast?.isError ? "bg-red-500" : "bg-slate-800"}`}>
        {toast?.msg}
      </div>
    </div>
  );
}
