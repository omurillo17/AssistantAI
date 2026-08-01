import { NextResponse } from 'next/server';
import { jwtVerify } from "jose";
import { ENV } from "@/lib/env";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { pool } from '@/lib/db';
import { syncPromptContextDisk } from '@/lib/syncPromptContext';

export async function GET(request: Request) {
  let rol = "USER";
  let reclutador_id: string | null = null;
  let jwt_empresa_id: string | null = null;
  let jwt_grupo_id: string | null = null;

  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("tci_session")?.value;
    if (!token) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const secret = new TextEncoder().encode(ENV.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    rol = payload.rol as string;
    reclutador_id = payload.reclutador_id as string;
    jwt_empresa_id = payload.empresa_id as string;
    jwt_grupo_id = payload.grupo_id as string | null;
  } catch (err) {
    return NextResponse.json({ error: "Token inválido o expirado" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  let filter_empresa_id = searchParams.get("empresa_id");
  let filter_nave_id = searchParams.get("nave_id");

  // Si no es ROOT, forzamos su propia empresa_id
  if (rol !== "ROOT") {
    filter_empresa_id = jwt_empresa_id;
  }

  try {
    let whereClause = "";
    const params: any[] = [];
    let paramIndex = 1;

    if (filter_empresa_id) {
      whereClause = `WHERE r.empresa_id = $${paramIndex}`;
      params.push(filter_empresa_id);
      paramIndex++;
    }

    if (rol === "RECLUTADOR" && reclutador_id) {
      whereClause += whereClause ? ` AND r.id = $${paramIndex}` : `WHERE r.id = $${paramIndex}`;
      params.push(reclutador_id);
      paramIndex++;
    }

    // Un ENCARGADO solo debe ver a los reclutadores de su propio grupo
    // (la relación reclutador-grupo vive en usuarios.grupo_id, vía usuarios.reclutador_id)
    if (rol === "ENCARGADO") {
      whereClause += whereClause ? ` AND u.grupo_id = $${paramIndex}` : `WHERE u.grupo_id = $${paramIndex}`;
      params.push(jwt_grupo_id);
      paramIndex++;
    }

    if (filter_nave_id) {
      whereClause += whereClause ? ` AND (v.nave_id = $${paramIndex} OR v.naves::jsonb @> '["' || (SELECT nombre FROM naves WHERE id = $${paramIndex}) || '"]'::jsonb)` : `WHERE (v.nave_id = $${paramIndex} OR v.naves::jsonb @> '["' || (SELECT nombre FROM naves WHERE id = $${paramIndex}) || '"]'::jsonb)`;
      params.push(filter_nave_id);
      paramIndex++;
    }

    const res = await pool.query(`
      SELECT 
        r.id AS reclutador_id, 
        r.nombre AS reclutador_nombre, 
        r.activo AS reclutador_activo,
        r.telefono AS reclutador_telefono,
        r.calendar_id AS reclutador_calendar,
        r.color AS reclutador_color,
        u.usuario AS reclutador_usuario,
        v.id AS vacante_id,
        v.nombre AS vacante_nombre,
        v.naves,
        v.detalles,
        v.palabras_clave,
        v.filtros,
        v.activa AS vacante_activa
      FROM reclutadores r
      LEFT JOIN usuarios u ON r.id = u.reclutador_id
      LEFT JOIN vacantes_def v ON r.id = v.reclutador_id
      ${whereClause}
      ORDER BY r.created_at ASC, v.orden ASC, v.created_at ASC
    `, params);

    // Agrupar por reclutador
    const map = new Map<string, any>();

    for (const row of res.rows) {
      if (!map.has(row.reclutador_id)) {
        map.set(row.reclutador_id, {
          reclutador_id: row.reclutador_id,
          nombre: row.reclutador_nombre,
          activo: row.reclutador_activo,
          telefono: row.reclutador_telefono || '',
          calendar_id: row.reclutador_calendar || '',
          color: row.reclutador_color || '#6366f1',
          usuario: row.reclutador_usuario || '',
          vacantes: []
        });
      }

      if (row.vacante_id) {
        map.get(row.reclutador_id).vacantes.push({
          id: row.vacante_id,
          nombre: row.vacante_nombre,
          naves: typeof row.naves === 'string' ? JSON.parse(row.naves) : row.naves,
          detalles: row.detalles || '',
          palabras_clave: row.palabras_clave || '',
          filtros: row.filtros || [],
          activa: row.vacante_activa
        });
      }
    }

    return NextResponse.json(Array.from(map.values()));
  } catch (err) {
    console.error('Error fetching vacantes:', err);
    return NextResponse.json({ error: 'Error al obtener las vacantes de la BD' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let rol = "USER";
  let jwt_reclutador_id: string | null = null;
  let jwt_empresa_id: string | null = null;
  let jwt_grupo_id: string | null = null;

  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("tci_session")?.value;
    if (!token) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const secret = new TextEncoder().encode(ENV.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    rol = payload.rol as string;
    jwt_reclutador_id = payload.reclutador_id as string;
    jwt_empresa_id = payload.empresa_id as string;
    jwt_grupo_id = payload.grupo_id as string | null;
  } catch (err) {
    return NextResponse.json({ error: "Token inválido o expirado" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  let target_empresa_id = searchParams.get("empresa_id");

  // Si no es ROOT, forzamos su propia empresa_id
  if (rol !== "ROOT") {
    target_empresa_id = jwt_empresa_id;
  }
  const client = await pool.connect();
  try {
    let body = await request.json();
    let data = [];
    let transfer_map: {from: string, to: string}[] = [];

    if (Array.isArray(body)) {
      data = body;
    } else if (body && Array.isArray(body.recruiters)) {
      data = body.recruiters;
      if (Array.isArray(body.transfer_map)) {
        transfer_map = body.transfer_map;
      }
    } else {
      return NextResponse.json({ error: 'Formato de datos inválido' }, { status: 400 });
    }

    if (rol === "RECLUTADOR") {
      if (!jwt_reclutador_id) {
         return NextResponse.json({ error: 'Acceso denegado' }, { status: 403 });
      }
      data = data.filter((r: any) => r.reclutador_id === jwt_reclutador_id);
    }

    // Un ENCARGADO solo puede tocar reclutadores de su propio grupo
    let allowedReclutadorIds: string[] = [];
    if (rol === "ENCARGADO") {
      const allowedRes = await client.query(
        `SELECT r.id FROM reclutadores r
         JOIN usuarios u ON u.reclutador_id = r.id
         WHERE u.grupo_id = $1 AND r.empresa_id = $2`,
        [jwt_grupo_id, jwt_empresa_id]
      );
      allowedReclutadorIds = allowedRes.rows.map((row: any) => row.id);
      data = data.filter((r: any) => allowedReclutadorIds.includes(r.reclutador_id));
    }

    await client.query('BEGIN');

    // Transfer chats and candidates if requested
    if ((rol === "ADMIN" || rol === "ENCARGADO") && transfer_map.length > 0) {
      for (const t of transfer_map) {
        if (t.from && t.to) {
          await client.query(`UPDATE mensajes_bandeja SET asignado_a = $1 WHERE asignado_a = $2`, [t.to, t.from]);
          await client.query(`UPDATE candidatos SET asignado_a = $1 WHERE asignado_a = $2`, [t.to, t.from]);
        }
      }
    }

    const incomingRecruiters = data.map((r: any) => r.reclutador_id);
    const incomingVacancies = data.flatMap((r: any) => r.vacantes.map((v: any) => v.id));

    if (rol === "ADMIN" || rol === "ROOT") {
      if (incomingRecruiters.length > 0) {
         if (target_empresa_id) {
            await client.query(`DELETE FROM reclutadores WHERE empresa_id = $1 AND id != ALL($2)`, [target_empresa_id, incomingRecruiters]);
         } else {
            await client.query(`DELETE FROM reclutadores WHERE id != ALL($1)`, [incomingRecruiters]);
         }
      } else {
         if (target_empresa_id) {
            await client.query(`DELETE FROM reclutadores WHERE empresa_id = $1`, [target_empresa_id]);
         } else {
            await client.query(`DELETE FROM reclutadores`);
         }
      }
    } else if (rol === "ENCARGADO" && allowedReclutadorIds.length > 0) {
      // Scoped únicamente a los reclutadores del grupo del encargado
      if (incomingRecruiters.length > 0) {
        await client.query(`DELETE FROM reclutadores WHERE id = ANY($1) AND id != ALL($2)`, [allowedReclutadorIds, incomingRecruiters]);
      } else {
        await client.query(`DELETE FROM reclutadores WHERE id = ANY($1)`, [allowedReclutadorIds]);
      }
    }

    // Insertar / Actualizar reclutadores
    for (const rec of data) {
      await client.query(`
        INSERT INTO reclutadores (id, nombre, activo, telefono, calendar_id, color, empresa_id, updated_at) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (id) DO UPDATE SET 
          nombre = EXCLUDED.nombre, 
          activo = EXCLUDED.activo, 
          telefono = EXCLUDED.telefono,
          calendar_id = EXCLUDED.calendar_id,
          color = EXCLUDED.color,
          empresa_id = EXCLUDED.empresa_id,
          updated_at = NOW()
      `, [rec.reclutador_id, rec.nombre, rec.activo, rec.telefono || '', rec.calendar_id || '', rec.color || '#6366f1', target_empresa_id || null]);

      // Insertar / Actualizar vacantes
      let orden = 0;
      for (const vac of rec.vacantes) {
        await client.query(`
          INSERT INTO vacantes_def (id, reclutador_id, nombre, naves, detalles, palabras_clave, filtros, activa, orden, empresa_id, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
          ON CONFLICT (id) DO UPDATE SET
            reclutador_id = EXCLUDED.reclutador_id,
            nombre = EXCLUDED.nombre,
            naves = EXCLUDED.naves,
            detalles = EXCLUDED.detalles,
            palabras_clave = EXCLUDED.palabras_clave,
            filtros = EXCLUDED.filtros,
            activa = EXCLUDED.activa,
            orden = EXCLUDED.orden,
            empresa_id = EXCLUDED.empresa_id,
            updated_at = NOW()
        `, [
          vac.id,
          rec.reclutador_id,
          vac.nombre,
          JSON.stringify(vac.naves || []),
          vac.detalles || '',
          vac.palabras_clave || '',
          JSON.stringify(vac.filtros || []),
          vac.activa,
          orden,
          target_empresa_id || null
        ]);
        orden++;
      }
    }

    // Borrar vacantes
    if (rol === "ADMIN" || rol === "ROOT") {
      if (incomingVacancies.length > 0) {
        if (target_empresa_id) {
           await client.query(`DELETE FROM vacantes_def WHERE empresa_id = $1 AND id != ALL($2)`, [target_empresa_id, incomingVacancies]);
        } else {
           await client.query(`DELETE FROM vacantes_def WHERE id != ALL($1)`, [incomingVacancies]);
        }
      } else {
        if (target_empresa_id) {
           await client.query(`DELETE FROM vacantes_def WHERE empresa_id = $1`, [target_empresa_id]);
        } else {
           await client.query(`DELETE FROM vacantes_def`);
        }
      }
    } else if (rol === "RECLUTADOR") {
      if (incomingVacancies.length > 0) {
        await client.query(`DELETE FROM vacantes_def WHERE reclutador_id = $1 AND id != ALL($2)`, [jwt_reclutador_id, incomingVacancies]);
      } else {
        await client.query(`DELETE FROM vacantes_def WHERE reclutador_id = $1`, [jwt_reclutador_id]);
      }
    } else if (rol === "ENCARGADO" && allowedReclutadorIds.length > 0) {
      if (incomingVacancies.length > 0) {
        await client.query(`DELETE FROM vacantes_def WHERE reclutador_id = ANY($1) AND id != ALL($2)`, [allowedReclutadorIds, incomingVacancies]);
      } else {
        await client.query(`DELETE FROM vacantes_def WHERE reclutador_id = ANY($1)`, [allowedReclutadorIds]);
      }
    }

    await client.query('COMMIT');
    
    // Auto-sync prompt_context.json file for n8n/AI
    await syncPromptContextDisk(target_empresa_id || undefined);

    return NextResponse.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error saving vacantes:', err);
    return NextResponse.json({ error: 'Error interno al guardar las vacantes' }, { status: 500 });
  } finally {
    client.release();
  }
}
