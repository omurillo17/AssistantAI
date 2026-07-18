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
        console.log("fileData was a string, parsing as base64 or raw string");
        buffer = Buffer.from(fileData);
      } else {
        file = fileData as unknown as File;
        originalFilename = (file as any)?.name || 'document.pdf';
        buffer = Buffer.from(await file.arrayBuffer());
      }
    } else {
      // If sent as raw binary body
      const arrayBuffer = await request.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
      if (buffer.length === 0) {
        return NextResponse.json({ error: "Empty request body" }, { status: 400 });
      }
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
