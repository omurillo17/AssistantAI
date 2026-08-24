import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export default function LeccionNoEncontrada() {
  return (
    <div className="p-2">
      <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
        <p className="text-slate-600 font-semibold mb-1">Esta guía no existe o fue movida</p>
        <p className="text-slate-400 text-sm mb-4">
          Revisa el listado del Centro de Capacitación.
        </p>
        <Link
          href="/capacitacion"
          className="inline-flex items-center gap-1.5 text-primary font-bold text-sm"
        >
          <ChevronLeft size={16} /> Volver a Capacitación
        </Link>
      </div>
    </div>
  );
}
