import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getSession } from "@/lib/auth";

// Resolviendo ruta: desde frontend hacia virgo_data/prompts
const PROMPTS_DIR = path.resolve(process.cwd(), "..", "virgo_data", "prompts");

// Solo nombres de archivo simples .md/.txt dentro de PROMPTS_DIR (sin subcarpetas ni "..")
function resolvePromptPath(filename: string): string | null {
  const base = path.basename(filename);
  if (base !== filename) return null;
  if (!base.endsWith(".md") && !base.endsWith(".txt")) return null;
  const fullPath = path.resolve(PROMPTS_DIR, base);
  if (!fullPath.startsWith(PROMPTS_DIR + path.sep)) return null;
  return fullPath;
}

async function requireAdmin(request: Request) {
  const payload = await getSession(request);
  if (!payload) return null;
  const rol = payload.rol as string;
  return rol === "ADMIN" || rol === "ROOT" ? payload : null;
}

export async function GET(request: Request) {
  try {
    if (!(await requireAdmin(request))) {
      return NextResponse.json({ success: false, error: "No autorizado" }, { status: 403 });
    }

    const files = await fs.readdir(PROMPTS_DIR);
    const editableFiles = files.filter(f => f.endsWith(".md") || f.endsWith(".txt"));

    const promptsData = await Promise.all(
      editableFiles.map(async (filename) => {
        const content = await fs.readFile(path.join(PROMPTS_DIR, filename), "utf-8");
        return { filename, content };
      })
    );

    return NextResponse.json({ success: true, files: promptsData });
  } catch (error) {
    console.error("Error reading prompts:", error);
    return NextResponse.json({ success: false, error: "Error al leer los prompts" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!(await requireAdmin(request))) {
      return NextResponse.json({ success: false, error: "No autorizado" }, { status: 403 });
    }

    const { filename, content } = await request.json();

    if (!filename || typeof filename !== "string" || content === undefined) {
      return NextResponse.json({ success: false, error: "Missing filename or content" }, { status: 400 });
    }

    const filePath = resolvePromptPath(filename);
    if (!filePath) {
      return NextResponse.json({ success: false, error: "Invalid file name" }, { status: 400 });
    }

    await fs.writeFile(filePath, content, "utf-8");

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving prompt:", error);
    return NextResponse.json({ success: false, error: "Error al guardar el prompt" }, { status: 500 });
  }
}
