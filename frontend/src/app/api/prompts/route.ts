import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

// Resolviendo ruta: desde frontend hacia virgo_data/prompts
const PROMPTS_DIR = path.join(process.cwd(), "..", "virgo_data", "prompts");

export async function GET() {
  try {
    // 1. Leer directorio
    const files = await fs.readdir(PROMPTS_DIR);
    
    // 2. Filtrar solo .md y .txt
    const editableFiles = files.filter(f => f.endsWith(".md") || f.endsWith(".txt"));
    
    // 3. Leer contenido de cada uno
    const promptsData = await Promise.all(
      editableFiles.map(async (filename) => {
        const filePath = path.join(PROMPTS_DIR, filename);
        const content = await fs.readFile(filePath, "utf-8");
        return { filename, content };
      })
    );

    return NextResponse.json({ success: true, files: promptsData });
  } catch (error: any) {
    console.error("Error reading prompts:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { filename, content } = await request.json();

    if (!filename || content === undefined) {
      return NextResponse.json({ success: false, error: "Missing filename or content" }, { status: 400 });
    }

    // Validar que el archivo sea .md o .txt para evitar que modifiquen algo indebido
    if (!filename.endsWith(".md") && !filename.endsWith(".txt")) {
      return NextResponse.json({ success: false, error: "Invalid file type" }, { status: 400 });
    }

    const filePath = path.join(PROMPTS_DIR, filename);
    await fs.writeFile(filePath, content, "utf-8");

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error saving prompt:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
