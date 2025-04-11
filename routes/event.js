// routes/events.js - Event routes
const express = require('express');
const router = express.Router();


const { fetchEvent, getMatches } = require('../controller/eventController');
const { checkCache } = require('../services/redis');

// GET event data with caching
router.get('/fetch-event', checkCache, fetchEvent);

// GET matches from database
router.get('/matches', getMatches);

module.exports = router;