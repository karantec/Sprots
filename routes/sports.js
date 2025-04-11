const express = require('express');
const router = express.Router();

const { checkCache } = require('../services/redis');
const { getSportsData, getLatestSportsData } = require('../controller/sportsController');

// GET all sports data (with cache middleware)
router.get('/', checkCache, getSportsData);

// GET latest sports data (from cron job)
router.get('/latest', getLatestSportsData);

module.exports = router;