// server.js - Main entry point
const express = require('express');
const cors = require('cors');
const { initRedisClient, closeRedisConnection } = require('./services/redis');
const { startCronJob } = require('./services/cron');
const sportsRoutes = require('./routes/sports');
const eventRoutes = require('./routes/event.routes');
const betRoutes = require('./routes/bet.routes');
const bookRoute = require('./routes/book.route');
const bmRoute = require('./routes/bm_routes');
const { initDatabase } = require('./db'); // initDatabase handles pool setup

const app = express();
const PORT = 3000;

// Middleware
app.options('*', cors()); // For pre-flight requests
app.use(
  cors({
    origin: ['https://book2500.in'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);
app.use(express.json());

// Unified async initialization block
(async () => {
  try {
    // Step 1: Initialize Redis
    await initRedisClient();

    // Step 2: Initialize Database
    const dbReady = await initDatabase();
    if (!dbReady) {
      console.error('❌ Could not start server due to DB initialization failure');
      process.exit(1);
    }

    // Step 3: Start Cron Job
    startCronJob();
    console.log('✅ Redis, DB and Cron job initialized');

    // Step 4: Routes
    app.use('/sports', sportsRoutes);
    app.use('/api/event', eventRoutes);
    app.use('/api/bet', betRoutes);
    app.use('/api/book', bookRoute);
    app.use('/api/v2/bm', bmRoute);

    // Step 5: Start server
    app.listen(PORT, () => {
      console.log(`🚀 Server running at http://localhost:${PORT}`);
    });

  } catch (error) {
    console.error('❌ Initialization Error:', error);
    process.exit(1);
  }
})();

// Graceful shutdown
process.on('SIGINT', async () => {
  await closeRedisConnection();
  console.log('👋 Server shutting down gracefully');
  process.exit(0);
});
