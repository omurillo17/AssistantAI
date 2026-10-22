"use client";

import { useEffect, useState } from "react";
import { registrarEstadosPersonalizados, type EstadoPersonalizado } from "@/lib/estados";

/**
 * Carga los estados personalizados de la empresa y los registra en el
 * catálogo de lib/estados. El componente que lo usa se vuelve a pintar al
 * terminar, así que getEstado() ya devuelve sus nombres y colores.
 */
export function useEstadosPersonalizados(): EstadoPersonalizado[] {
  const [estados, setEstados] = useState<EstadoPersonalizado[]>([]);

  useEffect(() => {
    const empresa = localStorage.getItem("tci_empresa_id");
    fetch(`/api/db/estados-personalizados${empresa ? `?empresa_id=${empresa}` : ""}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((lista: EstadoPersonalizado[]) => {
        registrarEstadosPersonalizados(lista);
        setEstados(lista);
      })
      .catch(() => {});
  }, []);

  return estados;
}
