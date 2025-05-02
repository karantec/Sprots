const axios = require("axios");
const moment = require("moment");
const db = require("../db");
const { default: Redis } = require("ioredis");

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

const fetchBookmakerOdds = async (req, res) => {
    try {
        const { eventId, marketId } = req.params;
        const url = `${BASE_URL}/bookmaker-odds/${eventId}/${marketId}`;

        console.log(`🔍 Fetching bookmaker odds from: ${url}`);

        const oddsResponse = await axios.get(url);

        if (!oddsResponse.data) {
            return res.status(404).json({ error: 'No bookmaker odds found' });
        }

        // Cache in Redis for 10 minutes
        await redisClient.setEx(req.originalUrl, 600, JSON.stringify(oddsResponse.data));

        res.json(oddsResponse.data);
    } catch (error) {
        console.error('❌ Error fetching bookmaker odds:', error.message);
        res.status(500).json({ error: 'Failed to fetch bookmaker odds' });
    }
};


const insertFancyOddsData = async (req, res) => {
  try {
    const { event_id, market_id } = req.params;
    await delay(1000);

    // Fetch data from the API
    const response = await axios.get(
      `http://65.0.40.23:7003/api/fancy-odds/${event_id}/${market_id}`
    );
    const data = response.data?.data;

    if (!Array.isArray(data))
      return res.status(404).json({ error: "No fancy-odds data found" });

    // Retrieve match data from the database
    const [matchRow] = await db.pool.execute(
      `SELECT id, end_date FROM matches WHERE api_event_id = ? AND api_market_id = ? LIMIT 1`,
      [event_id, market_id]
    );

    if (matchRow.length === 0)
      return res.status(404).json({ error: "Match not found" });

    const match_id = matchRow[0].id;
    const end_time = matchRow[0].end_date;
    const now = moment().format("YYYY-MM-DD HH:mm:ss");

    let inserted = 0,
      skipped = 0,
      failed = 0;
    const details = [];

    // Iterate over each item in the fancy odds data
    for (const item of data) {
      const runnerName = item.RunnerName;
      const selectionId = item.SelectionId;

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

      const gtype = item.gtype || "session";
      const minAmount = parseInt(item.min) || 100;
      const maxAmount = parseInt(item.max) || 50000;
      const status = item.GameStatus === "SUSPENDED" ? 0 : 1;
      const backPrice =
        parseFloat(item.BackPrice1) > 0 ? parseFloat(item.BackPrice1) : 1.0;
      const layPrice =
        parseFloat(item.LayPrice1) > 0 ? parseFloat(item.LayPrice1) : 1.0;

      // Ensure all lay and back prices have default values if missing
      const layPrice2 = parseFloat(item.LayPrice2) || 0;
      const layPrice3 = parseFloat(item.LayPrice3) || 0;
      const backPrice2 = parseFloat(item.BackPrice2) || 0;
      const backPrice3 = parseFloat(item.BackPrice3) || 0;

      let question_id;

      // Check if the question already exists
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
        // Insert a new question if not found
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

      // Insert bet options for back and lay prices
      const betOptions = [
        {
          type: "Back",
          price: backPrice,
          price2: backPrice2,
          price3: backPrice3,
        },
        { type: "Lay", price: layPrice, price2: layPrice2, price3: layPrice3 },
      ];

      for (const option of betOptions) {
        const [exists] = await db.pool.execute(
          `SELECT id FROM bet_options WHERE selection_id = ? AND match_id = ? AND question_id = ? AND option_name = ? LIMIT 1`,
          [selectionId, match_id, question_id, option.type]
        );

        if (exists.length > 0) {
          // Update existing record
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
          // Insert new record if not found
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
              minAmount,
              1,
              1,
              maxAmount,
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
      message: "✅ Fancy odds processed",
      inserted,
      skipped,
      failed,
      details,
    });
  } catch (error) {
    console.error("❌ Error in insertFancyOddsData:", error);
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
};

const redis = new Redis({
  host: "localhost", // Redis server hostname (change as needed)
  port: 6379, // Redis server port (default is 6379)
  db: 0, // Select the database (optional, default is 0)
});

const storeFancyDataToRedis = async (req, res) => {
  try {
    const { event_id, market_id } = req.params;

    // Delay to simulate processing
    await delay(1000);

    // Fetch fancy odds data from the API
    const response = await axios.get(
      `http://65.0.40.23:7003/api/fancy-odds/${event_id}/${market_id}`
    );
    const data = response.data?.data;

    if (!Array.isArray(data))
      return res.status(404).json({ error: "No fancy-odds data found" });

    // Prepare data for Redis storage
    const fancyData = data.map((item) => {
      const runnerName = item.RunnerName || "Unknown";
      const selectionId = item.SelectionId;
      const gtype = item.gtype || "";
      const minAmount = parseInt(item.min) || 100;
      const maxAmount = parseInt(item.max) || 50000;
      const status = item.GameStatus === "SUSPENDED" ? 0 : 1;
      const GameStatus = item.GameStatus || "";
      const SelectionId = item.SelectionId || "";
      const sr_no = item.sr_no || 0;
      const ballsess = item.ballsess || 0;
      const min = item.min || 0;
      const max = item.max || 0;
      const rem = item.rem || "";

      // Prices
      const LayPrice1 = parseFloat(item.LayPrice1) || 1.0;

      const LayPrice2 = parseFloat(item.LayPrice2) || 0;
      const LayPrice3 = parseFloat(item.LayPrice3) || 0;
      const BackPrice1 = parseFloat(item.BackPrice1) || 1.0;
      const BackPrice2 = parseFloat(item.BackPrice2) || 0;
      const BackPrice3 = parseFloat(item.BackPrice3) || 0;
      const BackSize1 = parseFloat(item.BackSize) || 0;
      const BackSize2 = parseFloat(item.BackSize2) || 0;
      const BackSize3 = parseFloat(item.BackSize3) || 0;
      const LaySize1 = parseFloat(item.LaySize) || 0;
      const LaySize2 = parseFloat(item.LaySize2) || 0;
      const LaySize3 = parseFloat(item.LaySize3) || 0;

      return {
        runnerName,
        selectionId,
        gtype,
        minAmount,
        maxAmount,
        status,
        LayPrice1,
        LayPrice2,
        LayPrice3,
        BackPrice1,
        GameStatus,
        BackPrice2,
        BackPrice3,
        BackSize1,
        BackSize2,
        BackSize3,
        LaySize1,
        LaySize2,
        LaySize3,

        SelectionId,
        sr_no,
        ballsess,
        min,
        max,
        rem,
      };
    });

    // Store the processed data in Redis (using a unique key per event and market)
    const redisKey = `fancyOdds:${event_id}:${market_id}`;
    await redis.set(redisKey, JSON.stringify(fancyData), "EX", 60 * 60); // Expiry time set to 1 hour

    // Return success response
    res.status(200).json({
      message: "✅ Fancy odds data stored in Redis",
      storedData: fancyData,
    });
  } catch (error) {
    console.error("❌ Error in storeFancyDataToRedis:", error);
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
};
const getFancyDataFromRedis = async (req, res) => {
  const { event_id, market_id } = req.params;
  const redisKey = `fancyOdds:${event_id}:${market_id}`;

  try {
    const cachedData = await redis.get(redisKey);
    if (!cachedData) {
      return res.status(404).json({ error: "Data not found in Redis cache" });
    }

    res.status(200).json({
      message: "✅ Retrieved fancy odds data from Redis",
      data: JSON.parse(cachedData),
    });
  } catch (error) {
    console.error("❌ Error in getFancyDataFromRedis:", error);
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
};

module.exports = {
  insertBookmakerOddsData,
  fetchBookmakerOdds,
  insertFancyOddsData,
  storeFancyDataToRedis,
  getFancyDataFromRedis,
};
