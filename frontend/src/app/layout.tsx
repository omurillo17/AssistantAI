import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { TopNavbar } from "@/components/TopNavbar";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Plataforma TCi",
  description: "Sistema de Reclutamiento por 17.CORP",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${outfit.variable} h-full antialiased`}>
      <body className="min-h-full flex font-sans bg-background text-foreground overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto relative">
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
      </body>
    </html>
  );
}
