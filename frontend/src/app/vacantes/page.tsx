"use client";

import { Plus, Edit, Filter, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { useVacantes } from "@/hooks/useVacantes";
import RecruiterCard from "@/components/vacantes/RecruiterCard";
import VacancyModal from "@/components/modals/VacancyModal";
import RecruiterModal from "@/components/modals/RecruiterModal";
import TransferRecruiterModal from "@/components/modals/TransferRecruiterModal";

export default function VacantesPage() {
  const router = useRouter();
  const v = useVacantes();

  if (v.loading) return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500">Cargando...</div>;

  return (
    <div className="flex flex-col h-full bg-slate-50 text-slate-800">
      {/* Top Toolbar */}
      <div className="flex flex-col md:flex-row justify-end items-start md:items-center mb-6 gap-4 px-10 pt-6">
        <div className="flex gap-4">
          <button onClick={v.loadData} className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold rounded shadow-sm transition-all border border-slate-200">
            Descartar Cambios
          </button>
          <button onClick={v.saveData} className="px-4 py-2 bg-primary hover:bg-primary/90 text-white font-semibold rounded shadow-sm transition-all">
            Guardar
          </button>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 p-10 max-w-7xl mx-auto w-full">
        {v.isAdmin ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {v.recruiters.map((rec, recIndex) => (
              <RecruiterCard
                key={rec.reclutador_id}
                rec={rec}
                recIndex={recIndex}
                isAdmin={v.isAdmin}
                myRecId={v.myRecId}
                onEditRecruiter={v.openRecruiterModal}
                onRemoveRecruiter={v.removeRecruiter}
                onToggleRecruiter={v.toggleRecruiter}
                onEditVacancy={v.openVacancyModal}
                onAddVacancy={(recId) => v.openVacancyModal(recId)}
                onToggleVacancy={v.toggleVacancy}
                onRemoveVacancy={v.removeVacancy}
                onDragStart={v.handleDragStart}
                onDrop={v.handleDrop}
                availableNaves={v.availableNaves}
              />
            ))}
          </div>
        ) : v.recruiters.length > 0 ? (
          <div className="flex flex-col gap-4 max-w-4xl mx-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-slate-800">Tus Vacantes</h2>
              <button onClick={() => v.openVacancyModal(v.recruiters[0].reclutador_id)} className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded shadow-sm transition-all border border-indigo-200 flex items-center gap-2">
                <Plus size={18} /> Añadir Vacante
              </button>
            </div>

            <div
              className="flex flex-col gap-3"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => v.handleDrop(e, 0, -1)}
            >
              {v.recruiters[0].vacantes.map((vac, vacIndex) => {
                const recIndex = 0;
                return (
                  <div
                    key={vac.id}
                    draggable
                    onDragStart={() => v.handleDragStart(recIndex, vacIndex)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.stopPropagation(); v.handleDrop(e, recIndex, vacIndex); }}
                    className={`p-4 rounded-xl border transition-all cursor-grab active:cursor-grabbing ${!vac.activa ? "bg-slate-50 border-slate-200 opacity-60" : "bg-white border-black/10 hover:bg-slate-50 hover:border-black/20"}`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="font-semibold text-lg">{vac.nombre}</div>
                      <input id={`vacancy-toggle-${vac.id}`} name="vacancy_activa" type="checkbox" className="w-5 h-5 accent-indigo-500 cursor-pointer" checked={vac.activa} onChange={() => v.toggleVacancy(recIndex, vacIndex)} />
                    </div>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {Array.isArray(vac.naves) && vac.naves.map((n) => {
                        const naveName = v.availableNaves.find(an => an.id === n)?.nombre || n;
                        return (
                          <span key={n} className="bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-bold">{naveName}</span>
                        );
                      })}
                    </div>
                    {vac.palabras_clave && (
                      <div className="text-sm text-slate-500 mb-4 italic">
                        <span className="font-semibold not-italic">Keywords: </span>{vac.palabras_clave}
                      </div>
                    )}
                    <div className="flex gap-3 border-t border-black/5 pt-4">
                      <button onClick={() => v.openVacancyModal(v.recruiters[0].reclutador_id, vac)} className="text-sm bg-success hover:bg-success/90 text-white px-4 py-2 rounded font-semibold transition-colors flex items-center gap-2">
                        <Edit size={16} /> Editar
                      </button>
                      <button onClick={() => router.push(`/vacantes/${vac.id}`)} className="text-sm bg-indigo-100 hover:bg-indigo-200 text-indigo-700 px-4 py-2 rounded font-semibold transition-colors flex items-center gap-2">
                        <Filter size={16} /> Filtros{(vac as any).filtros?.filter((f: any) => f.activo).length > 0 ? ` (${(vac as any).filtros?.filter((f: any) => f.activo).length})` : ''}
                      </button>
                      <button onClick={() => v.removeVacancy(recIndex, vacIndex)} className="text-sm bg-danger hover:bg-danger/90 text-white px-4 py-2 rounded font-semibold transition-colors flex items-center gap-2">
                        <Trash2 size={16} /> Eliminar
                      </button>
                    </div>
                  </div>
                );
              })}
              {v.recruiters[0].vacantes.length === 0 && (
                <div className="text-center py-10 text-slate-500 bg-white border border-black/10 rounded-xl">No tienes vacantes actualmente.</div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center py-10 text-slate-500">No se encontró información de tu cuenta.</div>
        )}
      </main>

      {/* ─── Modals ─────────────────────────────────────────── */}
      {v.isModalOpen && (
        <VacancyModal
          isEditing={!!v.modalVacancyId}
          vNombre={v.vNombre} setVNombre={v.setVNombre}
          vDetalles={v.vDetalles} setVDetalles={v.setVDetalles}
          vPalabrasClave={v.vPalabrasClave} setVPalabrasClave={v.setVPalabrasClave}
          vNaves={v.vNaves} toggleNave={v.toggleNave}
          availableNaves={v.availableNaves}
          onSave={v.saveVacancy} onCancel={() => v.setIsModalOpen(false)}
        />
      )}

      {v.isRecModalOpen && (
        <RecruiterModal
          rNombre={v.rNombre} setRNombre={v.setRNombre}
          rCodigoPais={v.rCodigoPais} setRCodigoPais={v.setRCodigoPais}
          rTelefonoNum={v.rTelefonoNum} setRTelefonoNum={v.setRTelefonoNum}
          rCalendar={v.rCalendar} setRCalendar={v.setRCalendar}
          rColor={v.rColor} setRColor={v.setRColor}
          onSave={v.saveRecruiter} onCancel={() => v.setIsRecModalOpen(false)}
        />
      )}

      {v.showTransferModal && v.transferRecruiterIndex !== null && (
        <TransferRecruiterModal
          recruiters={v.recruiters}
          transferRecruiterIndex={v.transferRecruiterIndex}
          targetRecruiterId={v.targetRecruiterId}
          setTargetRecruiterId={v.setTargetRecruiterId}
          onCancel={() => v.setShowTransferModal(false)}
          onDeletePermanently={() => v.confirmRemoveRecruiter(false)}
          onTransferAndDelete={() => v.confirmRemoveRecruiter(true)}
        />
      )}

      {/* Toast */}
      <div className={`fixed bottom-6 right-6 px-5 py-3 rounded font-bold text-white shadow-xl transition-all duration-300 z-[2000] ${v.toast ? "translate-y-0 opacity-100" : "translate-y-16 opacity-0"} ${v.toast?.isError ? "bg-danger" : "bg-success"}`}>
        {v.toast?.msg}
      </div>
    </div>
  );
}
