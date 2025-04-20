const express = require('express');
const {  insertBetOptionsController, insertBetQuestionFromOdds } = require('../controller/Bet.Controller');
const { checkCache } = require('../services/redis');


const router = express.Router();

router.get('/insert-question/:event_id/:market_id',  checkCache,insertBetQuestionFromOdds);

router.get('/bet-options/:event_id/:market_id', checkCache ,insertBetOptionsController );



module.exports = router;