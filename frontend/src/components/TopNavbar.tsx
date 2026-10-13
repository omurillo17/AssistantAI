"use client";

import { usePathname, useRouter } from "next/navigation";
import { useRealtime } from "@/lib/realtimeClient";
import { Bell, UserCircle, Building2, ChevronDown, Trash2, X, Calendar, AlertTriangle, ExternalLink, Menu } from "lucide-react";
import { useCallback, useEffect, useState, useRef } from "react";
import { useTenant } from "@/hooks/useTenant";
import { useLocalStorageValue } from "@/hooks/useLocalStorageValue";
import ChangePasswordModal from "@/components/usuarios/ChangePasswordModal";
import type { Empresa, Nave, Grupo, Notificacion } from "@/types";

interface TopNavbarProps {
  onToggleMobileMenu?: () => void;
}

export function TopNavbar({ onToggleMobileMenu }: TopNavbarProps = {}) {
  const pathname = usePathname();
  const router = useRouter();

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const username = useLocalStorageValue("tci_username") || "Usuario";
  const role = useLocalStorageValue("tci_role") || "USER";
  
  const [notifications, setNotifications] = useState<Notificacion[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [toasts, setToasts] = useState<Notificacion[]>([]);
  const seenNotifIds = useRef<Set<string | number>>(new Set());
  const initialLoadDone = useRef(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const empresaMenuRef = useRef<HTMLDivElement>(null);

  const { empresaId, naveId, grupoId, setTenant } = useTenant();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
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
              fetchedEmpresas = fetchedEmpresas.map((emp: Empresa) => ({
                ...emp,
                naves: emp.naves ? emp.naves.filter((n: Nave) => allowedNaves.includes(n.id)) : []
              })).filter((emp: Empresa) => (emp.naves?.length ?? 0) > 0);
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
        const items: Notificacion[] = data.items || [];
        setUnreadCount(data.unread || 0);
        setNotifications(items);

        if (!initialLoadDone.current) {
          items.forEach(n => seenNotifIds.current.add(n.id));
          initialLoadDone.current = true;
        } else {
          // Detectar nuevas notificaciones sin leer para disparar la tarjeta Toast
          const nuevas = items.filter(n => !n.leida && !seenNotifIds.current.has(n.id));
          if (nuevas.length > 0) {
            nuevas.forEach(n => seenNotifIds.current.add(n.id));
            setToasts(prev => [...nuevas, ...prev].slice(0, 3));
          }
        }
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

  // Auto-cierre de tarjetas flotantes a los 8 segundos
  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => {
      setToasts(prev => prev.slice(0, -1));
    }, 8000);
    return () => clearTimeout(timer);
  }, [toasts]);

  const dismissToast = (id: string | number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const getNotifMeta = (msg: string = "") => {
    const lower = msg.toLowerCase();
    if (lower.includes("cita") || lower.includes("agendada") || lower.includes("📅")) {
      return {
        badge: "📅 Cita Agendada",
        bg: "bg-emerald-50 text-emerald-700 border-emerald-200",
        border: "border-l-emerald-500",
        icon: <Calendar className="w-4 h-4 text-emerald-600" />,
      };
    }
    if (lower.includes("atención humana") || lower.includes("escalado") || lower.includes("🚨")) {
      return {
        badge: "🚨 Atención Humana",
        bg: "bg-rose-50 text-rose-700 border-rose-200",
        border: "border-l-rose-500",
        icon: <AlertTriangle className="w-4 h-4 text-rose-600" />,
      };
    }
    if (lower.includes("verificación") || lower.includes("identidad") || lower.includes("ocr") || lower.includes("curp") || lower.includes("⚠️")) {
      return {
        badge: "⚠️ Alerta de Identidad",
        bg: "bg-amber-50 text-amber-700 border-amber-200",
        border: "border-l-amber-500",
        icon: <AlertTriangle className="w-4 h-4 text-amber-600" />,
      };
    }
    return {
      badge: "🔔 Notificación",
      bg: "bg-indigo-50 text-indigo-700 border-indigo-200",
      border: "border-l-indigo-500",
      icon: <Bell className="w-4 h-4 text-indigo-600" />,
    };
  };

  const getNotifDisplay = (msg: string = "") => {
    const lower = msg.toLowerCase();
    const phoneMatch = /(?:wa\.me\/|tel:|phone:)?(\d{10,13})/i.exec(msg);
    const tel = phoneMatch ? phoneMatch[1] : "";
    const nameMatch = /Candidato:\s*([^\n]+)/i.exec(msg);
    const nombre = nameMatch ? nameMatch[1].trim() : "";
    const telSuffix = tel ? ` (${tel})` : "";
    let info = "";
    if (nombre) {
      info = `${nombre}${telSuffix}`;
    } else if (tel) {
      info = `Tel: ${tel}`;
    }

    if (lower.includes("verificación") || lower.includes("identidad") || lower.includes("ocr") || lower.includes("curp")) {
      return {
        titulo: "Alerta de Identidad",
        subtitulo: info || "Revisión de expediente requerida",
      };
    }
    if (lower.includes("cita") || lower.includes("agendada") || lower.includes("📅")) {
      return {
        titulo: "Cita Agendada",
        subtitulo: info || "Nueva entrevista programada",
      };
    }
    if (lower.includes("atención humana") || lower.includes("escalado") || lower.includes("🚨")) {
      return {
        titulo: "Atención Humana Requerida",
        subtitulo: info || "Conversación escalada",
      };
    }
    return {
      titulo: "Notificación",
      subtitulo: msg.length > 60 ? msg.slice(0, 60) + "..." : msg,
    };
  };

  const markAllAsRead = async () => {
    setUnreadCount(0);
    setNotifications(prev => prev.map(n => ({ ...n, leida: true })));
    try {
      await fetch("/api/db/notificaciones", { method: "PATCH", body: JSON.stringify({}) });
    } catch {}
  };

  const deleteNotif = async (id: string | number, e: React.MouseEvent) => {
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

  const handleNotifClick = (n: Notificacion) => {
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

    if (telefono) {
      router.push(`/expedientes?tel=${telefono}`);
    } else {
      router.push("/expedientes");
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

  const handleLogout = async () => {
    localStorage.removeItem("tci_username");
    localStorage.removeItem("tci_login");
    localStorage.removeItem("tci_role");
    localStorage.removeItem("tci_reclutador_id");
    localStorage.removeItem("tci_naves_asignadas");
    localStorage.removeItem("tci_grupo_id");
    localStorage.removeItem("tci_empresa_id");

    // La cookie de sesión es HttpOnly: solo el servidor puede borrarla.
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Sin red igual se sale; la cookie expira sola a las 4 h.
    }

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

  const getCurrentContextName = (): string => {
    if (grupoId) {
      return empresas.flatMap(e => e.grupos || []).find((g: Grupo) => g.id === grupoId)?.nombre || "Grupo";
    }
    if (naveId) {
      return empresas.flatMap(e => e.naves || []).find(n => n.id === naveId)?.nombre || "Nave";
    }
    if (empresaId) {
      return empresas.find(e => e.id === empresaId)?.nombre || "Empresa";
    }
    return role === "ROOT" ? "Global" : "Empresa";
  };

  return (
    <nav className="h-16 bg-primary flex items-center justify-between px-3 sm:px-6 shadow-sm z-40 sticky top-0 flex-shrink-0">
      {/* Title / Hamburger / Back Button */}
      <div className="flex items-center gap-2 sm:gap-4 text-white min-w-0">
        {/* Botón Hamburger en móvil */}
        {onToggleMobileMenu && (
          <button
            onClick={onToggleMobileMenu}
            className="md:hidden p-1.5 hover:bg-white/10 rounded-lg transition-colors focus:outline-none"
            aria-label="Abrir menú"
          >
            <Menu size={22} />
          </button>
        )}

        {showBackButton && (
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1 px-2 sm:px-3 py-1.5 bg-white/10 hover:bg-white/20 font-semibold rounded-lg transition-colors text-xs sm:text-sm shrink-0"
          >
            <span>⬅</span> <span className="hidden sm:inline">Atrás</span>
          </button>
        )}
        <h1 className="text-base sm:text-xl font-bold tracking-wide truncate max-w-[140px] sm:max-w-[240px] md:max-w-none">
          {getTitle()}
        </h1>
      </div>

      {/* Right side items */}
      <div className="flex items-center gap-2 sm:gap-4 text-white shrink-0">
        
        {/* Empresa Selector — oculto en Calendario: ahí no hay filtro manual de
            nave/grupo, cada quien ve automáticamente el calendario de su propio
            grupo (o todo, si no pertenece a ninguno). */}
        {!pathname.startsWith("/calendario") && (
          <div className="relative" ref={empresaMenuRef}>
            <button
              onClick={() => setIsEmpresaMenuOpen(!isEmpresaMenuOpen)}
              className={`flex items-center gap-1.5 sm:gap-2 py-1.5 px-2 sm:px-3 rounded-lg transition-colors focus:outline-none border border-white/20 hover:bg-white/10 ${!empresaId ? 'bg-amber-500/20 text-amber-100 border-amber-500/50' : 'bg-white/5'}`}
              title="Cambiar empresa o nave"
            >
              <Building2 size={16} className={!empresaId ? 'text-amber-400' : ''} />
              <div className="text-xs sm:text-sm font-semibold max-w-[90px] sm:max-w-[150px] truncate">
                {getCurrentContextName()}
              </div>
              <ChevronDown size={14} className="opacity-70" />
            </button>

            {isEmpresaMenuOpen && (
              <div className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-1.5rem)] bg-white rounded-xl shadow-xl py-2 z-50 text-slate-800 border border-slate-100 max-h-96 overflow-y-auto">
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
                      ? (emp.grupos || []).map((grupo: Grupo) => (
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
                      : (emp.naves || []).map((nave: Nave) => (
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
            className="relative hover:text-white/80 transition-colors focus:outline-none p-1"
            aria-label="Ver notificaciones"
          >
            <Bell size={20} />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-secondary text-white text-[9px] font-bold px-1.5 py-0.2 rounded-full">
                {unreadCount}
              </span>
            )}
          </button>
          
          {isNotifOpen && (
            <div className="absolute right-0 mt-3 w-80 sm:w-96 max-w-[calc(100vw-1.5rem)] bg-white rounded-xl shadow-xl py-2 z-50 text-slate-800 border border-slate-100 max-h-96 overflow-y-auto">
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
                notifications.map(n => {
                  const display = getNotifDisplay(n.mensaje);
                  const meta = getNotifMeta(n.mensaje);
                  return (
                    <div 
                      key={n.id} 
                      className={`px-4 py-3 text-sm border-b last:border-0 hover:bg-slate-50 transition-colors flex items-start justify-between gap-3 ${!n.leida ? 'bg-indigo-50/60 font-medium' : ''}`}
                    >
                      <button
                        type="button"
                        onClick={() => handleNotifClick(n)}
                        className="flex items-start gap-2.5 flex-1 min-w-0 text-left cursor-pointer focus:outline-none"
                      >
                        <div className="mt-0.5 shrink-0">{meta.icon}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-slate-800 font-bold text-xs leading-tight truncate">{display.titulo}</p>
                          {display.subtitulo && (
                            <p className="text-slate-500 text-[11px] font-medium leading-tight truncate mt-0.5">{display.subtitulo}</p>
                          )}
                          <span className="text-[10px] text-slate-400 block mt-1 font-mono">
                            {n.created_at ? new Date(n.created_at).toLocaleString('es-MX', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ""}
                          </span>
                        </div>
                      </button>
                      <button
                        onClick={(e) => deleteNotif(n.id, e)}
                        title="Eliminar notificación"
                        className="text-slate-300 hover:text-red-500 p-1 rounded transition-colors shrink-0 cursor-pointer"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="flex items-center gap-1.5 sm:gap-2 hover:bg-white/10 py-1.5 px-2 sm:px-3 rounded-full transition-colors focus:outline-none"
            aria-label="Menú de usuario"
          >
            <UserCircle size={24} />
            <div className="text-sm font-semibold hidden md:flex flex-col items-start leading-tight">
              <span>{username.toUpperCase()}</span>
              <span className="text-[10px] font-bold text-white/70">{role}</span>
            </div>
          </button>

          {isMenuOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-50 text-slate-800 border border-slate-100">
              <div className="md:hidden px-4 py-2 border-b border-slate-100">
                <p className="text-xs font-bold text-slate-700">{username.toUpperCase()}</p>
                <p className="text-[10px] font-bold text-indigo-600">{role}</p>
              </div>
              <button 
                onClick={() => { setIsMenuOpen(false); setIsPasswordModalOpen(true); }} 
                className="block w-full text-left px-4 py-2 text-sm hover:bg-slate-50 transition-colors"
              >
                Cambiar Contraseña
              </button>
              <button 
                onClick={() => { setIsMenuOpen(false); void handleLogout(); }} 
                className="block w-full text-left px-4 py-2 text-sm hover:bg-slate-50 transition-colors text-red-600 font-semibold"
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

      {/* ─── TOASTS FLOTANTES DE NOTIFICACIÓN EN TIEMPO REAL ─── */}
      <div className="fixed top-16 sm:top-20 right-3 sm:right-6 z-[9999] flex flex-col gap-3 max-w-[calc(100vw-1.5rem)] sm:max-w-sm w-full pointer-events-none">
        {toasts.map((t) => {
          const meta = getNotifMeta(t.mensaje);
          return (
            <div
              key={t.id}
              className={`pointer-events-auto bg-white/95 backdrop-blur-md border border-slate-200/80 shadow-2xl rounded-2xl p-4 border-l-4 ${meta.border} transition-all duration-300 transform translate-y-0 opacity-100 hover:shadow-indigo-500/15 animate-in fade-in slide-in-from-top-4`}
            >
              <div className="flex items-start justify-between gap-3 mb-1.5">
                <div className="flex items-center gap-1.5">
                  {meta.icon}
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${meta.bg}`}>
                    {meta.badge}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => dismissToast(t.id)}
                  className="text-slate-400 hover:text-slate-600 p-0.5 rounded-md transition-colors"
                  title="Cerrar"
                >
                  <X size={15} />
                </button>
              </div>

              <div className="mb-3">
                <div className="text-xs text-slate-800 font-bold leading-tight">{getNotifDisplay(t.mensaje).titulo}</div>
                {getNotifDisplay(t.mensaje).subtitulo && (
                  <div className="text-xs text-slate-500 font-medium leading-snug mt-0.5">{getNotifDisplay(t.mensaje).subtitulo}</div>
                )}
              </div>

              <div className="flex justify-end items-center gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    dismissToast(t.id);
                    handleNotifClick(t);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm shadow-indigo-200"
                >
                  <span>Ver Detalle</span>
                  <ExternalLink size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
