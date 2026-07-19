import { Pool, types } from 'pg';

// Forzar que los "timestamp without time zone" (OID 1114) se parseen como UTC
types.setTypeParser(1114, str => new Date(str + "Z"));

// Declaramos una variable global para evitar crear múltiples instancias en modo desarrollo
const globalForPg = global as unknown as { pgPool: Pool };

export const pool = globalForPg.pgPool || new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'virgo_user',
  password: process.env.DB_PASSWORD || 'virgo_password_secure',
  database: process.env.DB_NAME || 'virgo_db',
  port: parseInt(process.env.DB_PORT || '5432', 10),
});

if (process.env.NODE_ENV !== 'production') {
  globalForPg.pgPool = pool;
}
