"use client";

import { usePathname, useRouter } from "next/navigation";
import { Bell, UserCircle, Search, LogOut, Building2, ChevronDown } from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { useTenant } from "@/hooks/useTenant";

export function TopNavbar() {
  const pathname = usePathname();
  const router = useRouter();

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [username, setUsername] = useState("Usuario");
  const [role, setRole] = useState("USER");
  
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const empresaMenuRef = useRef<HTMLDivElement>(null);

  const { empresaId, naveId, setTenant } = useTenant();
  const [empresas, setEmpresas] = useState<any[]>([]);
  const [isEmpresaMenuOpen, setIsEmpresaMenuOpen] = useState(false);

  useEffect(() => {
    setUsername(localStorage.getItem("tci_username") || "Usuario");
    setRole(localStorage.getItem("tci_role") || "USER");
  }, [pathname]);

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
          } catch (e) {}

          setEmpresas(fetchedEmpresas);
        }
      })
      .catch(e => console.error(e));
  }, [role]);

  const fetchNotifs = async () => {
    try {
      const res = await fetch("/api/db/notificaciones");
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.unread || 0);
        setNotifications(data.items || []);
      }
    } catch (e) {}
  };

  useEffect(() => {
    fetchNotifs();
    const interval = setInterval(fetchNotifs, 10000); // Check every 10 seconds
    return () => clearInterval(interval);
  }, []);

  const markAllAsRead = async () => {
    try {
      await fetch("/api/db/notificaciones", { method: "PATCH", body: JSON.stringify({}) });
      fetchNotifs();
    } catch (e) {}
  };

  const toggleNotifs = () => {
    setIsNotifOpen(!isNotifOpen);
    if (!isNotifOpen && unreadCount > 0) {
      markAllAsRead();
    }
  };

  if (pathname === "/login") return null;

  const handleLogout = () => {
    localStorage.removeItem("tci_username");
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
    if (pathname.startsWith("/configuracion")) return "Configuración";
    if (pathname.startsWith("/usuarios")) return "Gestión de Usuarios";
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
        
        {/* Empresa Selector */}
        {true && (
          <div className="relative" ref={empresaMenuRef}>
            <button
              onClick={() => setIsEmpresaMenuOpen(!isEmpresaMenuOpen)}
              className={`flex items-center gap-2 py-1.5 px-3 rounded-lg transition-colors focus:outline-none border border-white/20 hover:bg-white/10 ${!empresaId ? 'bg-amber-500/20 text-amber-100 border-amber-500/50' : 'bg-white/5'}`}
            >
              <Building2 size={18} className={!empresaId ? 'text-amber-400' : ''} />
              <div className="text-sm font-semibold hidden md:block max-w-[150px] truncate">
                {naveId
                  ? (empresas.flatMap(e => e.naves || []).find(n => n.id === naveId)?.nombre || "Nave Desconocida")
                  : empresaId 
                    ? (empresas.find(e => e.id === empresaId)?.nombre || "Empresa Desconocida")
                    : role === "ROOT" ? "Vista Global" : "Selecciona Empresa"}
              </div>
              <ChevronDown size={16} className="opacity-70" />
            </button>

            {isEmpresaMenuOpen && (
              <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-xl py-2 z-50 text-slate-800 border border-slate-100 max-h-96 overflow-y-auto">
                <div className="px-4 py-2 border-b border-slate-100 text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Seleccionar Vista
                </div>
                
                {role === "ROOT" && (
                  <button
                    onClick={() => { setTenant(null, null); setIsEmpresaMenuOpen(false); window.location.reload(); }}
                    className={`block w-full text-left px-4 py-3 text-sm transition-colors border-b border-slate-50 hover:bg-slate-50 ${!empresaId && !naveId ? 'bg-indigo-50 font-bold text-indigo-700' : 'text-slate-700'}`}
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
                      onClick={() => { setTenant(emp.id, null); setIsEmpresaMenuOpen(false); window.location.reload(); }}
                      className={`block w-full text-left px-4 py-3 text-sm transition-colors hover:bg-slate-50 ${empresaId === emp.id && !naveId ? 'bg-indigo-50 font-bold text-indigo-700' : 'text-slate-700'}`}
                    >
                      <div className="flex items-center gap-2">
                        <Building2 size={16} className={empresaId === emp.id && !naveId ? "text-indigo-600" : "text-slate-400"} />
                        <span className="truncate">{emp.nombre} (Todo)</span>
                      </div>
                    </button>
                    {emp.naves && emp.naves.map((nave: any) => (
                      <button
                        key={nave.id}
                        onClick={() => { setTenant(emp.id, nave.id); setIsEmpresaMenuOpen(false); window.location.reload(); }}
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
            <div className="absolute right-0 mt-3 w-80 bg-white rounded-lg shadow-xl py-2 z-50 text-slate-800 border border-slate-100 max-h-96 overflow-y-auto">
              <div className="px-4 py-2 border-b font-bold text-sm">Notificaciones</div>
              {notifications.length === 0 ? (
                <div className="px-4 py-4 text-sm text-slate-500 text-center">No tienes notificaciones</div>
              ) : (
                notifications.map(n => (
                  <div key={n.id} className={`px-4 py-3 text-sm border-b last:border-0 ${!n.leida ? 'bg-indigo-50/50' : ''}`}>
                    <p className="text-slate-700">{n.mensaje}</p>
                    <span className="text-[10px] text-slate-400 block mt-1">
                      {new Date(n.created_at).toLocaleString('es-MX')}
                    </span>
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
                onClick={() => { setIsMenuOpen(false); router.push("/usuarios"); }} 
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
    </nav>
  );
}
