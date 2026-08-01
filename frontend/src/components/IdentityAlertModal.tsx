"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

type AlertaIdentidad = {
  telefono: string;
  nombre_ine: string | null;
  curp_ine: string | null;
  nombre_constancia: string | null;
  curp_rfc: string | null;
  vacante_interes: string | null;
  alerta_identidad_motivo: string | null;
};

export function IdentityAlertModal() {
  const pathname = usePathname();
  const [alertas, setAlertas] = useState<AlertaIdentidad[]>([]);
  const [cerradas, setCerradas] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);

  const fetchAlertas = async () => {
    try {
      const res = await fetch("/api/db/alertas-identidad");
      if (res.ok) {
        const data = await res.json();
        setAlertas(data.items || []);
      }
    } catch {
      // silencioso, se reintenta en el siguiente ciclo
    }
  };

  useEffect(() => {
    fetchAlertas();
    const interval = setInterval(fetchAlertas, 10000);

    const handleOpenEvent = (e: any) => {
      if (e.detail?.telefono) {
        setCerradas((prev) => prev.filter((t) => t !== e.detail.telefono));
      } else {
        setCerradas([]);
      }
      fetchAlertas();
    };

    window.addEventListener("open-identity-modal", handleOpenEvent);
    return () => {
      clearInterval(interval);
      window.removeEventListener("open-identity-modal", handleOpenEvent);
    };
  }, []);

  if (pathname === "/login") return null;

  // Un candidato "cerrado" (resuelto o pospuesto con "Revisar después") no vuelve
  // a interrumpir hasta que el siguiente poll traiga una alerta genuinamente nueva.
  const pendientes = alertas.filter((a) => !cerradas.includes(a.telefono));
  const actual = pendientes[0];
  if (!actual) return null;

  const cerrar = (telefono: string) => {
    setCerradas((prev) => [...prev, telefono]);
  };

  const resolver = async (decision: "validar" | "no_validar") => {
    setProcessing(true);
    try {
      await fetch("/api/db/candidato/validar-identidad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono: actual.telefono, decision }),
      });
      cerrar(actual.telefono);
      fetchAlertas();
    } catch (e) {
      console.error("Error resolviendo alerta de identidad:", e);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden border-4 border-red-500">
        <div className="bg-red-600 text-white px-5 py-4 flex items-center gap-3">
          <AlertTriangle size={24} className="shrink-0 animate-pulse" />
          <div>
            <h2 className="font-bold text-lg leading-tight">Verificación de identidad requerida</h2>
            <p className="text-red-100 text-xs">
              {pendientes.length > 1 ? `${pendientes.length} candidatos pendientes de revisión` : "Un candidato necesita revisión"}
            </p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-sm text-slate-600">
            <span className="font-semibold">Tel:</span> wa.me/{actual.telefono}
            {" · "}
            <span className="font-semibold">Vacante:</span> {actual.vacante_interes || "General"}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 rounded-xl border border-violet-200 bg-violet-50">
              <div className="text-xs font-bold text-violet-800 mb-1">INE</div>
              <div className="text-sm text-violet-700"><span className="font-semibold">Nombre:</span> {actual.nombre_ine || "—"}</div>
              <div className="text-sm text-violet-700 break-all"><span className="font-semibold">CURP:</span> {actual.curp_ine || "—"}</div>
            </div>
            <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50">
              <div className="text-xs font-bold text-emerald-800 mb-1">RFC / CSF</div>
              <div className="text-sm text-emerald-700"><span className="font-semibold">Nombre:</span> {actual.nombre_constancia || "—"}</div>
              <div className="text-sm text-emerald-700 break-all"><span className="font-semibold">CURP:</span> {actual.curp_rfc || "—"}</div>
            </div>
          </div>

          {actual.alerta_identidad_motivo && (
            <div className="text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-lg p-3">
              {actual.alerta_identidad_motivo}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <button
              disabled={processing}
              onClick={() => resolver("validar")}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg transition-colors"
            >
              Validar
            </button>
            <button
              disabled={processing}
              onClick={() => resolver("no_validar")}
              className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg transition-colors"
            >
              No validar
            </button>
          </div>
          <button
            disabled={processing}
            onClick={() => cerrar(actual.telefono)}
            className="w-full text-center text-xs text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50"
          >
            Revisar después
          </button>
        </div>
      </div>
    </div>
  );
}
