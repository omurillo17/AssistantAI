const { Pool } = require('pg');
const pool = new Pool({
  host: 'localhost',
  user: 'virgo_user',
  password: 'virgo_password_secure',
  database: 'virgo_db',
  port: 5432
});

pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'candidatos'").then(res => {
  console.table(res.rows);
  pool.end();
}).catch(console.error);
