import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

import { pool } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { syncPromptContextDisk } from "@/lib/syncPromptContext";

/**
 * Prompt de la IA por empresa (`empresas.prompt_ia`), que es lo que edita la
 * pantalla /prompt.
 *
 * Antes esta ruta leía y escribía el archivo virgo_data/prompts/chat_prompt.md
 * y no la usaba nadie; la pantalla guardaba contra /api/db/empresas con método
 * PUT, que esa ruta no expone (solo PATCH), así que el guardado devolvía 405 y
 * el prompt nunca se llegaba a modificar.
 *
 * El archivo sigue existiendo como PLANTILLA: cuando una empresa todavía no
 * tiene prompt propio se devuelve su contenido para que haya de dónde partir,
 * en vez de un editor en blanco.
 */

const PLANTILLA_PATHS = [
  path.resolve(process.cwd(), "..", "virgo_data", "prompts", "chat_prompt.md"),
  path.resolve(process.cwd(), "virgo_data", "prompts", "chat_prompt.md"),
  "/app/virgo_files/prompts/chat_prompt.md",
];

async function leerPlantilla(): Promise<string> {
  for (const p of PLANTILLA_PATHS) {
    try {
      return await fs.readFile(p, "utf-8");
    } catch {
      // siguiente ruta candidata
    }
  }
  return "";
}

/** ROOT administra cualquier empresa; ADMIN solo la suya. */
async function resolverAcceso(request: Request, empresaIdPedida?: string | null) {
  const session = await getSession(request);
  if (!session) return { error: "No autorizado", status: 401 as const };

  const rol = (session.rol as string) || "USER";
  if (rol !== "ROOT" && rol !== "ADMIN") {
    return { error: "Solo un administrador puede editar el prompt", status: 403 as const };
  }

  const empresaDelUsuario = (session.empresa_id as string | null) ?? null;
  // Un ADMIN queda amarrado a su empresa aunque mande otro id por query.
  let empresaId = rol === "ROOT" ? (empresaIdPedida || empresaDelUsuario) : empresaDelUsuario;

  // El superusuario ROOT es global y no pertenece a ninguna empresa: si no
  // indica cuál quiere editar, se toma la más antigua (que en una instalación
  // de un solo cliente es la única).
  if (!empresaId && rol === "ROOT") {
    const primera = await pool.query(`SELECT id FROM empresas ORDER BY created_at ASC LIMIT 1`);
    empresaId = primera.rows[0]?.id ?? null;
  }

  if (!empresaId) {
    return { error: "No hay ninguna empresa registrada todavía", status: 400 as const };
  }
  return { empresaId, rol };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const acceso = await resolverAcceso(request, searchParams.get("empresa_id"));
  if ("error" in acceso) {
    return NextResponse.json({ success: false, error: acceso.error }, { status: acceso.status });
  }

  try {
    const res = await pool.query(
      `SELECT id, nombre, COALESCE(prompt_ia, '') AS prompt_ia FROM empresas WHERE id = $1`,
      [acceso.empresaId]
    );
    if (res.rowCount === 0) {
      return NextResponse.json({ success: false, error: "Empresa no encontrada" }, { status: 404 });
    }

    const empresa = res.rows[0];
    const tienePropio = Boolean((empresa.prompt_ia || "").trim());

    return NextResponse.json({
      success: true,
      empresa_id: empresa.id,
      empresa_nombre: empresa.nombre,
      // `personalizado: false` avisa a la pantalla de que lo que se muestra es
      // la plantilla global y todavía no hay nada guardado para esta empresa.
      personalizado: tienePropio,
      prompt: tienePropio ? empresa.prompt_ia : await leerPlantilla(),
    });
  } catch (error) {
    console.error("Error leyendo el prompt:", error);
    return NextResponse.json({ success: false, error: "Error al leer el prompt" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const acceso = await resolverAcceso(request, body?.empresa_id);
  if ("error" in acceso) {
    return NextResponse.json({ success: false, error: acceso.error }, { status: acceso.status });
  }

  const prompt = body?.prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ success: false, error: "El prompt no puede quedar vacío" }, { status: 400 });
  }

  try {
    const res = await pool.query(
      `UPDATE empresas SET prompt_ia = $1 WHERE id = $2 RETURNING id`,
      [prompt, acceso.empresaId]
    );
    if (res.rowCount === 0) {
      return NextResponse.json({ success: false, error: "Empresa no encontrada" }, { status: 404 });
    }

    // El agente no lee esta tabla directamente: toma `prompt_base` de
    // virgo_data/data/prompt_context.json. Sin regenerarlo, el cambio se
    // guardaría en la base y el bot seguiría con el prompt anterior.
    await syncPromptContextDisk(acceso.empresaId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error guardando el prompt:", error);
    return NextResponse.json({ success: false, error: "Error al guardar el prompt" }, { status: 500 });
  }
}
