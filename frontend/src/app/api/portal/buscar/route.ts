import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';

const bodySchema = z.object({
  telefono: z.string().min(10, 'El número telefónico debe tener 10 dígitos'),
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
        { error: 'Datos inválidos', detail: z.flattenError(parsed.error) },
        { status: 400 }
      );
    }

    const { telefono, empresa_id, nave_id } = parsed.data;

    // Sanitize phone number to digits only.
    // Se exigen los 10 dígitos completos: con 8 bastaba para que el patrón
    // `%12345678%` hiciera match por SUBCADENA contra cualquier teléfono que
    // los contuviera, así que un tercero podía sacar el expediente de alguien
    // más probando fragmentos, sin conocer el número completo.
    const digitsOnly = telefono.replace(/\D/g, '');
    if (digitsOnly.length < 10) {
      return NextResponse.json(
        { error: 'Por favor ingresa un número de teléfono válido de 10 dígitos.' },
        { status: 400 }
      );
    }

    // Match por SUFIJO, no por subcadena: el teléfono guardado trae prefijos
    // de país/operador variables (3323379399, 523323379399, 5213323379399),
    // pero siempre termina en los mismos 10 dígitos.
    const last10 = digitsOnly.slice(-10);
    const searchPattern = `%${last10}`;

    let query = `
      SELECT id, telefono, nombre, nombre_chat, nombre_solicitud, 
             vacante_interes, nave_interes, estado, alerta_identidad_estado,
             alerta_identidad_motivo, asignado_a_id, empresa_id, nave_id,
             tiene_cv, link_cv, cv_manual, datos_ine, datos_rfc
      FROM candidatos
      WHERE (telefono ILIKE $1 OR REPLACE(telefono, '+', '') ILIKE $1)
    `;
    const params: unknown[] = [searchPattern];
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
