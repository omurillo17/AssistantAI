import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const MIME_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;
    const safeFilename = path.basename(filename);

    const candidateDirs = [
      path.join(process.cwd(), "public", "uploads"),
      path.join(process.cwd(), "..", "virgo_data", "uploads"),
      "/app/public/uploads",
      "/app/virgo_files/uploads",
      "/app/virgo_data/uploads",
    ];

    let filePath: string | null = null;
    for (const dir of candidateDirs) {
      const fullPath = path.join(dir, safeFilename);
      if (fs.existsSync(fullPath)) {
        filePath = fullPath;
        break;
      }
    }

    if (!filePath) {
      return new NextResponse("Archivo no encontrado", { status: 404 });
    }

    const ext = path.extname(safeFilename).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    const fileBuffer = fs.readFileSync(filePath);
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${safeFilename}"`,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("Error serving upload file:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
