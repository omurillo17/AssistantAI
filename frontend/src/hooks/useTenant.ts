"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

// Se dispara cada vez que setTenant() cambia empresa_id/nave_id/grupo_id (mismo
// tab) o cuando cambian en otra pestaña (evento nativo "storage"). Cualquier
// página/hook que cargue datos filtrados por tenant debe usar este hook
// para refrescarse en cuanto el usuario cambia de empresa/nave/grupo en el
// TopNavbar, sin necesitar un reload completo de la página.
export function useTenantChange(callback: () => void) {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    const handler = () => callbackRef.current();
    window.addEventListener("storage", handler);
    window.addEventListener("tci_tenant_changed", handler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("tci_tenant_changed", handler);
    };
  }, []);
}

export function useTenant() {
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [naveId, setNaveId] = useState<string | null>(null);
  // grupoId es un filtro adicional (solo lo usa el selector Nave/Grupo del
  // TopNavbar para el rol ADMIN) — mutuamente excluyente con naveId.
  const [grupoId, setGrupoId] = useState<string | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    // Escuchar cambios personalizados o locales en tci_empresa_id, tci_nave_id y tci_grupo_id
    const eId = localStorage.getItem("tci_empresa_id");
    const nId = localStorage.getItem("tci_nave_id");
    const gId = localStorage.getItem("tci_grupo_id");
    setEmpresaId(eId);
    setNaveId(nId);
    setGrupoId(gId);

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "tci_empresa_id") {
        setEmpresaId(e.newValue);
      }
      if (e.key === "tci_nave_id") {
        setNaveId(e.newValue);
      }
      if (e.key === "tci_grupo_id") {
        setGrupoId(e.newValue);
      }
    };

    const handleCustomChange = () => {
      setEmpresaId(localStorage.getItem("tci_empresa_id"));
      setNaveId(localStorage.getItem("tci_nave_id"));
      setGrupoId(localStorage.getItem("tci_grupo_id"));
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("tci_tenant_changed", handleCustomChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("tci_tenant_changed", handleCustomChange);
    };
  }, [pathname]);

  // nvId y grpId son mutuamente excluyentes: seleccionar uno limpia el otro.
  // grpId es opcional: omitirlo (undefined) deja tci_grupo_id intacto — esto
  // importa porque tci_grupo_id también se setea en el login para ENCARGADO
  // (su grupo fijo) y los selectores de nave que usan todos los roles no deben
  // pisarlo. Solo el selector de grupo (ADMIN) debe pasar null/valor explícito.
  const setTenant = (empId: string | null, nvId: string | null = null, grpId?: string | null) => {
    if (empId) {
      localStorage.setItem("tci_empresa_id", empId);
    } else {
      localStorage.removeItem("tci_empresa_id");
    }

    if (nvId) {
      localStorage.setItem("tci_nave_id", nvId);
    } else {
      localStorage.removeItem("tci_nave_id");
    }

    if (grpId !== undefined) {
      if (grpId) {
        localStorage.setItem("tci_grupo_id", grpId);
      } else {
        localStorage.removeItem("tci_grupo_id");
      }
      setGrupoId(grpId);
    }

    setEmpresaId(empId);
    setNaveId(nvId);
    window.dispatchEvent(new Event("tci_tenant_changed"));
  };

  return {
    empresaId,
    naveId,
    grupoId,
    setTenant
  };
}
