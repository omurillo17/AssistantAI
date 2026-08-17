import { useRef } from "react";
import type { MouseEvent } from "react";

/**
 * Cierra un modal al hacer click en su backdrop, sin dispararse cuando el
 * mousedown empieza dentro del modal y el mouseup termina fuera de él (p.ej.
 * seleccionar texto y soltar el mouse afuera). Se rastrea el mousedown en un
 * ref en vez de con onClick porque onClick por sí solo no distingue ese caso.
 */
export function useBackdropClose(onClose: () => void) {
  const isBackdropMouseDown = useRef(false);

  return {
    onMouseDown: (e: MouseEvent<HTMLElement>) => {
      isBackdropMouseDown.current = e.target === e.currentTarget;
    },
    onMouseUp: (e: MouseEvent<HTMLElement>) => {
      if (isBackdropMouseDown.current && e.target === e.currentTarget) {
        onClose();
      }
      isBackdropMouseDown.current = false;
    },
  };
}
