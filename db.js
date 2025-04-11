// services/db.js - MySQL database connection and operations
const mysql = require('mysql2/promise');

// Create connection pool
const pool = mysql.createPool({
  host: '195.35.44.144', // ✅ Correct: No http:// and no /
  user: 'u923765222_book2500',
  password: 'Test2481?', // ✅ Make sure this is your correct DB password
  database: 'u923765222_book2500',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Initialize database and create tables if they don't exist
const initDatabase = async () => {
  let connection;
  try {
    connection = await pool.getConnection();
    console.log('✅ Connected to MySQL database');

    // Create matches table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS matches (
        id INT AUTO_INCREMENT PRIMARY KEY,
        cat_id INT NOT NULL,
        event_id VARCHAR(255) NOT NULL,
        team_1_image VARCHAR(255),
        team_2_image VARCHAR(255),
        team_1 VARCHAR(255) NOT NULL,
        team_2 VARCHAR(255) NOT NULL,
        team_1_slug VARCHAR(255),
        team_2_slug VARCHAR(255),
        start_date DATETIME,
        end_date DATETIME,
        status VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX (event_id),
        INDEX (cat_id)
      )
    `);

    console.log('✅ Database tables initialized');
    return true;
  } catch (error) {
    console.error('❌ Database initialization error:', error.message);
    return false;
  } finally {
    if (connection) connection.release();
  }
};

//sport every 24 hours


// Insert or update match data with the specified columns
const saveMatch = async (match) => {
    try {
      // Optional: validate only team_1 and team_2 since we're hardcoding event_id
      if (
        match.team_1 === undefined ||
        match.team_2 === undefined
      ) {
        throw new Error('Required match data is missing');
      }
      
      // Execute the query, hardcoding event_id to 24
      const [result] = await pool.execute(
        `INSERT INTO matches
          (event_id, team_1, team_2, team_1_slug, team_2_slug, start_date, end_date, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          team_1 = VALUES(team_1),
          team_2 = VALUES(team_2),
          team_1_slug = VALUES(team_1_slug),
          team_2_slug = VALUES(team_2_slug),
          start_date = VALUES(start_date),
          end_date = VALUES(end_date),
          status = VALUES(status),
          updated_at = CURRENT_TIMESTAMP`,
        [
          24, // Hardcoded event_id value instead of using match.event_id
          match.team_1 ?? null,
          match.team_2 ?? null,
          match.team_1_slug ?? null,
          match.team_2_slug ?? null,
          match.start_date ?? null,
          match.end_date ?? null,
          match.status ?? 'upcoming'
        ]
      );
      return result;
    } catch (error) {
      console.error(`❌ Error saving match data: ${error.message}`);
      throw error;
    }
  };
// Get all matches
const getAllMatches = async () => {
  try {
    const [rows] = await pool.query('SELECT * FROM matches');
    return rows;
  } catch (error) {
    console.error(`❌ Error fetching matches: ${error.message}`);
    throw error;
  }
};

// Close database connection
const closeDbConnection = async () => {
  try {
    await pool.end();
    console.log('🔴 MySQL connection pool closed');
  } catch (error) {
    console.error('❌ Error closing database connection:', error.message);
  }
};

// Export all functions - ONLY use this export statement
module.exports = {
  initDatabase,
  saveMatch,
  getAllMatches,
  closeDbConnection
};
