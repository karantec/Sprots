const express = require('express');

const { checkCache } = require('../services/redis');
const { fetchAndStoreCompetition, fetchAndStoreMatches, clearCache, getCachedData, listCacheKeys } = require('../controller/event.Controller');
const router = express.Router();

// Existing routes with checkCache middleware
router.get('/competition/save', checkCache, fetchAndStoreCompetition);
router.get('/matches/save', checkCache, fetchAndStoreMatches);

// Dynamic route for matches with parameters
router.get('/matches/save/:competitionId/:eventId', checkCache, fetchAndStoreMatches);

// New routes for cache management
router.get('/cache/clear/:key', clearCache);
router.get('/cache/data/:key', getCachedData);
router.get('/cache/keys', listCacheKeys);

module.exports = router;