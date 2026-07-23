"use client";

import type { Vacante } from "@/types";


type Props = {
  isEditing: boolean;
  vNombre: string;
  setVNombre: (v: string) => void;
  vDetalles: string;
  setVDetalles: (v: string) => void;
  vPalabrasClave: string;
  setVPalabrasClave: (v: string) => void;
  vNaves: string[];
  toggleNave: (n: string) => void;
  availableNaves: {id: string, nombre: string}[];
  onSave: () => void;
  onCancel: () => void;
};

export default function VacancyModal({
  isEditing,
  vNombre,
  setVNombre,
  vDetalles,
  setVDetalles,
  vPalabrasClave,
  setVPalabrasClave,
  vNaves,
  toggleNave,
  availableNaves,
  onSave,
  onCancel,
}: Props) {
  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1000] p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl p-6 md:p-8 shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-xl font-bold text-slate-800 mb-6 pb-4 border-b border-black/10">
          {isEditing ? "Editar Vacante" : "Agregar Vacante"}
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-500 font-medium mb-1">
              Nombre de la Vacante
            </label>
            <input
              type="text"
              className={`w-full p-3 rounded-lg border border-black/10 outline-none uppercase transition-all shadow-sm ${
                isEditing 
                  ? "bg-slate-100 text-slate-500 cursor-not-allowed" 
                  : "bg-slate-50 focus:bg-white focus:border-indigo-500"
              }`}
              placeholder="EJ: OPERADOR GENERAL"
              value={vNombre}
              onChange={(e) => setVNombre(e.target.value)}
              disabled={isEditing}
            />
            {isEditing && (
              <p className="text-xs text-amber-600 font-medium mt-1">
                El nombre de la vacante no se puede modificar para mantener la consistencia de los datos.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm text-slate-500 font-medium mb-2">
              Nave / Sucursal (Selecciona una o varias)
            </label>
            <div className="flex flex-col gap-3 p-4 bg-slate-50 border border-black/10 rounded-xl max-h-48 overflow-y-auto">
              {availableNaves.length > 0 ? (
                availableNaves.map((n) => (
                  <label
                    key={n.id}
                    className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700"
                  >
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-indigo-500"
                      checked={vNaves.includes(n.id)}
                      onChange={() => toggleNave(n.id)}
                    />
                    {n.nombre}
                  </label>
                ))
              ) : (
                <span className="text-sm text-slate-400">No hay naves registradas.</span>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-500 font-medium mb-1">
              Palabras Clave (Separadas por comas)
            </label>
            <input
              type="text"
              className="w-full p-3 rounded-lg border border-black/10 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none transition-all shadow-sm"
              placeholder="Ej: Chofer, Repartidor, Moto"
              value={vPalabrasClave}
              onChange={(e) => setVPalabrasClave(e.target.value)}
            />
            <p className="text-xs text-slate-400 mt-1">
              Si la IA lee estos nombres en el flyer, los relacionará con esta
              vacante.
            </p>
          </div>

          <div>
            <label className="block text-sm text-slate-500 font-medium mb-1">
              Detalles (Sueldo, Horario, Requisitos)
            </label>
            <textarea
              className="w-full p-3 rounded-lg border border-black/10 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none font-mono text-sm h-32 resize-y transition-all shadow-sm"
              placeholder={`-[REQUISITO EXCLUSIVO]\n-*Prestaciones de ley*\n-*$2,500 Semanales*...`}
              value={vDetalles}
              onChange={(e) => setVDetalles(e.target.value)}
            ></textarea>
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
            Guardar Vacante
          </button>
        </div>
      </div>
    </div>
  );
}
