import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';

const bodySchema = z.object({
  telefono: z.string().min(8, 'El número telefónico debe tener al menos 8 dígitos'),
  empresa_id: z.string().optional().nullable(),
  nave_id: z.string().optional().nullable(),
});

// POST /api/portal/buscar
// Busca al candidato por teléfono y empresa/nave
export async function POST(request: Request) {
  // Endpoint público: rate limit para frenar la enumeración de teléfonos
  const rl = rateLimit(request, 20);
  if (!rl.success) {
    return NextResponse.json({ error: 'Demasiados intentos, espera un momento.' }, { status: 429 });
  }

  try {
    const rawBody = await request.json();
    const parsed = bodySchema.safeParse(rawBody);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', detail: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { telefono, empresa_id, nave_id } = parsed.data;

    // Sanitize phone number to digits only
    const digitsOnly = telefono.replace(/\D/g, '');
    if (digitsOnly.length < 8) {
      return NextResponse.json(
        { error: 'Por favor ingresa un número de teléfono válido de 10 dígitos.' },
        { status: 400 }
      );
    }

    // Prepare search variations (e.g. 3323379399, 523323379399, 5213323379399)
    const last10 = digitsOnly.slice(-10);
    const searchPattern = `%${last10}%`;

    let query = `
      SELECT id, telefono, nombre, nombre_chat, nombre_solicitud, 
             vacante_interes, nave_interes, estado, alerta_identidad_estado,
             alerta_identidad_motivo, asignado_a, empresa_id, nave_id,
             tiene_cv, link_cv, cv_manual, datos_ine, datos_rfc
      FROM candidatos
      WHERE (telefono ILIKE $1 OR REPLACE(telefono, '+', '') ILIKE $1)
    `;
    const params: any[] = [searchPattern];
    let idx = 2;

    if (empresa_id) {
      query += ` AND (empresa_id = $${idx} OR empresa_id IS NULL)`;
      params.push(empresa_id);
      idx++;
    }

    if (nave_id) {
      query += ` AND (nave_id = $${idx} OR nave_id IS NULL)`;
      params.push(nave_id);
      idx++;
    }

    query += ` ORDER BY updated_at DESC LIMIT 1`;

    const res = await pool.query(query, params);

    if (res.rowCount === 0) {
      return NextResponse.json({
        encontrado: false,
        mensaje: 'No se encontró una solicitud activa registrada con ese número de teléfono en la empresa seleccionada. Tu expediente sigue en espera de autorización del reclutador.',
      });
    }

    const cand = res.rows[0];
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
      candidato: {
        id: cand.id,
        telefono: cand.telefono,
        nombre: nombreMostrado,
        vacante_interes: cand.vacante_interes || 'General',
        nave_interes: cand.nave_interes || 'General',
        estado: cand.estado,
        alerta_identidad_estado: cand.alerta_identidad_estado,
        alerta_identidad_motivo: cand.alerta_identidad_motivo,
        tiene_cv: tieneCvRegistrado,
        link_cv: cand.link_cv || null,
        tiene_archivos_previos: tieneInePrevio || tieneRfcPrevio || tieneCvPrevio,
      },
    });
  } catch (err) {
    console.error('Error en /api/portal/buscar:', err);
    return NextResponse.json({ error: 'Error al buscar candidato' }, { status: 500 });
  }
}
