"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export function WahaStatusBanner() {
  const [isOffline, setIsOffline] = useState(false);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);

  const checkStatus = async () => {
    try {
      const res = await fetch("/api/waha-status");
      const data = await res.json();
      if (data.status === "offline") {
        setIsOffline(true);
      } else {
        setIsOffline(false);
      }
    } catch (error) {
      setIsOffline(true);
    }
    setLastCheck(new Date());
  };

  useEffect(() => {
    // Check immediately on mount
    checkStatus();
    
    // Then poll every 15 seconds
    const interval = setInterval(checkStatus, 15000);
    return () => clearInterval(interval);
  }, []);

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
            El servicio de WhatsApp (WAHA) está desconectado. No se pueden enviar ni recibir mensajes.
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
