const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'virgo_user',
  password: process.env.DB_PASSWORD || 'virgo_password_secure',
  database: process.env.DB_NAME || 'virgo_db',
  port: parseInt(process.env.DB_PORT || '5432'),
});

async function migrate() {
  try {
    await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS rol VARCHAR(50) DEFAULT 'USER'`);
    await pool.query(`UPDATE usuarios SET rol = 'ADMIN' WHERE usuario = 'admin'`);
    console.log('Migracion DB completada: Columna rol anadida.');
  } catch (error) {
    console.error('Error DB:', error);
  } finally {
    pool.end();
  }
}
migrate();
