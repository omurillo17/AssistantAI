import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const DATA_FILE = path.join(process.cwd(), "..", "virgo_data", "prompts", "reclutador_vacantes.json");

export async function GET() {
  try {
    const content = await fs.readFile(DATA_FILE, "utf-8");
    const data = JSON.parse(content);
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Error reading reclutador_vacantes:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
