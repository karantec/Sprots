const axios = require("axios");
const moment = require("moment");
const db = require("../db");
const { default: Redis } = require("ioredis");
// const BASE_URL = process.env.BOOKMAKER_API_BASE_URL || 'http://65.0.40.23:7003/api';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const insertBookmakerOddsData = async (req, res) => {
  try {
    const { event_id, market_id } = req.params;
    await delay(1000);

    // Fetch data from the API
    const response = await axios.get(
      `http://65.0.40.23:7003/api/bookmaker-odds/${event_id}/${market_id}`
    );
    const data = response.data?.data;

    if (!data)
      return res.status(404).json({ error: "No data from bookmaker-odds API" });

    const matchEventId = data.evid;

    // Retrieve match data from the database
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
      market,
      status = "SUSPENDED",
      inplay = 0,
      min = 0,
      max = 0,
      mname,
      runners = [],
    } = data;

    const questionStatus = status === "OPEN" ? 1 : 0;

    // Insert the question data into the bet_questions table
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

    // Insert bet options for each runner
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

        // Insert a new bet option into bet_options
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
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
};

// const fetchBookmakerOdds = async (req, res) => {
//     try {
//         const { event_id, market_id } = req.params;
//         const url = `http://65.0.40.23:7003/api/bookmaker-odds/${event_id}/${market_id}`;

//         console.log(`🔍 Fetching bookmaker odds from: ${url}`);

//         const oddsResponse = await axios.get(url);

//         // Check if the response is empty or has no usable data
//         if (
//             !oddsResponse.data ||
//             (Array.isArray(oddsResponse.data) && oddsResponse.data.length === 0) ||
//             (typeof oddsResponse.data === 'object' && Object.keys(oddsResponse.data).length === 0)
//         ) {
//             return res.status(404).json({ error: 'API data not present yet' });
//         }

//         // Cache in Redis for 10 minutes
//         await redisClient.setEx(req.originalUrl, 600, JSON.stringify(oddsResponse.data));

//         res.json(oddsResponse.data);
//     } catch (error) {
//         console.error('❌ Error fetching bookmaker odds:', error.message);
//         res.status(500).json({ error: 'Failed to fetch bookmaker odds' });
//     }
// };

const fetchBookmakerOdds = async (req, res) => {
  try {
    const { event_id, market_id } = req.params;
    const url = `http://65.0.40.23:7003/api/bookmaker-odds/${event_id}/${market_id}`;
    const cacheKey = req.originalUrl;

    console.log(`🔍 Fetching bookmaker odds from: ${url}`);

    // Check cache first
    try {
      const cachedData = await redis.get(cacheKey);
      if (cachedData) {
        console.log("✅ Returning cached bookmaker odds data");
        return res.json(JSON.parse(cachedData));
      }
    } catch (redisError) {
      console.error("⚠️ Redis cache retrieval error:", redisError.message);
      // Continue with API call if cache fails
    }

    const oddsResponse = await axios.get(url);

    // Check if the response is empty or has no usable data
    if (
      !oddsResponse.data ||
      (Array.isArray(oddsResponse.data) && oddsResponse.data.length === 0) ||
      (typeof oddsResponse.data === "object" &&
        Object.keys(oddsResponse.data).length === 0)
    ) {
      return res.status(404).json({ error: "API data not present yet" });
    }

    // Cache in Redis for 10 minutes
    try {
      await redis.setEx(cacheKey, 600, JSON.stringify(oddsResponse.data));
      console.log("✅ Bookmaker odds stored in Redis cache");
    } catch (redisCacheError) {
      console.error("⚠️ Redis caching error:", redisCacheError.message);
      // Continue even if caching fails
    }

    res.json(oddsResponse.data);
  } catch (error) {
    console.error("❌ Error fetching bookmaker odds:", error.message);
    res.status(500).json({ error: "Failed to fetch bookmaker odds" });
  }
};

