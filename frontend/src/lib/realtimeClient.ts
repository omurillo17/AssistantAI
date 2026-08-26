"use client";

import { useEffect, useRef } from "react";

export type RealtimeEvent = {
  tipo: "mensaje" | "bandeja" | "candidato" | "notificacion";
  telefono?: string;
  alerta?: boolean;
};

// ─── EventSource compartido ───────────────────────────────
// Varias piezas del CRM (bandeja, campana, expedientes, alertas de identidad)
// quieren enterarse de lo mismo. Si cada una abriera su propio EventSource
// serían 4 conexiones abiertas por pestaña, y el navegador solo permite ~6 por
// dominio sobre HTTP/1.1 — con dos pestañas del CRM abiertas se agotarían y
// las peticiones normales se quedarían encoladas. Así que hay una sola
// conexión por pestaña y aquí se reparte a quien se suscriba.

type Handler = (ev: RealtimeEvent) => void;

const handlers = new Set<Handler>();
let source: EventSource | null = null;

function abrir() {
  if (source || typeof window === "undefined") return;
  source = new EventSource("/api/db/mensajes/stream");
  source.onmessage = (ev) => {
    let data: RealtimeEvent;
    try {
      data = JSON.parse(ev.data);
    } catch {
      return; // evento no parseable, se ignora
    }
    // Una excepción en un suscriptor no debe dejar sin evento a los demás.
    handlers.forEach((h) => {
      try {
        h(data);
      } catch (err) {
        console.error("suscriptor realtime falló", err);
      }
    });
  };
  // El navegador reconecta solo tras un error; no se cierra la conexión aquí
  // para no quedarse sin push si el corte fue momentáneo.
}

function cerrarSiSobra() {
  if (handlers.size === 0 && source) {
    source.close();
    source = null;
  }
}

export function suscribirRealtime(handler: Handler): () => void {
  handlers.add(handler);
  abrir();
  return () => {
    handlers.delete(handler);
    cerrarSiSobra();
  };
}

/**
 * Suscribe el componente al stream compartido. El handler se guarda en una ref
 * para que no haga falta memoizarlo en cada componente que lo use: la
 * suscripción se monta una vez y no se recrea en cada render.
 */
export function useRealtime(handler: Handler) {
  const ref = useRef(handler);

  // La ref se actualiza en un efecto, no durante el render: escribirla en el
  // cuerpo del componente es justo lo que React desaconseja (y lo que marca
  // react-hooks/refs).
  useEffect(() => {
    ref.current = handler;
  });

  useEffect(() => {
    return suscribirRealtime((ev) => ref.current(ev));
  }, []);
}
