const axios = require("axios");
const moment = require("moment");
const db = require("../db");
const { default: Redis } = require("ioredis");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Initialize Redis connection
const redis = new Redis({
  host: "localhost",
  port: 6379,
  db: 0,
});

// Configure Redis subscriber for database updates
const redisSub = new Redis({
  host: "localhost",
  port: 6379,
  db: 0,
});

// Auto-sync interval in milliseconds (e.g., 5 minutes)
const AUTO_SYNC_INTERVAL = 5 * 60 * 1000;

// Initialize the background sync process
const initBackgroundSync = () => {
  console.log("🔄 Initializing background sync process");
  
  // Subscribe to specific Redis channels for real-time updates
  redisSub.subscribe("bookmaker:update", "fancy:update");
  
  redisSub.on("message", async (channel, message) => {
    try {
      const data = JSON.parse(message);
      if (channel === "bookmaker:update") {
        await syncBookmakerDataToDatabase(data.event_id, data.market_id);
      } else if (channel === "fancy:update") {
        await syncFancyDataToDatabase(data.event_id, data.market_id);
      }
    } catch (error) {
      console.error(`❌ Error processing Redis message on channel ${channel}:`, error);
    }
  });
  
  // Set up periodic sync for all cached data
  setInterval(async () => {
    try {
      // Get all keys for bookmaker odds
      const bookmakerKeys = await redis.keys("bookmakerOdds:*");
      for (const key of bookmakerKeys) {
        const [_, event_id, market_id] = key.split(":");
        await syncBookmakerDataToDatabase(event_id, market_id);
      }
      
      // Get all keys for fancy odds
      const fancyKeys = await redis.keys("fancyOdds:*");
      for (const key of fancyKeys) {
        const [_, event_id, market_id] = key.split(":");
        await syncFancyDataToDatabase(event_id, market_id);
      }
      
      console.log("✅ Completed periodic sync of Redis data to database");
    } catch (error) {
      console.error("❌ Error in periodic sync:", error);
    }
  }, AUTO_SYNC_INTERVAL);
};

// Function to fetch and store bookmaker odds in Redis
const fetchAndStoreBookmakerOdds = async (req, res) => {
  try {
    const { event_id, market_id } = req.params;
    const url = `http://65.0.40.23:7003/api/bookmaker-odds/${event_id}/${market_id}`;
    const redisKey = `bookmakerOdds:${event_id}:${market_id}`;

    console.log(`🔍 Fetching bookmaker odds from: ${url}`);

    // Check cache first
    try {
      const cachedData = await redis.get(redisKey);
      if (cachedData) {
        console.log('✅ Returning cached bookmaker odds data');
        
        // Trigger background sync from cache to database
        syncBookmakerDataToDatabase(event_id, market_id).catch(err => {
          console.error('⚠️ Background sync error:', err.message);
        });
        
        return res.json(JSON.parse(cachedData));
      }
    } catch (redisError) {
      console.error('⚠️ Redis cache retrieval error:', redisError.message);
    }

    const oddsResponse = await axios.get(url);

    // Check if the response is empty or has no usable data
    if (
      !oddsResponse.data || 
      (Array.isArray(oddsResponse.data) && oddsResponse.data.length === 0) ||
      (typeof oddsResponse.data === 'object' && Object.keys(oddsResponse.data).length === 0)
    ) {
      return res.status(404).json({ error: 'API data not present yet' });
    }

    // Cache in Redis for 10 minutes
    try {
      await redis.setEx(redisKey, 600, JSON.stringify(oddsResponse.data));
      console.log('✅ Bookmaker odds stored in Redis cache');
      
      // Publish an update notification
      redis.publish("bookmaker:update", JSON.stringify({ event_id, market_id }));
      
      // Trigger immediate database sync in the background
      syncBookmakerDataToDatabase(event_id, market_id).catch(err => {
        console.error('⚠️ Background sync error:', err.message);
      });
    } catch (redisCacheError) {
      console.error('⚠️ Redis caching error:', redisCacheError.message);
    }

    res.json({
      ...oddsResponse.data,
      message: "✅ Data stored in Redis and syncing to database in background"
    });
  } catch (error) {
    console.error('❌ Error fetching bookmaker odds:', error.message);
    res.status(500).json({ error: 'Failed to fetch bookmaker odds' });
  }
};

