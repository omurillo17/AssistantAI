"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [passwordInput, setPasswordInput] = useState("");
  const router = useRouter();

  const [loading, setLoading] = useState(false);

  const checkLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordInput }),
      });

      const data = await res.json();

      if (data.success) {
        // En lugar de localStorage, el token ya se guardó como Cookie HttpOnly
        // Aún así, podemos dejar una bandera inofensiva para que el UI sepa que está logueado rápidamente
        localStorage.setItem("tci_authenticated", "true");
        router.push("/");
      } else {
        alert(data.error || "Contraseña incorrecta");
      }
    } catch (err) {
      alert("Error al conectar con el servidor");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#F3F3F3] p-6">
      <div className="bg-white p-10 rounded shadow-md border-t-4 border-t-[#0C66AC] text-center w-[90%] max-w-sm">
        <div className="text-4xl font-bold mb-2 tracking-tight">
          <span className="font-light text-slate-700">Plataforma</span> <span className="text-[#0C66AC]">TCi</span>
        </div>
        <div className="text-sm text-slate-500 mb-8 font-medium">
          Inicia sesión para comenzar
        </div>
        <form onSubmit={checkLogin}>
          <input
            type="password"
            className="w-full p-2.5 rounded border border-slate-300 bg-white text-slate-800 outline-none mb-4 focus:border-[#0C66AC] transition-colors"
            placeholder="Contraseña de acceso"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
          />
          <button type="submit" disabled={loading} className="w-full bg-[#0C66AC] hover:bg-[#0a5793] text-white font-semibold py-2.5 rounded shadow-sm transition-colors disabled:opacity-50">
            {loading ? "Ingresando..." : "Ingresar"}
          </button>
        </form>
      </div>
    </div>
  );
}
