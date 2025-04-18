const express = require('express');
const { fetchAndStoreCompetition, fetchAndStoreMatches } = require('../controller/event.Controller');
const { checkCache } = require('../services/redis');
const router = express.Router();


router.get('/competition/save',  checkCache ,fetchAndStoreCompetition);


router.get('/matches/save', checkCache, fetchAndStoreMatches);

module.exports = router;
