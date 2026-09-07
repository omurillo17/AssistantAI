"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, MapPin, Plus, Trash2, Edit, Phone, ChevronDown, Briefcase } from "lucide-react";
import SaasGrupoModal from "@/components/saas/SaasGrupoModal";
import AdminModal from "@/components/saas/AdminModal";
import EmpresaModal from "@/components/saas/EmpresaModal";
import NaveModal from "@/components/saas/NaveModal";
import { useIsHydrated, useLocalStorageValue } from "@/hooks/useLocalStorageValue";
import type { Grupo } from "@/types";

type Nave = {
  id: string;
  nombre: string;
  rfc: string;
  ubicacion_maps: string;
  created_at: string;
};

type Empresa = {
  id: string;
  nombre: string;
  prompt_ia: string;
  created_at: string;
  naves: Nave[];
};

type NaveCardProps = {
  nave: Nave;
  grupoActualId: string;
  empresaId: string;
  empGrupos: Grupo[];
  onEditNave: (nave: Nave) => void;
  onDeleteNave: (id: string) => void;
  onChangeNaveGrupo: (naveId: string, empresaId: string, nuevoGrupoId: string) => void;
};

function NaveCard({
  nave,
  grupoActualId,
  empresaId,
  empGrupos,
  onEditNave,
  onDeleteNave,
  onChangeNaveGrupo,
}: Readonly<NaveCardProps>) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow group relative overflow-hidden">
      <div className="absolute top-0 left-0 w-1 h-full bg-indigo-400" />
      <div className="flex justify-between items-start mb-3">
        <h4 className="font-bold text-slate-800 text-base leading-tight pr-14">{nave.nombre}</h4>
        <span className="text-xs font-semibold text-slate-400 block mt-1">RFC: {nave.rfc || 'Sin RFC'}</span>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity absolute top-3 right-3">
          <button onClick={() => onEditNave(nave)} className="p-1.5 text-slate-400 hover:text-indigo-600 bg-slate-50 rounded"><Edit size={14} /></button>
          <button onClick={() => onDeleteNave(nave.id)} className="p-1.5 text-slate-400 hover:text-red-600 bg-slate-50 rounded"><Trash2 size={14} /></button>
        </div>
      </div>
      {nave.ubicacion_maps ? (
        <a href={nave.ubicacion_maps} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-indigo-600 font-medium hover:underline bg-indigo-50 px-2.5 py-1 rounded-md mb-3">
          <MapPin size={14} /> Ver en Maps
        </a>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-sm text-slate-400 font-medium bg-slate-50 px-2.5 py-1 rounded-md mb-3">
          <MapPin size={14} /> Sin ubicación
        </span>
      )}
      {empGrupos.length > 0 && (
        <select
          id={`nave-grupo-${nave.id}`}
          name="nave_grupo"
          value={grupoActualId}
          onChange={(e) => onChangeNaveGrupo(nave.id, empresaId, e.target.value)}
          className="w-full text-xs font-semibold p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-violet-500 text-slate-600 cursor-pointer"
        >
          <option value="">Sin grupo asignado</option>
          {empGrupos.map((g: Grupo) => <option key={g.id} value={g.id}>{g.nombre}</option>)}
        </select>
      )}
    </div>
  );
}

type EmpresaNavesExpandedProps = {
  emp: Empresa;
  grupos: Grupo[];
  onAddGrupo: (emp: Empresa) => void;
  onEditGrupo: (emp: Empresa, grupo: Grupo) => void;
  onDeleteGrupo: (grupoId: string) => void;
  onEditNave: (empresaId: string, nave: Nave) => void;
  onDeleteNave: (id: string) => void;
  onChangeNaveGrupo: (naveId: string, empresaId: string, nuevoGrupoId: string) => void;
};

