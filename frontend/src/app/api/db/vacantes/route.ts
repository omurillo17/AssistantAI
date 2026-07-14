import { NextResponse } from 'next/server';
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { pool } from '@/lib/db';

export async function GET(request: Request) {
  let rol = "USER";
  let reclutador_id: string | null = null;
  
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("tci_session")?.value;
    if (!token) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'secret-key-default');
    const { payload } = await jwtVerify(token, secret);
    rol = payload.rol as string;
    reclutador_id = payload.reclutador_id as string;
  } catch (err) {
    return NextResponse.json({ error: "Token inválido o expirado" }, { status: 401 });
  }

  try {
    let whereClause = "";
    const params: any[] = [];
    if (rol === "RECLUTADOR" && reclutador_id) {
      whereClause = "WHERE r.id = $1";
      params.push(reclutador_id);
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
  
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("tci_session")?.value;
    if (!token) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'secret-key-default');
    const { payload } = await jwtVerify(token, secret);
    rol = payload.rol as string;
    jwt_reclutador_id = payload.reclutador_id as string;
  } catch (err) {
    return NextResponse.json({ error: "Token inválido o expirado" }, { status: 401 });
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

    await client.query('BEGIN');

    // Transfer chats and candidates if requested
    if (rol === "ADMIN" && transfer_map.length > 0) {
      for (const t of transfer_map) {
        if (t.from && t.to) {
          await client.query(`UPDATE mensajes_bandeja SET asignado_a = $1 WHERE asignado_a = $2`, [t.to, t.from]);
          await client.query(`UPDATE candidatos SET asignado_a = $1 WHERE asignado_a = $2`, [t.to, t.from]);
        }
      }
    }

    const incomingRecruiters = data.map((r: any) => r.reclutador_id);
    const incomingVacancies = data.flatMap((r: any) => r.vacantes.map((v: any) => v.id));

    if (rol === "ADMIN") {
      if (incomingRecruiters.length > 0) {
         await client.query(`DELETE FROM reclutadores WHERE id != ALL($1)`, [incomingRecruiters]);
      } else {
         await client.query(`DELETE FROM reclutadores`);
      }
    }

    // Insertar / Actualizar reclutadores
    for (const rec of data) {
      await client.query(`
        INSERT INTO reclutadores (id, nombre, activo, telefono, calendar_id, color, updated_at) 
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (id) DO UPDATE SET 
          nombre = EXCLUDED.nombre, 
          activo = EXCLUDED.activo, 
          telefono = EXCLUDED.telefono,
          calendar_id = EXCLUDED.calendar_id,
          color = EXCLUDED.color,
          updated_at = NOW()
      `, [rec.reclutador_id, rec.nombre, rec.activo, rec.telefono || '', rec.calendar_id || '', rec.color || '#6366f1']);

      if (rol === "ADMIN" && rec.usuario) {
        const checkUser = await client.query('SELECT id FROM usuarios WHERE reclutador_id = $1', [rec.reclutador_id]);
        
        if (checkUser.rows.length > 0) {
          // Update existing user
          if (rec.password) {
            const password_hash = await bcrypt.hash(rec.password, 10);
            await client.query(`UPDATE usuarios SET usuario = $1, password_hash = $2, actual_password = $3 WHERE reclutador_id = $4`,
              [rec.usuario.toLowerCase(), password_hash, rec.password, rec.reclutador_id]);
          } else {
            await client.query(`UPDATE usuarios SET usuario = $1 WHERE reclutador_id = $2`,
              [rec.usuario.toLowerCase(), rec.reclutador_id]);
          }
        } else {
          // Create new user (requires password)
          if (rec.password) {
            const password_hash = await bcrypt.hash(rec.password, 10);
            await client.query(`INSERT INTO usuarios (usuario, password_hash, actual_password, rol, reclutador_id) VALUES ($1, $2, $3, 'RECLUTADOR', $4)`,
              [rec.usuario.toLowerCase(), password_hash, rec.password, rec.reclutador_id]);
          }
        }
      }

      // Insertar / Actualizar vacantes
      let orden = 0;
      for (const vac of rec.vacantes) {
        await client.query(`
          INSERT INTO vacantes_def (id, reclutador_id, nombre, naves, detalles, palabras_clave, filtros, activa, orden, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
          ON CONFLICT (id) DO UPDATE SET
            reclutador_id = EXCLUDED.reclutador_id,
            nombre = EXCLUDED.nombre,
            naves = EXCLUDED.naves,
            detalles = EXCLUDED.detalles,
            palabras_clave = EXCLUDED.palabras_clave,
            filtros = EXCLUDED.filtros,
            activa = EXCLUDED.activa,
            orden = EXCLUDED.orden,
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
          orden
        ]);
        orden++;
      }
    }

    // Borrar vacantes
    if (rol === "ADMIN") {
      if (incomingVacancies.length > 0) {
        await client.query(`DELETE FROM vacantes_def WHERE id != ALL($1)`, [incomingVacancies]);
      } else {
        await client.query(`DELETE FROM vacantes_def`);
      }
    } else if (rol === "RECLUTADOR") {
      if (incomingVacancies.length > 0) {
        await client.query(`DELETE FROM vacantes_def WHERE reclutador_id = $1 AND id != ALL($2)`, [jwt_reclutador_id, incomingVacancies]);
      } else {
        await client.query(`DELETE FROM vacantes_def WHERE reclutador_id = $1`, [jwt_reclutador_id]);
      }
    }

    await client.query('COMMIT');

    // MANTENER LA FUNCIONALIDAD ANTERIOR: Generar archivos físicos (JSON y TXT)
    try {
      const fs = require('fs');
      const path = require('path');
      
      // Ajustar ruta al lugar correcto en el disco del host
      // Subimos dos niveles desde frontend (que está en vf/frontend) para llegar a vf/virgo_data/prompts
      const basePath = path.join(process.cwd(), '..', 'virgo_data', 'prompts'); 
      
      if (fs.existsSync(basePath)) {
        // 1. Guardar JSON (para respaldo o si otra cosa lo lee)
        fs.writeFileSync(
            path.join(basePath, 'reclutador_vacantes.json'),
            JSON.stringify(data, null, 2),
            'utf8'
        );

        // 2. Extraer vacantes únicas por nave
        const naves: Record<string, any[]> = { 1: [], 2: [], 3: [] };

        data.forEach((rec: any) => {
            if (rec.nombre === "DESHABILITADAS" || !rec.activo) return;

            if (rec.vacantes && Array.isArray(rec.vacantes)) {
                rec.vacantes.forEach((vac: any) => {
                    if (!vac.activa) return;
                    
                    const navesVacante = vac.naves || (vac.nave ? [vac.nave] : []);
                    
                    navesVacante.forEach((naveStr: string) => {
                        const nave = parseInt(naveStr);
                        if (naves[nave]) {
                            const existe = naves[nave].find((v: any) => v.nombre.trim().toUpperCase() === vac.nombre.trim().toUpperCase());
                            if (!existe) {
                                naves[nave].push(vac);
                            }
                        }
                    });
                });
            }
        });

        // 3. Autogenerar los archivos TXT
        for (const nave in naves) {
            const vacantesNave = naves[nave];
            
            let menuTexto = "";
            let detallesTexto = "";

            if (vacantesNave.length > 0) {
                vacantesNave.forEach((vac, index) => {
                    const num = index + 1;
                    menuTexto += `*${num}. ${vac.nombre}*\n`;
                    detallesTexto += `*${num}. ${vac.nombre}*\n`;
                    detallesTexto += `${vac.detalles || "Sin detalles"}\n`;

                    if (vac.filtros && vac.filtros.length > 0) {
                        const filtrosActivos = vac.filtros.filter((f: any) => f.activo);
                        const filtrosBase = filtrosActivos.filter((f: any) => f.es_pregunta_base);
                        const filtrosEvaluacion = filtrosActivos.filter((f: any) => !f.es_pregunta_base);

                        if (filtrosEvaluacion.length > 0) {
                            detallesTexto += `\n[REGLAS DE EVALUACIÓN OBLIGATORIAS PARA ESTA VACANTE]\n`;
                            detallesTexto += `Debes hacer las siguientes preguntas al candidato de forma conversacional.\n`;
                            filtrosEvaluacion.forEach((f: any) => {
                                detallesTexto += `- Pregunta a hacer: "${f.pregunta}"\n`;
                                if (f.tipo === "booleano") {
                                    detallesTexto += `  Condición para ser VIABLE: El candidato DEBE cumplir con esto.\n`;
                                } else if (f.tipo === "opcion") {
                                    detallesTexto += `  Opciones permitidas: ${f.opciones?.join(', ')}.\n`;
                                } else if (f.tipo === "rango_edad") {
                                    detallesTexto += `  Condición para ser VIABLE: Su edad DEBE estar entre ${f.edad_min} y ${f.edad_max} años.\n`;
                                }
                            });
                        }

                        if (filtrosBase.length > 0) {
                            detallesTexto += `\n[PREGUNTAS BASE PARA ARMAR PERFIL (SI NO TIENE CV)]\n`;
                            detallesTexto += `Estas preguntas conforman el perfil manual del candidato. Hazlas obligatoriamente si el candidato NO tiene CV:\n`;
                            filtrosBase.forEach((f: any) => {
                                detallesTexto += `- Pregunta a hacer: "${f.pregunta}" (Etiqueta JSON sugerida: ${f.clave})\n`;
                            });
                        }
                    }

                    detallesTexto += `\n---\n\n`;
                });
            } else {
                menuTexto = "No hay vacantes disponibles en este momento.";
                detallesTexto = "No hay vacantes disponibles en este momento.";
            }

            fs.writeFileSync(path.join(basePath, `menu_vacantes_${nave}.txt`), menuTexto.trim(), 'utf8');
            fs.writeFileSync(path.join(basePath, `detalle_vacantes_${nave}.txt`), detallesTexto.trim(), 'utf8');
        }
      } else {
        console.warn('La ruta base de los prompts no existe localmente:', basePath);
      }
    } catch (fsError) {
      console.error('Error generando archivos físicos (JSON/TXT):', fsError);
      // No devolvemos error HTTP porque la BD ya se actualizó correctamente
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error saving vacantes:', err);
    return NextResponse.json({ error: 'Error interno al guardar las vacantes' }, { status: 500 });
  } finally {
    client.release();
  }
}
