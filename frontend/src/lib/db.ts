import { Pool, types } from 'pg';

types.setTypeParser(1114, str => new Date(str + "Z"));

const connectionString = process.env.DATABASE_URL || 'postgres://omurillo17:Gg172125@127.0.0.1:5433/db_assistantai';

export const pool = new Pool({
  connectionString,
});
