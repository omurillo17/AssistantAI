import { pool } from '@/lib/db';
import fs from 'fs';
import path from 'path';

// Prompt global de respaldo cuando la empresa no tiene un prompt_ia propio configurado
function getGlobalPromptBase(): string {
  const candidatePaths = [
    path.join(process.cwd(), '..', 'virgo_data', 'prompts', 'chat_prompt.md'),
    path.join(process.cwd(), 'virgo_data', 'prompts', 'chat_prompt.md'),
    path.join(process.cwd(), '..', 'virgo_data', 'workflows', 'chat_prompt.md'),
    path.join(process.cwd(), 'virgo_data', 'workflows', 'chat_prompt.md'),
    '/home/node/virgo_files/prompts/chat_prompt.md',
    '/home/node/virgo_files/workflows/chat_prompt.md',
  ];

  for (const p of candidatePaths) {
    try {
      if (fs.existsSync(p)) {
        return fs.readFileSync(p, 'utf-8');
      }
    } catch {}
  }
  console.error('Error leyendo el prompt global de respaldo en todas las rutas candidatas.');
  return 'Error: No se pudo cargar el prompt base del sistema.';
}

type Filtro = {
  id?: string;
  clave?: string;
  etiqueta?: string;
  tipo: string;
  pregunta: string;
  opciones?: string[];
  valor_requerido?: string;
  edad_min?: number;
  edad_max?: number;
  requiere_si?: boolean;
  activo?: boolean;
  es_pregunta_base?: boolean;
};

function criterioFiltro(f: Filtro): string {
  if (f.tipo === 'booleano' || f.tipo === 'si_no') {
    return f.requiere_si ? '(el candidato debe responder SÍ para calificar)' : '(el candidato debe responder NO para calificar)';
  }
  if (f.tipo === 'opcion') {
    return f.valor_requerido ? `(valor requerido: ${f.valor_requerido})` : '';
  }
  if (f.tipo === 'rango_edad') {
    return `(rango permitido: ${f.edad_min ?? '?'} a ${f.edad_max ?? '?'} años)`;
  }
  return '';
}

// Genera el bloque que la Sección 5.2 de chat_prompt.md busca literalmente
// (`[REGLAS DE EVALUACIÓN OBLIGATORIAS PARA ESTA VACANTE]`) a partir de los
// filtros estructurados que se configuran en /vacantes/[id], en vez de depender
// de que alguien lo transcriba a mano en el campo de texto libre "detalles".
function buildReglasEvaluacion(filtros: Filtro[]): string {
  const activos = filtros.filter((f) => f.activo !== false && !f.es_pregunta_base);
  if (activos.length === 0) return '';
  const lineas = activos.map((f, i) => {
    const criterio = criterioFiltro(f);
    return `${i + 1}. ${f.pregunta}${criterio ? ' ' + criterio : ''}`;
  });
  return `[REGLAS DE EVALUACIÓN OBLIGATORIAS PARA ESTA VACANTE]\n${lineas.join('\n')}`;
}

// Genera el bloque que la Sección 5.3 busca (`[PREGUNTAS BASE PARA ARMAR PERFIL
// (SI NO TIENE CV)]`) a partir de los filtros marcados como "pregunta base" en
// el modal correspondiente de /vacantes/[id].
function buildPreguntasBase(filtros: Filtro[]): string {
  const base = filtros.filter((f) => f.activo !== false && f.es_pregunta_base);
  if (base.length === 0) return '';
  const lineas = base.map((f, i) => `${i + 1}. ${f.pregunta}`);
  return `[PREGUNTAS BASE PARA ARMAR PERFIL (SI NO TIENE CV)]\n${lineas.join('\n')}`;
}

export type PromptContext = {
  prompt_base: string;
  menu_naves: string;
  menu_vacantes: string;
  detalle_vacantes: string;
  equipo_reclutadores: Array<{
    reclutador_id: string;
    nombre: string;
    activo: boolean;
    telefono: string;
    calendar_id: string;
    color: string;
    usuario: string;
    empresa_id: string;
    vacantes: Array<{ id: string; nombre: string; naves: string[]; detalles: string; palabras_clave: string; filtros: Filtro[] }>;
  }>;
  _meta: {
    empresas: Array<{ id: string; nombre: string }>;
    total_reclutadores: number;
    total_vacantes_unicas: number;
    generated_at: string;
  };
};

/**
 * Fuente única de verdad del contexto que necesita la IA de n8n (menús de
 * naves/vacantes, reglas de evaluación por filtros, equipo de reclutadores).
 * La usan tanto GET /api/prompt-context (consumido en vivo por el nodo
 * "Vacantes" de n8n) como syncPromptContextDisk (que escribe el archivo que
 * lee el nodo "CargarPrompt") — antes eran dos implementaciones separadas que
 * se desincronizaban entre sí cada vez que una cambiaba y la otra no.
 */
