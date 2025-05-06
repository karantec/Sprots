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
const PORT = process.env.PORT || 3000;

// ─── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: ['https://book2500.in'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

app.use(express.json());
// app.use(helmet()); // Uncomment if you want added security
// app.use(morgan('dev')); // Uncomment for logging during development

// ─── SERVER INITIALIZATION ─────────────────────────────────────────────────────
(async () => {
  try {
    console.log('🔄 Initializing services...');

    // Step 1: Initialize Redis
    await initRedisClient();
    console.log('✅ Redis initialized');

    // Step 2: Initialize Database
    const dbReady = await initDatabase();
    if (!dbReady) {
      console.error('❌ Database initialization failed. Exiting...');
      process.exit(1);
    }
    console.log('✅ Database initialized');

    // Step 3: Start Cron Jobs
    startCronJob();
    console.log('✅ Cron jobs started');

    // Step 4: Register Routes
    app.use('/sports', sportsRoutes);
    app.use('/api/event', eventRoutes);
    app.use('/api/bet', betRoutes);
    app.use('/api/book', bookRoute);
    app.use('/api/v2/bm', bmRoute);

    // Step 5: Start Server
    app.listen(PORT, () => {
      console.log(`🚀 Server running at http://localhost:${PORT}`);
    });

  } catch (error) {
    console.error('❌ Initialization Error:', error);
    process.exit(1);
  }
})();

// ─── GRACEFUL SHUTDOWN ─────────────────────────────────────────────────────────
process.on('SIGINT', async () => {
  console.log('\n🛑 SIGINT received. Cleaning up...');
  await closeRedisConnection();
  // await closeDatabaseConnection(); // Add this if your DB module supports graceful shutdown
  console.log('👋 Server shut down gracefully');
  process.exit(0);
});
