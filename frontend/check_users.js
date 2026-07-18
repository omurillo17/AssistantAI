const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'virgo_user',
  password: process.env.DB_PASSWORD || 'virgo_password_secure',
  database: process.env.DB_NAME || 'virgo_db',
  port: parseInt(process.env.DB_PORT || '5432'),
});

async function main() {
  const res = await pool.query('SELECT * FROM usuarios');
  console.log('Usuarios:', res.rows);
  const res2 = await pool.query('SELECT * FROM reclutadores');
  console.log('Reclutadores:', res2.rows);
  pool.end();
}

main();
