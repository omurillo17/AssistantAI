"use client";

import { useCallback, useState, useEffect } from "react";
import type { Recruiter, Vacante } from "@/types";
import { COUNTRY_CODES } from "@/types";
import type { Empresa, Nave } from "@/types";
import { useTenant, useTenantChange } from "./useTenant";
import { useIsHydrated, useLocalStorageValue } from "./useLocalStorageValue";

const API_URL = `/api/db/vacantes`;

export function useVacantes() {
  const { setTenant } = useTenant();

  const [recruiters, setRecruiters] = useState<Recruiter[]>([]);
  const [loading, setLoading] = useState(true);
  const hidratado = useIsHydrated();
  const rol = useLocalStorageValue("tci_role");
  const isAdmin = rol === "ADMIN" || rol === "ROOT" || rol === "ENCARGADO";
  const myRecId = useLocalStorageValue("tci_reclutador_id");
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);
  const [availableNaves, setAvailableNaves] = useState<{id: string, nombre: string}[]>([]);

  // ─── Vacancy Modal State ─────────────────────────────────
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalRecruiterId, setModalRecruiterId] = useState<string | null>(null);
  const [modalVacancyId, setModalVacancyId] = useState<string | null>(null);
  const [vNombre, setVNombre] = useState("");
  const [vDetalles, setVDetalles] = useState("");
  const [vFunciones, setVFunciones] = useState("");
  const [vPalabrasClave, setVPalabrasClave] = useState("");
  const [vNaves, setVNaves] = useState<string[]>([]);

  // ─── Recruiter Modal State ───────────────────────────────
  const [isRecModalOpen, setIsRecModalOpen] = useState(false);
  const [editingRecId, setEditingRecId] = useState<string | null>(null);
  const [rNombre, setRNombre] = useState("");
  const [rCodigoPais, setRCodigoPais] = useState("52");
  const [rTelefonoNum, setRTelefonoNum] = useState("");
  const [rCalendar, setRCalendar] = useState("");
  const [rColor, setRColor] = useState("#6366f1");

  // ─── Transfer Modal State ────────────────────────────────
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferRecruiterIndex, setTransferRecruiterIndex] = useState<number | null>(null);
  const [targetRecruiterId, setTargetRecruiterId] = useState<string>("");
  const [transferMap, setTransferMap] = useState<{from: string, to: string}[]>([]);

  // ─── Drag and Drop ───────────────────────────────────────
  const [draggedItem, setDraggedItem] = useState<{ recIndex: number; vacIndex: number } | null>(null);

  // ─── Helpers ─────────────────────────────────────────────
  const showToast = (msg: string, isError: boolean) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3000);
  };

  const loadNaves = useCallback(async () => {
    try {
      const role = localStorage.getItem("tci_role") || "USER";
      const res = await fetch("/api/db/empresas");
      if (res.ok) {
        const data = await res.json();
        let fetchedEmpresas = data.empresas || [];
        
        try {
          const navesAsignadasStr = localStorage.getItem("tci_naves_asignadas");
          if (navesAsignadasStr && role !== "ROOT" && role !== "ADMIN") {
            const allowedNaves = JSON.parse(navesAsignadasStr);
            if (Array.isArray(allowedNaves) && allowedNaves.length > 0) {
              fetchedEmpresas = fetchedEmpresas.map((emp: Empresa) => ({
                ...emp,
                naves: emp.naves ? emp.naves.filter((n: Nave) => allowedNaves.includes(n.id)) : []
              })).filter((emp: Empresa) => (emp.naves?.length ?? 0) > 0);
            }
          }
        } catch {}

        const allNaves = fetchedEmpresas.flatMap((e: Empresa) => e.naves || []);
        setAvailableNaves(allNaves);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const storedEmpresaId = localStorage.getItem("tci_empresa_id");
      const storedNaveId = localStorage.getItem("tci_nave_id");
      let query = "";
      if (storedEmpresaId) query += `?empresa_id=${storedEmpresaId}`;
      if (storedNaveId) query += (query ? `&` : `?`) + `nave_id=${storedNaveId}`;
      
      const res = await fetch(`${API_URL}${query}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const raw = Array.isArray(data) ? data : data.data || [];

      // La API puede devolver la fila incompleta; aquí se le ponen los valores
      // por defecto que faltan, así que entra como Partial y sale como Recruiter.
      const normalized: Recruiter[] = raw.map((rec: Partial<Recruiter>, i: number) => ({
        ...rec,
        reclutador_id: rec.reclutador_id || `rec_${i}_${Date.now()}`,
        nombre: rec.nombre || '',
        activo: rec.activo !== false,
        telefono: rec.telefono || '',
        calendar_id: rec.calendar_id || '',
        color: rec.color || '#6366f1',
        usuario: rec.usuario || '',
        password: '',
        vacantes: (rec.vacantes || []).map((vac: Partial<Vacante>, j: number) => ({
          ...vac,
          id: vac.id || `vac_${i}_${j}_${Date.now()}`,
          nombre: vac.nombre || '',
          naves: vac.naves || [],
          detalles: vac.detalles || '',
          activa: vac.activa !== false
        }))
      }));

      setRecruiters(normalized);
      showToast("Datos cargados", false);
    } catch {
      showToast("Error al cargar datos de n8n.", true);
    } finally {
      setLoading(false);
    }
  }, []);

  // ─── Auth & Init ────────────────────────────────────────
  useEffect(() => {
    document.title = "Gestión de Vacantes | TCi";
    // Espera a la hidratación: antes de eso no se conoce el rol y se
    // cargarían los datos dos veces.
    if (!hidratado) return;

    // ADMIN/ROOT administran TODA la empresa: si llegan aquí con una nave/grupo
    // todavía seleccionado de otra página (Dashboards, Mensajes, etc.), Vacantes
    // se veía recortado a esa nave sin que quedara claro por qué ("vacantes que
    // nada que ver"). Al entrar aquí se resetea a "todas" -- el selector de
    // Nave/Grupo del TopNavbar sigue funcionando normal después, para quien sí
    // quiera filtrar mientras está en esta página.
    // ENCARGADO no se toca: su grupo es fijo (asignado en el login), no un
    // filtro opcional.
    if (rol === "ADMIN" || rol === "ROOT") {
      setTenant(localStorage.getItem("tci_empresa_id"), null, null);
    }

    const cargar = async () => {
      await Promise.all([loadData(), loadNaves()]);
    };
    cargar();
    // setTenant se recrea en cada render del hook y solo escribe en
    // localStorage; incluirlo relanzaría la carga en bucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidratado, rol, loadData, loadNaves]);

  // Re-cargar (sin recargar la página) cuando el usuario cambia de empresa/nave en el TopNavbar
  useTenantChange(() => {
    loadData();
    loadNaves();
  });


  // ─── Data Operations ────────────────────────────────────

  const saveData = async () => {
    try {
      showToast("Guardando...", false);
      
      const storedEmpresaId = localStorage.getItem("tci_empresa_id");
      const storedNaveId = localStorage.getItem("tci_nave_id");
      let query = "";
      if (storedEmpresaId) query += `?empresa_id=${storedEmpresaId}`;
      if (storedNaveId) query += (query ? `&` : `?`) + `nave_id=${storedNaveId}`;

      const res = await fetch(`${API_URL}${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recruiters: recruiters,
          transfer_map: transferMap
        }),
      });
      if (!res.ok) throw new Error();
      showToast("✅ Cambios guardados con éxito", false);
      setTransferMap([]); // Clear transfer map after successful save
    } catch {
      showToast("❌ Error al guardar en n8n.", true);
    }
  };

  // ─── Recruiter Operations ───────────────────────────────
  const toggleRecruiter = (recIndex: number) => {
    if (!isAdmin) return;
    const updated = [...recruiters];
    updated[recIndex].activo = !updated[recIndex].activo;
    setRecruiters(updated);
  };

  const openRecruiterModal = (rec: Recruiter) => {
    setEditingRecId(rec.reclutador_id);
    setRNombre(rec.nombre);

    const tel = rec.telefono || "";
    let matchedCode = "52";
    let matchedNum = tel;
    const sortedCodes = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length);
    for (const c of sortedCodes) {
      if (tel.startsWith(c.code)) {
        matchedCode = c.code;
        matchedNum = tel.slice(c.code.length);
        break;
      }
    }
    setRCodigoPais(matchedCode);
    setRTelefonoNum(matchedNum);
    setRCalendar(rec.calendar_id);
    setRColor(rec.color);
    setIsRecModalOpen(true);
  };

  const saveRecruiter = () => {
    if (!rNombre.trim()) {
      showToast("Debes ingresar un nombre.", true);
      return;
    }
    const updated = [...recruiters];

    if (editingRecId) {
      const index = updated.findIndex(r => r.reclutador_id === editingRecId);
      if (index > -1) {
        updated[index].nombre = rNombre.toUpperCase();
        updated[index].telefono = rTelefonoNum ? rCodigoPais + rTelefonoNum : "";
        updated[index].calendar_id = rCalendar;
        updated[index].color = rColor;
      }
    }

    setRecruiters(updated);
    setIsRecModalOpen(false);
  };

  const removeRecruiter = (recIndex: number) => {
    setTransferRecruiterIndex(recIndex);
    const recToDelete = recruiters[recIndex];
    const availableTargets = recruiters.filter(r => r.reclutador_id !== recToDelete.reclutador_id);
    if (availableTargets.length > 0) {
      setTargetRecruiterId(availableTargets[0].reclutador_id);
    } else {
      setTargetRecruiterId("");
    }
    setShowTransferModal(true);
  };

  const confirmRemoveRecruiter = (transferir: boolean) => {
    if (transferRecruiterIndex === null) return;
    const updated = [...recruiters];
    const recToDelete = updated[transferRecruiterIndex];

    if (transferir && targetRecruiterId) {
      const targetIndex = updated.findIndex(r => r.reclutador_id === targetRecruiterId);
      if (targetIndex > -1) {
        updated[targetIndex].vacantes = [
          ...updated[targetIndex].vacantes,
          ...recToDelete.vacantes
        ];
        // Record the chat transfer mapping
        setTransferMap(prev => [...prev, { from: recToDelete.reclutador_id, to: updated[targetIndex].reclutador_id }]);
      }
    }

    updated.splice(transferRecruiterIndex, 1);
    setRecruiters(updated);
    setShowTransferModal(false);
    setTransferRecruiterIndex(null);
  };

  // ─── Vacancy Operations ─────────────────────────────────
  const toggleVacancy = (recIndex: number, vacIndex: number) => {
    const updated = [...recruiters];
    const isEditable = isAdmin || updated[recIndex].reclutador_id === myRecId;
    if (!isEditable) return;
    updated[recIndex].vacantes[vacIndex].activa = !updated[recIndex].vacantes[vacIndex].activa;
    setRecruiters(updated);
  };

  const removeVacancy = (recIndex: number, vacIndex: number) => {
    if (!confirm("¿Seguro que deseas ELIMINAR esta vacante permanentemente?")) return;
    const updated = [...recruiters];
    updated[recIndex].vacantes.splice(vacIndex, 1);
    setRecruiters(updated);
  };

  const openVacancyModal = (recId: string, vac?: Vacante) => {
    setModalRecruiterId(recId);
    if (vac) {
      setModalVacancyId(vac.id);
      setVNombre(vac.nombre);
      setVDetalles(vac.detalles || "");
      setVFunciones(vac.funciones || "");
      setVPalabrasClave(vac.palabras_clave || "");
      setVNaves(Array.isArray(vac.naves) ? vac.naves : typeof vac.naves === "string" ? [vac.naves] : []);
    } else {
      setModalVacancyId(null);
      setVNombre("");
      setVDetalles("");
      setVFunciones("");
      setVPalabrasClave("");
      // Si hay una nave filtrada en el TopNavbar, la preseleccionamos: lo más
      // probable es que quieran agregar la vacante justo para esa nave.
      const storedNaveId = localStorage.getItem("tci_nave_id");
      setVNaves(storedNaveId ? [storedNaveId] : []);
    }
    setIsModalOpen(true);
  };

  const saveVacancy = () => {
    const normalizedName = vNombre.trim().toUpperCase();
    if (!normalizedName || vNaves.length === 0) {
      showToast("Debes ingresar un nombre y seleccionar al menos una nave.", true);
      return;
    }

    const updated = [...recruiters];

    // Evitar duplicados revisando en todas las vacantes de todos los reclutadores
    let duplicateExists = false;
    for (const r of updated) {
      for (const v of r.vacantes) {
        if (v.nombre === normalizedName && v.id !== modalVacancyId) {
          duplicateExists = true;
          break;
        }
      }
      if (duplicateExists) break;
    }

    if (duplicateExists) {
      showToast(`La vacante "${normalizedName}" ya existe. Búscala en tu lista y actívala si está inactiva.`, true);
      return;
    }

    const recIndex = updated.findIndex((r) => r.reclutador_id === modalRecruiterId);
    if (recIndex === -1) return;

    if (modalVacancyId) {
      const vacIndex = updated[recIndex].vacantes.findIndex((v) => v.id === modalVacancyId);
      if (vacIndex > -1) {
        updated[recIndex].vacantes[vacIndex] = {
          ...updated[recIndex].vacantes[vacIndex],
          nombre: normalizedName,
          detalles: vDetalles,
          funciones: vFunciones,
          palabras_clave: vPalabrasClave,
          naves: vNaves,
        };
      }
    } else {
      updated[recIndex].vacantes.push({
        id: "v_" + Date.now().toString(),
        nombre: normalizedName,
        detalles: vDetalles,
        funciones: vFunciones,
        palabras_clave: vPalabrasClave,
        naves: vNaves,
        activa: true,
      });
    }

    setRecruiters(updated);
    setIsModalOpen(false);
  };

  const toggleNave = (n: string) => {
    if (vNaves.includes(n)) {
      setVNaves(vNaves.filter((x) => x !== n));
    } else {
      setVNaves([...vNaves, n]);
    }
  };

  // ─── Drag and Drop ──────────────────────────────────────
  const handleDragStart = (recIndex: number, vacIndex: number) => {
    setDraggedItem({ recIndex, vacIndex });
  };

  const handleDrop = (e: React.DragEvent, targetRecIndex: number, targetVacIndex: number) => {
    e.preventDefault();
    if (!draggedItem) return;

    const updated = [...recruiters];
    const sourceList = updated[draggedItem.recIndex].vacantes;
    const targetList = updated[targetRecIndex].vacantes;

    const [moved] = sourceList.splice(draggedItem.vacIndex, 1);
    if (targetVacIndex === -1) {
      targetList.push(moved);
    } else {
      targetList.splice(targetVacIndex, 0, moved);
    }

    setRecruiters(updated);
    setDraggedItem(null);
  };

  return {
    // Core state
    recruiters,
    loading,
    isAdmin,
    myRecId,
    toast,
    availableNaves,

    // Data operations
    loadData,
    saveData,

    // Recruiter operations
    toggleRecruiter,
    openRecruiterModal,
    saveRecruiter,
    removeRecruiter,
    confirmRemoveRecruiter,

    // Vacancy operations
    toggleVacancy,
    removeVacancy,
    openVacancyModal,
    saveVacancy,
    toggleNave,

    // Drag and Drop
    handleDragStart,
    handleDrop,

    // Vacancy Modal state
    isModalOpen,
    setIsModalOpen,
    modalVacancyId,
    vNombre,
    setVNombre,
    vDetalles,
    setVDetalles,
    vFunciones,
    setVFunciones,
    vPalabrasClave,
    setVPalabrasClave,
    vNaves,

    // Recruiter Modal state
    isRecModalOpen,
    setIsRecModalOpen,
    editingRecId,
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

    // Transfer Modal state
    showTransferModal,
    setShowTransferModal,
    transferRecruiterIndex,
    targetRecruiterId,
    setTargetRecruiterId,
  };
}
