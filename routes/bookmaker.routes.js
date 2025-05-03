const express = require('express');
const router = express.Router();
const oddsController = require('../controllers/fetchBookmaker.Controller');

// Routes for bookmaker odds
router.get('/bookmaker-odds/:event_id/:market_id', oddsController.fetchAndStoreBookmakerOdds);
router.get('/bookmaker-data/:event_id/:market_id', oddsController.getBookmakerDataFromRedis);
router.post('/sync/bookmaker/:event_id/:market_id', oddsController.manualSyncBookmakerData);

// Routes for fancy odds
router.get('/fancy-odds/:event_id/:market_id', oddsController.fetchAndStoreFancyOdds);
router.get('/fancy-data/:event_id/:market_id', oddsController.getFancyDataFromRedis);
router.post('/sync/fancy/:event_id/:market_id', oddsController.manualSyncFancyData);

// Health check route
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Odds service is running',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
