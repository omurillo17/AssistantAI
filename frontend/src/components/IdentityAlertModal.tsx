"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { proxyMediaUrl } from "@/lib/formatters";

type AlertaIdentidad = {
  telefono: string;
  nombre_ine: string | null;
  curp_ine: string | null;
  nombre_constancia: string | null;
  curp_rfc: string | null;
  vacante_interes: string | null;
  alerta_identidad_motivo: string | null;
  datos_ine?: any;
  datos_rfc?: any;
  link_ine?: string | null;
  link_csf?: string | null;
  link_rfc?: string | null;
};

export function IdentityAlertModal() {
  const pathname = usePathname();
  const [alertas, setAlertas] = useState<AlertaIdentidad[]>([]);
  const [cerradas, setCerradas] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);

  const fetchAlertas = useCallback(async () => {
    try {
      const res = await fetch("/api/db/alertas-identidad");
      if (res.ok) {
        const data = await res.json();
        setAlertas(data.items || []);
      }
    } catch {
      // silencioso, se reintenta en el siguiente ciclo
    }
  }, []);

  useEffect(() => {
    const cargar = async () => { await fetchAlertas(); };
    cargar();
    const interval = setInterval(cargar, 10000);

    const handleOpenEvent = (e: Event) => {
      const telefono = (e as CustomEvent<{ telefono?: string }>).detail?.telefono;
      if (telefono) {
        setCerradas((prev) => prev.filter((t) => t !== telefono));
      } else {
        setCerradas([]);
      }
      cargar();
    };

    window.addEventListener("open-identity-modal", handleOpenEvent);
    return () => {
      clearInterval(interval);
      window.removeEventListener("open-identity-modal", handleOpenEvent);
    };
  }, [fetchAlertas]);

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

  const ineData = typeof actual.datos_ine === 'string' ? (() => { try { return JSON.parse(actual.datos_ine); } catch { return null; } })() : actual.datos_ine;
  const csfData = typeof actual.datos_rfc === 'string' ? (() => { try { return JSON.parse(actual.datos_rfc); } catch { return null; } })() : actual.datos_rfc;

  const ineUrls: string[] = [];
  if (Array.isArray(ineData?.urls)) {
    ineData.urls.forEach((u: string) => {
      const p = proxyMediaUrl(u);
      if (p && !ineUrls.includes(p)) ineUrls.push(p);
    });
  }
  const defaultIne = proxyMediaUrl(ineData?.url || ineData?.link || actual.link_ine);
  if (defaultIne && !ineUrls.includes(defaultIne)) ineUrls.unshift(defaultIne);
  if (ineData?.url_reverso) {
    const rev = proxyMediaUrl(ineData.url_reverso);
    if (rev && !ineUrls.includes(rev)) ineUrls.push(rev);
  }

  const csfUrls: string[] = [];
  if (Array.isArray(csfData?.urls)) {
    csfData.urls.forEach((u: string) => {
      const p = proxyMediaUrl(u);
      if (p && !csfUrls.includes(p)) csfUrls.push(p);
    });
  }
  const defaultCsf = proxyMediaUrl(csfData?.url || csfData?.link || actual.link_csf || actual.link_rfc);
  if (defaultCsf && !csfUrls.includes(defaultCsf)) csfUrls.unshift(defaultCsf);

  const ineUrl = ineUrls[0] || null;
  const csfUrl = csfUrls[0] || null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden border-4 border-red-500">
        <div className="bg-red-600 text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle size={24} className="shrink-0 animate-pulse" />
            <div>
              <h2 className="font-bold text-lg leading-tight">Verificación de identidad requerida</h2>
              <p className="text-red-100 text-xs">
                {pendientes.length > 1 ? `${pendientes.length} candidatos pendientes de revisión` : "Un candidato necesita revisión"}
              </p>
            </div>
          </div>
          {(ineUrls.length > 0 || csfUrls.length > 0) && (
            <button
              onClick={() => {
                [...ineUrls, ...csfUrls].forEach((u) => window.open(u, "_blank", "noopener,noreferrer"));
              }}
              className="text-xs font-bold bg-white text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors shadow-xs shrink-0"
            >
              Abrir docs en nuevas pestañas ↗
            </button>
          )}
        </div>

        <div className="p-5 space-y-4">
          <div className="text-sm text-slate-600">
            <span className="font-semibold">Tel:</span> wa.me/{actual.telefono}
            {" · "}
            <span className="font-semibold">Vacante:</span> {actual.vacante_interes || "General"}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-4 rounded-xl border border-violet-200 bg-violet-50/80 flex flex-col items-start gap-3">
              <div className="text-xs font-bold text-violet-800">🪪 Documento INE {ineUrls.length > 1 && `(${ineUrls.length} fotos)`}</div>
              {ineUrls.length > 0 ? (
                <div className="flex flex-col gap-2 w-full">
                  {ineUrls.map((u, idx) => (
                    <a
                      key={idx}
                      href={u}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs rounded-lg transition-colors shadow-2xs"
                    >
                      {ineUrls.length > 1 ? (idx === 0 ? "Ver INE (Frente) ↗" : `Ver INE (Reverso/Pág ${idx + 1}) ↗`) : "Abrir INE en nueva pestaña ↗"}
                    </a>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-slate-400 font-medium">Documento INE no adjuntado aún</span>
              )}
            </div>

            <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/80 flex flex-col items-start gap-3">
              <div className="text-xs font-bold text-emerald-800">📋 Constancia Fiscal (CSF / RFC) {csfUrls.length > 1 && `(${csfUrls.length} docs)`}</div>
              {csfUrls.length > 0 ? (
                <div className="flex flex-col gap-2 w-full">
                  {csfUrls.map((u, idx) => (
                    <a
                      key={idx}
                      href={u}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg transition-colors shadow-2xs"
                    >
                      {csfUrls.length > 1 ? `Ver Constancia (Pág ${idx + 1}) ↗` : "Abrir Constancia (CSF) en nueva pestaña ↗"}
                    </a>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-slate-400 font-medium">Constancia CSF no adjuntada aún</span>
              )}
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
