"use client";

import { useEffect, useRef } from "react";
import {
  LOCAL_STORAGE_EVENT,
  notifyLocalStorageChange,
  useLocalStorageValue,
} from "./useLocalStorageValue";

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
    window.addEventListener(LOCAL_STORAGE_EVENT, handler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener(LOCAL_STORAGE_EVENT, handler);
    };
  }, []);
}

export function useTenant() {
  const empresaId = useLocalStorageValue("tci_empresa_id");
  const naveId = useLocalStorageValue("tci_nave_id");
  // grupoId es un filtro adicional (solo lo usa el selector Nave/Grupo del
  // TopNavbar para el rol ADMIN) — mutuamente excluyente con naveId.
  const grupoId = useLocalStorageValue("tci_grupo_id");

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
    }

    // Un solo aviso al final: los tres valores se releen de localStorage.
    notifyLocalStorageChange();
  };

  return {
    empresaId,
    naveId,
    grupoId,
    setTenant
  };
}
