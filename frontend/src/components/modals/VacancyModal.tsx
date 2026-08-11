"use client";

import { useState } from "react";
import { X, Plus } from "lucide-react";

type Props = {
  isEditing: boolean;
  vNombre: string;
  setVNombre: (v: string) => void;
  vDetalles: string;
  setVDetalles: (v: string) => void;
  vFunciones: string;
  setVFunciones: (v: string) => void;
  vPalabrasClave: string;
  setVPalabrasClave: (v: string) => void;
  vNaves: string[];
  toggleNave: (n: string) => void;
  availableNaves: {id: string, nombre: string}[];
  onSave: () => void;
  onCancel: () => void;
};

const ETIQUETA = "block text-sm text-slate-500 font-medium mb-1";
const CAMPO =
  "w-full p-3 rounded-lg border border-black/10 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none transition-all shadow-sm";

/**
 * Las palabras clave se guardan como una cadena separada por comas (así viaja
 * a `vacantes_def.palabras_clave` y de ahí al catálogo de la IA), pero se
 * editan como etiquetas sueltas: escribir comas a mano se prestaba a dejar
 * espacios de más, comas dobles o una entrada vacía al final.
 */
function parseChips(valor: string): string[] {
  return valor
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

export default function VacancyModal({
  isEditing,
  vNombre,
  setVNombre,
  vDetalles,
  setVDetalles,
  vFunciones,
  setVFunciones,
  vPalabrasClave,
  setVPalabrasClave,
  vNaves,
  toggleNave,
  availableNaves,
  onSave,
  onCancel,
}: Props) {
  const [chipBorrador, setChipBorrador] = useState("");
  const chips = parseChips(vPalabrasClave);

  const agregarChip = () => {
    const nuevo = chipBorrador.trim().replace(/,/g, "");
    if (!nuevo) return;
    // Sin duplicados: comparar sin mayúsculas evita "Chofer" y "chofer".
    if (chips.some((c) => c.toLowerCase() === nuevo.toLowerCase())) {
      setChipBorrador("");
      return;
    }
    setVPalabrasClave([...chips, nuevo].join(", "));
    setChipBorrador("");
  };

  const quitarChip = (chip: string) => {
    setVPalabrasClave(chips.filter((c) => c !== chip).join(", "));
  };

  const onChipKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter o coma confirman la etiqueta; Backspace en vacío borra la última.
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      agregarChip();
    } else if (e.key === "Backspace" && !chipBorrador && chips.length > 0) {
      quitarChip(chips[chips.length - 1]);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1000] p-4"
      onClick={onCancel}
    >
      {/* Formato apaisado: dos columnas desde pantallas medianas. Los textos
          largos (detalles y actividades) quedan lado a lado en vez de obligar
          a bajar por toda la ventana. */}
      <div
        className="bg-white w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl p-6 md:p-8 shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-xl font-bold text-slate-800 mb-6 pb-4 border-b border-black/10">
          {isEditing ? "Editar Vacante" : "Agregar Vacante"}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <label className={ETIQUETA}>Nombre de la Vacante</label>
            <input
              id="vacancy-nombre"
              name="nombre"
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
            <label className={ETIQUETA}>Nave / Sucursal (Selecciona una o varias)</label>
            <div className="flex flex-col gap-3 p-4 bg-slate-50 border border-black/10 rounded-xl max-h-[104px] overflow-y-auto">
              {availableNaves.length > 0 ? (
                availableNaves.map((n) => (
                  <label
                    key={n.id}
                    className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700"
                  >
                    <input
                      id={`vacancy-nave-${n.id}`}
                      name="vacancy_naves"
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

          <div className="md:col-span-2">
            <label className={ETIQUETA}>Palabras Clave</label>
            <div className="flex flex-wrap items-center gap-2 p-2 rounded-lg border border-black/10 bg-slate-50 focus-within:bg-white focus-within:border-indigo-500 transition-all shadow-sm">
              {chips.map((chip) => (
                <span
                  key={chip}
                  className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 bg-indigo-100 text-indigo-800 rounded-full text-sm font-medium"
                >
                  {chip}
                  <button
                    type="button"
                    onClick={() => quitarChip(chip)}
                    className="p-0.5 rounded-full hover:bg-indigo-200 text-indigo-500 hover:text-indigo-800 transition-colors"
                    aria-label={`Quitar ${chip}`}
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
              <input
                id="vacancy-palabras-clave"
                name="palabras_clave"
                type="text"
                className="flex-1 min-w-[160px] p-1.5 bg-transparent outline-none text-sm"
                placeholder={chips.length ? "Agregar otra…" : "Ej: Chofer"}
                value={chipBorrador}
                onChange={(e) => setChipBorrador(e.target.value)}
                onKeyDown={onChipKeyDown}
                onBlur={agregarChip}
              />
              <button
                type="button"
                onClick={agregarChip}
                disabled={!chipBorrador.trim()}
                className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                <Plus size={14} /> Agregar
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Sinónimos con los que el candidato puede pedir esta vacante. Si
              escribe &quot;chofer&quot; y aquí lo pusiste, la IA sabrá que se
              refiere a esta vacante aunque se llame distinto. Pulsa Enter o
              &quot;Agregar&quot; para cada palabra.
            </p>
          </div>

          <div>
            <label className={ETIQUETA}>Detalles (Sueldo, Horario, Requisitos)</label>
            <textarea
              id="vacancy-detalles"
              name="detalles"
              className={`${CAMPO} font-mono text-sm h-40 resize-y`}
              placeholder={`-[REQUISITO EXCLUSIVO]\n-*Prestaciones de ley*\n-*$2,500 Semanales*...`}
              value={vDetalles}
              onChange={(e) => setVDetalles(e.target.value)}
            ></textarea>
          </div>

          <div>
            <label className={ETIQUETA}>Actividades a realizar</label>
            <textarea
              id="vacancy-funciones"
              name="funciones"
              className={`${CAMPO} font-mono text-sm h-40 resize-y`}
              placeholder={`- Registrar entrada y salida de mercancía\n- Capturar folios en el sistema\n- Apoyo en inventarios cíclicos`}
              value={vFunciones}
              onChange={(e) => setVFunciones(e.target.value)}
            ></textarea>
            <p className="text-xs text-slate-400 mt-1">
              Se le envían al candidato en un mensaje aparte y se le pregunta en
              cuáles tiene experiencia.
            </p>
          </div>
        </div>

        <div className="flex gap-3 mt-8 pt-4 border-t border-black/10">
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
