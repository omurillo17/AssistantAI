"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useLocalStorageValue } from "@/hooks/useLocalStorageValue";
import {
  Home,
  MessageSquare,
  Briefcase,
  Users,
  Calendar,
  FolderOpen,
  ChevronLeft,
  ChevronRight,
  Activity,
  GraduationCap,
  X
} from "lucide-react";

interface SidebarProps {
  mobileOpen?: boolean;
  setMobileOpen?: (open: boolean) => void;
}

export function Sidebar({ mobileOpen = false, setMobileOpen }: SidebarProps) {
  const pathname = usePathname();
  const [isExpanded, setIsExpanded] = useState(false);
  const userRole = useLocalStorageValue("tci_role") || "";

  // Ocultar sidebar en la página de login
  if (pathname === "/login") return null;

  const menu = [
    { name: "Inicio", path: "/", icon: <Home size={18} /> },
    { name: "Dashboards", path: "/dashboards", icon: <Activity size={18} /> },
    { name: "Expedientes", path: "/expedientes", icon: <FolderOpen size={18} /> },
    { name: "Mensajes", path: "/mensajes", icon: <MessageSquare size={18} /> },
    { name: "Vacantes", path: "/vacantes", icon: <Briefcase size={18} /> },
    { name: "Calendario", path: "/calendario", icon: <Calendar size={18} /> },
    { name: "Capacitación", path: "/capacitacion", icon: <GraduationCap size={18} /> },
  ];

  if (userRole === "ROOT" || userRole === "ADMIN" || userRole === "ENCARGADO") {
    menu.push({ name: "Usuarios", path: "/usuarios", icon: <Users size={18} /> });
  }

  if (userRole === "ROOT") {
    // Add a glowing / premium icon effect for SaaS Admin
    menu.push({ name: "SaaS Admin", path: "/saas", icon: <Briefcase size={18} className="text-amber-500" /> });
  }

  const handleLinkClick = () => {
    if (setMobileOpen) setMobileOpen(false);
  };

  return (
    <>
      {/* ─── DESKTOP SIDEBAR (md y superior) ─── */}
      <aside className={`hidden md:flex ${isExpanded ? "w-64" : "w-[72px]"} bg-white border-r border-slate-200 flex-col flex-shrink-0 h-screen sticky top-0 transition-all duration-300 z-50 relative`}>
        {/* Botón de colapsar/expandir */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="absolute -right-3 top-6 bg-white border border-slate-200 rounded-full p-1 text-primary hover:text-primary/80 shadow-sm z-10"
          aria-label={isExpanded ? "Colapsar menú" : "Expandir menú"}
        >
          {isExpanded ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </button>

        {/* Header del Sidebar */}
        <div className={`h-16 flex items-center ${isExpanded ? "px-6" : "px-0 justify-center"} border-b border-slate-100 overflow-hidden flex-shrink-0`}>
          {isExpanded ? (
            <div className="text-xl font-extrabold text-primary whitespace-nowrap tracking-wide">
              TCi Reclutamiento
            </div>
          ) : (
            <div className="text-xl font-extrabold text-primary">
              TCi
            </div>
          )}
        </div>

        {/* Navegación */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 flex flex-col gap-1">
          {menu.map((item) => {
            const isActive =
              item.path === "/" ? pathname === "/" : pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                href={item.path}
                title={!isExpanded ? item.name : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium transition-colors text-sm mb-1 ${isActive
                  ? "bg-primary text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  } ${!isExpanded && "justify-center"}`}
              >
                <div className={`${isActive ? "text-white" : "text-slate-400"} flex-shrink-0`}>
                  {item.icon}
                </div>
                {isExpanded && <span className="whitespace-nowrap">{item.name}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Footer del Sidebar */}
        {isExpanded && (
          <div className="p-4 border-t border-slate-100 text-xs text-slate-400 text-center whitespace-nowrap">
            Versión 1.0.0
          </div>
        )}
      </aside>

      {/* ─── MOBILE DRAWER (pantallas pequeñas < md) ─── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          {/* Backdrop oscuro */}
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity animate-fade-in"
            onClick={() => setMobileOpen?.(false)}
          />

          {/* Drawer contenedor */}
          <aside className="relative w-72 max-w-[80vw] bg-white h-full flex flex-col shadow-2xl z-50 animate-in slide-in-from-left duration-200">
            <div className="h-16 flex items-center justify-between px-5 border-b border-slate-100 flex-shrink-0 bg-slate-50/50">
              <div className="text-lg font-extrabold text-primary tracking-wide">
                TCi Reclutamiento
              </div>
              <button
                onClick={() => setMobileOpen?.(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
                aria-label="Cerrar menú"
              >
                <X size={20} />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto py-4 px-3 flex flex-col gap-1">
              {menu.map((item) => {
                const isActive =
                  item.path === "/" ? pathname === "/" : pathname.startsWith(item.path);
                return (
                  <Link
                    key={item.path}
                    href={item.path}
                    onClick={handleLinkClick}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors text-sm ${isActive
                      ? "bg-primary text-white shadow-sm font-bold"
                      : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                      }`}
                  >
                    <div className={`${isActive ? "text-white" : "text-slate-500"} flex-shrink-0`}>
                      {item.icon}
                    </div>
                    <span>{item.name}</span>
                  </Link>
                );
              })}
            </nav>

            <div className="p-4 border-t border-slate-100 text-xs text-slate-400 text-center bg-slate-50/50">
              Plataforma TCi · Versión 1.0.0
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
