import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import fs from 'fs';
import path from 'path';
import { verifyInternalApiKey } from '@/lib/auth';

// Prompt global de respaldo cuando la empresa no tiene un prompt_ia propio configurado
function getGlobalPromptBase(): string {
  const candidatePaths = [
    path.join(process.cwd(), '..', 'virgo_data', 'prompts', 'chat_prompt.md'),
    path.join(process.cwd(), 'virgo_data', 'prompts', 'chat_prompt.md'),
    '/home/node/virgo_files/prompts/chat_prompt.md',
  ];

  for (const p of candidatePaths) {
    try {
      if (fs.existsSync(p)) {
        return fs.readFileSync(p, 'utf-8');
      }
    } catch (err) {}
  }
  console.error('Error leyendo el prompt global de respaldo en todas las rutas candidatas.');
  return 'Error: No se pudo cargar el prompt base del sistema.';
}

/**
 * GET /api/prompt-context?empresa_id=xxx
 *
 * Genera dinamicamente desde PostgreSQL todo el contexto que necesita la IA de n8n:
 * - prompt_base: Plantilla del prompt (override de la empresa si existe, si no el global)
 * - menu_naves: Lista de sucursales con direccion y link
 * - menu_vacantes: Listado simple de nombres de vacantes por nave
 * - detalle_vacantes: Detalles completos de cada vacante por nave
 * - equipo_reclutadores: Reemplaza reclutador_vacantes.json (mismo formato)
 *
 * Acceso publico con API key (header x-api-key) para consumo desde n8n.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const empresa_id = searchParams.get('empresa_id');

  if (!verifyInternalApiKey(request)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    // 1. Obtener empresa(s)
    const empresaQuery = empresa_id
      ? `SELECT id, nombre, prompt_ia FROM empresas WHERE id = $1 ORDER BY nombre ASC`
      : `SELECT id, nombre, prompt_ia FROM empresas ORDER BY nombre ASC`;
    const empresaParams = empresa_id ? [empresa_id] : [];
    const empresasRes = await pool.query(empresaQuery, empresaParams);
    const empresas = empresasRes.rows;

    if (empresas.length === 0) {
      return NextResponse.json({
        prompt_base: getGlobalPromptBase(),
        menu_naves: 'No hay sucursales registradas.',
        menu_vacantes: 'No hay vacantes disponibles por el momento.',
        detalle_vacantes: 'Informacion no disponible.',
        equipo_reclutadores: [],
      });
    }

    // El prompt_ia de la empresa (si se definio uno en el panel SaaS) sobreescribe el prompt global
    const empresaPromptIa = empresa_id ? (empresas[0]?.prompt_ia || '').trim() : '';
    const prompt_base = empresaPromptIa || getGlobalPromptBase();

    const empresaIds = empresas.map((e: any) => e.id);

    // 2. Obtener naves activas de esas empresas
    // Las naves se numeran segun su orden de creacion por empresa
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

    // 3. Obtener reclutadores activos con sus vacantes
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

    // 4. Agrupar reclutadores => equipo_reclutadores
    const recMap = new Map<string, any>();
    for (const row of reclutadoresRes.rows) {
      if (!recMap.has(row.reclutador_id)) {
        recMap.set(row.reclutador_id, {
          reclutador_id: row.reclutador_id,
          nombre: row.nombre,
          activo: true,
          telefono: row.telefono || '',
          calendar_id: row.calendar_id || '',
          color: row.color || '#6366f1',
          usuario: row.usuario || '',
          empresa_id: row.empresa_id,
          vacantes: [],
        });
      }
      if (row.vacante_id) {
        let navesArr: string[] = [];
        if (typeof row.vacante_naves === 'string') {
          try { navesArr = JSON.parse(row.vacante_naves); } catch { navesArr = []; }
        } else {
          navesArr = row.vacante_naves || [];
        }
        recMap.get(row.reclutador_id)!.vacantes.push({
          id: row.vacante_id,
          nombre: row.vacante_nombre,
          naves: navesArr,
          detalles: row.detalles || '',
          palabras_clave: row.palabras_clave || '',
          filtros: row.filtros || [],
        });
      }
    }
    const equipo_reclutadores = Array.from(recMap.values());

    // 5. Construir menu_naves usando numero calculado y ubicacion_maps
    const menu_naves_lines: string[] = [];
    for (const nav of naves) {
      let line = `${nav.numero}. ${nav.nombre}`;
      if (nav.ubicacion_maps) {
        line += '\n   ' + '\uD83D\uDCCD' + ` ${nav.ubicacion_maps}`;
      }
      menu_naves_lines.push(line);
    }
    const menu_naves = menu_naves_lines.length > 0
      ? menu_naves_lines.join('\n')
      : 'No hay sucursales registradas.';

    // 6. Recopilar vacantes unicas
    const todasLasVacantes: Array<{ nombre: string; detalles: string; naves: string[] }> = [];
    for (const rec of equipo_reclutadores) {
      for (const vac of rec.vacantes) {
        if (!todasLasVacantes.some((v: any) => v.nombre === vac.nombre)) {
          todasLasVacantes.push({ nombre: vac.nombre, detalles: vac.detalles, naves: vac.naves });
        }
      }
    }

    // Mapa nave_id (UUID real, tal como se guarda en vacantes_def.naves) => { numero, naveName, vacantes[] }
    // El "numero" (secuencial por empresa) solo se usa para el texto que ve la IA/n8n
    // ("--- SUCURSAL {numero}: ---"), nunca como llave de cruce con las vacantes.
    const naveMap = new Map<string, { numero: number; naveName: string; vacantes: Array<{ nombre: string; detalles: string }> }>();
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

    // 7. Construir menu_vacantes y detalle_vacantes
    const menuVacantesParts: string[] = [];
    const detalleVacantesParts: string[] = [];
    for (const navData of naveMap.values()) {
      if (navData.vacantes.length === 0) continue;
      const header = `--- SUCURSAL ${navData.numero}: ${navData.naveName} ---`;
      const menuLines = navData.vacantes.map((v: any, i: number) => `*${i + 1}. ${v.nombre}*`).join('\n');
      menuVacantesParts.push(`${header}\n${menuLines}`);
      const detalleLines = navData.vacantes
        .map((v: any, i: number) => `*${i + 1}. ${v.nombre}*\n${v.detalles || '(Sin detalles registrados)'}`)
        .join('\n\n---\n\n');
      detalleVacantesParts.push(`${header}\n${detalleLines}`);
    }

    const menu_vacantes = menuVacantesParts.length > 0
      ? menuVacantesParts.join('\n\n')
      : 'No hay vacantes disponibles por el momento.';
    const detalle_vacantes = detalleVacantesParts.length > 0
      ? detalleVacantesParts.join('\n\n')
      : 'Informacion no disponible.';

    return NextResponse.json({
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
    });

  } catch (err) {
    console.error('Error generating prompt-context:', err);
    return NextResponse.json({ error: 'Error generando contexto' }, { status: 500 });
  }
}
