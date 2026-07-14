"use client";

import { usePathname, useRouter } from "next/navigation";
import { Bell, UserCircle, Search, LogOut } from "lucide-react";
import { useEffect, useState, useRef } from "react";

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

  useEffect(() => {
    setUsername(localStorage.getItem("tci_username") || "Usuario");
    setRole(localStorage.getItem("tci_role") || "USER");
  }, [pathname]);

  useEffect(() => {
    const auth = localStorage.getItem("tci_authenticated");
    if (!auth && pathname !== "/login") {
      router.push("/login");
    }

    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setIsNotifOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [pathname, router]);

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
    localStorage.removeItem("tci_authenticated");
    localStorage.removeItem("tci_username");
    localStorage.removeItem("tci_role");

    // In a real app we might also need to hit a logout API to clear the HttpOnly cookie, 
    // but for now deleting the cookie in JS or redirecting to a logout route is best.
    // For now we just clear the flags and Nextjs proxy will redirect if cookie is missing/invalid.
    // We can just set the cookie to expire.
    document.cookie = "tci_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";

    router.push("/login");
  };

  return (
    <nav className="h-16 bg-primary flex items-center justify-between px-6 shadow-sm z-40 sticky top-0 flex-shrink-0">
      {/* Search / Breadcrumbs */}
      <div className="flex items-center gap-4 text-white/90">
        <div className="relative hidden md:block text-white/80">
          <Search size={16} className="absolute left-3 top-2.5 opacity-70" />
          <input
            type="text"
            placeholder="Buscar..."
            className="pl-10 pr-4 py-2 bg-white/10 border border-white/20 rounded-full text-sm focus:outline-none focus:bg-white/20 transition-colors text-white placeholder-white/50 w-64"
          />
        </div>
      </div>

      {/* Right side items */}
      <div className="flex items-center gap-5 text-white">
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
