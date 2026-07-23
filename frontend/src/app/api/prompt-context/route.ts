import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

/**
 * GET /api/prompt-context?empresa_id=xxx
 *
 * Genera dinamicamente desde PostgreSQL todo el contexto que necesita la IA de n8n:
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

  const apiKey = request.headers.get('x-api-key');
  const expectedKey = process.env.N8N_API_KEY;
  if (expectedKey && apiKey !== expectedKey) {
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
        menu_naves: 'No hay sucursales registradas.',
        menu_vacantes: 'No hay vacantes disponibles por el momento.',
        detalle_vacantes: 'Informacion no disponible.',
        equipo_reclutadores: [],
      });
    }

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
        const navesArr =
          typeof row.vacante_naves === 'string'
            ? JSON.parse(row.vacante_naves)
            : row.vacante_naves || [];
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

    // Mapa nave_numero => { naveName, vacantes[] }
    const naveMap = new Map<string, { naveName: string; vacantes: Array<{ nombre: string; detalles: string }> }>();
    for (const nav of naves) {
      const key = String(nav.numero);
      naveMap.set(key, { naveName: nav.nombre, vacantes: [] });
    }

    for (const vac of todasLasVacantes) {
      for (const naveKey of vac.naves) {
        const key = String(naveKey);
        if (naveMap.has(key)) {
          const navData = naveMap.get(key)!;
          if (!navData.vacantes.some((v: any) => v.nombre === vac.nombre)) {
            navData.vacantes.push({ nombre: vac.nombre, detalles: vac.detalles });
          }
        }
      }
    }

    // 7. Construir menu_vacantes y detalle_vacantes
    const menuVacantesParts: string[] = [];
    const detalleVacantesParts: string[] = [];
    for (const [naveKey, navData] of naveMap.entries()) {
      if (navData.vacantes.length === 0) continue;
      const header = `--- SUCURSAL ${naveKey}: ${navData.naveName} ---`;
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
    return NextResponse.json({ error: 'Error generando contexto', details: String(err) }, { status: 500 });
  }
}
