"use client";

import { useRef } from "react";
import { COUNTRY_CODES } from "@/types";

type Props = {
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
  onSave: () => void;
  onCancel: () => void;
};

export default function RecruiterModal({
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
  onSave,
  onCancel,
}: Props) {
  const isBackdropMouseDown = useRef(false);

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1000] p-4"
      onMouseDown={(e) => { isBackdropMouseDown.current = (e.target === e.currentTarget); }}
      onMouseUp={(e) => {
        if (isBackdropMouseDown.current && e.target === e.currentTarget) {
          onCancel();
        }
        isBackdropMouseDown.current = false;
      }}
    >
      <div
        className="bg-white w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl p-6 md:p-8 shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-xl font-bold text-slate-800 mb-6 pb-4 border-b border-black/10">
          Editar Reclutador
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-500 font-medium mb-1">
              Nombre
            </label>
            <input
              id="recruiter-nombre"
              name="nombre"
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
                id="recruiter-country-code"
                name="country_code"
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
                id="recruiter-phone"
                name="phone"
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
              id="recruiter-calendar"
              name="calendar_email"
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
                id="recruiter-color"
                name="color"
                type="color"
                className="h-10 w-14 rounded cursor-pointer border-0 bg-transparent"
                value={rColor}
                onChange={(e) => setRColor(e.target.value)}
              />
              <span className="text-sm font-mono text-slate-500">{rColor}</span>
            </div>
          </div>

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
