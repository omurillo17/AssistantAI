"use client";

import { usePathname, useRouter } from "next/navigation";
import { useRealtime } from "@/lib/realtimeClient";
import { Bell, UserCircle, Building2, ChevronDown, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, useRef } from "react";
import { useTenant } from "@/hooks/useTenant";
import { useLocalStorageValue } from "@/hooks/useLocalStorageValue";
import ChangePasswordModal from "@/components/usuarios/ChangePasswordModal";

export function TopNavbar() {
  const pathname = usePathname();
  const router = useRouter();

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const username = useLocalStorageValue("tci_username") || "Usuario";
  const role = useLocalStorageValue("tci_role") || "USER";
  
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const empresaMenuRef = useRef<HTMLDivElement>(null);

  const { empresaId, naveId, grupoId, setTenant } = useTenant();
  const [empresas, setEmpresas] = useState<any[]>([]);
  const [isEmpresaMenuOpen, setIsEmpresaMenuOpen] = useState(false);
  // Solo para ADMIN: alterna entre filtrar por Nave o por Grupo de reclutamiento.
  const [filterMode, setFilterMode] = useState<"nave" | "grupo">("nave");

  useEffect(() => {


    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setIsNotifOpen(false);
      }
      if (empresaMenuRef.current && !empresaMenuRef.current.contains(event.target as Node)) {
        setIsEmpresaMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [pathname, router]);

  useEffect(() => {
    fetch("/api/db/empresas")
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          let fetchedEmpresas = data.empresas || [];

          try {
            const navesAsignadasStr = localStorage.getItem("tci_naves_asignadas");
            if (role !== "ROOT" && role !== "ADMIN") {
              const allowedNaves = JSON.parse(navesAsignadasStr || "[]");
              fetchedEmpresas = fetchedEmpresas.map((emp: any) => ({
                ...emp,
                naves: emp.naves ? emp.naves.filter((n: any) => allowedNaves.includes(n.id)) : []
              })).filter((emp: any) => emp.naves.length > 0);
            }
          } catch {}

          setEmpresas(fetchedEmpresas);
        }
      })
      .catch(e => console.error(e));
  }, [role]);

  const fetchNotifs = useCallback(async () => {
    try {
      const res = await fetch("/api/db/notificaciones");
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.unread || 0);
        setNotifications(data.items || []);
      }
    } catch {}
  }, []);

  // La campana se actualiza por push (canal notificacion_change). El intervalo
  // que queda es solo la red de seguridad por si el SSE se cae en silencio
  // detrás de un proxy: antes sondeaba cada 10s aunque no hubiera nada nuevo.
  useEffect(() => {
    const cargar = async () => { await fetchNotifs(); };
    cargar();
    const interval = setInterval(cargar, 120000);
    // El modal de identidad emite este evento al cerrarse: la alerta que dejó
    // de interrumpir tiene que aparecer en la campana en ese momento.
    window.addEventListener("refrescar-notificaciones", cargar);
    return () => {
      clearInterval(interval);
      window.removeEventListener("refrescar-notificaciones", cargar);
    };
  }, [fetchNotifs]);

  useRealtime((ev) => {
    if (ev.tipo === "notificacion") fetchNotifs();
  });

  const markAllAsRead = async () => {
    setUnreadCount(0);
    setNotifications(prev => prev.map(n => ({ ...n, leida: true })));
    try {
      await fetch("/api/db/notificaciones", { method: "PATCH", body: JSON.stringify({}) });
    } catch {}
  };

  const deleteNotif = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`/api/db/notificaciones?id=${id}`, { method: "DELETE" });
      setNotifications(prev => {
        const next = prev.filter(n => n.id !== id);
        const unread = next.filter(n => !n.leida).length;
        setUnreadCount(unread);
        return next;
      });
    } catch (err) {
      console.error("Error deleting notification:", err);
    }
  };

  const clearAllNotifs = async () => {
    try {
      await fetch("/api/db/notificaciones", { method: "DELETE" });
      setNotifications([]);
      setUnreadCount(0);
    } catch (err) {
      console.error("Error clearing notifications:", err);
    }
  };

  const handleNotifClick = (n: any) => {
    setIsNotifOpen(false);
    
    // Mark single notification as read immediately
    if (!n.leida) {
      setNotifications(prev => prev.map(item => item.id === n.id ? { ...item, leida: true } : item));
      setUnreadCount(prev => Math.max(0, prev - 1));
      fetch("/api/db/notificaciones", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: n.id }),
      }).catch(() => {});
    }

    // Extract phone if available in message (e.g. wa.me/521... or 10-13 digits)
    const phoneMatch = n.mensaje?.match(/(?:wa\.me\/|tel:|phone:)?(\d{10,13})/i);
    const telefono = phoneMatch ? phoneMatch[1] : null;

    if (n.mensaje?.toLowerCase().includes("verificación") || n.mensaje?.toLowerCase().includes("identidad") || n.mensaje?.toLowerCase().includes("ocr")) {
      window.dispatchEvent(new CustomEvent("open-identity-modal", { detail: { telefono } }));
    }

    if (telefono) {
      router.push(`/expedientes?telefono=${telefono}`);
    }
  };

  const toggleNotifs = () => {
    const nextState = !isNotifOpen;
    setIsNotifOpen(nextState);
    if (nextState && unreadCount > 0) {
      markAllAsRead();
    }
  };

  if (pathname === "/login") return null;

  const handleLogout = () => {
    localStorage.removeItem("tci_username");
    localStorage.removeItem("tci_login");
    localStorage.removeItem("tci_role");
    localStorage.removeItem("tci_reclutador_id");
    localStorage.removeItem("tci_naves_asignadas");
    localStorage.removeItem("tci_grupo_id");
    localStorage.removeItem("tci_empresa_id");

    // In a real app we might also need to hit a logout API to clear the HttpOnly cookie, 
    // but for now deleting the cookie in JS or redirecting to a logout route is best.
    // For now we just clear the flags and Nextjs proxy will redirect if cookie is missing/invalid.
    // We can just set the cookie to expire.
    document.cookie = "tci_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";

    router.push("/login");
  };

  // Mapear rutas a títulos
  const getTitle = () => {
    if (pathname.startsWith("/mensajes")) return "Bandeja de Mensajes";
    if (pathname.startsWith("/crm")) return "CRM Reclutamiento";
    if (pathname.startsWith("/vacantes")) return "Gestión de Vacantes";
    if (pathname.startsWith("/calendario")) return "Calendario de Entrevistas";
    if (pathname.startsWith("/expedientes")) return "Expediente de Candidato";
    if (pathname.startsWith("/usuarios")) return "Gestión de Usuarios";
    if (pathname.startsWith("/capacitacion")) return "Centro de Capacitación";
    if (pathname.startsWith("/empresa")) return "Perfil de Empresa";
    if (pathname.startsWith("/reclutadores")) return "Reclutadores";
    return "Panel Principal";
  };

  const showBackButton = pathname !== "/";

  return (
    <nav className="h-16 bg-primary flex items-center justify-between px-6 shadow-sm z-40 sticky top-0 flex-shrink-0">
      {/* Title / Back Button */}
      <div className="flex items-center gap-4 text-white">
        {showBackButton && (
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 font-semibold rounded-lg transition-colors text-sm"
          >
            ⬅ Atrás
          </button>
        )}
        <h1 className="text-xl font-bold tracking-wide">
          {getTitle()}
        </h1>
      </div>

      {/* Right side items */}
      <div className="flex items-center gap-4 text-white">
        
        {/* Empresa Selector — oculto en Calendario: ahí no hay filtro manual de
            nave/grupo, cada quien ve automáticamente el calendario de su propio
            grupo (o todo, si no pertenece a ninguno). */}
        {!pathname.startsWith("/calendario") && (
          <div className="relative" ref={empresaMenuRef}>
            <button
              onClick={() => setIsEmpresaMenuOpen(!isEmpresaMenuOpen)}
              className={`flex items-center gap-2 py-1.5 px-3 rounded-lg transition-colors focus:outline-none border border-white/20 hover:bg-white/10 ${!empresaId ? 'bg-amber-500/20 text-amber-100 border-amber-500/50' : 'bg-white/5'}`}
            >
              <Building2 size={18} className={!empresaId ? 'text-amber-400' : ''} />
              <div className="text-sm font-semibold hidden md:block max-w-[150px] truncate">
                {grupoId
                  ? (empresas.flatMap(e => e.grupos || []).find((g: any) => g.id === grupoId)?.nombre || "Grupo Desconocido")
                  : naveId
                    ? (empresas.flatMap(e => e.naves || []).find(n => n.id === naveId)?.nombre || "Nave Desconocida")
                    : empresaId
                      ? (empresas.find(e => e.id === empresaId)?.nombre || "Empresa Desconocida")
                      : role === "ROOT" ? "Vista Global" : "Selecciona Empresa"}
              </div>
              <ChevronDown size={16} className="opacity-70" />
            </button>

            {isEmpresaMenuOpen && (
              <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-xl py-2 z-50 text-slate-800 border border-slate-100 max-h-96 overflow-y-auto">
                <div className="px-4 py-2 border-b border-slate-100 text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between gap-2">
                  <span>Seleccionar Vista</span>
                  {role === "ADMIN" && (
                    <div className="flex items-center bg-slate-100 rounded-lg p-0.5 text-[11px] font-bold normal-case">
                      <button
                        type="button"
                        onClick={() => setFilterMode("nave")}
                        className={`px-2 py-1 rounded-md transition-colors ${filterMode === "nave" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-400"}`}
                      >
                        Nave
                      </button>
                      <button
                        type="button"
                        onClick={() => setFilterMode("grupo")}
                        className={`px-2 py-1 rounded-md transition-colors ${filterMode === "grupo" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-400"}`}
                      >
                        Grupo
                      </button>
                    </div>
                  )}
                </div>

                {role === "ROOT" && (
                  <button
                    onClick={() => { setTenant(null, null, null); setIsEmpresaMenuOpen(false); }}
                    className={`block w-full text-left px-4 py-3 text-sm transition-colors border-b border-slate-50 hover:bg-slate-50 ${!empresaId && !naveId && !grupoId ? 'bg-indigo-50 font-bold text-indigo-700' : 'text-slate-700'}`}
                  >
                    <div className="flex items-center gap-2">
                      <Building2 size={16} />
                      <span>Todas las Empresas (Vista Global)</span>
                    </div>
                  </button>
                )}

                {empresas.map(emp => (
                  <div key={emp.id} className="border-b border-slate-50 last:border-0">
                    <button
                      onClick={() => { setTenant(emp.id, null, role === "ADMIN" ? null : undefined); setIsEmpresaMenuOpen(false); }}
                      className={`block w-full text-left px-4 py-3 text-sm transition-colors hover:bg-slate-50 ${empresaId === emp.id && !naveId && !grupoId ? 'bg-indigo-50 font-bold text-indigo-700' : 'text-slate-700'}`}
                    >
                      <div className="flex items-center gap-2">
                        <Building2 size={16} className={empresaId === emp.id && !naveId && !grupoId ? "text-indigo-600" : "text-slate-400"} />
                        <span className="truncate">{emp.nombre} (Todo)</span>
                      </div>
                    </button>
                    {role === "ADMIN" && filterMode === "grupo"
                      ? (emp.grupos || []).map((grupo: any) => (
                        <button
                          key={grupo.id}
                          onClick={() => { setTenant(emp.id, null, grupo.id); setIsEmpresaMenuOpen(false); }}
                          className={`block w-full text-left pl-8 pr-4 py-2 text-sm transition-colors hover:bg-slate-50 ${grupoId === grupo.id ? 'bg-indigo-50 font-bold text-indigo-700' : 'text-slate-600'}`}
                        >
                          <div className="flex items-center gap-2">
                            <div className={`w-1.5 h-1.5 rounded-full ${grupoId === grupo.id ? 'bg-indigo-600' : 'bg-slate-300'}`}></div>
                            <span className="truncate">{grupo.nombre}</span>
                          </div>
                        </button>
                      ))
                      : (emp.naves || []).map((nave: any) => (
                        <button
                          key={nave.id}
                          onClick={() => { setTenant(emp.id, nave.id, role === "ADMIN" ? null : undefined); setIsEmpresaMenuOpen(false); }}
                          className={`block w-full text-left pl-8 pr-4 py-2 text-sm transition-colors hover:bg-slate-50 ${naveId === nave.id ? 'bg-indigo-50 font-bold text-indigo-700' : 'text-slate-600'}`}
                        >
                          <div className="flex items-center gap-2">
                            <div className={`w-1.5 h-1.5 rounded-full ${naveId === nave.id ? 'bg-indigo-600' : 'bg-slate-300'}`}></div>
                            <span className="truncate">{nave.nombre}</span>
                          </div>
                        </button>
                      ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="w-px h-6 bg-white/20 hidden md:block"></div>

        <div className="relative" ref={notifRef}>
          <button 
            onClick={toggleNotifs}
            className="relative hover:text-white/80 transition-colors focus:outline-none"
          >
            <Bell size={20} />
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-secondary text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                {unreadCount}
              </span>
            )}
          </button>
          
          {isNotifOpen && (
            <div className="absolute right-0 mt-3 w-80 sm:w-96 bg-white rounded-xl shadow-xl py-2 z-50 text-slate-800 border border-slate-100 max-h-96 overflow-y-auto">
              <div className="px-4 py-2 border-b flex items-center justify-between font-bold text-sm">
                <span>Notificaciones</span>
                {notifications.length > 0 && (
                  <button 
                    onClick={clearAllNotifs}
                    className="text-xs font-semibold text-slate-400 hover:text-red-600 transition-colors"
                  >
                    Limpiar todas
                  </button>
                )}
              </div>
              {notifications.length === 0 ? (
                <div className="px-4 py-6 text-sm text-slate-400 text-center">No tienes notificaciones</div>
              ) : (
                notifications.map(n => (
                  <div 
                    key={n.id} 
                    onClick={() => handleNotifClick(n)}
                    className={`px-4 py-3 text-sm border-b last:border-0 hover:bg-slate-50 transition-colors cursor-pointer flex items-start justify-between gap-3 ${!n.leida ? 'bg-indigo-50/60 font-medium' : ''}`}
                  >
                    <div className="flex-1">
                      <p className="text-slate-700 leading-snug">{n.mensaje}</p>
                      <span className="text-[10px] text-slate-400 block mt-1.5 font-mono">
                        {new Date(n.created_at).toLocaleString('es-MX')}
                      </span>
                    </div>
                    <button
                      onClick={(e) => deleteNotif(n.id, e)}
                      title="Eliminar notificación"
                      className="text-slate-300 hover:text-red-500 p-1 rounded transition-colors shrink-0"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="flex items-center gap-2 hover:bg-white/10 py-1.5 px-3 rounded-full transition-colors focus:outline-none"
          >
            <UserCircle size={24} />
            <div className="text-sm font-semibold hidden md:flex flex-col items-start leading-tight">
              <span>{username.toUpperCase()}</span>
              <span className="text-[10px] font-bold text-white/70">{role}</span>
            </div>
          </button>

          {isMenuOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-50 text-slate-800 border border-slate-100">
              <button 
                onClick={() => { setIsMenuOpen(false); setIsPasswordModalOpen(true); }} 
                className="block w-full text-left px-4 py-2 text-sm hover:bg-slate-50 transition-colors"
              >
                Cambiar Contraseña
              </button>
              <button 
                onClick={() => { setIsMenuOpen(false); handleLogout(); }} 
                className="block w-full text-left px-4 py-2 text-sm hover:bg-slate-50 transition-colors text-red-600"
              >
                Cerrar Sesión
              </button>
            </div>
          )}
        </div>
      </div>

      <ChangePasswordModal
        isOpen={isPasswordModalOpen}
        onClose={() => setIsPasswordModalOpen(false)}
        username={username}
      />
    </nav>
  );
}
