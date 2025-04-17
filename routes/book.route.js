const express = require('express');
const { insertBookmakerOddsData } = require('../controller/Book.Controller');
const router = express.Router();

// Route for inserting bookmaker odds
router.get('/insert-bookmaker/:event_id/:market_id', insertBookmakerOddsData);

module.exports = router;
