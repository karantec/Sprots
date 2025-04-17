const express = require('express');
const { fetchAndStoreCompetition, fetchAndStoreMatches } = require('../controller/event.Controller');
const router = express.Router();


router.get('/competition/save', fetchAndStoreCompetition);


router.get('/matches/save', fetchAndStoreMatches);

module.exports = router;
