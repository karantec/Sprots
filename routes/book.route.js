const express = require('express');
const { insertBookmakerOddsData, insertFancyOddsData } = require('../controller/Book.Controller');
const { checkCache } = require('../services/redis');
const router = express.Router();

// Route for inserting bookmaker odds
router.get('/insert-bookmaker/:event_id/:market_id',checkCache, insertBookmakerOddsData);

router.get('/fancy-odds/:event_id/:market_id', checkCache, insertFancyOddsData) ;
module.exports = router;
