"use client";

import { usePathname, useRouter } from "next/navigation";
import { Bell, UserCircle, Search, LogOut } from "lucide-react";
import { useEffect, useState } from "react";

export function TopNavbar() {
  const pathname = usePathname();
  const router = useRouter();
  
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [username, setUsername] = useState("Usuario");
  const [role, setRole] = useState("USER");

  useEffect(() => {
    setUsername(localStorage.getItem("tci_username") || "Usuario");
    setRole(localStorage.getItem("tci_role") || "USER");
  }, [pathname]);

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
        <button className="relative hover:text-white/80 transition-colors">
          <Bell size={20} />
          <span className="absolute -top-1.5 -right-1.5 bg-secondary text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
            3
          </span>
        </button>
        
        <div className="relative">
          <button 
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="flex items-center gap-2 hover:bg-white/10 py-1.5 px-3 rounded-full transition-colors focus:outline-none"
          >
            <UserCircle size={24} />
            <div className="text-sm font-semibold hidden md:flex flex-col items-start leading-tight">
              <span>{username}</span>
              <span className="text-[10px] font-bold text-white/70">{role}</span>
            </div>
          </button>

          {isMenuOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 text-slate-700 border border-slate-200 z-50 animate-fade-in">
              <div className="px-4 py-2 border-b border-slate-100 mb-1 md:hidden">
                <p className="text-sm font-bold truncate">{username}</p>
                <p className="text-xs text-slate-500">{role}</p>
              </div>
              <button 
                onClick={handleLogout}
                className="w-full text-left px-4 py-2 text-sm text-danger hover:bg-slate-50 flex items-center gap-2 transition-colors"
              >
                <LogOut size={16} /> Cerrar Sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
