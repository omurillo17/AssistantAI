"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useIsHydrated, useLocalStorageValue } from "@/hooks/useLocalStorageValue";

export default function Home() {
  const [noLeidos, setNoLeidos] = useState(0);
  const hidratado = useIsHydrated();
  const rolGuardado = useLocalStorageValue("tci_role");
  const empresaId = useLocalStorageValue("tci_empresa_id");
  // Mientras no hidrata no se puede leer el rol: se muestra el esqueleto.
  const loading = !hidratado;
  const role = rolGuardado || "USER";

  useEffect(() => {
    document.title = "Plataforma TCi";
    const query = empresaId ? `?empresa_id=${empresaId}` : "";

    // Cargar badge de chats activos con mensajes no leídos (excluyendo descartados)
    const cargarNoLeidos = async () => {
      try {
        const data = await (await fetch(`/api/db/mensajes${query}`)).json();
        if (Array.isArray(data)) {
          const chatsSinLeerActivos = data.filter((c: { mensajes_no_leidos?: number; estado?: string }) => {
            const hasUnread = (c.mensajes_no_leidos || 0) > 0;
            const isDescartado = c.estado === "RECHAZADO" || c.estado === "INACTIVO" || c.estado === "OTRA_CIUDAD";
            return hasUnread && !isDescartado;
          }).length;
          setNoLeidos(chatsSinLeerActivos);
        }
      } catch { }
    };
    cargarNoLeidos();
  }, [empresaId]);

  if (loading) return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500">Cargando...</div>;

  return (
    <div className="p-2 animate-fade-in">
      <div className="mb-6 flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-slate-800 mb-1">Panel de Control</h1>
          <p className="text-slate-500">Selecciona la aplicación a la que deseas ingresar</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* Dashboards */}
        <Link href="/dashboards" className="bg-primary rounded-lg relative overflow-hidden text-white shadow-sm hover:shadow-md transition-shadow block">
          <div className="p-5 relative z-10">
            <h3 className="text-3xl font-bold mb-1">Dashboards</h3>
            <p className="text-white/80 text-sm">Graficas visuales</p>
          </div>
          <div className="absolute top-4 right-4 text-black/10 text-6xl font-black">
            📊
          </div>
          <div className="bg-black/10 py-1.5 text-center text-sm font-semibold hover:bg-black/20 transition-colors">
            Ir al módulo <span className="ml-1">→</span>
          </div>
        </Link>

        {/* Mensajes */}
        <Link href="/mensajes" className="bg-success rounded-lg relative overflow-hidden text-white shadow-sm hover:shadow-md transition-shadow block">
          <div className="p-5 relative z-10">
            <h3 className="text-3xl font-bold mb-1 flex items-center gap-2">
              Mensajes
              {noLeidos > 0 && (
                <span className="bg-danger text-white text-xs px-2.5 py-0.5 rounded-full shadow-sm animate-pulse">
                  {noLeidos} {noLeidos === 1 ? "chat" : "chats"}
                </span>
              )}
            </h3>
            <p className="text-white/80 text-sm">Bandeja compartida IA</p>
          </div>
          <div className="absolute top-4 right-4 text-black/10 text-6xl font-black">
            💬
          </div>
          <div className="bg-black/10 py-1.5 text-center text-sm font-semibold hover:bg-black/20 transition-colors">
            Ir al módulo <span className="ml-1">→</span>
          </div>
        </Link>

        {/* Expedientes */}
        <Link href="/expedientes" className="bg-info rounded-lg relative overflow-hidden text-white shadow-sm hover:shadow-md transition-shadow block">
          <div className="p-5 relative z-10">
            <h3 className="text-3xl font-bold mb-1">Expedientes</h3>
            <p className="text-white/80 text-sm">Base de candidatos</p>
          </div>
          <div className="absolute top-4 right-4 text-black/10 text-6xl font-black">
            🗂️
          </div>
          <div className="bg-black/10 py-1.5 text-center text-sm font-semibold hover:bg-black/20 transition-colors">
            Ir al módulo <span className="ml-1">→</span>
          </div>
        </Link>

        {/* Vacantes */}
        <Link href="/vacantes" className="bg-secondary rounded-lg relative overflow-hidden text-white shadow-sm hover:shadow-md transition-shadow block">
          <div className="p-5 relative z-10">
            <h3 className="text-3xl font-bold mb-1">Vacantes</h3>
            <p className="text-white/80 text-sm">Control de plazas</p>
          </div>
          <div className="absolute top-4 right-4 text-black/10 text-6xl font-black">
            💼
          </div>
          <div className="bg-black/10 py-1.5 text-center text-sm font-semibold hover:bg-black/20 transition-colors">
            Ir al módulo <span className="ml-1">→</span>
          </div>
        </Link>

        {/* Calendario */}
        <Link href="/calendario" className="bg-indigo-500 rounded-lg relative overflow-hidden text-white shadow-sm hover:shadow-md transition-shadow block">
          <div className="p-5 relative z-10">
            <h3 className="text-3xl font-bold mb-1">Calendario</h3>
            <p className="text-white/80 text-sm">Vista de citas</p>
          </div>
          <div className="absolute top-4 right-4 text-black/10 text-6xl font-black">
            📅
          </div>
          <div className="bg-black/10 py-1.5 text-center text-sm font-semibold hover:bg-black/20 transition-colors">
            Ir al módulo <span className="ml-1">→</span>
          </div>
        </Link>
      </div>

      {(role === "ADMIN" || role === "ROOT") && (
        <>
          <h2 className="text-lg font-bold text-slate-700 mb-4 mt-8">Configuración y Administración</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Link href="/usuarios" className="bg-white p-5 rounded-lg border-t-4 border-indigo-500 shadow-sm hover:shadow text-slate-700 transition-all">
              <div className="flex items-center gap-3 mb-2">
                <div className="text-2xl">🔐</div>
                <h3 className="font-bold text-lg">Usuarios</h3>
              </div>
              <p className="text-sm text-slate-500">Gestión de accesos y contraseñas del portal web.</p>
            </Link>

            {role === "ROOT" && (
              <Link href="/saas" className="bg-white p-5 rounded-lg border-t-4 border-amber-500 shadow-sm hover:shadow text-slate-700 transition-all">
                <div className="flex items-center gap-3 mb-2">
                  <div className="text-2xl">🌐</div>
                  <h3 className="font-bold text-lg">SaaS Admin</h3>
                </div>
                <p className="text-sm text-slate-500">Administración de empresas, naves y grupos.</p>
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
}

