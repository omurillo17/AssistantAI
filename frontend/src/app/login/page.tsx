"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [usuarioInput, setUsuarioInput] = useState("");
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
        body: JSON.stringify({ usuario: usuarioInput, password: passwordInput }),
      });

      const data = await res.json();

      if (data.success) {
        // En lugar de localStorage, el token ya se guardó como Cookie HttpOnly
        // Guardamos información inofensiva para renderizado de UI
        // Guardamos información inofensiva para renderizado de UI
        // `tci_username` es lo que se PINTA en la interfaz, así que guarda el
        // nombre de la persona; la credencial de login queda aparte.
        localStorage.setItem("tci_username", data.nombre || data.usuario || usuarioInput);
        localStorage.setItem("tci_login", data.usuario || usuarioInput);
        localStorage.setItem("tci_role", data.rol || "USER");
        if (data.reclutador_id) {
          localStorage.setItem("tci_reclutador_id", data.reclutador_id);
        } else {
          localStorage.removeItem("tci_reclutador_id");
        }
        if (data.empresa_id) {
          localStorage.setItem("tci_empresa_id", data.empresa_id);
        } else {
          localStorage.removeItem("tci_empresa_id");
        }
        if (data.grupo_id) {
          localStorage.setItem("tci_grupo_id", data.grupo_id);
        } else {
          localStorage.removeItem("tci_grupo_id");
        }
        if (data.naves_asignadas && Array.isArray(data.naves_asignadas)) {
          localStorage.setItem("tci_naves_asignadas", JSON.stringify(data.naves_asignadas));
        } else {
          localStorage.removeItem("tci_naves_asignadas");
        }
        router.push("/");
      } else {
        alert(data.error || "Credenciales incorrectas");
      }
    } catch {
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
            id="login-username"
            name="username"
            type="text"
            autoComplete="username"
            className="w-full p-2.5 rounded border border-slate-300 bg-white text-slate-800 outline-none mb-4 focus:border-[#0C66AC] transition-colors"
            placeholder="Usuario"
            value={usuarioInput}
            onChange={(e) => setUsuarioInput(e.target.value)}
            required
          />
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            className="w-full p-2.5 rounded border border-slate-300 bg-white text-slate-800 outline-none mb-4 focus:border-[#0C66AC] transition-colors"
            placeholder="Contraseña de acceso"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            required
          />
          <button type="submit" disabled={loading} className="w-full bg-[#0C66AC] hover:bg-[#0a5793] text-white font-semibold py-2.5 rounded shadow-sm transition-colors disabled:opacity-50">
            {loading ? "Ingresando..." : "Ingresar"}
          </button>
        </form>
      </div>
    </div>
  );
}
