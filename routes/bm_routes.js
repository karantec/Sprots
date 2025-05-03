const express = require('express');
const {
  getBookmakerOdds,insertBookmakerToSqlandRedis ,fetchAndCacheBookmakerOdds
} = require('../controller/bm_data.controller');

const router = express.Router();

router.get('/insert-bookmaker-to-sql-redis/:event_id/:market_id', insertBookmakerToSqlandRedis);
router.get('/get-bookmaker-odds-redis-cache/:event_id/:market_id', getBookmakerOdds);
router.get('/cache-bookmaker-odds-redis/:event_id/:market_id', fetchAndCacheBookmakerOdds);
module.exports = router;
