import { pool } from "@/lib/db";
import fs from "fs";
import path from "path";

function getGlobalPromptBase(): string {
  const candidatePaths = [
    path.join(process.cwd(), "..", "virgo_data", "prompts", "chat_prompt.md"),
    path.join(process.cwd(), "virgo_data", "prompts", "chat_prompt.md"),
    path.join(process.cwd(), "..", "virgo_data", "workflows", "chat_prompt.md"),
    path.join(process.cwd(), "virgo_data", "workflows", "chat_prompt.md"),
    "/home/node/virgo_files/prompts/chat_prompt.md",
    "/home/node/virgo_files/workflows/chat_prompt.md",
  ];

  for (const p of candidatePaths) {
    try {
      if (fs.existsSync(p)) {
        return fs.readFileSync(p, "utf-8");
      }
    } catch {}
  }
  return "Error: No se pudo cargar el prompt base del sistema.";
}

/**
 * Genera automáticamente el objeto prompt_context desde PostgreSQL
 * y lo escribe inmediatamente en virgo_data/data/prompt_context.json (y rutas montadas)
 * para que n8n y la IA tengan la información actualizada sin acción manual.
 */
export async function syncPromptContextDisk(empresaIdTarget?: string) {
  try {
    const empresaQuery = empresaIdTarget
      ? `SELECT id, nombre, prompt_ia FROM empresas WHERE id = $1 ORDER BY nombre ASC`
      : `SELECT id, nombre, prompt_ia FROM empresas ORDER BY nombre ASC`;
    const empresaParams = empresaIdTarget ? [empresaIdTarget] : [];
    const empresasRes = await pool.query(empresaQuery, empresaParams);
    const empresas = empresasRes.rows;

    if (empresas.length === 0) return;

    const empresaPromptIa = (empresas[0]?.prompt_ia || "").trim();
    const prompt_base = empresaPromptIa || getGlobalPromptBase();
    const empresaIds = empresas.map((e: any) => e.id);

    // 2. Naves
    const navesRes = await pool.query(
      `SELECT
         n.id,
         n.nombre,
         n.ubicacion_maps,
         n.empresa_id,
         ROW_NUMBER() OVER (PARTITION BY n.empresa_id ORDER BY n.created_at ASC) AS numero
       FROM naves n
       WHERE n.empresa_id = ANY($1::uuid[])
       ORDER BY n.empresa_id, n.created_at ASC`,
      [empresaIds]
    );
    const naves = navesRes.rows;

    // 3. Reclutadores y Vacantes
    const reclutadoresRes = await pool.query(
      `SELECT
         r.id AS reclutador_id,
         r.nombre,
         r.telefono,
         r.calendar_id,
         r.color,
         r.empresa_id,
         u.usuario,
         v.id AS vacante_id,
         v.nombre AS vacante_nombre,
         v.naves AS vacante_naves,
         v.detalles,
         v.palabras_clave,
         v.filtros,
         v.orden
       FROM reclutadores r
       LEFT JOIN usuarios u ON r.id = u.reclutador_id
       LEFT JOIN vacantes_def v ON r.id = v.reclutador_id AND v.activa = true
       WHERE r.activo = true AND r.empresa_id = ANY($1::uuid[])
       ORDER BY r.created_at ASC, v.orden ASC`,
      [empresaIds]
    );

    const recMap = new Map<string, any>();
    for (const row of reclutadoresRes.rows) {
      if (!recMap.has(row.reclutador_id)) {
        recMap.set(row.reclutador_id, {
          reclutador_id: row.reclutador_id,
          nombre: row.nombre,
          activo: true,
          telefono: row.telefono || "",
          calendar_id: row.calendar_id || "",
          color: row.color || "#6366f1",
          usuario: row.usuario || "",
          empresa_id: row.empresa_id,
          vacantes: [],
        });
      }
      if (row.vacante_id) {
        let navesArr: string[] = [];
        if (typeof row.vacante_naves === "string") {
          try {
            navesArr = JSON.parse(row.vacante_naves);
          } catch {
            navesArr = [];
          }
        } else {
          navesArr = row.vacante_naves || [];
        }
        recMap.get(row.reclutador_id)!.vacantes.push({
          id: row.vacante_id,
          nombre: row.vacante_nombre,
          naves: navesArr,
          detalles: row.detalles || "",
          palabras_clave: row.palabras_clave || "",
          filtros: row.filtros || [],
        });
      }
    }
    const equipo_reclutadores = Array.from(recMap.values());

    // 4. Menu naves
    const menu_naves_lines: string[] = [];
    for (const nav of naves) {
      let line = `${nav.numero}. ${nav.nombre}`;
      if (nav.ubicacion_maps) {
        line += "\n   " + "📍" + ` ${nav.ubicacion_maps}`;
      }
      menu_naves_lines.push(line);
    }
    const menu_naves =
      menu_naves_lines.length > 0
        ? menu_naves_lines.join("\n")
        : "No hay sucursales registradas.";

    // 5. Vacantes únicas y mapeo por nave
    const todasLasVacantes: Array<{ nombre: string; detalles: string; naves: string[] }> = [];
    for (const rec of equipo_reclutadores) {
      for (const vac of rec.vacantes) {
        if (!todasLasVacantes.some((v: any) => v.nombre === vac.nombre)) {
          todasLasVacantes.push({ nombre: vac.nombre, detalles: vac.detalles, naves: vac.naves });
        }
      }
    }

    const naveMap = new Map<
      string,
      { numero: number; naveName: string; vacantes: Array<{ nombre: string; detalles: string }> }
    >();
    for (const nav of naves) {
      naveMap.set(nav.id, { numero: nav.numero, naveName: nav.nombre, vacantes: [] });
    }

    for (const vac of todasLasVacantes) {
      for (const naveId of vac.naves) {
        if (naveMap.has(naveId)) {
          const navData = naveMap.get(naveId)!;
          if (!navData.vacantes.some((v: any) => v.nombre === vac.nombre)) {
            navData.vacantes.push({ nombre: vac.nombre, detalles: vac.detalles });
          }
        }
      }
    }

    const menuVacantesParts: string[] = [];
    const detalleVacantesParts: string[] = [];
    for (const navData of naveMap.values()) {
      if (navData.vacantes.length === 0) continue;
      const header = `--- SUCURSAL ${navData.numero}: ${navData.naveName} ---`;
      const menuLines = navData.vacantes
        .map((v: any, i: number) => `*${i + 1}. ${v.nombre}*`)
        .join("\n");
      menuVacantesParts.push(`${header}\n${menuLines}`);
      const detalleLines = navData.vacantes
        .map((v: any, i: number) => `*${i + 1}. ${v.nombre}*\n${v.detalles || "(Sin detalles registrados)"}`)
        .join("\n\n---\n\n");
      detalleVacantesParts.push(`${header}\n${detalleLines}`);
    }

    const menu_vacantes =
      menuVacantesParts.length > 0
        ? menuVacantesParts.join("\n\n")
        : "No hay vacantes disponibles por el momento.";
    const detalle_vacantes =
      detalleVacantesParts.length > 0
        ? detalleVacantesParts.join("\n\n")
        : "Informacion no disponible.";

    const contextPayload = {
      prompt_base,
      menu_naves,
      menu_vacantes,
      detalle_vacantes,
      equipo_reclutadores,
      _meta: {
        empresas: empresas.map((e: any) => ({ id: e.id, nombre: e.nombre })),
        total_reclutadores: equipo_reclutadores.length,
        total_vacantes_unicas: todasLasVacantes.length,
        generated_at: new Date().toISOString(),
      },
    };

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
