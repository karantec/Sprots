// server.js - Main entry point
const express = require('express');
const cors = require('cors');
const { initRedisClient } = require('./services/redis');
const { startCronJob } = require('./services/cron');
const sportsRoutes = require('./routes/sports');
const eventRoutes = require('./routes/event');
const {pool, initDatabase } = require('./db');
const app = express();
const PORT = 3000;

// Enable CORS
app.use(cors());

// Initialize Redis and start cron job
(async () => {
    try {
        await initRedisClient();
        startCronJob();
    } catch (error) {
        console.error('❌ Initialization error:', error);
        process.exit(1);
    }
})();

// Register routes
app.use('/sports', sportsRoutes);
app.use('/', eventRoutes);
app.use(express.json());


(async () => {
    const dbReady = await initDatabase();
    if (!dbReady) {
      console.error('❌ Could not start server due to DB error');
      process.exit(1);
    }
  
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  })();
// Handle graceful shutdown
process.on('SIGINT', async () => {
    const { closeRedisConnection } = require('./services/redis');
    await closeRedisConnection();
    console.log('👋 Server shutting down gracefully');
    process.exit(0);
});