import React, { useState } from "react";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import type { Empresa, Grupo, Nave } from "@/types";

interface NewUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  empresas: Empresa[];
  grupos: Grupo[];
  naves: Nave[];
  showToast: (msg: string, isError?: boolean) => void;
}

// Credencial de acceso: sin espacios, acentos ni símbolos. El nombre "bonito"
// de la persona va en el campo Nombre completo, que es lo que se pinta en la
// interfaz -- así se puede renombrar a alguien sin tocarle el login.
const USUARIO_REGEX = /^[a-zA-Z0-9._-]+$/;

// Roles operativos: trabajan sobre una nave concreta y reciben avisos de citas
// y alertas por WhatsApp, así que para ellos el grupo y el teléfono son
// obligatorios. ROOT y ADMIN administran y no reciben esos avisos.
const ROLES_OPERATIVOS = ["RECLUTADOR", "ENCARGADO", "USER"];

const ETIQUETA = "block text-sm font-semibold mb-1 text-slate-600";
const CAMPO =
  "w-full p-2 border rounded focus:outline-none focus:border-indigo-500 bg-slate-50 focus:bg-white transition-colors";

// Wrapper: al cerrarse desmonta el contenido, y con el desmontaje se reinicia
// el formulario. Reiniciarlo desde un useEffect provocaba un render en cascada
// (react-hooks/set-state-in-effect).
export default function NewUserModal(props: NewUserModalProps) {
  if (!props.isOpen) return null;
  return <NewUserModalContent {...props} />;
}

