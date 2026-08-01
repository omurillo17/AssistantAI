"use client";

import { AlertTriangle, X } from "lucide-react";
import type { Recruiter } from "@/types";

type Props = {
  recruiters: Recruiter[];
  transferRecruiterIndex: number;
  targetRecruiterId: string;
  setTargetRecruiterId: (id: string) => void;
  onCancel: () => void;
  onDeletePermanently: () => void;
  onTransferAndDelete: () => void;
};

export default function TransferRecruiterModal({
  recruiters,
  transferRecruiterIndex,
  targetRecruiterId,
  setTargetRecruiterId,
  onCancel,
  onDeletePermanently,
  onTransferAndDelete,
}: Props) {
  const recToDelete = recruiters[transferRecruiterIndex];
  if (!recToDelete) return null;

  const availableTargets = recruiters.filter(
    (r) => r.reclutador_id !== recToDelete.reclutador_id
  );

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1000] p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl relative flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-red-50 rounded-t-2xl">
          <div>
            <h2 className="text-lg font-bold text-red-600 flex items-center gap-2">
              <AlertTriangle size={20} />
              Eliminar Reclutador
            </h2>
          </div>
          <button
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-700 bg-white p-1 rounded-full shadow-sm"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          <p className="text-sm text-slate-600">
            Estás a punto de eliminar al reclutador{" "}
            <strong className="text-slate-800">{recToDelete.nombre}</strong>.
            Este reclutador tiene{" "}
            <strong>{recToDelete.vacantes.length} vacantes</strong> asignadas.
          </p>

          <div className="bg-amber-50 p-3 rounded-xl border border-amber-200">
            <p className="text-xs text-amber-700 font-medium">
              ¿Qué deseas hacer con sus vacantes (y los candidatos asignados a
              ellas)?
            </p>
          </div>

          {availableTargets.length > 0 ? (
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Transferir a:
              </label>
              <select
                id="transfer-recruiter-target"
                name="target_recruiter"
                value={targetRecruiterId}
                onChange={(e) => setTargetRecruiterId(e.target.value)}
                className="w-full p-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:border-indigo-400 outline-none"
              >
                {availableTargets.map((r) => (
                  <option key={r.reclutador_id} value={r.reclutador_id}>
                    {r.nombre}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-1">
                Los chats de este reclutador le aparecerán automáticamente a
                este nuevo reclutador.
              </p>
            </div>
          ) : (
            <p className="text-xs text-slate-500 italic">
              No hay otros reclutadores activos para transferir las vacantes.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex flex-col gap-2 sm:flex-row justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-white text-slate-700 border border-slate-200 text-sm font-bold rounded-xl transition-colors shadow-sm"
          >
            Cancelar
          </button>

          <button
            onClick={onDeletePermanently}
            className="px-4 py-2 bg-red-100 text-red-700 hover:bg-red-200 text-sm font-bold rounded-xl transition-colors shadow-sm"
          >
            Eliminar Permanentemente
          </button>

          {availableTargets.length > 0 && (
            <button
              onClick={onTransferAndDelete}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-colors shadow-sm"
              disabled={!targetRecruiterId}
            >
              Transferir y Eliminar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
