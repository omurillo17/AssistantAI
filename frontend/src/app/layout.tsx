import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";

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
      <body className="min-h-full flex flex-col font-sans">
        <main className="flex-1 flex flex-col">
          {children}
        </main>

        {/* FOOTER GLOBAL */}
        <footer className="bg-slate-50 p-4 border-t border-black/5 flex flex-col items-center justify-center shrink-0">
          <div className="text-slate-500 text-sm font-medium">
            Desarrollado internamente por <span className="font-bold text-slate-700"><a href="https://seventeencorp.com" target="_blank">Seventeen Corp</a></span>
          </div>
          <div className="text-xs text-slate-400 mt-1">
            Plataforma TCi © {new Date().getFullYear()}
          </div>
        </footer>
      </body>
    </html>
  );
}
