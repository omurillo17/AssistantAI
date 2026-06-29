"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [passwordInput, setPasswordInput] = useState("");
  const router = useRouter();

  const checkLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordInput === "virgo") {
      localStorage.setItem("tci_authenticated", "true");
      router.push("/");
    } else {
      alert("Contraseña incorrecta");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6">
      <div className="bg-white p-10 rounded-2xl border border-black/10 text-center shadow-lg w-[90%] max-w-sm">
        <div className="text-3xl font-extrabold bg-gradient-to-br from-cyan-500 to-amber-500 bg-clip-text text-transparent mb-6">
          Plataforma TCi
        </div>
        <form onSubmit={checkLogin}>
          <input
            type="password"
            className="w-full p-3 rounded-lg border border-black/10 bg-slate-50 text-slate-800 outline-none mb-4 focus:border-cyan-500 focus:bg-white transition-all shadow-sm focus:shadow-md"
            placeholder="Contraseña de acceso"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
          />
          <button type="submit" className="w-full bg-cyan-500 hover:bg-cyan-600 text-white font-semibold py-3 rounded-lg transition-all shadow-md">
            Ingresar
          </button>
        </form>
      </div>
    </div>
  );
}
