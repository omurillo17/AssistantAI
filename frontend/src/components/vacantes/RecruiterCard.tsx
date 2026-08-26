"use client";

import { useRouter } from "next/navigation";
import { Check, Trash2, Filter, Edit } from "lucide-react";
import type { Recruiter, Vacante } from "@/types";

type Props = {
  rec: Recruiter;
  recIndex: number;
  isAdmin: boolean;
  myRecId: string | null;
  onEditRecruiter: (rec: Recruiter) => void;
  onRemoveRecruiter: (recIndex: number) => void;
  onToggleRecruiter: (recIndex: number) => void;
  onEditVacancy: (recId: string, vac: Vacante) => void;
  onAddVacancy: (recId: string) => void;
  onToggleVacancy: (recIndex: number, vacIndex: number) => void;
  onRemoveVacancy: (recIndex: number, vacIndex: number) => void;
  onDragStart: (recIndex: number, vacIndex: number) => void;
  onDrop: (e: React.DragEvent, targetRecIndex: number, targetVacIndex: number) => void;
  availableNaves: {id: string, nombre: string}[];
};

export default function RecruiterCard({
  rec,
  recIndex,
  isAdmin,
  myRecId,
  onEditRecruiter,
  onRemoveRecruiter,
  onToggleRecruiter,
  onEditVacancy,
  onAddVacancy,
  onToggleVacancy,
  onRemoveVacancy,
  onDragStart,
  onDrop,
  availableNaves,
}: Props) {
  const router = useRouter();
  const isEditable = isAdmin || rec.reclutador_id === myRecId;

  return (
    <div
      className={`flex flex-col bg-white rounded-2xl border transition-all shadow-sm hover:shadow-md ${
        !rec.activo ? "border-red-500/30 opacity-75" : "border-black/10"
      }`}
      style={rec.activo ? { borderTop: `4px solid ${rec.color}` } : {}}
    >
      {/* Header */}
      <div
        className={`p-5 border-b border-black/10 flex flex-col gap-3 rounded-t-2xl ${
          !rec.activo ? "bg-red-50" : "bg-slate-50"
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">👤</span>
            <h3
              className={`font-bold text-lg ${
                !rec.activo ? "text-red-500" : "text-slate-800"
              }`}
            >
              {rec.nombre}
            </h3>
          </div>
          {isEditable && (
            <div className="flex gap-2 items-center">
              <button
                onClick={() => onEditRecruiter(rec)}
                className="text-slate-400 hover:text-indigo-600 transition-colors"
              >
                <Edit size={16} />
              </button>
              {isAdmin && (
                <button
                  onClick={() => onRemoveRecruiter(recIndex)}
                  className="text-slate-400 hover:text-red-600 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          )}
        </div>
        <label
          className={`flex items-center justify-end ${
            isAdmin ? "cursor-pointer" : "cursor-not-allowed opacity-80"
          }`}
        >
          <div className="relative">
            <input
              id={`recruiter-toggle-${rec.reclutador_id}`}
              name="recruiter_activo"
              type="checkbox"
              className="sr-only"
              checked={rec.activo}
              onChange={() => onToggleRecruiter(recIndex)}
              disabled={!isAdmin}
            />
            <div
              className={`block w-10 h-6 rounded-full transition-colors ${
                rec.activo ? "bg-primary" : "bg-slate-300"
              }`}
            ></div>
            <div
              className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform flex items-center justify-center ${
                rec.activo
                  ? "transform translate-x-4 text-primary"
                  : "text-transparent"
              }`}
            >
              <Check
                size={10}
                strokeWidth={4}
                className={rec.activo ? "opacity-100" : "opacity-0"}
              />
            </div>
          </div>
        </label>
      </div>

      {/* Vacancy List */}
      <div
        className="p-5 flex-1 max-h-[400px] overflow-y-auto flex flex-col gap-3 custom-scrollbar min-h-[100px]"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => onDrop(e, recIndex, -1)}
      >
        {rec.vacantes.map((vac, vacIndex) => (
          <div
            key={vac.id}
            draggable={isEditable}
            onDragStart={() => isEditable && onDragStart(recIndex, vacIndex)}
            onDragOver={(e) => isEditable && e.preventDefault()}
            onDrop={(e) => {
              if (!isEditable) return;
              e.stopPropagation();
              onDrop(e, recIndex, vacIndex);
            }}
            className={`p-3 rounded-xl border transition-all ${
              isEditable ? "cursor-grab active:cursor-grabbing" : ""
            } ${
              !vac.activa
                ? "bg-slate-50 border-slate-200 opacity-60"
                : "bg-white border-black/10 hover:bg-slate-50 hover:border-black/20"
            }`}
          >
            <div className="flex justify-between items-start mb-2">
              <div className="font-semibold text-[15px]">{vac.nombre}</div>
              <input
                id={`vacancy-toggle-${vac.id}`}
                name="vacancy_activa"
                type="checkbox"
                className={`w-4 h-4 accent-indigo-500 ${
                  isEditable ? "cursor-pointer" : "cursor-not-allowed"
                }`}
                checked={vac.activa}
                onChange={() => onToggleVacancy(recIndex, vacIndex)}
                disabled={!isEditable}
              />
            </div>
            <div className="flex flex-wrap gap-1 mb-3">
              {Array.isArray(vac.naves) &&
                vac.naves.map((n) => {
                  const naveName = availableNaves.find(an => an.id === n)?.nombre || n;
                  return (
                    <span
                      key={n}
                      className="bg-primary/10 text-primary px-2 py-0.5 rounded-full text-[11px] font-bold"
                    >
                      {naveName}
                    </span>
                  );
                })}
            </div>
            {vac.palabras_clave && (
              <div className="text-[11px] text-slate-500 mb-3 italic">
                <span className="font-semibold not-italic">Keywords: </span>
                {vac.palabras_clave}
              </div>
            )}
            <div className="flex gap-2 border-t border-black/5 pt-3">
              {isEditable && (
                <button
                  onClick={() => onEditVacancy(rec.reclutador_id, vac)}
                  className="text-xs bg-success hover:bg-success/90 text-white px-3 py-1.5 rounded font-semibold transition-colors"
                >
                  Editar
                </button>
              )}
              <button
                onClick={() => router.push(`/vacantes/${vac.id}`)}
                className="text-xs bg-indigo-100 hover:bg-indigo-200 text-indigo-700 px-3 py-1.5 rounded font-semibold transition-colors flex items-center justify-center gap-1 flex-1"
              >
                <Filter size={12} /> Filtros
                {(vac.filtros?.filter((f) => f.activo).length ?? 0) > 0
                  ? ` (${vac.filtros?.filter((f) => f.activo).length})`
                  : ""}
              </button>
              {isEditable && (
                <button
                  onClick={() => onRemoveVacancy(recIndex, vacIndex)}
                  className="text-xs bg-danger hover:bg-danger/90 text-white px-3 py-1.5 rounded font-semibold transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
        {rec.vacantes.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-center text-sm text-slate-400 italic py-4">
            Sin vacantes {isEditable ? "— agrega la primera" : "registradas"}
          </div>
        )}
      </div>

      {/* Add Vacancy Footer */}
      {rec.activo && isEditable && (
        <div className="p-4 border-t border-black/10 bg-slate-100/50 rounded-b-2xl">
          <button
            onClick={() => onAddVacancy(rec.reclutador_id)}
            className="w-full py-2 border border-black/10 text-slate-700 font-semibold rounded-lg hover:bg-black/5 transition-colors"
          >
            + Añadir Vacante
          </button>
        </div>
      )}
    </div>
  );
}
