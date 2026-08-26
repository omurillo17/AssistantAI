import type { SessionPayload } from '@/lib/auth';
import { resolveGrupoNaveIds } from '@/lib/grupos';

export interface CandidatosScope {
  /** Condiciones SQL sobre el alias `c` (candidatos), listas para unir con AND. */
  conditions: string[];
  values: unknown[];
  /** Siguiente índice de placeholder libre ($n) para quien añada más filtros. */
  nextIdx: number;
}

// Construye el filtro de alcance (empresa / grupo / nave / rol) que comparten
// todos los endpoints que leen `candidatos`. Vive en un solo sitio a propósito:
// duplicarlo fue lo que abrió la fuga de expedientes que se cerró en bb26383,
// así que cualquier consulta nueva sobre candidatos debe pasar por aquí en vez
// de reescribir el WHERE a mano.
//
// El alias de la tabla candidatos debe ser `c` en la consulta que lo use.
export async function buildCandidatosScope(
  payload: SessionPayload,
  searchParams: URLSearchParams,
  startIdx = 1,
): Promise<CandidatosScope> {
  const rol = (payload.rol as string) || 'USER';
  const reclutador_id = (payload.reclutador_id as string | null) ?? null;
  const jwt_empresa_id = (payload.empresa_id as string | null) ?? null;
  const jwt_grupo_id = (payload.grupo_id as string | null) ?? null;

  let filter_empresa_id = searchParams.get('empresa_id');
  const filter_nave_id = searchParams.get('nave_id');
  let filter_grupo_id = searchParams.get('grupo_id');

  // Solo ROOT puede mirar la empresa de otro; al resto se le fuerza la suya.
  if (rol !== 'ROOT') {
    filter_empresa_id = jwt_empresa_id;
  }
  // Solo ADMIN/ROOT pueden pedir el grupo de otra persona por query param.
  // Ojo: esto NO debe inyectar un grupo_id cuando el cliente no mandó uno
  // (p.ej. Dashboards/Mensajes/Expedientes filtrando solo por nave) — solo
  // corrige el caso en que alguien mande un grupo_id ajeno al suyo.
  if (filter_grupo_id && rol !== 'ROOT' && rol !== 'ADMIN' && filter_grupo_id !== jwt_grupo_id) {
    filter_grupo_id = jwt_grupo_id;
  }

  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = startIdx;

  if (filter_empresa_id) {
    conditions.push(`c.empresa_id = $${idx++}`);
    values.push(filter_empresa_id);
  }

  if (filter_grupo_id) {
    // El filtro por grupo tiene prioridad sobre nave_id (son mutuamente
    // excluyentes desde el TopNavbar, pero por robustez se prioriza grupo).
    const grupoNaveIds = await resolveGrupoNaveIds(filter_grupo_id);
    if (grupoNaveIds && grupoNaveIds.length > 0) {
      conditions.push(`(c.nave_id = ANY($${idx++}::uuid[]) OR c.nave_id IS NULL OR c.nave_interes IS NULL OR c.nave_interes = '' OR c.nave_interes = 'Pendiente')`);
      values.push(grupoNaveIds);
    } else {
      conditions.push(`FALSE`);
    }
  } else if (filter_nave_id) {
    conditions.push(`(c.nave_id = $${idx++} OR c.nave_id IS NULL OR c.nave_interes IS NULL OR c.nave_interes = '' OR c.nave_interes = 'Pendiente')`);
    values.push(filter_nave_id);
  }

  // Si hay un grupo aplicado (propio del usuario o elegido por ADMIN), el
  // alcance de grupo ya cubre a todo el equipo — no restringir además a
  // las vacantes propias del reclutador (ver Calendario: un reclutador de
  // un grupo debe ver las citas de todo su grupo, no solo las suyas).
  if (rol === 'RECLUTADOR' && reclutador_id && !filter_grupo_id) {
    conditions.push(`
        c.vacante_interes IN (
          SELECT nombre FROM vacantes_def WHERE reclutador_id = $${idx}
        )
      `);
    values.push(reclutador_id);
    idx++;
  }

  return { conditions, values, nextIdx: idx };
}
