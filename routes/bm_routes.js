const express = require('express');
const {
  insertBookmakerToSqlandRedis,
  getBookmakerOdds,
} = require('../controller/bm_data.controller');

const router = express.Router();

router.get('/insert-bookmaker-to-sql-redis/:event_id/:market_id', insertBookmakerToSqlandRedis);
router.get('/get-bookmaker-odds-redis-cache/:event_id/:market_id', getBookmakerOdds);

module.exports = router;
