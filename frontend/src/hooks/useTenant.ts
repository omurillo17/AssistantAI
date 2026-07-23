"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";

export function useTenant() {
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [naveId, setNaveId] = useState<string | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    // Escuchar cambios personalizados o locales en tci_empresa_id y tci_nave_id
    const eId = localStorage.getItem("tci_empresa_id");
    const nId = localStorage.getItem("tci_nave_id");
    setEmpresaId(eId);
    setNaveId(nId);

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "tci_empresa_id") {
        setEmpresaId(e.newValue);
      }
      if (e.key === "tci_nave_id") {
        setNaveId(e.newValue);
      }
    };
    
    const handleCustomChange = () => {
      setEmpresaId(localStorage.getItem("tci_empresa_id"));
      setNaveId(localStorage.getItem("tci_nave_id"));
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("tci_tenant_changed", handleCustomChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("tci_tenant_changed", handleCustomChange);
    };
  }, [pathname]);

  const setTenant = (empId: string | null, nvId: string | null = null) => {
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

    setEmpresaId(empId);
    setNaveId(nvId);
    window.dispatchEvent(new Event("tci_tenant_changed"));
  };

  return {
    empresaId,
    naveId,
    setTenant
  };
}
