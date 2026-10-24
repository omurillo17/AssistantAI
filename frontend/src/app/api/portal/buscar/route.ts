import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { verificarCodigo, firmarTokenPortal } from '@/lib/portalOtp';
import { rateLimit } from '@/lib/rate-limit';
import { normalizarTelefonoPortal } from '../telefono';
import { buscarCandidatoPortal } from '../candidatos';

const bodySchema = z.object({
  telefono: z.string(),
  codigo: z.string().regex(/^\d{6}$/),
  empresa_id: z.guid().optional().nullable(),
});

const CODIGO_INVALIDO = 'Código inválido o vencido';

// POST /api/portal/buscar
// Verifica el código que llegó por WhatsApp y devuelve los datos que pinta el
// portal más el token que exige /api/portal/subir.
export async function POST(request: Request) {
  // Endpoint público: rate limit por IP; el código además se invalida a los 5 fallos.
  const rl = rateLimit(request, 20);
  if (!rl.success) {
    return NextResponse.json({ error: 'Demasiados intentos, espera un momento.' }, { status: 429 });
  }

  try {
    const parsed = bodySchema.safeParse(await request.json());
    const last10 = parsed.success ? normalizarTelefonoPortal(parsed.data.telefono) : null;
    if (!parsed.success || !last10) {
      return NextResponse.json({ error: CODIGO_INVALIDO }, { status: 401 });
    }
    const empresaId = parsed.data.empresa_id ?? null;

    if (!verificarCodigo(last10, empresaId, parsed.data.codigo)) {
      return NextResponse.json({ error: CODIGO_INVALIDO }, { status: 401 });
    }

    const cand = await buscarCandidatoPortal(last10, empresaId);
    if (!cand) {
      return NextResponse.json({
        encontrado: false,
        mensaje: 'No se encontró una solicitud activa registrada con ese número de teléfono en la empresa seleccionada. Tu expediente sigue en espera de autorización del reclutador.',
      });
    }

    const nombreMostrado = cand.nombre || cand.nombre_chat || cand.nombre_solicitud || 'Candidato';

    const tieneCvRegistrado = Boolean(
      cand.tiene_cv || 
      (cand.link_cv && String(cand.link_cv).trim() !== '') || 
      (cand.cv_manual && String(cand.cv_manual).trim() !== '' && cand.cv_manual !== 'null')
    );

    const tieneInePrevio = Boolean(cand.datos_ine && (cand.datos_ine.url || (typeof cand.datos_ine === 'string' && cand.datos_ine.includes('url'))));
    const tieneRfcPrevio = Boolean(cand.datos_rfc && (cand.datos_rfc.url || (typeof cand.datos_rfc === 'string' && cand.datos_rfc.includes('url'))));
    const tieneCvPrevio = tieneCvRegistrado;

    return NextResponse.json({
      encontrado: true,
      // El teléfono y la empresa salen del servidor (no del formulario): es lo
      // único que /api/portal/subir usa para encontrar el expediente.
      token: firmarTokenPortal(last10, cand.empresa_id ?? empresaId),
      candidato: {
        // Solo lo que pinta el portal. El teléfono es el mismo que tecleó el
        // candidato (no el guardado).
        telefono: last10,
        nombre: nombreMostrado,
        vacante_interes: cand.vacante_interes || 'General',
        nave_interes: cand.nave_interes || 'General',
        // Mensaje GENÉRICO, no la nota interna: este endpoint es público (solo
        // pide un teléfono) y `alerta_identidad_motivo` incluye la CURP leída
        // del documento ('CURP con formato inválido ... "MESC010323MJCDNA2"'),
        // así que bastaba conocer un teléfono para sacar la CURP de esa
        // persona. El portal solo usa este texto para pedirle al candidato que
        // vuelva a subir el documento, y para eso el genérico basta.
        alerta_identidad_motivo: cand.alerta_identidad_motivo
          ? 'No pudimos validar los datos de tu documento. Vuelve a subirlo completo, con buena luz y sin reflejos.'
          : null,
        // `link_cv` NO se expone: era la ruta directa a un archivo servido de
        // forma pública desde /uploads, de modo que con un teléfono se podía
        // descargar el CV/INE de esa persona sin sesión. El portal nunca lo
        // usó -- la pantalla solo mira `tiene_archivos_previos`.
        tiene_cv: tieneCvRegistrado,
        tiene_archivos_previos: tieneInePrevio || tieneRfcPrevio || tieneCvPrevio,
      },
    });
  } catch (err) {
    console.error('Error en /api/portal/buscar:', err);
    return NextResponse.json({ error: 'Error al buscar candidato' }, { status: 500 });
  }
}
