"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Home,
  Kanban,
  MessageSquare,
  Briefcase,
  Users,
  Calendar,
  Settings,
  FolderOpen,
  ChevronLeft,
  ChevronRight
} from "lucide-react";

export function Sidebar() {
  const pathname = usePathname();
  const [isExpanded, setIsExpanded] = useState(false);

  // Ocultar sidebar en la página de login
  if (pathname === "/login") return null;

  const menu = [
    { name: "Inicio", path: "/", icon: <Home size={18} /> },
    { name: "Dashboards", path: "/dashboards", icon: <Kanban size={18} /> },
    { name: "Mensajes", path: "/mensajes", icon: <MessageSquare size={18} /> },
    { name: "Vacantes", path: "/vacantes", icon: <Briefcase size={18} /> },
    { name: "Calendario", path: "/calendario", icon: <Calendar size={18} /> },
    { name: "Configuración", path: "/configuracion", icon: <Settings size={18} /> },
  ];

  return (
    <aside className={`${isExpanded ? "w-64" : "w-[72px]"} bg-white border-r border-slate-200 flex flex-col flex-shrink-0 h-screen sticky top-0 transition-all duration-300 z-50 relative`}>
      {/* Botón de colapsar/expandir */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="absolute -right-3 top-6 bg-white border border-slate-200 rounded-full p-1 text-primary hover:text-primary/80 shadow-sm z-10"
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
          const isActive = pathname === item.path;
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
  );
}
