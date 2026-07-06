"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [noLeidos, setNoLeidos] = useState(0);

  useEffect(() => {
    document.title = "Plataforma TCi";
    const auth = localStorage.getItem("tci_authenticated");
    if (!auth) {
      router.push("/login");
    } else {
      setLoading(false);
      // Cargar badge de mensajes no leídos
      fetch("/api/db/mensajes")
        .then(r => r.json())
        .then(data => {
          if (Array.isArray(data)) {
            const total = data.reduce((acc: number, c: any) => acc + (c.mensajes_no_leidos || 0), 0);
            setNoLeidos(total);
          }
        })
        .catch(() => {});
    }
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem("tci_authenticated");
    router.push("/login");
  };

  if (loading) return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500">Cargando...</div>;

  return (
    <div className="p-2 animate-fade-in">
      <div className="mb-6 flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-slate-800 mb-1">Panel de Control</h1>
          <p className="text-slate-500">Selecciona la aplicación a la que deseas ingresar</p>
        </div>
        <button
          onClick={handleLogout}
          className="px-4 py-2 bg-white text-danger font-bold rounded shadow-sm border border-slate-200 hover:bg-slate-50 transition-colors text-sm"
        >
          Cerrar Sesión
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* CRM */}
        <Link href="/crm" className="bg-primary rounded-lg relative overflow-hidden text-white shadow-sm hover:shadow-md transition-shadow block">
          <div className="p-5 relative z-10">
            <h3 className="text-3xl font-bold mb-1">CRM</h3>
            <p className="text-white/80 text-sm">Flujo de reclutamiento</p>
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
                <span className="bg-danger text-white text-[10px] px-2 py-0.5 rounded-full shadow-sm animate-pulse">
                  {noLeidos} nuevos
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
        <Link href="/candidatos" className="bg-info rounded-lg relative overflow-hidden text-white shadow-sm hover:shadow-md transition-shadow block">
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
      </div>

      <h2 className="text-lg font-bold text-slate-700 mb-4 mt-8">Configuración y Reportes</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link href="/reclutadores" className="bg-white p-5 rounded-lg border-t-4 border-primary shadow-sm hover:shadow text-slate-700 transition-all">
          <div className="flex items-center gap-3 mb-2">
            <div className="text-2xl">👥</div>
            <h3 className="font-bold text-lg">Reclutadores</h3>
          </div>
          <p className="text-sm text-slate-500">Altas, bajas y edición de información de ejecutivos.</p>
        </Link>

        <Link href="/calendario" className="bg-white p-5 rounded-lg border-t-4 border-info shadow-sm hover:shadow text-slate-700 transition-all">
          <div className="flex items-center gap-3 mb-2">
            <div className="text-2xl">📅</div>
            <h3 className="font-bold text-lg">Calendario</h3>
          </div>
          <p className="text-sm text-slate-500">Vista completa de citas agendadas por la IA.</p>
        </Link>

        <Link href="/configuracion" className="bg-white p-5 rounded-lg border-t-4 border-secondary shadow-sm hover:shadow text-slate-700 transition-all">
          <div className="flex items-center gap-3 mb-2">
            <div className="text-2xl">⚙️</div>
            <h3 className="font-bold text-lg">Configuración IA</h3>
          </div>
          <p className="text-sm text-slate-500">Gestión de Prompts y personalidad del bot.</p>
        </Link>
      </div>
    </div>
  );
}

