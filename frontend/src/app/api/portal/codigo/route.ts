import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { rateLimit } from '@/lib/rate-limit';
import { enviarMensajeDirecto } from '@/lib/messagingService';
import { generarCodigo } from '@/lib/portalOtp';
import { normalizarTelefonoPortal } from '../telefono';
import { buscarCandidatoPortal } from '../candidatos';

const bodySchema = z.object({
  telefono: z.string(),
  empresa_id: z.guid().optional().nullable(),
});

// Misma respuesta exista o no el teléfono: no sirve para enumerar candidatos.
const RESPUESTA = { success: true, mensaje: 'Si el número está registrado, te enviamos un código por WhatsApp.' };

// POST /api/portal/codigo
// Manda por WhatsApp un código de un solo uso para entrar al portal.
export async function POST(request: Request) {
  // Ojo: el contador por IP de rateLimit es compartido con las demás rutas.
  const rl = rateLimit(request, 10);
  if (!rl.success) {
    return NextResponse.json({ error: 'Demasiados intentos, espera un momento.' }, { status: 429 });
  }

  try {
    const parsed = bodySchema.safeParse(await request.json());
    const telefono = parsed.success ? normalizarTelefonoPortal(parsed.data.telefono) : null;
    if (!parsed.success || !telefono) {
      return NextResponse.json({ error: 'Ingresa un número de teléfono válido de 10 dígitos.' }, { status: 400 });
    }
    const empresaId = parsed.data.empresa_id ?? null;

    // El límite por teléfono se aplica ANTES de buscarlo, exista o no: si solo
    // aplicara a los registrados, el 429 delataría cuáles existen.
    const r = generarCodigo(telefono, empresaId);
    if (!r.ok) {
      return NextResponse.json(
        { error: r.motivo === 'espera' ? 'Espera un minuto antes de pedir otro código.' : 'Pediste demasiados códigos. Intenta en una hora.' },
        { status: 429 }
      );
    }

    const cand = await buscarCandidatoPortal(telefono, empresaId);
    if (!cand) return NextResponse.json(RESPUESTA);

    // Sin await: WAHA puede tardar segundos y esa diferencia de tiempo
    // delataría qué teléfonos existen. Si falla, solo se registra.
    const texto = `Tu código para el portal de documentos es: ${r.codigo}. Vence en 10 minutos. Si no lo pediste, ignora este mensaje.`;
    enviarMensajeDirecto(String(cand.telefono), texto)
      .then((res) => {
        if (!res.ok) console.error(`[portal/codigo] No se envió el código a ...${telefono.slice(-4)}:`, res.error);
      })
      .catch((err) => console.error(`[portal/codigo] Error enviando código a ...${telefono.slice(-4)}:`, err));

    return NextResponse.json(RESPUESTA);
  } catch (err) {
    console.error('Error en /api/portal/codigo:', err);
    return NextResponse.json({ error: 'Error al enviar el código' }, { status: 500 });
  }
}
