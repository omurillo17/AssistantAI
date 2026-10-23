import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { sniffDocumentType } from '@/lib/file-validation';
import { deleteUploadedFile, UPLOAD_DIR } from '@/lib/fileStorage';
import { normalizarTelefonoPortal } from '../telefono';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB limit
// Tope del request completo (INE + RFC + CV de 10 MB + overhead multipart),
// revisado ANTES de parsear el formData para no cargar en memoria cuerpos gigantes.
const MAX_REQUEST_SIZE = 3 * MAX_FILE_SIZE + 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp']);
// Valores de `tipo_documento` para el envío de un solo archivo (`file`).
const tipoDocumentoSchema = z.enum(['ine', 'rfc', 'cv']);
const empresaIdSchema = z.guid().nullable();
const ERROR_ASOCIAR = 'No pudimos asociar los archivos a tu expediente. Contacta a tu reclutador.';

function validateFile(fileObj: File | null, label: string) {
  if (!fileObj) return null;
  if (fileObj.size > MAX_FILE_SIZE) {
    return `El archivo de ${label} excede el límite máximo de 10 MB.`;
  }
  const ext = path.extname(fileObj.name || '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return `Formato no permitido en ${label}. Solo se aceptan PDF o imágenes (JPG, PNG, WEBP).`;
  }
  return null;
}

async function saveFile(fileObj: File, suffix: string, safeTelefono: string) {
  const arrayBuffer = await fileObj.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  // La extensión se determina por el contenido real (magic bytes), no por
  // el nombre del archivo, para impedir subir HTML/scripts disfrazados.
  const ext = sniffDocumentType(buffer);
  if (!ext || ext === '.doc' || ext === '.docx') {
    throw new Error('FORMATO_NO_PERMITIDO');
  }
  const finalFilename = `portal_${safeTelefono}_${suffix}_${Date.now()}${ext}`;
  // Defensa en profundidad: la ruta final tiene que quedar dentro de /uploads.
  const filePath = path.resolve(UPLOAD_DIR, finalFilename);
  if (!filePath.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) {
    throw new Error('FORMATO_NO_PERMITIDO');
  }
  await writeFile(filePath, buffer);
  return `/uploads/${finalFilename}`;
}

async function processUploadedDocuments(
  formData: FormData,
  tipoDoc: z.infer<typeof tipoDocumentoSchema>,
  safeTelefono: string,
  cand: Record<string, unknown>,
  datosIneObj: Record<string, unknown>,
  datosRfcObj: Record<string, unknown>
) {
  const fileIne = formData.get('file_ine') as File | null;
  const fileRfc = formData.get('file_rfc') as File | null;
  const fileCv = formData.get('file_cv') as File | null;
  const singleFile = formData.get('file') as File | null;

  let urlIne: string | null = null;
  let urlRfc: string | null = null;
  let urlCv: string | null = null;

  if (fileIne) {
    await deleteUploadedFile(datosIneObj?.url as string | null);
    urlIne = await saveFile(fileIne, 'ine', safeTelefono);
  }
  if (fileRfc) {
    await deleteUploadedFile(datosRfcObj?.url as string | null);
    urlRfc = await saveFile(fileRfc, 'rfc', safeTelefono);
  }
  if (fileCv) {
    await deleteUploadedFile(cand.link_cv as string | null);
    urlCv = await saveFile(fileCv, 'cv', safeTelefono);
  }

  if (singleFile && !urlIne && !urlRfc && !urlCv) {
    const url = await saveFile(singleFile, tipoDoc, safeTelefono);
    if (tipoDoc === 'ine') {
      await deleteUploadedFile(datosIneObj?.url as string | null);
      urlIne = url;
    } else if (tipoDoc === 'rfc') {
      await deleteUploadedFile(datosRfcObj?.url as string | null);
      urlRfc = url;
    } else {
      await deleteUploadedFile(cand.link_cv as string | null);
      urlCv = url;
    }
  }

  return { urlIne, urlRfc, urlCv };
}

