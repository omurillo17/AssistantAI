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
  });

globalForPg.pgPool = pool;

