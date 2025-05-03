const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: '195.35.44.144',
  user: 'u923765222_book',
  password: 'Test2481?',
  database: 'u923765222_book',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

const initDatabase = async () => {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    console.log('✅ MySQL connected');
    return true;
  } catch (err) {
    console.error('❌ MySQL connection failed:', err);
    return false;
  }
};

module.exports = {
  pool,
  initDatabase,
};