function EmpresaNavesExpanded({
  emp,
  grupos,
  onAddGrupo,
  onEditGrupo,
  onDeleteGrupo,
  onEditNave,
  onDeleteNave,
  onChangeNaveGrupo,
}: Readonly<EmpresaNavesExpandedProps>) {
  const empGrupos = grupos.filter(g => g.empresa_id === emp.id);
  const navesEnGrupo = new Set(empGrupos.flatMap((g: Grupo) => g.naves_asignadas || []));
  const navesSinGrupo = (emp.naves || []).filter(n => !navesEnGrupo.has(n.id));

  return (
    <div className="border-t border-slate-100 p-6 bg-slate-50/50">
      <div className="mb-5 flex items-center justify-between">
        <div className="text-sm font-bold text-slate-400 uppercase tracking-wider">Sub-Empresas (Naves) por Grupo</div>
        <button
          onClick={(e) => { e.stopPropagation(); onAddGrupo(emp); }}
          className="px-3 py-1.5 bg-violet-50 text-violet-700 hover:bg-violet-100 font-semibold rounded-lg text-xs transition-colors flex items-center gap-1.5"
        >
          <Plus size={14} /> Nuevo Grupo
        </button>
      </div>

      {(!emp.naves || emp.naves.length === 0) ? (
        <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-xl bg-white">
          <MapPin size={32} className="mx-auto text-slate-300 mb-3" />
          <h3 className="text-slate-500 font-medium mb-1">Esta empresa no tiene Naves.</h3>
          <p className="text-sm text-slate-400">Registra al menos una nave para poder asignar vacantes.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {empGrupos.map((grupo: Grupo) => {
            const navesDelGrupo = (emp.naves || []).filter(n => (grupo.naves_asignadas || []).includes(n.id));
            return (
              <div key={grupo.id}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-violet-500"></div>
                    <span className="text-sm font-bold text-slate-700">{grupo.nombre}</span>
                    <span className="text-xs text-slate-400">({navesDelGrupo.length} naves)</span>
                  </div>
                  <div className="flex-1 h-px bg-slate-200"></div>
                  <button onClick={() => onEditGrupo(emp, grupo)} className="p-1 text-slate-300 hover:text-violet-500 transition-colors"><Edit size={13} /></button>
                  <button onClick={() => onDeleteGrupo(grupo.id)} className="p-1 text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={13} /></button>
                </div>
                {navesDelGrupo.length === 0 ? (
                  <p className="text-xs text-slate-400 italic ml-5">Sin naves asignadas a este grupo.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 ml-5">
                    {navesDelGrupo.map(nave => (
                      <NaveCard
                        key={nave.id}
                        nave={nave}
                        grupoActualId={grupo.id}
                        empresaId={emp.id}
                        empGrupos={empGrupos}
                        onEditNave={(n) => onEditNave(emp.id, n)}
                        onDeleteNave={onDeleteNave}
                        onChangeNaveGrupo={onChangeNaveGrupo}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {navesSinGrupo.length > 0 && (
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-slate-300"></div>
                  <span className="text-sm font-bold text-slate-400">Sin grupo asignado</span>
                  <span className="text-xs text-slate-400">({navesSinGrupo.length} naves)</span>
                </div>
                <div className="flex-1 h-px bg-slate-200"></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 ml-5">
                {navesSinGrupo.map(nave => (
                  <NaveCard
                    key={nave.id}
                    nave={nave}
                    grupoActualId=""
                    empresaId={emp.id}
                    empGrupos={empGrupos}
                    onEditNave={(n) => onEditNave(emp.id, n)}
                    onDeleteNave={onDeleteNave}
                    onChangeNaveGrupo={onChangeNaveGrupo}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SaasAdminPage() {
  const router = useRouter();
  const hidratado = useIsHydrated();
  const rolGuardado = useLocalStorageValue("tci_role");
  // null hasta que hidrata (en el servidor no hay localStorage): la vista
  // muestra "cargando" mientras tanto y solo después decide si hay permiso.
  const isRoot = hidratado ? rolGuardado === "ROOT" : null;
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [showEmpresaModal, setShowEmpresaModal] = useState(false);
  const [showNaveModal, setShowNaveModal] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [showGrupoModal, setShowGrupoModal] = useState(false);

  // Selected for modals
  const [editingEmpresa, setEditingEmpresa] = useState<Empresa | null>(null);
  const [editingNave, setEditingNave] = useState<Nave | null>(null);
  const [selectedEmpresaForNave, setSelectedEmpresaForNave] = useState<string>("");
  const [selectedEmpresaForAdmin, setSelectedEmpresaForAdmin] = useState<Empresa | null>(null);
  const [selectedEmpresaForGrupo, setSelectedEmpresaForGrupo] = useState<Empresa | null>(null);
  const [editingGrupo, setEditingGrupo] = useState<Grupo | null>(null);

  // UI State
  const [expandedEmpresa, setExpandedEmpresa] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);

  const showToast = (msg: string, isError: boolean = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3000);
  };

  const handleOpenEditNave = useCallback((empresaId: string, nave: Nave) => {
    setSelectedEmpresaForNave(empresaId);
    setEditingNave(nave);
    setShowNaveModal(true);
  }, []);

  const handleOpenAddGrupo = useCallback((emp: Empresa) => {
    setSelectedEmpresaForGrupo(emp);
    setEditingGrupo(null);
    setShowGrupoModal(true);
  }, []);

  const handleOpenEditGrupo = useCallback((emp: Empresa, grupo: Grupo) => {
    setSelectedEmpresaForGrupo(emp);
    setEditingGrupo(grupo);
    setShowGrupoModal(true);
  }, []);

  const fetchGrupos = useCallback(async () => {
    try {
      const res = await fetch("/api/db/grupos");
      if (res.ok) setGrupos(await res.json());
    } catch (err) {
      console.error(err);
    }
  }, []);

  const handleDeleteGrupo = async (grupoId: string) => {
    if (!confirm("¿Eliminar este grupo? Los reclutadores asignados a él perderán su asignación.")) return;
    try {
      const res = await fetch(`/api/db/grupos?id=${grupoId}`, { method: "DELETE" });
      if (res.ok) { showToast("Grupo eliminado"); fetchGrupos(); }
    } catch { showToast("Error", true); }
  };

  const handleChangeNaveGrupo = async (naveId: string, empresaId: string, nuevoGrupoId: string) => {
    const gruposEmpresa = grupos.filter((g) => g.empresa_id === empresaId);
    const grupoOrigen = gruposEmpresa.find((g) => (g.naves_asignadas || []).includes(naveId));

    if ((grupoOrigen?.id || "") === nuevoGrupoId) return;

    try {
      if (grupoOrigen) {
        await fetch("/api/db/grupos", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: grupoOrigen.id,
            nombre: grupoOrigen.nombre,
            naves_asignadas: (grupoOrigen.naves_asignadas || []).filter((id: string) => id !== naveId),
          }),
        });
      }

      if (nuevoGrupoId) {
        const grupoDestino = gruposEmpresa.find((g) => g.id === nuevoGrupoId);
        if (grupoDestino) {
          await fetch("/api/db/grupos", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: grupoDestino.id,
              nombre: grupoDestino.nombre,
              naves_asignadas: Array.from(new Set([...(grupoDestino.naves_asignadas || []), naveId])),
            }),
          });
        }
      }

      showToast("Grupo de la nave actualizado");
      fetchGrupos();
    } catch {
      showToast("Error al actualizar el grupo de la nave", true);
    }
  };

  const fetchEmpresas = useCallback(async () => {
    try {
      const res = await fetch("/api/db/empresas");
      const data = await res.json();
      if (data.empresas) {
        setEmpresas(data.empresas);
      }
    } catch {
      showToast("Error al cargar empresas", true);
    }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([fetchEmpresas(), fetchGrupos()]);
    } finally {
      setLoading(false);
    }
  }, [fetchEmpresas, fetchGrupos]);

  useEffect(() => {
    document.title = "SaaS Admin | TCi";
    if (!isRoot) return;
    const cargar = async () => { await fetchData(); };
    cargar();
  }, [isRoot, fetchData]);

  const handleDeleteEmpresa = async (id: string) => {
    if (!confirm("¿Estás seguro de eliminar esta Empresa? Se eliminarán todas sus Naves y Vacantes.")) return;
    try {
      const res = await fetch(`/api/db/empresas?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        showToast("Empresa eliminada");
        fetchEmpresas();
      }
    } catch {
      showToast("Error al eliminar", true);
    }
  };

  const handleDeleteNave = async (id: string) => {
    if (!confirm("¿Estás seguro de eliminar esta Nave?")) return;
    try {
      const res = await fetch(`/api/db/naves?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        showToast("Nave eliminada");
        fetchEmpresas();
      }
    } catch {
      showToast("Error al eliminar", true);
    }
  };

  if (isRoot === null) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500 font-medium">Cargando Plataforma SaaS...</div>;
  }

  if (isRoot === false) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-black/10 w-full max-w-md text-center">
          <div className="text-5xl mb-4">🔒</div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Acceso Root Requerido</h1>
          <p className="text-slate-500 mb-6 text-sm">Esta sección está restringida al administrador global del sistema SaaS.</p>
          <button onClick={() => router.push('/')} className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors">
            Volver al Inicio
          </button>
        </div>
      </div>
    );
  }

  if (loading && empresas.length === 0) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500 font-medium">Cargando Plataforma SaaS...</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 text-slate-800 p-6 md:p-10 font-sans">
      
      {/* Header Premium */}
      <div className="max-w-6xl mx-auto mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-100 text-amber-700 text-xs font-bold rounded-full mb-3 uppercase tracking-wider">
            <Briefcase size={14} /> Global Administration
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-slate-900 mb-2">SaaS Multi-Tenant</h1>
          <p className="text-slate-500 text-lg max-w-xl">Gestiona las empresas, asigna naves y controla la infraestructura de todos los clientes de Virgo.</p>
        </div>
        <button 
          onClick={() => { setEditingEmpresa(null); setShowEmpresaModal(true); }}
          className="bg-slate-900 hover:bg-slate-800 text-white px-6 py-3.5 rounded-xl font-bold shadow-lg shadow-slate-900/20 transition-all flex items-center gap-3 transform hover:-translate-y-0.5 active:translate-y-0"
        >
          <Plus size={20} /> Registrar Nueva Empresa
        </button>
      </div>

      {/* Main Content Grid */}
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        {empresas.map((emp) => {
          const isExpanded = expandedEmpresa === emp.id;
          return (
            <div key={emp.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition-all duration-300 hover:shadow-md">
              {/* Company Header Row */}
              <div 
                className={`p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors ${isExpanded ? 'bg-slate-50/50' : 'hover:bg-slate-50'}`}
              >
                <button
                  type="button"
                  onClick={() => setExpandedEmpresa(isExpanded ? null : emp.id)}
                  className="flex items-center gap-4 text-left flex-1 cursor-pointer focus:outline-none"
                >
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${isExpanded ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-600'}`}>
                    <Building2 size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">{emp.nombre}</h2>
                    <div className="flex items-center gap-4 text-sm text-slate-500 mt-1">
                      <span className="flex items-center gap-1.5"><Phone size={14} /> {grupos.filter(g => g.empresa_id === emp.id).length} Grupos (WhatsApp)</span>
                      <span className="flex items-center gap-1.5"><MapPin size={14} /> {(emp.naves || []).length} Naves activas</span>
                    </div>
                  </div>
                </button>
                
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => { setEditingEmpresa(emp); setShowEmpresaModal(true); }}
                    className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                    title="Editar Empresa"
                  >
                    <Edit size={18} />
                  </button>
                  <button 
                    onClick={() => handleDeleteEmpresa(emp.id)}
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Eliminar Empresa"
                  >
                    <Trash2 size={18} />
                  </button>
                  <div className="w-px h-6 bg-slate-200 mx-1"></div>
                  <button 
                    onClick={() => { setSelectedEmpresaForAdmin(emp); setShowAdminModal(true); }}
                    className="px-4 py-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-semibold rounded-lg text-sm transition-colors flex items-center gap-2"
                  >
                    <Plus size={16} /> Crear Admin
                  </button>
                  <button 
                    onClick={() => { setSelectedEmpresaForNave(emp.id); setEditingNave(null); setShowNaveModal(true); }}
                    className="px-4 py-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-semibold rounded-lg text-sm transition-colors flex items-center gap-2"
                  >
                    <Plus size={16} /> Añadir Nave
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpandedEmpresa(isExpanded ? null : emp.id)}
                    className={`p-1 transition-transform duration-300 cursor-pointer ${isExpanded ? 'rotate-180' : ''}`}
                    aria-label="Expandir o colapsar empresa"
                  >
                    <ChevronDown size={20} className="text-slate-400" />
                  </button>
                </div>
              </div>

              {/* Naves (Expanded View) */}
              {isExpanded && (
                <EmpresaNavesExpanded
                  emp={emp}
                  grupos={grupos}
                  onAddGrupo={handleOpenAddGrupo}
                  onEditGrupo={handleOpenEditGrupo}
                  onDeleteGrupo={handleDeleteGrupo}
                  onEditNave={handleOpenEditNave}
                  onDeleteNave={handleDeleteNave}
                  onChangeNaveGrupo={handleChangeNaveGrupo}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Modales SaaS Refactorizados */}
      <EmpresaModal
        isOpen={showEmpresaModal}
        onClose={() => { setShowEmpresaModal(false); setEditingEmpresa(null); }}
        onSuccess={fetchEmpresas}
        empresa={editingEmpresa}
        showToast={showToast}
      />

      <NaveModal
        isOpen={showNaveModal}
        onClose={() => { setShowNaveModal(false); setEditingNave(null); setSelectedEmpresaForNave(""); }}
        onSuccess={fetchEmpresas}
        nave={editingNave}
        empresaId={selectedEmpresaForNave}
        showToast={showToast}
      />

      <SaasGrupoModal
        isOpen={showGrupoModal}
        onClose={() => { setShowGrupoModal(false); setSelectedEmpresaForGrupo(null); setEditingGrupo(null); }}
        onSuccess={fetchGrupos}
        empresa={selectedEmpresaForGrupo}
        grupo={editingGrupo}
        showToast={showToast}
      />

      <AdminModal
        isOpen={showAdminModal}
        onClose={() => { setShowAdminModal(false); setSelectedEmpresaForAdmin(null); }}
        onSuccess={fetchEmpresas}
        empresa={selectedEmpresaForAdmin}
        showToast={showToast}
      />

      {/* Toast */}
      <div
        className={`fixed bottom-6 right-6 px-5 py-3 rounded-xl font-semibold text-white shadow-xl transition-all duration-300 transform z-[200] ${
          toast ? "translate-y-0 opacity-100" : "translate-y-16 opacity-0"
        } ${toast?.isError ? "bg-red-500" : "bg-slate-800"}`}
      >
        {toast?.msg}
      </div>
    </div>
  );
}
