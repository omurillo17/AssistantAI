"use client";

import { COUNTRY_CODES } from "@/types";

type Props = {
  isEditing: boolean;
  isAdmin: boolean;
  rNombre: string;
  setRNombre: (v: string) => void;
  rCodigoPais: string;
  setRCodigoPais: (v: string) => void;
  rTelefonoNum: string;
  setRTelefonoNum: (v: string) => void;
  rCalendar: string;
  setRCalendar: (v: string) => void;
  rColor: string;
  setRColor: (v: string) => void;
  rUsuario: string;
  setRUsuario: (v: string) => void;
  rPassword: string;
  setRPassword: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
};

export default function RecruiterModal({
  isEditing,
  isAdmin,
  rNombre,
  setRNombre,
  rCodigoPais,
  setRCodigoPais,
  rTelefonoNum,
  setRTelefonoNum,
  rCalendar,
  setRCalendar,
  rColor,
  setRColor,
  rUsuario,
  setRUsuario,
  rPassword,
  setRPassword,
  onSave,
  onCancel,
}: Props) {
  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1000] p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl p-6 md:p-8 shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-xl font-bold text-slate-800 mb-6 pb-4 border-b border-black/10">
          {isEditing ? "Editar Reclutador" : "Agregar Reclutador"}
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-500 font-medium mb-1">
              Nombre
            </label>
            <input
              type="text"
              className="w-full p-3 rounded-lg border border-black/10 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none uppercase transition-all shadow-sm"
              placeholder="EJ: Geronimo Murillo"
              value={rNombre}
              onChange={(e) => setRNombre(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm text-slate-500 font-medium mb-1">
              Teléfono Whatsapp
            </label>
            <div className="flex gap-2">
              <select
                className="w-[120px] sm:w-[140px] p-3 rounded-lg border border-black/10 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none transition-all shadow-sm cursor-pointer"
                value={rCodigoPais}
                onChange={(e) => setRCodigoPais(e.target.value)}
              >
                {COUNTRY_CODES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                className="flex-1 p-3 rounded-lg border border-black/10 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none transition-all shadow-sm"
                placeholder="3300000000"
                value={rTelefonoNum}
                onChange={(e) => setRTelefonoNum(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-500 font-medium mb-1">
              Correo Electrónico (Google Calendar ID)
            </label>
            <input
              type="email"
              className="w-full p-3 rounded-lg border border-black/10 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none transition-all shadow-sm"
              placeholder="ejemplo@gmail.com"
              value={rCalendar}
              onChange={(e) => setRCalendar(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm text-slate-500 font-medium mb-1">
              Color Identificador
            </label>
            <div className="flex items-center gap-4">
              <input
                type="color"
                className="h-10 w-14 rounded cursor-pointer border-0 bg-transparent"
                value={rColor}
                onChange={(e) => setRColor(e.target.value)}
              />
              <span className="text-sm font-mono text-slate-500">{rColor}</span>
            </div>
          </div>

          {isAdmin && (
            <div className="pt-4 border-t border-black/10 space-y-4">
              <h4 className="text-sm font-bold text-slate-800">
                Acceso al Sistema
              </h4>
              <div>
                <label className="block text-sm text-slate-500 font-medium mb-1">
                  Usuario (Login)
                </label>
                <input
                  type="text"
                  className="w-full p-3 rounded-lg border border-black/10 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none transition-all shadow-sm"
                  placeholder="usuario"
                  value={rUsuario}
                  onChange={(e) => setRUsuario(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm text-slate-500 font-medium mb-1">
                  {isEditing
                    ? "Nueva Contraseña (deja en blanco para no cambiar)"
                    : "Contraseña"}
                </label>
                <input
                  type="password"
                  className="w-full p-3 rounded-lg border border-black/10 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none transition-all shadow-sm"
                  placeholder="••••••••"
                  value={rPassword}
                  onChange={(e) => setRPassword(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-8">
          <button
            onClick={onCancel}
            className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onSave}
            className="flex-1 py-3 bg-primary hover:bg-primary/90 text-white font-semibold rounded shadow-sm transition-all"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
