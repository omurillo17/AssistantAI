import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import fs from 'fs';

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    let telefono = searchParams.get('telefono');

    let file: File | Blob | null = null;
    let buffer: Buffer;

    let originalFilename = 'document.pdf';

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      console.log("FormData keys:", Array.from(formData.keys()));

      const fileData = formData.get('data');
      if (!telefono) telefono = formData.get('telefono') as string;

      if (!fileData) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }

      if (typeof fileData === 'string') {
        if (fileData === 'undefined' || fileData === 'null' || !fileData.trim()) {
          return NextResponse.json({ error: "Datos de archivo inválidos" }, { status: 400 });
        }
        // Si viene en base64 o texto
        const cleanStr = fileData.replace(/^data:application\/pdf;base64,/, '');
        buffer = Buffer.from(cleanStr, 'base64');
      } else {
        file = fileData as unknown as File;
        originalFilename = (file as any)?.name || 'document.pdf';
        buffer = Buffer.from(await file.arrayBuffer());
      }
    } else {
      // If sent as raw binary body
      const arrayBuffer = await request.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    }

    if (buffer.length === 0 || (buffer.length <= 20 && buffer.toString().includes('undefined'))) {
      return NextResponse.json({ error: "El archivo enviado está vacío o corrupto" }, { status: 400 });
    }

    // Sanitize filename
    const ext = path.extname(originalFilename) || '.pdf';

    // Fallback if telefono is not provided
    if (!telefono || telefono === 'undefined' || telefono === 'null') {
      telefono = `candidato_${Date.now()}`;
    }

    const safeTelefono = telefono.replace(/[^a-zA-Z0-9]/g, "");
    const timestamp = new Date().getTime();

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
