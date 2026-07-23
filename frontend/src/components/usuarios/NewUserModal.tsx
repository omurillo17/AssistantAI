import React, { useState, useEffect } from "react";

interface NewUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  empresas: any[];
  grupos: any[];
  naves: any[];
  showToast: (msg: string, isError?: boolean) => void;
}

export default function NewUserModal({
  isOpen,
  onClose,
  onSuccess,
  empresas,
  grupos,
  naves,
  showToast,
}: NewUserModalProps) {
  const [usuarioInput, setUsuarioInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [rolInput, setRolInput] = useState("RECLUTADOR");
  const [correoInput, setCorreoInput] = useState("");
  const [telefonoInput, setTelefonoInput] = useState("");
  const [telPrefix, setTelPrefix] = useState("521");
  const [selectedGrupo, setSelectedGrupo] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setUsuarioInput("");
      setPasswordInput("");
      setRolInput("RECLUTADOR");
      setCorreoInput("");
      setTelefonoInput("");
      setTelPrefix("521");
      setSelectedGrupo("");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const creatorRole = typeof window !== 'undefined' ? localStorage.getItem("tci_role") : "USER";
  const creatorEmpresaId = typeof window !== 'undefined' ? localStorage.getItem("tci_empresa_id") : null;

  const crearUsuario = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);

    try {
      const res = await fetch("/api/db/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usuario: usuarioInput.toUpperCase(),
          password: passwordInput,
          rol: rolInput,
          grupo_id: selectedGrupo || undefined,
          empresa_id: creatorRole === "ENCARGADO" ? (creatorEmpresaId || undefined) : undefined,
          ...((rolInput === "RECLUTADOR" || rolInput === "ENCARGADO") && { 
            correo: correoInput.toLowerCase(), 
            telefono: telefonoInput ? (telPrefix + telefonoInput) : "" 
          })
        })
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Error al crear usuario", true);
      } else {
        showToast("Usuario creado exitosamente");
        setUsuarioInput("");
        setPasswordInput("");
        setRolInput("RECLUTADOR");
        setCorreoInput("");
        setTelefonoInput("");
        setTelPrefix("521");
        setSelectedGrupo("");
        onSuccess();
        onClose();
      }
    } catch (e) {
      showToast("Error de red al crear usuario", true);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1000] p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl p-6 md:p-8 shadow-2xl relative" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-slate-800">Nuevo Usuario</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl">&times;</button>
        </div>
        <form onSubmit={crearUsuario} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-1 text-slate-600">Nombre de Usuario</label>
            <input 
              type="text" 
              required
              className="w-full p-2 border rounded focus:outline-none focus:border-indigo-500 bg-slate-50 focus:bg-white transition-colors uppercase"
              value={usuarioInput}
              onChange={(e) => setUsuarioInput(e.target.value.toUpperCase())}
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
              <option value="RECLUTADOR">RECLUTADOR (Bandeja filtrada)</option>
              {creatorRole !== "ENCARGADO" && (
                <>
                  <option value="ENCARGADO">ENCARGADO (Jefe de Reclutadores)</option>
                  <option value="ADMIN">ADMIN (Acceso Total)</option>
                </>
              )}
            </select>
          </div>

          {(rolInput === "RECLUTADOR" || rolInput === "ENCARGADO") && (
            <>
              <div>
                <label className="block text-sm font-semibold mb-1 text-slate-600">Correo (Google Calendar)</label>
                <input 
                  type="email" 
                  required
                  className="w-full p-2 border rounded focus:outline-none focus:border-indigo-500 bg-slate-50 focus:bg-white transition-colors"
                  placeholder="ejemplo@gmail.com"
                  value={correoInput}
                  onChange={(e) => setCorreoInput(e.target.value.toLowerCase())}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-1 text-slate-600">Teléfono (Opcional - WhatsApp)</label>
                <div className="flex gap-2">
                  <select 
                    className="p-2 border rounded focus:outline-none focus:border-indigo-500 bg-slate-50 focus:bg-white transition-colors text-slate-800 text-sm"
                    value={telPrefix}
                    onChange={(e) => setTelPrefix(e.target.value)}
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
                    className="flex-1 p-2 border rounded focus:outline-none focus:border-indigo-500 bg-slate-50 focus:bg-white transition-colors"
                    placeholder="3320707333"
                    value={telefonoInput}
                    onChange={(e) => setTelefonoInput(e.target.value.replace(/\D/g, ""))}
                  />
                </div>
              </div>
            </>
          )}

          {(rolInput === "RECLUTADOR" || rolInput === "ENCARGADO") && (
            <div className="pt-2">
              <label className="block text-sm font-semibold mb-2 text-slate-600">Grupo de Reclutamiento</label>
              <select 
                className="w-full p-2 border rounded focus:outline-none focus:border-indigo-500 bg-slate-50 focus:bg-white transition-colors"
                value={selectedGrupo}
                onChange={(e) => setSelectedGrupo(e.target.value)}
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

          <button 
            type="submit" 
            disabled={creating} 
            className="w-full bg-indigo-600 text-white font-bold py-2 rounded hover:bg-indigo-700 disabled:bg-slate-400"
          >
            {creating ? "Creando..." : "Crear Usuario"}
          </button>
        </form>
      </div>
    </div>
  );
}
