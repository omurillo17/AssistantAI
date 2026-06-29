"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Plataforma TCi";
    const auth = localStorage.getItem("tci_authenticated");
    if (!auth) {
      router.push("/login");
    } else {
      setLoading(false);
    }
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem("tci_authenticated");
    router.push("/login");
  };

  if (loading) return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500">Cargando...</div>;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6 relative">
      <button
        onClick={handleLogout}
        className="absolute top-6 right-6 px-4 py-2 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-lg shadow-sm transition-colors text-sm"
      >
        Cerrar Sesión
      </button>

      <div className="text-center mb-10">
        <h1 className="text-4xl font-extrabold bg-gradient-to-br from-cyan-500 to-amber-500 bg-clip-text text-transparent mb-4">
          Plataforma TCi
        </h1>
        <p className="text-slate-500 text-lg">Selecciona la aplicación a la que deseas ingresar</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-6 w-full max-w-4xl">
        <Link
          href="/crm"
          className="flex-1 bg-white p-8 rounded-2xl shadow-sm border border-black/10 hover:shadow-lg hover:border-cyan-500 hover:-translate-y-1 transition-all group text-center"
        >
          <div className="text-5xl mb-4 group-hover:scale-110 transition-transform">📊</div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">CRM Candidatos</h2>
          <p className="text-slate-500 text-sm">Gestiona el flujo de reclutamiento (Kanban) y chatea con candidatos.</p>
        </Link>

        <Link
          href="/vacantes"
          className="flex-1 bg-white p-8 rounded-2xl shadow-sm border border-black/10 hover:shadow-lg hover:border-amber-500 hover:-translate-y-1 transition-all group text-center"
        >
          <div className="text-5xl mb-4 group-hover:scale-110 transition-transform">💼</div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Panel de Vacantes</h2>
          <p className="text-slate-500 text-sm">Administra las vacantes activas de los reclutadores y naves.</p>
        </Link>

        <Link
          href="/reclutadores"
          className="flex-1 bg-white p-8 rounded-2xl shadow-sm border border-black/10 hover:shadow-lg hover:border-indigo-500 hover:-translate-y-1 transition-all group text-center"
        >
          <div className="text-5xl mb-4 group-hover:scale-110 transition-transform">👥</div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Reclutadores</h2>
          <p className="text-slate-500 text-sm">Altas, bajas y edición de información de los ejecutivos.</p>
        </Link>
      </div>
    </div>
  );
}
