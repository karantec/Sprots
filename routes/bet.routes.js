const express = require('express');
const { insertBetQuestionFromOdds, insertBetOptionsController } = require('../controller/Bet.Controller');


const router = express.Router();

router.get('/insert-question/:event_id/:market_id', insertBetQuestionFromOdds);

router.get('/bet-options/:event_id/:market_id',insertBetOptionsController );


module.exports = router;