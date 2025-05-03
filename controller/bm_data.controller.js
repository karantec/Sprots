const axios = require("axios");
const moment = require("moment");
const db = require("../db");
const { default: Redis } = require("ioredis");

const redis = new Redis(); // Create redis instance if not already

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const insertBookmakerToSqlandRedis = async (req, res) => {
  try {
    const { event_id, market_id } = req.params;
    const redisKey = `/api/bookmaker-odds/${event_id}/${market_id}`;

    await delay(1000);

    // Fetch from API
    const response = await axios.get(`http://65.0.40.23:7003${redisKey}`);
    const data = response.data?.data;

    if (!data)
      return res.status(404).json({ error: "No data from bookmaker-odds API" });

    // ✅ Save to Redis cache for 10 minutes
    try {
      await redis.setEx(redisKey, 600, JSON.stringify(response.data));
      console.log("✅ API response cached in Redis");
    } catch (err) {
      console.warn("⚠️ Failed to cache API data in Redis:", err.message);
    }

    const matchEventId = data.evid;

    // Continue with inserting into SQL
    const [matchResult] = await db.pool.execute(
      `SELECT id, end_date FROM matches WHERE api_event_id = ? AND api_market_id = ? LIMIT 1`,
      [matchEventId, market_id]
    );

    if (matchResult.length === 0)
      return res.status(404).json({ error: "Match not found" });

    const match_id = matchResult[0].id;
    const end_time = matchResult[0].end_date;
    const now = moment().format("YYYY-MM-DD HH:mm:ss");

    const {
      status = "SUSPENDED",
      inplay = 0,
      min = 0,
      max = 0,
      mname,
      runners = [],
    } = data;

    const questionStatus = status === "OPEN" ? 1 : 0;

    const [questionInsertResult] = await db.pool.execute(
      `INSERT INTO bet_questions (
        match_id, question, end_time, status, created_at, updated_at,
        market_id, market_name, event_id, inplay, min_amount, max_amount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        match_id,
        mname ?? null,
        end_time,
        questionStatus,
        now,
        now,
        market_id ?? null,
        mname ?? null,
        matchEventId ?? null,
        inplay,
        min,
        max,
      ]
    );

    const question_id = questionInsertResult.insertId;

    let inserted = 0,
      skipped = 0,
      failed = 0;
    const details = [];

    for (const runner of runners) {
      try {
        const [existing] = await db.pool.execute(
          `SELECT id FROM bet_options WHERE question_id = ? AND selection_id = ?`,
          [question_id, runner.selectionId]
        );

        if (existing.length > 0) {
          skipped++;
          details.push({
            runnerName: runner.runnerName,
            selection_id: runner.selectionId,
            status: "skipped",
          });
          continue;
        }

        await db.pool.execute(
          `INSERT INTO bet_options (
            question_id, match_id, option_name, min_amo, status, created_at,
            updated_at, selection_id, last_price_traded
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            question_id,
            match_id,
            runner.runnerName ?? null,
            100,
            runner.status === "ACTIVE" ? 1 : 0,
            now,
            now,
            runner.selectionId ?? null,
            runner.lastPriceTraded ?? 0,
          ]
        );

        inserted++;
        details.push({
          runnerName: runner.runnerName,
          selection_id: runner.selectionId,
          status: "inserted",
        });
      } catch (err) {
        failed++;
        details.push({
          runnerName: runner.runnerName,
          selection_id: runner.selectionId,
          status: "failed",
          error: err.message,
        });
      }
    }

    res.status(200).json({
      message: "✅ Bookmaker odds inserted",
      question_id,
      inserted,
      skipped,
      failed,
      details,
    });
  } catch (error) {
    console.error("❌ Error in insertBookmakerOddsData:", error);
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
};
const getBookmakerOdds = async (req, res) => {
  try {
    const { event_id, market_id } = req.params;
    const url = `http://65.0.40.23:7003/api/bookmaker-odds/${event_id}/${market_id}`;
    const cacheKey = `/bookmaker-odds/${event_id}/${market_id}`;

    console.log(`🔍 Checking Redis cache for key: ${cacheKey}`);

    // Check Redis cache first
    try {
      const cachedData = await redis.get(cacheKey);
      if (cachedData) {
        console.log("✅ Returning bookmaker odds data from Redis");
        return res.json(JSON.parse(cachedData));
      }
    } catch (redisErr) {
      console.error("⚠️ Redis get error:", redisErr.message);
      // Proceed to fetch from API
    }

    console.log(`🌐 Cache miss. Fetching from API: ${url}`);
    const oddsResponse = await axios.get(url);

    if (
      !oddsResponse.data ||
      (Array.isArray(oddsResponse.data) && oddsResponse.data.length === 0) ||
      (typeof oddsResponse.data === "object" &&
        Object.keys(oddsResponse.data).length === 0)
    ) {
      return res.status(404).json({ error: "API data not present yet" });
    }

    // Store in Redis for 10 minutes
    try {
      await redis.setEx(cacheKey, 600, JSON.stringify(oddsResponse.data));
      console.log("✅ Bookmaker odds data cached in Redis");
    } catch (redisCacheError) {
      console.error("⚠️ Redis set error:", redisCacheError.message);
    }

    res.json(oddsResponse.data);
  } catch (error) {
    console.error("❌ Error fetching bookmaker odds:", error.message);
    res.status(500).json({ error: "Failed to fetch bookmaker odds" });
  }
};

const fetchAndCacheBookmakerOdds = async (req, res) => {
  try {
    const { event_id, market_id } = req.params;
    const url = `http://65.0.40.23:7003/api/bookmaker-odds/${event_id}/${market_id}`;
    const cacheKey = `/bookmaker-odds/${event_id}/${market_id}`;

    console.log(`🌐 Fetching and caching bookmaker odds from API: ${url}`);
    const oddsResponse = await axios.get(url);

    if (
      !oddsResponse.data ||
      (Array.isArray(oddsResponse.data) && oddsResponse.data.length === 0) ||
      (typeof oddsResponse.data === "object" && Object.keys(oddsResponse.data).length === 0)
    ) {
      return res.status(404).json({ error: "API data not present yet" });
    }

    // Store in Redis for 5 seconds
    try {
      await redis.setEx(cacheKey, 5, JSON.stringify(oddsResponse.data));
      console.log("✅ Bookmaker odds data cached in Redis for 5s");
    } catch (redisErr) {
      console.error("⚠️ Redis set error:", redisErr.message);
    }

    res.json({ message: "✅ Cached bookmaker odds successfully" });
  } catch (error) {
    console.error("❌ Error in fetchAndCacheBookmakerOdds:", error.message);
    res.status(500).json({ error: "Failed to fetch and cache bookmaker odds" });
  }
};


module.exports = { getBookmakerOdds,insertBookmakerToSqlandRedis ,fetchAndCacheBookmakerOdds};
