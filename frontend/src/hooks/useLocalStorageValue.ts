"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Evento propio para avisar de escrituras a localStorage hechas en ESTA pestaña.
 * El evento nativo "storage" solo lo reciben las OTRAS pestañas, así que sin
 * este los selectores del TopNavbar no refrescarían la vista actual.
 */
export const LOCAL_STORAGE_EVENT = "tci_tenant_changed";

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(LOCAL_STORAGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(LOCAL_STORAGE_EVENT, onStoreChange);
  };
}

/**
 * Lee una clave de localStorage como estado reactivo.
 *
 * localStorage es un store externo al árbol de React, así que la forma correcta
 * de consumirlo es useSyncExternalStore y no `useState` + `useEffect`: el
 * tercer argumento (snapshot de servidor) devuelve null durante el prerender de
 * Next.js, donde `localStorage` no existe, y React re-renderiza con el valor
 * real al hidratar. Eso evita tanto el mismatch de hidratación como el
 * setState dentro de un efecto (react-hooks/set-state-in-effect).
 */
export function useLocalStorageValue(key: string): string | null {
  const getSnapshot = useCallback(() => localStorage.getItem(key), [key]);
  const getServerSnapshot = useCallback(() => null, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Notifica a los hooks de esta pestaña que localStorage cambió. */
export function notifyLocalStorageChange() {
  window.dispatchEvent(new Event(LOCAL_STORAGE_EVENT));
}

const noSubscribe = () => () => {};

/**
 * `false` durante el prerender y el primer render del cliente; `true` a partir
 * de la hidratación.
 *
 * Hace falta porque useLocalStorageValue devuelve null tanto cuando la clave no
 * existe como cuando todavía no hidrata, y hay pantallas que necesitan
 * distinguirlo (mostrar "cargando" vs. "no autorizado").
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(noSubscribe, () => true, () => false);
}