// Function to fetch and store fancy odds in Redis
const fetchAndStoreFancyOdds = async (req, res) => {
  try {
    const { event_id, market_id } = req.params;
    const url = `http://65.0.40.23:7003/api/fancy-odds/${event_id}/${market_id}`;
    const redisKey = `fancyOdds:${event_id}:${market_id}`;

    console.log(`🔍 Fetching fancy odds from: ${url}`);

    // Check cache first
    try {
      const cachedData = await redis.get(redisKey);
      if (cachedData) {
        console.log('✅ Returning cached fancy odds data');
        
        // Trigger background sync from cache to database
        syncFancyDataToDatabase(event_id, market_id).catch(err => {
          console.error('⚠️ Background sync error:', err.message);
        });
        
        return res.json(JSON.parse(cachedData));
      }
    } catch (redisError) {
      console.error('⚠️ Redis cache retrieval error:', redisError.message);
    }

    // Fetch data from API
    const response = await axios.get(url);
    const data = response.data?.data;

    if (!Array.isArray(data)) {
      return res.status(404).json({ error: "No fancy-odds data found" });
    }

    // Process and format the data
    const fancyData = data.map((item) => {
      return {
        RunnerName: item.RunnerName || "Unknown",
        SelectionId: item.SelectionId,
        gtype: item.gtype || "session",
        min: parseInt(item.min) || 100,
        max: parseInt(item.max) || 50000,
        GameStatus: item.GameStatus || "SUSPENDED",
        LayPrice1: parseFloat(item.LayPrice1) || 1.0,
        LayPrice2: parseFloat(item.LayPrice2) || 0,
        LayPrice3: parseFloat(item.LayPrice3) || 0,
        BackPrice1: parseFloat(item.BackPrice1) || 1.0,
        BackPrice2: parseFloat(item.BackPrice2) || 0,
        BackPrice3: parseFloat(item.BackPrice3) || 0,
        BackSize1: parseFloat(item.BackSize) || 0,
        BackSize2: parseFloat(item.BackSize2) || 0,
        BackSize3: parseFloat(item.BackSize3) || 0,
        LaySize1: parseFloat(item.LaySize) || 0,
        LaySize2: parseFloat(item.LaySize2) || 0,
        LaySize3: parseFloat(item.LaySize3) || 0,
        sr_no: item.sr_no || 0,
        ballsess: item.ballsess || 0,
        rem: item.rem || ""
      };
    });

    // Store in Redis with expiry
    await redis.set(redisKey, JSON.stringify({
      data: fancyData,
      metadata: {
        event_id,
        market_id,
        timestamp: new Date().toISOString()
      }
    }), "EX", 600); // 10 minutes expiry

    // Publish an update notification
    redis.publish("fancy:update", JSON.stringify({ event_id, market_id }));
    
    // Trigger immediate database sync in the background
    syncFancyDataToDatabase(event_id, market_id).catch(err => {
      console.error('⚠️ Background sync error:', err.message);
    });

    res.status(200).json({
      message: "✅ Fancy odds data stored in Redis and syncing to database in background",
      data: fancyData
    });
  } catch (error) {
    console.error("❌ Error in fetchAndStoreFancyOdds:", error);
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
};

// Function to sync bookmaker odds from Redis to database
const syncBookmakerDataToDatabase = async (event_id, market_id) => {
  console.log(`🔄 Syncing bookmaker data to database for event ${event_id}, market ${market_id}`);
  
  try {
    const redisKey = `bookmakerOdds:${event_id}:${market_id}`;
    const cachedData = await redis.get(redisKey);
    
    if (!cachedData) {
      console.log(`⚠️ No cached data found for ${redisKey}`);
      return { status: "skipped", reason: "no_data" };
    }
    
    const parsedData = JSON.parse(cachedData);
    const data = parsedData.data;
    
    if (!data) {
      console.log(`⚠️ Invalid data format in Redis for ${redisKey}`);
      return { status: "skipped", reason: "invalid_data" };
    }

    const matchEventId = data.evid;

    // Retrieve match data from the database
    const [matchResult] = await db.pool.execute(
      `SELECT id, end_date FROM matches WHERE api_event_id = ? AND api_market_id = ? LIMIT 1`,
      [matchEventId, market_id]
    );

    if (matchResult.length === 0) {
      console.log(`⚠️ Match not found for event ${matchEventId}, market ${market_id}`);
      return { status: "skipped", reason: "match_not_found" };
    }

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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        status = VALUES(status),
        updated_at = VALUES(updated_at),
        min_amount = VALUES(min_amount),
        max_amount = VALUES(max_amount)`,
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

    // Get question_id (either from insert or from existing record)
    let question_id;
    if (questionInsertResult.insertId > 0) {
      question_id = questionInsertResult.insertId;
    } else {
      const [existingQuestion] = await db.pool.execute(
        `SELECT id FROM bet_questions WHERE match_id = ? AND market_id = ? AND event_id = ? LIMIT 1`,
        [match_id, market_id, matchEventId]
      );
      question_id = existingQuestion[0]?.id;
    }

    // Insert bet options for each runner
    let inserted = 0, updated = 0, skipped = 0, failed = 0;
    const details = [];

    for (const runner of runners) {
      try {
        const [existing] = await db.pool.execute(
          `SELECT id FROM bet_options WHERE question_id = ? AND selection_id = ?`,
          [question_id, runner.selectionId]
        );

        if (existing.length > 0) {
          // Update existing bet option
          await db.pool.execute(
            `UPDATE bet_options SET 
              option_name = ?, 
              status = ?, 
              updated_at = ?, 
              last_price_traded = ? 
            WHERE id = ?`,
            [
              runner.runnerName ?? null,
              runner.status === "ACTIVE" ? 1 : 0,
              now,
              runner.lastPriceTraded ?? 0,
              existing[0].id
            ]
          );
          updated++;
          details.push({
            runnerName: runner.runnerName,
            selection_id: runner.selectionId,
            status: "updated"
          });
        } else {
          // Insert a new bet option
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
            status: "inserted"
          });
        }
      } catch (err) {
        failed++;
        details.push({
          runnerName: runner.runnerName,
          selection_id: runner.selectionId,
          status: "failed",
          error: err.message
        });
      }
    }

    console.log(`✅ Bookmaker sync completed: ${inserted} inserted, ${updated} updated, ${skipped} skipped, ${failed} failed`);
    return { 
      status: "completed", 
      question_id, 
      inserted, 
      updated,
      skipped, 
      failed
    };
  } catch (error) {
    console.error("❌ Error in syncBookmakerDataToDatabase:", error);
    return { 
      status: "error", 
      error: error.message 
    };
  }
};

// Function to sync fancy odds from Redis to database
const syncFancyDataToDatabase = async (event_id, market_id) => {
  console.log(`🔄 Syncing fancy data to database for event ${event_id}, market ${market_id}`);
  
  try {
    const redisKey = `fancyOdds:${event_id}:${market_id}`;
    const cachedData = await redis.get(redisKey);
    
    if (!cachedData) {
      console.log(`⚠️ No cached data found for ${redisKey}`);
      return { status: "skipped", reason: "no_data" };
    }
    
    const parsedData = JSON.parse(cachedData);
    const data = parsedData.data;
    
    if (!Array.isArray(data)) {
      console.log(`⚠️ Invalid data format in Redis for ${redisKey}`);
      return { status: "skipped", reason: "invalid_data" };
    }

    // Retrieve match data from the database
    const [matchRow] = await db.pool.execute(
      `SELECT id, end_date FROM matches WHERE api_event_id = ? AND api_market_id = ? LIMIT 1`,
      [event_id, market_id]
    );

    if (matchRow.length === 0) {
      console.log(`⚠️ Match not found for event ${event_id}, market ${market_id}`);
      return { status: "skipped", reason: "match_not_found" };
    }

    const match_id = matchRow[0].id;
    const end_time = matchRow[0].end_date;
    const now = moment().format("YYYY-MM-DD HH:mm:ss");

    let inserted = 0, updated = 0, skipped = 0, failed = 0;
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
          error: "Missing RunnerName or SelectionId"
        });
        continue;
      }

      const gtype = item.gtype || "session";
      const minAmount = parseInt(item.min) || 100;
      const maxAmount = parseInt(item.max) || 50000;
      const status = item.GameStatus === "SUSPENDED" ? 0 : 1;
      const backPrice = parseFloat(item.BackPrice1) > 0 ? parseFloat(item.BackPrice1) : 1.0;
      const layPrice = parseFloat(item.LayPrice1) > 0 ? parseFloat(item.LayPrice1) : 1.0;

      // Additional prices with default values
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
        updated++;
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
            status,
            now,
            now,
            market_id,
            gtype,
            event_id,
            1,
            minAmount,
            maxAmount
          ]
        );
        question_id = insertResult.insertId;
        inserted++;
      }

      // Insert bet options for back and lay prices
      const betOptions = [
        { type: "Back", price: backPrice, price2: backPrice2, price3: backPrice3 },
        { type: "Lay", price: layPrice, price2: layPrice2, price3: layPrice3 }
      ];

      for (const option of betOptions) {
        try {
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
                status,
                now,
                option.price,
                exists[0].id
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
                status,
                now,
                now,
                selectionId,
                option.price
              ]
            );
          }
        } catch (err) {
          failed++;
          details.push({
            runnerName,
            selectionId,
            option: option.type,
            status: "failed",
            error: err.message
          });
        }
      }

      details.push({
        runnerName,
        selectionId,
        question_id,
        status: "processed"
      });
    }

    console.log(`✅ Fancy odds sync completed: ${inserted} inserted, ${updated} updated, ${skipped} skipped, ${failed} failed`);
    return { 
      status: "completed", 
      inserted, 
      updated,
      skipped, 
      failed
    };
  } catch (error) {
    console.error("❌ Error in syncFancyDataToDatabase:", error);
    return { 
      status: "error", 
      error: error.message 
    };
  }
};

// Manual trigger for syncing bookmaker data
const manualSyncBookmakerData = async (req, res) => {
  try {
    const { event_id, market_id } = req.params;
    const result = await syncBookmakerDataToDatabase(event_id, market_id);
    res.status(200).json({
      message: "✅ Manual bookmaker sync completed",
      result
    });
  } catch (error) {
    console.error("❌ Error in manualSyncBookmakerData:", error);
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
};

// Manual trigger for syncing fancy data
const manualSyncFancyData = async (req, res) => {
  try {
    const { event_id, market_id } = req.params;
    const result = await syncFancyDataToDatabase(event_id, market_id);
    res.status(200).json({
      message: "✅ Manual fancy sync completed",
      result
    });
  } catch (error) {
    console.error("❌ Error in manualSyncFancyData:", error);
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
};

// Get fancy data directly from Redis
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
      data: JSON.parse(cachedData)
    });
  } catch (error) {
    console.error("❌ Error in getFancyDataFromRedis:", error);
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
};

// Get bookmaker data directly from Redis
const getBookmakerDataFromRedis = async (req, res) => {
  const { event_id, market_id } = req.params;
  const redisKey = `bookmakerOdds:${event_id}:${market_id}`;

  try {
    const cachedData = await redis.get(redisKey);
    if (!cachedData) {
      return res.status(404).json({ error: "Data not found in Redis cache" });
    }

    res.status(200).json({
      message: "✅ Retrieved bookmaker odds data from Redis",
      data: JSON.parse(cachedData)
    });
  } catch (error) {
    console.error("❌ Error in getBookmakerDataFromRedis:", error);
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
};

// Initialize the background sync process when the module is loaded
initBackgroundSync();

module.exports = {
  fetchAndStoreBookmakerOdds,
  fetchAndStoreFancyOdds,
  manualSyncBookmakerData,
  manualSyncFancyData,
  getFancyDataFromRedis,
  getBookmakerDataFromRedis,
  // These functions are exported to allow direct usage from other modules
  syncBookmakerDataToDatabase,
  syncFancyDataToDatabase
};
