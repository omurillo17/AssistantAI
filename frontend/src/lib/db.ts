import { Pool, types } from 'pg';
import { ENV } from '@/lib/env';

types.setTypeParser(1114, str => new Date(str + "Z"));

export const pool = new Pool({
  connectionString: ENV.DATABASE_URL,
});
