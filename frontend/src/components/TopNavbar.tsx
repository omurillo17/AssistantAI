"use client";

import { usePathname } from "next/navigation";
import { Bell, UserCircle, Search } from "lucide-react";

export function TopNavbar() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

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
        <button className="flex items-center gap-2 hover:bg-white/10 py-1.5 px-3 rounded-full transition-colors">
          <UserCircle size={24} />
          <span className="text-sm font-semibold hidden md:block">Usuario TCi</span>
        </button>
      </div>
    </nav>
  );
}
