import fs from "node:fs";
import path from "node:path";
import { buildPromptContext } from "@/lib/promptContext";

/**
 * Genera el objeto prompt_context desde PostgreSQL (misma fuente de verdad que
 * GET /api/prompt-context, vía buildPromptContext) y lo escribe en
 * virgo_data/data/prompt_context.json para que el backend Python tenga el
 * catálogo actualizado sin acción manual.
 *
 * El archivo es una CACHÉ, no la fuente de verdad: si no existe, el backend se
 * cae a /api/prompt-context (ver obtener_prompt_context en
 * backend/app/chat/analizador.py). Por eso no se versiona en git.
 */
export async function syncPromptContextDisk(empresaIdTarget?: string) {
  try {
    const contextPayload = await buildPromptContext(empresaIdTarget);

    // Dos rutas porque el cwd depende de cómo se arranque Next.js (desde
    // frontend/ en desarrollo, desde la raíz con algunos supervisores).
    // Ambas resuelven al mismo ./virgo_data, que docker-compose monta dentro
    // del contenedor del backend.
    const targetPaths = [
      path.join(process.cwd(), "..", "virgo_data", "data", "prompt_context.json"),
      path.join(process.cwd(), "virgo_data", "data", "prompt_context.json"),
    ];

    const jsonStr = JSON.stringify(contextPayload, null, 2);
    for (const targetPath of targetPaths) {
      try {
        const dir = path.dirname(targetPath);
        // Solo escribe donde ya exista virgo_data/, para no crear un árbol
        // fantasma desde el cwd equivocado.
        if (fs.existsSync(path.dirname(dir))) {
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(targetPath, jsonStr, "utf8");
        }
      } catch (err) {
        console.error(`No se pudo escribir ${targetPath}:`, err);
      }
    }
  } catch (err) {
    console.error("Error auto-syncing prompt context:", err);
  }
}
