import fs from "fs";
import path from "path";
import { buildPromptContext } from "@/lib/promptContext";

/**
 * Genera automáticamente el objeto prompt_context desde PostgreSQL (misma fuente
 * de verdad que GET /api/prompt-context, vía buildPromptContext) y lo escribe
 * inmediatamente en virgo_data/data/prompt_context.json (y rutas montadas) para
 * que n8n y la IA tengan la información actualizada sin acción manual.
 */
export async function syncPromptContextDisk(empresaIdTarget?: string) {
  try {
    const contextPayload = await buildPromptContext(empresaIdTarget);

    const targetPaths = [
      path.join(process.cwd(), "..", "virgo_data", "data", "prompt_context.json"),
      path.join(process.cwd(), "virgo_data", "data", "prompt_context.json"),
      "/home/node/virgo_files/data/prompt_context.json",
    ];

    const jsonStr = JSON.stringify(contextPayload, null, 2);
    for (const targetPath of targetPaths) {
      try {
        const dir = path.dirname(targetPath);
        if (fs.existsSync(dir)) {
          fs.writeFileSync(targetPath, jsonStr, "utf8");
        }
      } catch {}
    }
  } catch (err) {
    console.error("Error auto-syncing prompt context:", err);
  }
}
