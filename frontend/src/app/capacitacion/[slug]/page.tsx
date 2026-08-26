import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LeccionVista } from "@/components/capacitacion/LeccionVista";
import { LECCIONES, getLeccion } from "@/lib/capacitacion";

/**
 * Componente de servidor: al declarar los slugs, Next prerenderiza cada lección
 * en el build. Además de ser más rápido, hace que un error de contenido reviente
 * en `npm run build` y no en la cara del reclutador.
 */
export function generateStaticParams() {
  return LECCIONES.map((l) => ({ slug: l.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const leccion = getLeccion(slug);
  if (!leccion) return { title: "Capacitación | Plataforma TCi" };
  return {
    title: `${leccion.titulo} | Capacitación TCi`,
    description: leccion.resumen,
  };
}

export default async function LeccionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const leccion = getLeccion(slug);

  if (!leccion) notFound();

  return (
    <div className="p-2 animate-fade-in">
      <LeccionVista leccion={leccion} />
    </div>
  );
}
