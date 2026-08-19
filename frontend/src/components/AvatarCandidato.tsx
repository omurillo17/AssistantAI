"use client";

import { useState } from "react";

/**
 * Avatar de un candidato: intenta la foto de perfil de WhatsApp y, si no hay
 * (privacidad activada, contacto nuevo, WAHA caído), muestra la inicial de
 * siempre. La imagen la sirve /api/waha-avatar/[telefono], que la retransmite
 * desde el CDN de Meta sin guardarla.
 */
export default function AvatarCandidato({
  telefono,
  nombre,
  escalado = false,
  size = 48,
  className = "",
}: {
  telefono?: string | null;
  nombre?: string | null;
  escalado?: boolean;
  size?: number;
  className?: string;
}) {
  // Se guarda de QUIÉN falló la foto, no un booleano: así, al cambiar de
  // candidato, el nuevo vuelve a intentarlo sin necesitar un efecto que
  // reinicie el estado.
  const [telefonoSinFoto, setTelefonoSinFoto] = useState<string | null>(null);

  const inicial = (nombre || telefono)?.trim()?.[0]?.toUpperCase() || "?";
  const soloDigitos = (telefono || "").replace(/\D/g, "");
  const puedeTenerFoto =
    /^\d{6,20}$/.test(soloDigitos) && telefonoSinFoto !== soloDigitos;

  const base = `rounded-full shadow-sm flex-shrink-0 ${className}`;
  const estilo = { width: size, height: size };

  if (puedeTenerFoto) {
    return (
      <img
        src={`/api/waha-avatar/${soloDigitos}`}
        alt={nombre || "Candidato"}
        style={estilo}
        className={`${base} object-cover bg-slate-200`}
        loading="lazy"
        onError={() => setTelefonoSinFoto(soloDigitos)}
      />
    );
  }

  return (
    <div
      style={{ ...estilo, fontSize: Math.round(size * 0.4) }}
      className={`${base} flex items-center justify-center font-bold ${
        escalado ? "bg-danger/10 text-danger" : "bg-slate-200 text-slate-600"
      }`}
    >
      {inicial}
    </div>
  );
}
