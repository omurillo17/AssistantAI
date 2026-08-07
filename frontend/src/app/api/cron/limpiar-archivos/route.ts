import { NextResponse } from 'next/server';

import { pool } from '@/lib/db';
import { verifyInternalApiKey } from '@/lib/auth';
import { deleteUploadedFile, extractFileUrl } from '@/lib/fileStorage';

/**
 * GET /api/cron/limpiar-archivos
 *
 * Borra los archivos (CV/INE/RFC) de candidatos que llevan cerrados
 * (RECHAZADO, CONTRATADO, INACTIVO) más tiempo del que la empresa configuró
 * en `empresas.retencion_archivos_dias` (30 por defecto). Solo se borran los
 * archivos y se limpian esas columnas — el candidato y su historial de
 * conversación se conservan para reportes.
 *
 * Pensado para ser disparado periodicamente por un Schedule Trigger de n8n
 * (workflow "5_Sofia - Mantenimiento y Errores"), mismo patron que
 * /api/cron/process-outbox.
 */
export async function GET(request: Request) {
  if (!verifyInternalApiKey(request)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const res = await pool.query(`
      SELECT c.id, c.link_cv, c.datos_ine, c.datos_rfc
      FROM candidatos c
      LEFT JOIN empresas e ON e.id = c.empresa_id
      WHERE c.estado IN ('RECHAZADO', 'CONTRATADO', 'INACTIVO')
        AND c.updated_at < NOW() - (COALESCE(e.retencion_archivos_dias, 30) || ' days')::interval
        AND (c.link_cv IS NOT NULL OR c.datos_ine IS NOT NULL OR c.datos_rfc IS NOT NULL)
      LIMIT 200
    `);

    let candidatosLimpiados = 0;
    let archivosBorrados = 0;

    for (const row of res.rows) {
      const urls = [
        row.link_cv as string | null,
        extractFileUrl(row.datos_ine),
        extractFileUrl(row.datos_rfc),
      ].filter((u): u is string => !!u);

      for (const url of urls) {
        await deleteUploadedFile(url);
        archivosBorrados++;
      }

      await pool.query(
        `UPDATE candidatos
         SET link_cv = NULL, datos_ine = NULL, datos_rfc = NULL, tiene_cv = false
         WHERE id = $1`,
        [row.id]
      );
      candidatosLimpiados++;
    }

    return NextResponse.json({ ok: true, candidatosLimpiados, archivosBorrados });
  } catch (err) {
    console.error('Error limpiando archivos de candidatos:', err);
    return NextResponse.json({ error: 'Error al limpiar archivos' }, { status: 500 });
  }
}
