const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
  connectionString: config.databaseUrl
});

async function query(text, params) {
  return pool.query(text, params);
}

async function checkConnection() {
  return query('SELECT 1');
}

async function closePool() {
  return pool.end();
}

module.exports = {
  pool,
  query,
  checkConnection,
  closePool
};