export async function buildPromptContext(empresaId?: string | null): Promise<PromptContext> {
  // 1. Obtener empresa(s)
  const empresaQuery = empresaId
    ? `SELECT id, nombre, prompt_ia FROM empresas WHERE id = $1 ORDER BY nombre ASC`
    : `SELECT id, nombre, prompt_ia FROM empresas ORDER BY nombre ASC`;
  const empresaParams = empresaId ? [empresaId] : [];
  const empresasRes = await pool.query(empresaQuery, empresaParams);
  const empresas = empresasRes.rows;

  if (empresas.length === 0) {
    return {
      prompt_base: getGlobalPromptBase(),
      menu_naves: 'No hay sucursales registradas.',
      menu_vacantes: 'No hay vacantes disponibles por el momento.',
      detalle_vacantes: 'Informacion no disponible.',
      equipo_reclutadores: [],
      _meta: { empresas: [], total_reclutadores: 0, total_vacantes_unicas: 0, generated_at: new Date().toISOString() },
    };
  }

  // El prompt_ia de la empresa (si se definio uno en el panel SaaS) sobreescribe el prompt global
  const empresaPromptIa = empresaId ? (empresas[0]?.prompt_ia || '').trim() : '';
  const prompt_base = empresaPromptIa || getGlobalPromptBase();

  const empresaIds = empresas.map((e: { id: string }) => e.id);

  // 2. Obtener naves activas de esas empresas (numeradas por orden de creacion por empresa)
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
  const recMap = new Map<string, PromptContext['equipo_reclutadores'][number]>();
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
      line += '\n   ' + '📍' + ` ${nav.ubicacion_maps}`;
    }
    menu_naves_lines.push(line);
  }
  const menu_naves = menu_naves_lines.length > 0
    ? menu_naves_lines.join('\n')
    : 'No hay sucursales registradas.';

  // 6. Recopilar vacantes unicas
  const todasLasVacantes: Array<{ nombre: string; detalles: string; naves: string[]; filtros: Filtro[] }> = [];
  for (const rec of equipo_reclutadores) {
    for (const vac of rec.vacantes) {
      if (!todasLasVacantes.some((v) => v.nombre === vac.nombre)) {
        todasLasVacantes.push({ nombre: vac.nombre, detalles: vac.detalles, naves: vac.naves, filtros: vac.filtros || [] });
      }
    }
  }

  // Mapa nave_id (UUID real, tal como se guarda en vacantes_def.naves) => { numero, naveName, vacantes[] }
  // El "numero" (secuencial por empresa) solo se usa para el texto que ve la IA/n8n
  // ("--- SUCURSAL {numero}: ---"), nunca como llave de cruce con las vacantes.
  const naveMap = new Map<string, { numero: number; naveName: string; vacantes: Array<{ nombre: string; detalles: string; filtros: Filtro[] }> }>();
  for (const nav of naves) {
    naveMap.set(nav.id, { numero: nav.numero, naveName: nav.nombre, vacantes: [] });
  }

  for (const vac of todasLasVacantes) {
    for (const naveId of vac.naves) {
      if (naveMap.has(naveId)) {
        const navData = naveMap.get(naveId)!;
        if (!navData.vacantes.some((v) => v.nombre === vac.nombre)) {
          navData.vacantes.push({ nombre: vac.nombre, detalles: vac.detalles, filtros: vac.filtros });
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
    const menuLines = navData.vacantes.map((v, i) => `*${i + 1}. ${v.nombre}*`).join('\n');
    menuVacantesParts.push(`${header}\n${menuLines}`);
    const detalleLines = navData.vacantes
      .map((v, i) => {
        const partes = [`*${i + 1}. ${v.nombre}*`, v.detalles || '(Sin detalles registrados)'];
        const reglas = buildReglasEvaluacion(v.filtros);
        if (reglas) partes.push(reglas);
        const preguntasBase = buildPreguntasBase(v.filtros);
        if (preguntasBase) partes.push(preguntasBase);
        return partes.join('\n\n');
      })
      .join('\n\n---\n\n');
    detalleVacantesParts.push(`${header}\n${detalleLines}`);
  }

  const menu_vacantes = menuVacantesParts.length > 0
    ? menuVacantesParts.join('\n\n')
    : 'No hay vacantes disponibles por el momento.';
  const detalle_vacantes = detalleVacantesParts.length > 0
    ? detalleVacantesParts.join('\n\n')
    : 'Informacion no disponible.';

  return {
    prompt_base,
    menu_naves,
    menu_vacantes,
    detalle_vacantes,
    equipo_reclutadores,
    _meta: {
      empresas: empresas.map((e: { id: string; nombre: string }) => ({ id: e.id, nombre: e.nombre })),
      total_reclutadores: equipo_reclutadores.length,
      total_vacantes_unicas: todasLasVacantes.length,
      generated_at: new Date().toISOString(),
    },
  };
}
