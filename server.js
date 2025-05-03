// server.js - Main entry point
const express = require('express');
const cors = require('cors');
const { initRedisClient, closeRedisConnection } = require('./services/redis');
const { startCronJob } = require('./services/cron');
const sportsRoutes = require('./routes/sports');
const eventRoutes = require('./routes/event.routes');
const betRoutes=require('./routes/bet.routes') 
const bookRoute=require('./routes/book.route');
const bmRoute = require('./routes/bm_routes');

const { pool, initDatabase } = require('./db'); // Updated with initDatabase

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Redis Initialization & Cron Job
(async () => {
  try {
    await initRedisClient();
    startCronJob();
    console.log('✅ Redis and Cron job initialized');
  } catch (error) {
    console.error('❌ Redis/Cron Initialization Error:', error);
    process.exit(1);
  }
})();

// MySQL Initialization and Server Start
(async () => {
  const dbReady = await initDatabase();
  if (!dbReady) {
    console.error('❌ Could not start server due to DB initialization failure');
    process.exit(1);
  }

  // Routes
  app.use('/sports', sportsRoutes);
  app.use('/api/event', eventRoutes); 
  app.use('/api/bet',betRoutes);
  app.use('/api/book', bookRoute); // Updated route for bet routes
  app.use('/api/v2/bm',bmRoute);
  // Start server
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
  });
})();

// Graceful shutdown
process.on('SIGINT', async () => {
  await closeRedisConnection();
  console.log('👋 Server shutting down gracefully');
  process.exit(0);
});
