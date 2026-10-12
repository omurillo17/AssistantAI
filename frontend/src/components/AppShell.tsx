"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { TopNavbar } from "@/components/TopNavbar";
import { WahaStatusBanner } from "@/components/WahaStatusBanner";
import { IdentityAlertModal } from "@/components/IdentityAlertModal";

export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const isStandalone = pathname === "/login" || pathname.startsWith("/portal");

  if (isStandalone) {
    return <div className="h-screen w-full overflow-y-auto bg-[#f3f3f3] flex flex-col relative">{children}</div>;
  }

  return (
    <>
      <Sidebar />
      <IdentityAlertModal />
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto relative">
        <WahaStatusBanner />
        <TopNavbar />
        <main className="flex-1 flex flex-col p-6">
          {children}
        </main>

        {/* FOOTER GLOBAL */}
        <footer className="bg-white p-4 border-t border-slate-200 flex flex-col items-center justify-center shrink-0 z-10">
          <div className="text-slate-500 text-sm font-medium">
            Desarrollado internamente por <span className="font-bold text-slate-700"><a href="https://seventeencorp.com" target="_blank" rel="noreferrer">Seventeen Corp</a></span>
          </div>
          <div className="text-xs text-slate-400 mt-1">
            Plataforma TCi © {new Date().getFullYear()}
          </div>
        </footer>
      </div>
    </>
  );
}
