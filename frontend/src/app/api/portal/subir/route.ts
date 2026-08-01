import { NextResponse } from 'next/server';
import { writeFile, mkdir, unlink } from 'fs/promises';
import path from 'path';
import fs from 'fs';
import { pool } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { sniffDocumentType } from '@/lib/file-validation';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB limit
const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];

export async function POST(request: Request) {
  // Endpoint público: rate limit para evitar abuso de subida de archivos
  const rl = rateLimit(request, 10);
  if (!rl.success) {
    return NextResponse.json({ error: 'Demasiados intentos, espera un momento.' }, { status: 429 });
  }

  try {
    const formData = await request.formData();
    const telefono = formData.get('telefono') as string;

    if (!telefono) {
      return NextResponse.json({ error: 'Falta el parámetro teléfono' }, { status: 400 });
    }

    const fileIne = formData.get('file_ine') as File | null;
    const fileRfc = formData.get('file_rfc') as File | null;
    const fileCv = formData.get('file_cv') as File | null;
    const singleFile = formData.get('file') as File | null;

    if (!fileIne && !fileRfc && !fileCv && !singleFile) {
      return NextResponse.json({ error: 'Debes seleccionar los archivos requeridos para subir.' }, { status: 400 });
    }

    // Validar extensión y tamaño de archivos
    const validateFile = (fileObj: File | null, label: string) => {
      if (!fileObj) return null;
      if (fileObj.size > MAX_FILE_SIZE) {
        return `El archivo de ${label} excede el límite máximo de 10 MB.`;
      }
      const ext = path.extname(fileObj.name || '').toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return `Formato no permitido en ${label}. Solo se aceptan PDF o imágenes (JPG, PNG, WEBP).`;
      }
      return null;
    };

    const errIne = validateFile(fileIne, 'INE');
    const errRfc = validateFile(fileRfc, 'Constancia RFC');
    const errCv = validateFile(fileCv, 'CV / Solicitud');
    const errSingle = validateFile(singleFile, 'Documento');

    const firstError = errIne || errRfc || errCv || errSingle;
    if (firstError) {
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const safeTelefono = telefono.replace(/[^a-zA-Z0-9]/g, '');
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    // Buscar candidato previamente para eliminar archivos anteriores si existen
    const candRes = await pool.query(
      `SELECT id, nombre, nombre_chat, nombre_solicitud, asignado_a, datos_ine, datos_rfc, link_cv 
       FROM candidatos 
       WHERE telefono = $1 OR REPLACE(telefono, '+', '') LIKE $2 
       ORDER BY updated_at DESC LIMIT 1`,
      [telefono, `%${safeTelefono.slice(-10)}%`]
    );

    if (candRes.rowCount === 0) {
      return NextResponse.json(
        { error: 'Candidato no encontrado para asociar los archivos.' },
        { status: 404 }
      );
    }

    const cand = candRes.rows[0];
    const nombreCandidato = cand.nombre || cand.nombre_chat || cand.nombre_solicitud || 'Candidato';

    let datosIneObj = typeof cand.datos_ine === 'string' ? (() => { try { return JSON.parse(cand.datos_ine); } catch { return {}; } })() : (cand.datos_ine || {});
    let datosRfcObj = typeof cand.datos_rfc === 'string' ? (() => { try { return JSON.parse(cand.datos_rfc); } catch { return {}; } })() : (cand.datos_rfc || {});

    // Función segura para eliminar archivo anterior si era local
    const deleteOldFile = async (oldUrl: string | null | undefined) => {
      if (!oldUrl || typeof oldUrl !== 'string' || !oldUrl.startsWith('/uploads/')) return;
      try {
        const filename = path.basename(oldUrl);
        const fullPath = path.join(uploadDir, filename);
        if (fs.existsSync(fullPath)) {
          await unlink(fullPath);
        }
      } catch (e) {
        console.warn('No se pudo eliminar el archivo antiguo:', oldUrl, e);
      }
    };

    const saveFile = async (fileObj: File, suffix: string) => {
      const arrayBuffer = await fileObj.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      // La extensión se determina por el contenido real (magic bytes), no por
      // el nombre del archivo, para impedir subir HTML/scripts disfrazados.
      const ext = sniffDocumentType(buffer);
      if (!ext || ext === '.doc' || ext === '.docx') {
        throw new Error('FORMATO_NO_PERMITIDO');
      }
      const finalFilename = `portal_${safeTelefono}_${suffix}_${Date.now()}${ext}`;
      const filePath = path.join(uploadDir, finalFilename);
      await writeFile(filePath, buffer);
      return `/uploads/${finalFilename}`;
    };

    let urlIne: string | null = null;
    let urlRfc: string | null = null;
    let urlCv: string | null = null;

    if (fileIne) {
      await deleteOldFile(datosIneObj?.url);
      urlIne = await saveFile(fileIne, 'ine');
    }
    if (fileRfc) {
      await deleteOldFile(datosRfcObj?.url);
      urlRfc = await saveFile(fileRfc, 'rfc');
    }
    if (fileCv) {
      await deleteOldFile(cand.link_cv);
      urlCv = await saveFile(fileCv, 'cv');
    }

    if (singleFile && !urlIne && !urlRfc && !urlCv) {
      const tipoDoc = (formData.get('tipo_documento') as string) || 'ine';
      const url = await saveFile(singleFile, tipoDoc);
      if (tipoDoc === 'ine') {
        await deleteOldFile(datosIneObj?.url);
        urlIne = url;
      } else if (tipoDoc === 'rfc') {
        await deleteOldFile(datosRfcObj?.url);
        urlRfc = url;
      } else {
        await deleteOldFile(cand.link_cv);
        urlCv = url;
      }
    }

    if (urlIne) {
      datosIneObj = { ...datosIneObj, url: urlIne, fecha_carga_portal: new Date().toISOString() };
    }
    if (urlRfc) {
      datosRfcObj = { ...datosRfcObj, url: urlRfc, fecha_carga_portal: new Date().toISOString() };
    }

    const motivoOcr = `⚠️ Error de OCR: El candidato subió sus archivos manualmente desde el portal, se le permitió el acceso, verificar datos con él.`;

    await pool.query(
      `UPDATE candidatos
       SET estado = 'INE_VALIDADA',
           alerta_identidad_estado = 'PENDIENTE',
           alerta_identidad_motivo = $1,
           datos_ine = $2,
           datos_rfc = $3,
           link_cv = COALESCE($4, link_cv),
           tiene_cv = CASE WHEN $4 IS NOT NULL THEN true ELSE tiene_cv END,
           updated_at = NOW()
       WHERE id = $5`,
      [
        motivoOcr,
        JSON.stringify(datosIneObj),
        JSON.stringify(datosRfcObj),
        urlCv,
        cand.id,
      ]
    );

    // Notificación al reclutador
    const mensajeNotif = `⚠️ Error de OCR: El candidato ${nombreCandidato} (wa.me/${safeTelefono}) subió sus archivos manualmente desde el portal, se le permitió el acceso, verificar datos con él.`;

    await pool.query(
      `INSERT INTO notificaciones (reclutador_id, mensaje)
       VALUES (
         (SELECT id FROM reclutadores WHERE nombre = $1 LIMIT 1),
         $2
       )`,
      [cand.asignado_a || '', mensajeNotif]
    );

    return NextResponse.json({
      success: true,
      mensaje: '¡Todos tus documentos han sido procesados y reemplazados correctamente! Tu expediente está actualizado.',
      url_ine: urlIne,
      url_rfc: urlRfc,
      url_cv: urlCv,
      estado: 'INE_VALIDADA',
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'FORMATO_NO_PERMITIDO') {
      return NextResponse.json(
        { error: 'El contenido del archivo no corresponde a un PDF o imagen válida (JPG, PNG, WEBP).' },
        { status: 400 }
      );
    }
    console.error('Error en /api/portal/subir:', err);
    return NextResponse.json({ error: 'Error interno al procesar los archivos.' }, { status: 500 });
  }
}
