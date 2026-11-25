const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'closet_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
});

/**
 * Verify MySQL pool connectivity at startup or health checks.
 * Returns { ok: boolean, message: string }.
 */
async function testConnection() {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.ping();
    return { ok: true, message: 'MySQL 연결 성공' };
  } catch (err) {
    console.error('[DB] MySQL 연결 실패:', err.code || err.message);
    return { ok: false, message: '데이터베이스 연결에 실패했습니다.' };
  } finally {
    if (conn) conn.release();
  }
}

module.exports = {
  pool,
  testConnection,
};
