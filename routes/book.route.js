const express = require("express");
const {
  insertBookmakerOddsData,
  fetchBookmakerOdds,
  //   insertFancyOddsData,

  //   getFancyDataFromRedis,
  storeThenInsertFancyOddsData,
} = require("../controller/Book.Controller");
const { checkCache } = require("../services/redis");
const router = express.Router();

// Route for inserting bookmaker odds
router.get(
  "/insert-bookmaker/:event_id/:market_id",
  checkCache,
  insertBookmakerOddsData
);
router.get("/fetch-bookmaker/:event_id/:market_id", fetchBookmakerOdds);
// router.get("/fetch-event-with-odds", fetchEventWithOdds);
router.get("/fancy-odds/:event_id/:market_id", checkCache, insertFancyOddsData);
router.get(
  "/fancy-odds/fetch-and-insert/:event_id/:market_id",
  storeThenInsertFancyOddsData
);

// Route to retrieve fancy odds data from Redis
router.get("/retrieve/:event_id/:market_id", getFancyDataFromRedis);

module.exports = router;
