import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import fs from 'node:fs';
import { verifyInternalApiKey } from '@/lib/auth';
import { sniffDocumentType } from '@/lib/file-validation';

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB

async function extractBufferFromRequest(request: Request): Promise<{ buffer: Buffer; telefonoFromForm?: string | null }> {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const fileData = formData.get('data');
    const telefonoFromForm = formData.get('telefono') as string | null;

    if (!fileData) {
      throw new Error("NO_FILE");
    }

    if (typeof fileData === 'string') {
      if (fileData === 'undefined' || fileData === 'null' || !fileData.trim()) {
        throw new Error("INVALID_DATA");
      }
      const cleanStr = fileData.replace(/^data:application\/pdf;base64,/, '');
      return { buffer: Buffer.from(cleanStr, 'base64'), telefonoFromForm };
    }
    const file = fileData as File;
    return { buffer: Buffer.from(await file.arrayBuffer()), telefonoFromForm };
  }

  const arrayBuffer = await request.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer) };
}

function validateFileBuffer(buffer: Buffer): string | null {
  if (buffer.length === 0 || (buffer.length <= 20 && buffer.toString().includes('undefined'))) {
    return "El archivo enviado está vacío o corrupto";
  }
  if (buffer.length > MAX_FILE_SIZE) {
    return "El archivo excede el límite máximo de 15 MB";
  }
  return null;
}

export async function POST(request: Request) {
  if (!verifyInternalApiKey(request)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    let telefono = searchParams.get('telefono');

    let buffer: Buffer;
    try {
      const extracted = await extractBufferFromRequest(request);
      buffer = extracted.buffer;
      if (!telefono) telefono = extracted.telefonoFromForm || null;
    } catch (extractErr) {
      if (extractErr instanceof Error && extractErr.message === "NO_FILE") {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }
      if (extractErr instanceof Error && extractErr.message === "INVALID_DATA") {
        return NextResponse.json({ error: "Datos de archivo inválidos" }, { status: 400 });
      }
      throw extractErr;
    }

    const validationError = validateFileBuffer(buffer);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    // La extensión se decide por el CONTENIDO real del archivo (magic bytes),
    // no por el nombre que declare el cliente. Si no es un formato de
    // documento/imagen permitido, se rechaza.
    const ext = sniffDocumentType(buffer);
    if (!ext) {
      return NextResponse.json(
        { error: 'Formato de archivo no permitido. Solo PDF, imágenes (JPG/PNG/WEBP) o Word.' },
        { status: 400 }
      );
    }

    // Fallback if telefono is not provided
    if (!telefono || telefono === 'undefined' || telefono === 'null') {
      telefono = `candidato_${Date.now()}`;
    }

    const safeTelefono = telefono.replace(/[^a-zA-Z0-9]/g, "");
    const timestamp = Date.now();

    // Example: 5213323379399_17300000000.pdf
    const finalFilename = `${safeTelefono}_${timestamp}${ext}`;

    const uploadDir = path.join(process.cwd(), 'public', 'uploads');

    if (!fs.existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    const filePath = path.join(uploadDir, finalFilename);
    await writeFile(filePath, buffer);

    // The public URL path
    const fileUrl = `/uploads/${finalFilename}`;

    return NextResponse.json({ url: fileUrl });
  } catch (e) {
    console.error("Error uploading file:", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
