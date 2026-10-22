import { Pool, types } from 'pg';
import { ENV } from '@/lib/env';

types.setTypeParser(1114, (str: string) => new Date(str + "Z"));

const globalForPg = globalThis as unknown as { pgPool: Pool | undefined };

export const pool =
  globalForPg.pgPool ??
  new Pool({
    connectionString: ENV.DATABASE_URL,
    max: 25,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
  });

globalForPg.pgPool = pool;

/**
 * Ejecuta `text` marcado como un cambio hecho por una persona desde el CRM.
 * Los triggers de `candidatos` leen la marca para el historial de estados y
 * para permitir sacar a un candidato de un estado personalizado (al bot no
 * se le permite). Ver migrations/004.
 */
export async function queryComoCrm(usuario: string, text: string, params: unknown[]) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.origen', 'crm', true), set_config('app.usuario', $1, true)`,
      [usuario]
    );
    const res = await client.query(text, params);
    await client.query('COMMIT');
    return res;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

