"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function UsuariosPage() {
  const router = useRouter();
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Formulario de Alta
  const [usuarioInput, setUsuarioInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [rolInput, setRolInput] = useState("USER");
  const [creating, setCreating] = useState(false);

  // Formulario Cambio Contraseña
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editingUsername, setEditingUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    document.title = "Gestión de Usuarios | TCi";
    // Check if authenticated
    const auth = localStorage.getItem("tci_authenticated");
    const role = localStorage.getItem("tci_role");
    
    if (!auth) {
      router.push("/login");
    } else if (role !== "ADMIN") {
      router.push("/");
    } else {
      cargarUsuarios();
    }
  }, [router]);

  const cargarUsuarios = async () => {
    try {
      const res = await fetch("/api/db/usuarios");
      if (res.ok) {
        const data = await res.json();
        setUsuarios(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const crearUsuario = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);

    try {
      const res = await fetch("/api/db/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usuario: usuarioInput,
          password: passwordInput,
          rol: rolInput
        })
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Error al crear usuario");
      } else {
        alert("Usuario creado exitosamente");
        setUsuarioInput("");
        setPasswordInput("");
        setRolInput("USER");
        cargarUsuarios();
      }
    } catch (err) {
      alert("Error de red");
    } finally {
      setCreating(false);
    }
  };

  const eliminarUsuario = async (id: number, username: string) => {
    if (!confirm(`¿Estás seguro de eliminar el acceso para "${username}"?`)) return;

    try {
      const res = await fetch(`/api/db/usuarios?id=${id}`, {
        method: "DELETE"
      });

      if (res.ok) {
        cargarUsuarios();
      } else {
        const data = await res.json();
        alert(data.error || "Error al eliminar");
      }
    } catch (err) {
      alert("Error de red al eliminar");
    }
  };

  const abrirModalPassword = (id: number, username: string) => {
    setEditingUserId(id);
    setEditingUsername(username);
    setNewPassword("");
    setAdminPassword("");
  };

  const cambiarContraseña = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdating(true);
    
    try {
      const res = await fetch("/api/db/usuarios", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId: editingUserId,
          newPassword,
          adminPassword
        })
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Error al actualizar la contraseña");
      } else {
        alert("Contraseña actualizada exitosamente");
        setEditingUserId(null);
      }
    } catch (err) {
      alert("Error de red al actualizar contraseña");
    } finally {
      setUpdating(false);
    }
  };

  if (loading) return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500">Cargando...</div>;

  return (
    <div className="p-8 max-w-5xl mx-auto animate-fade-in text-slate-800">
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={() => router.push("/")}
          className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 font-semibold rounded shadow-sm transition-colors text-sm border border-slate-200"
        >
          ⬅ Atrás
        </button>
        <h1 className="text-3xl font-bold text-slate-800">Gestión de Usuarios</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Formulario de Alta */}
        <div className="col-span-1 bg-white p-6 rounded-lg shadow-sm border border-slate-100 h-fit">
          <h2 className="text-lg font-bold mb-4 border-b pb-2">Nuevo Usuario</h2>
          <form onSubmit={crearUsuario} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-1 text-slate-600">Nombre de Usuario</label>
              <input 
                type="text" 
                required
                className="w-full p-2 border rounded focus:outline-none focus:border-indigo-500 bg-slate-50 focus:bg-white transition-colors"
                value={usuarioInput}
                onChange={(e) => setUsuarioInput(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1 text-slate-600">Contraseña</label>
              <input 
                type="password" 
                required
                minLength={5}
                className="w-full p-2 border rounded focus:outline-none focus:border-indigo-500 bg-slate-50 focus:bg-white transition-colors"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1 text-slate-600">Rol del Sistema</label>
              <select 
                className="w-full p-2 border rounded focus:outline-none focus:border-indigo-500 bg-slate-50 focus:bg-white transition-colors"
                value={rolInput}
                onChange={(e) => setRolInput(e.target.value)}
              >
                <option value="USER">USER (Solo herramientas)</option>
                <option value="ADMIN">ADMIN (Acceso Total)</option>
              </select>
            </div>
            <button 
              type="submit" 
              disabled={creating}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded shadow-sm disabled:opacity-50 transition-colors"
            >
              {creating ? "Creando..." : "Crear Usuario"}
            </button>
          </form>
        </div>

        {/* Lista de Usuarios */}
        <div className="col-span-2">
          <div className="bg-white rounded-lg shadow-sm border border-slate-100 overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-6 py-3 text-sm font-bold text-slate-600">ID</th>
                  <th className="px-6 py-3 text-sm font-bold text-slate-600">Usuario</th>
                  <th className="px-6 py-3 text-sm font-bold text-slate-600">Rol</th>
                  <th className="px-6 py-3 text-sm font-bold text-slate-600">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {usuarios.map(u => (
                  <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 text-sm text-slate-500">#{u.id}</td>
                    <td className="px-6 py-4 font-semibold">{u.usuario}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 text-xs font-bold rounded-full ${u.rol === 'ADMIN' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-700'}`}>
                        {u.rol}
                      </span>
                    </td>
                    <td className="px-6 py-4 flex gap-3">
                      <button 
                        onClick={() => abrirModalPassword(u.id, u.usuario)}
                        className="text-indigo-500 hover:text-indigo-700 text-sm font-bold"
                        title="Cambiar Contraseña"
                      >
                        Cambiar Contraseña
                      </button>
                      <button 
                        onClick={() => eliminarUsuario(u.id, u.usuario)}
                        disabled={u.usuario === "admin"} // Proteger al admin principal
                        className="text-red-500 hover:text-red-700 text-sm font-bold disabled:opacity-30 disabled:cursor-not-allowed"
                        title={u.usuario === "admin" ? "No se puede borrar al super admin" : "Eliminar"}
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
                {usuarios.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-slate-500">
                      No hay usuarios registrados
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal Cambiar Contraseña */}
      {editingUserId !== null && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1000]" onClick={() => setEditingUserId(null)}>
          <div className="bg-white w-[90%] max-w-sm rounded-2xl p-8 shadow-2xl relative" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-bold text-slate-800 mb-2">Cambiar Contraseña</h3>
            <p className="text-sm text-slate-500 mb-6">Usuario: <strong>{editingUsername}</strong></p>
            
            <form onSubmit={cambiarContraseña} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-1 text-slate-600">Nueva Contraseña</label>
                <input 
                  type="password" 
                  required
                  minLength={5}
                  className="w-full p-2 border rounded focus:outline-none focus:border-indigo-500 bg-slate-50 focus:bg-white transition-colors"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="pt-4 border-t border-slate-100">
                <label className="block text-sm font-semibold mb-1 text-red-500">Autorización Requerida</label>
                <p className="text-xs text-slate-500 mb-2">Para cambiar esta contraseña, ingresa tu propia contraseña de Administrador.</p>
                <input 
                  type="password" 
                  required
                  className="w-full p-2 border border-red-200 rounded focus:outline-none focus:border-red-500 bg-red-50 focus:bg-white transition-colors"
                  placeholder="Tu contraseña de administrador"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                />
              </div>
              <div className="flex gap-3 mt-6">
                <button 
                  type="button"
                  onClick={() => setEditingUserId(null)}
                  className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={updating}
                  className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded shadow-sm disabled:opacity-50 transition-colors"
                >
                  {updating ? "Guardando..." : "Confirmar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