const storeThenInsertFancyOddsData = async (req, res) => {
  try {
    const { event_id, market_id } = req.params;
    await delay(1000);

    // Fetch data from API
    const response = await axios.get(
      `http://65.0.40.23:7003/api/fancy-odds/${event_id}/${market_id}`
    );
    const data = response.data?.data;

    if (!Array.isArray(data)) {
      return res.status(404).json({ error: "No fancy-odds data found" });
    }

    // Prepare and store data in Redis
    const fancyData = data.map((item) => ({
      runnerName: item.RunnerName || "Unknown",
      selectionId: item.SelectionId,
      gtype: item.gtype || "session",
      minAmount: parseInt(item.min) || 100,
      maxAmount: parseInt(item.max) || 50000,
      status: item.GameStatus === "SUSPENDED" ? 0 : 1,
      LayPrice1: parseFloat(item.LayPrice1) || 1.0,
      LayPrice2: parseFloat(item.LayPrice2) || 0,
      LayPrice3: parseFloat(item.LayPrice3) || 0,
      BackPrice1: parseFloat(item.BackPrice1) || 1.0,
      BackPrice2: parseFloat(item.BackPrice2) || 0,
      BackPrice3: parseFloat(item.BackPrice3) || 0,
      SelectionId: item.SelectionId || "",
      GameStatus: item.GameStatus || "",
      sr_no: item.sr_no || 0,
      ballsess: item.ballsess || 0,
      min: item.min || 0,
      max: item.max || 0,
      rem: item.rem || "",
    }));

    const redisKey = `fancyOdds:${event_id}:${market_id}`;
    await redis.set(redisKey, JSON.stringify(fancyData), "EX", 60 * 60);

    // Fetch match info
    const [matchRow] = await db.pool.execute(
      `SELECT id, end_date FROM matches WHERE api_event_id = ? AND api_market_id = ? LIMIT 1`,
      [event_id, market_id]
    );

    if (matchRow.length === 0) {
      return res.status(404).json({ error: "Match not found" });
    }

    const match_id = matchRow[0].id;
    const end_time = matchRow[0].end_date;
    const now = moment().format("YYYY-MM-DD HH:mm:ss");

    let inserted = 0,
      failed = 0;
    const details = [];

    for (const item of fancyData) {
      const { runnerName, selectionId, gtype, minAmount, maxAmount, status } =
        item;

      if (!runnerName || !selectionId) {
        failed++;
        details.push({
          runnerName,
          selectionId,
          status: "failed",
          error: "Missing RunnerName or SelectionId",
        });
        continue;
      }

      let question_id;

      const [existingQuestion] = await db.pool.execute(
        `SELECT id FROM bet_questions WHERE match_id = ? AND question = ? AND market_id = ? LIMIT 1`,
        [match_id, runnerName, market_id]
      );

      if (existingQuestion.length > 0) {
        question_id = existingQuestion[0].id;
        await db.pool.execute(
          `UPDATE bet_questions SET status = ?, updated_at = ?, min_amount = ?, max_amount = ? WHERE id = ?`,
          [status, now, minAmount, maxAmount, question_id]
        );
      } else {
        const [insertResult] = await db.pool.execute(
          `INSERT INTO bet_questions (
            match_id, question, end_time, status, created_at, updated_at,
            market_id, market_name, event_id, inplay, min_amount, max_amount
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            match_id,
            runnerName,
            end_time,
            1,
            now,
            now,
            market_id,
            gtype,
            event_id,
            1,
            minAmount,
            maxAmount,
          ]
        );
        question_id = insertResult.insertId;
      }

      const betOptions = [
        {
          type: "Back",
          price: item.BackPrice1,
          price2: item.BackPrice2,
          price3: item.BackPrice3,
        },
        {
          type: "Lay",
          price: item.LayPrice1,
          price2: item.LayPrice2,
          price3: item.LayPrice3,
        },
      ];

      for (const option of betOptions) {
        const [exists] = await db.pool.execute(
          `SELECT id FROM bet_options WHERE selection_id = ? AND match_id = ? AND question_id = ? AND option_name = ? LIMIT 1`,
          [selectionId, match_id, question_id, option.type]
        );

        if (exists.length > 0) {
          await db.pool.execute(
            `UPDATE bet_options SET 
              return_amount = ?, min_amo = ?, bet_limit = ?, status = ?, updated_at = ?, last_price_traded = ?
            WHERE id = ?`,
            [
              option.price,
              minAmount,
              maxAmount,
              1,
              now,
              option.price,
              exists[0].id,
            ]
          );
        } else {
          await db.pool.execute(
            `INSERT INTO bet_options (
              question_id, match_id, option_name, invest_amount, return_amount, min_amo,
              ratio1, ratio2, bet_limit, status, created_at, updated_at, selection_id, last_price_traded
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              question_id,
              match_id,
              option.type,
              minAmount,
              option.price,
              100,
              1,
              1,
              50000,
              1,
              now,
              now,
              selectionId,
              option.price,
            ]
          );
          inserted++;
        }
      }

      details.push({
        runnerName,
        selectionId,
        question_id,
        status: "processed",
      });
    }

    res.status(200).json({
      message: "✅ Fancy odds stored in Redis and processed into SQL",
      inserted,
      failed,
      details,
    });
  } catch (error) {
    console.error("❌ Error in storeThenInsertFancyOddsData:", error);
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
};

module.exports = {
  insertBookmakerOddsData,
  fetchBookmakerOdds,
  storeThenInsertFancyOddsData,
  // storeFancyDataToRedis,
  // getFancyDataFromRedis,
};