function NewUserModalContent({
  onClose,
  onSuccess,
  empresas,
  grupos,
  naves,
  showToast,
}: NewUserModalProps) {
  const [usuarioInput, setUsuarioInput] = useState("");
  const [nombreInput, setNombreInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [rolInput, setRolInput] = useState("RECLUTADOR");
  const [correoInput, setCorreoInput] = useState("");
  const [telefonoInput, setTelefonoInput] = useState("");
  const [telPrefix, setTelPrefix] = useState("521");
  const [selectedGrupo, setSelectedGrupo] = useState("");
  const [creating, setCreating] = useState(false);

  const creatorRole = typeof window !== 'undefined' ? localStorage.getItem("tci_role") : "USER";
  const creatorEmpresaId = typeof window !== 'undefined' ? localStorage.getItem("tci_empresa_id") : null;

  const usuarioInvalido = usuarioInput.length > 0 && !USUARIO_REGEX.test(usuarioInput);
  const esRolOperativo = ROLES_OPERATIVOS.includes(rolInput);
  const grupoRequerido = esRolOperativo;
  const telefonoRequerido = esRolOperativo;

  const crearUsuario = async (e: React.FormEvent) => {
    e.preventDefault();

    // Se valida antes de salir a la red para dar el mensaje exacto de una vez;
    // la API vuelve a validar lo mismo (nunca se confía solo en el navegador).
    if (!USUARIO_REGEX.test(usuarioInput)) {
      showToast("El usuario solo admite letras, números, punto, guion y guion bajo", true);
      return;
    }
    if (grupoRequerido && !selectedGrupo) {
      showToast("Selecciona el grupo de reclutamiento", true);
      return;
    }
    if (telefonoRequerido && telefonoInput.length < 10) {
      showToast("El teléfono es obligatorio para este rol", true);
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/db/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usuario: usuarioInput.toLowerCase(),
          nombre: nombreInput.trim(),
          password: passwordInput,
          rol: rolInput,
          correo: correoInput.toLowerCase(),
          // Sin número no se manda la lada suelta: quedaría un teléfono
          // inservible como "521" guardado en el perfil.
          telefono: telefonoInput ? telPrefix + telefonoInput : "",
          grupo_id: selectedGrupo || undefined,
          empresa_id: creatorRole === "ENCARGADO" ? (creatorEmpresaId || undefined) : undefined,
        })
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Error al crear usuario", true);
      } else {
        showToast("Usuario creado exitosamente");
        onSuccess();
        onClose();
      }
    } catch {
      showToast("Error de red al crear usuario", true);
    } finally {
      setCreating(false);
    }
  };

  const opcionesGrupo = (
    <>
      <option value="">— Selecciona un grupo —</option>
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
    </>
  );

  const backdropHandlers = useBackdropClose(onClose);

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1000] p-4"
      {...backdropHandlers}
    >
      {/* Formato apaisado: max-w-3xl y rejilla de 2 columnas en pantallas
          medianas hacia arriba. Los seis campos caben sin scroll, en vez de
          una tira vertical larga. En móvil colapsa a una sola columna. */}
      <div className="bg-white w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl p-6 md:p-8 shadow-2xl relative" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-6 pb-4 border-b border-black/10">
          <div>
            <h3 className="text-xl font-bold text-slate-800">Nuevo Usuario</h3>
            <p className="text-xs text-slate-400 mt-0.5">Todos los campos son obligatorios</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        </div>

        <form onSubmit={crearUsuario}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <label htmlFor="new-user-nombre" className={ETIQUETA}>Nombre completo</label>
              <input
                id="new-user-nombre"
                name="nombre"
                type="text"
                required
                minLength={3}
                className={CAMPO}
                placeholder="Ej: Michelle Rodríguez"
                value={nombreInput}
                onChange={(e) => setNombreInput(e.target.value)}
              />
              <p className="text-xs text-slate-400 mt-1">Es el nombre que se muestra en la plataforma y que el candidato escucha.</p>
            </div>

            <div>
              <label htmlFor="new-user-username" className={ETIQUETA}>Usuario (para iniciar sesión)</label>
              <input
                id="new-user-username"
                name="username"
                type="text"
                required
                minLength={3}
                className={`${CAMPO} lowercase ${usuarioInvalido ? "border-red-400 bg-red-50" : ""}`}
                placeholder="Ej: michelle.rodriguez"
                value={usuarioInput}
                onChange={(e) => setUsuarioInput(e.target.value.toLowerCase().trim())}
              />
              <p className={`text-xs mt-1 ${usuarioInvalido ? "text-red-500 font-medium" : "text-slate-400"}`}>
                {usuarioInvalido
                  ? "Sin espacios, acentos ni símbolos: solo letras, números, . _ -"
                  : "Solo letras, números, punto, guion y guion bajo."}
              </p>
            </div>

            <div>
              <label htmlFor="new-user-password" className={ETIQUETA}>Contraseña</label>
              <input
                id="new-user-password"
                name="password"
                type="password"
                required
                minLength={5}
                className={CAMPO}
                placeholder="Mínimo 5 caracteres"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="new-user-rol" className={ETIQUETA}>Rol del sistema</label>
              <select
                id="new-user-rol"
                name="rol"
                className={CAMPO}
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

            <div>
              <label htmlFor="new-user-email" className={ETIQUETA}>
                Correo (Google Calendar)
                {!esRolOperativo && <span className="text-slate-400 font-normal"> (opcional para este rol)</span>}
              </label>
              <input
                id="new-user-email"
                name="email"
                type="email"
                required={esRolOperativo}
                className={CAMPO}
                placeholder="ejemplo@gmail.com"
                value={correoInput}
                onChange={(e) => setCorreoInput(e.target.value.toLowerCase())}
              />
              <p className="text-xs text-slate-400 mt-1">
                {esRolOperativo
                  ? "Con esta cuenta se agendan sus entrevistas."
                  : "Este rol no agenda entrevistas, puedes dejarlo vacío."}
              </p>
            </div>

            <div>
              <label htmlFor="new-user-phone" className={ETIQUETA}>
                Teléfono (WhatsApp)
                {!telefonoRequerido && <span className="text-slate-400 font-normal"> (opcional para este rol)</span>}
              </label>
              <div className="flex gap-2">
                <select
                  id="new-user-phone-prefix"
                  name="phone_prefix"
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
                  id="new-user-phone"
                  name="phone"
                  type="tel"
                  required={telefonoRequerido}
                  minLength={telefonoRequerido ? 10 : undefined}
                  className={`${CAMPO} flex-1`}
                  placeholder="3320707333"
                  value={telefonoInput}
                  onChange={(e) => setTelefonoInput(e.target.value.replace(/\D/g, ""))}
                />
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {telefonoRequerido
                  ? "Recibe las alertas y avisos de citas."
                  : "Este rol no recibe avisos de citas, puedes dejarlo vacío."}
              </p>
            </div>

            <div className="md:col-span-2">
              <label htmlFor="new-user-grupo" className={ETIQUETA}>
                Grupo de reclutamiento{!grupoRequerido && <span className="text-slate-400 font-normal"> (opcional para este rol)</span>}
              </label>
              <select
                id="new-user-grupo"
                name="grupo"
                required={grupoRequerido}
                className={CAMPO}
                value={selectedGrupo}
                onChange={(e) => setSelectedGrupo(e.target.value)}
              >
                {opcionesGrupo}
              </select>
              <p className="text-xs text-slate-400 mt-1">
                {grupoRequerido
                  ? "Define qué naves podrá ver esta persona."
                  : "Un ADMIN ve toda la empresa, no hace falta atarlo a un grupo."}
              </p>
            </div>
          </div>

          <div className="flex gap-3 mt-8 pt-4 border-t border-black/10">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={creating || usuarioInvalido}
              className="flex-1 bg-indigo-600 text-white font-bold py-2.5 rounded hover:bg-indigo-700 disabled:bg-slate-400 transition-colors"
            >
              {creating ? "Creando..." : "Crear Usuario"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
