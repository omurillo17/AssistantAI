"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { TopNavbar } from "@/components/TopNavbar";
import { WahaStatusBanner } from "@/components/WahaStatusBanner";
import { IdentityAlertModal } from "@/components/IdentityAlertModal";

export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isStandalone = pathname === "/login" || pathname.startsWith("/portal");

  if (isStandalone) {
    return <div className="h-screen w-full overflow-y-auto bg-[#f3f3f3] flex flex-col relative">{children}</div>;
  }

  return (
    <>
      <Sidebar mobileOpen={mobileMenuOpen} setMobileOpen={setMobileMenuOpen} />
      <IdentityAlertModal />
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto relative">
        <WahaStatusBanner />
        <TopNavbar onToggleMobileMenu={() => setMobileMenuOpen(prev => !prev)} />
        <main className="flex-1 flex flex-col p-3 sm:p-4 md:p-6">
          {children}
        </main>

        {/* FOOTER GLOBAL */}
        <footer className="bg-white p-3 sm:p-4 border-t border-slate-200 flex flex-col items-center justify-center shrink-0 z-10 text-center">
          <div className="text-slate-500 text-xs sm:text-sm font-medium">
            Desarrollado internamente por <span className="font-bold text-slate-700"><a href="https://seventeencorp.com" target="_blank" rel="noreferrer">Seventeen Corp</a></span>
          </div>
          <div className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
            Plataforma TCi © {new Date().getFullYear()}
          </div>
        </footer>
      </div>
    </>
  );
}