export async function POST(request: Request) {
  // Endpoint público: rate limit para evitar abuso de subida de archivos
  const rl = rateLimit(request, 10);
  if (!rl.success) {
    return NextResponse.json({ error: 'Demasiados intentos, espera un momento.' }, { status: 429 });
  }

  const declaredSize = Number(request.headers.get('content-length') || 0);
  if (declaredSize > MAX_REQUEST_SIZE) {
    return NextResponse.json({ error: 'Los archivos exceden el tamaño máximo permitido.' }, { status: 413 });
  }

  try {
    const formData = await request.formData();
    const safeTelefono = normalizarTelefonoPortal(formData.get('telefono'));

    if (!safeTelefono) {
      return NextResponse.json({ error: 'Ingresa un número de teléfono válido de 10 dígitos.' }, { status: 400 });
    }

    const tipoDoc = tipoDocumentoSchema.safeParse(formData.get('tipo_documento') ?? 'ine');
    const empresaId = empresaIdSchema.safeParse(formData.get('empresa_id') || null);
    if (!tipoDoc.success || !empresaId.success) {
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    }

    const fileIne = formData.get('file_ine') as File | null;
    const fileRfc = formData.get('file_rfc') as File | null;
    const fileCv = formData.get('file_cv') as File | null;
    const singleFile = formData.get('file') as File | null;

    if (!fileIne && !fileRfc && !fileCv && !singleFile) {
      return NextResponse.json({ error: 'Debes seleccionar los archivos requeridos para subir.' }, { status: 400 });
    }

    const firstError =
      validateFile(fileIne, 'INE') ||
      validateFile(fileRfc, 'Constancia RFC') ||
      validateFile(fileCv, 'CV / Solicitud') ||
      validateFile(singleFile, 'Documento');
    if (firstError) {
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    if (!fs.existsSync(UPLOAD_DIR)) {
      await mkdir(UPLOAD_DIR, { recursive: true });
    }

    // Match por SUFIJO exacto de 10 dígitos (igual que /api/portal/buscar),
    // nunca por subcadena: con LIKE '%...%' un fragmento bastaba para
    // sobrescribir los documentos de otra persona.
    const candRes = await pool.query(
      `SELECT id, empresa_id, nombre, nombre_chat, nombre_solicitud, asignado_a_id, datos_ine, datos_rfc, link_cv
       FROM candidatos
       WHERE RIGHT(regexp_replace(telefono, '\\D', '', 'g'), 10) = $1
         AND ($2::uuid IS NULL OR empresa_id = $2::uuid)
       ORDER BY updated_at DESC`,
      [safeTelefono, empresaId.data]
    );

    if (candRes.rowCount === 0) {
      return NextResponse.json(
        { error: 'Candidato no encontrado para asociar los archivos.' },
        { status: 404 }
      );
    }

    // El mismo teléfono en dos empresas: sin empresa_id no hay forma segura
    // de saber a qué expediente pertenecen los archivos.
    if (new Set(candRes.rows.map((r) => r.empresa_id)).size > 1) {
      return NextResponse.json({ error: ERROR_ASOCIAR }, { status: 409 });
    }

    const cand = candRes.rows[0];
    const nombreCandidato = cand.nombre || cand.nombre_chat || cand.nombre_solicitud || 'Candidato';

    let datosIneObj = typeof cand.datos_ine === 'string' ? (() => { try { return JSON.parse(cand.datos_ine); } catch { return {}; } })() : (cand.datos_ine || {});
    let datosRfcObj = typeof cand.datos_rfc === 'string' ? (() => { try { return JSON.parse(cand.datos_rfc); } catch { return {}; } })() : (cand.datos_rfc || {});

    const { urlIne, urlRfc, urlCv } = await processUploadedDocuments(
      formData,
      tipoDoc.data,
      safeTelefono,
      cand,
      datosIneObj,
      datosRfcObj
    );

    if (urlIne) {
      datosIneObj = { ...datosIneObj, url: urlIne, fecha_carga_portal: new Date().toISOString() };
    }
    if (urlRfc) {
      datosRfcObj = { ...datosRfcObj, url: urlRfc, fecha_carga_portal: new Date().toISOString() };
    }

    const motivoOcr = `⚠️ Documentos subidos manualmente desde el portal: validar la identidad del candidato antes de avanzar.`;

    // El estado NO se avanza aquí: el portal es público y solo pide un
    // teléfono, así que la identidad queda PENDIENTE hasta que un reclutador
    // la valide (validar-identidad es quien pasa a INE_VALIDADA).
    await pool.query(
      `UPDATE candidatos
       SET alerta_identidad_estado = 'PENDIENTE',
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
    const mensajeNotif = `⚠️ El candidato ${nombreCandidato} (wa.me/52${safeTelefono}) subió sus documentos desde el portal. Valida su identidad antes de avanzar.`;

    await pool.query(
      `INSERT INTO notificaciones (reclutador_id, mensaje)
       VALUES (
         $1,
         $2
       )`,
      [cand.asignado_a_id || null, mensajeNotif]
    );

    return NextResponse.json({
      success: true,
      mensaje: '¡Tus documentos fueron recibidos! Un reclutador los revisará para continuar con tu proceso.',
      url_ine: urlIne,
      url_rfc: urlRfc,
      url_cv: urlCv,
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
