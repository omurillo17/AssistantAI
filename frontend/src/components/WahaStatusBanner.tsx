"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export function WahaStatusBanner() {
  const [isOffline, setIsOffline] = useState(false);

  // Devuelve si WAHA está caído, para que quien la llama decida cada cuánto
  // volver a preguntar.
  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/waha-status");
      const data = await res.json();
      const caido = data.status === "offline";
      setIsOffline(caido);
      return caido;
    } catch {
      setIsOffline(true);
      return true;
    }
  }, []);

  // WAHA es un servicio externo: no hay LISTEN/NOTIFY del que colgarse, así que
  // aquí el sondeo se queda. Lo que cambia es el ritmo — mientras la conexión
  // está sana basta con mirar cada minuto, y solo cuando se cae se sondea
  // rápido, que es cuando de verdad importa enterarse de que ya volvió.
  useEffect(() => {
    let cancelado = false;
    let timer: ReturnType<typeof setTimeout>;

    const revisar = async () => {
      const caido = await checkStatus();
      if (cancelado) return;
      timer = setTimeout(revisar, caido ? 15000 : 60000);
    };
    revisar();

    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [checkStatus]);

  if (!isOffline) return null;

  return (
    <div className="bg-red-500 text-white px-4 py-3 shadow-md border-b-4 border-red-700 flex flex-col md:flex-row items-center justify-between z-50">
      <div className="flex items-center gap-3 mb-2 md:mb-0">
        <div className="bg-white/20 p-2 rounded-full animate-pulse">
          <AlertTriangle size={24} className="text-white" />
        </div>
        <div>
          <h3 className="font-bold text-lg leading-none mb-1">¡Alerta: Conexión con WhatsApp Perdida!</h3>
          <p className="text-red-100 text-sm">
            El servicio de WhatsApp está desconectado. No se pueden enviar ni recibir mensajes.
          </p>
        </div>
      </div>
      
      <button 
        onClick={checkStatus}
        className="flex items-center gap-2 bg-white text-red-600 px-4 py-2 rounded-lg font-bold text-sm hover:bg-red-50 transition-colors shadow-sm"
      >
        <RefreshCw size={16} />
        Reintentar Conexión
      </button>
    </div>
  );
}
