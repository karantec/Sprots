const axios = require('axios');
const { pool } = require('../db'); // adjust based on your DB connection file
const { createClient } = require('redis');
const moment = require('moment');

// Modern Redis client implementation
let redisClient = null;
let isRedisReady = false;

const initRedisClient = async () => {
  if (redisClient && isRedisReady) return redisClient;
  
  // Clean up existing client if it exists
  if (redisClient) {
    await redisClient.quit().catch(console.error);
  }
  
  redisClient = createClient({ url: 'redis://localhost:6379' });
  
  redisClient.on('error', (err) => {
    console.error('Redis error:', err);
    isRedisReady = false;
  });
  
  redisClient.on('ready', () => {
    console.log('Redis client connected and ready.');
    isRedisReady = true;
  });
  
  redisClient.on('end', () => {
    console.log('Redis client connection closed.');
    isRedisReady = false;
  });
  
  // Connect the client
  await redisClient.connect().catch(err => {
    console.error('Failed to connect to Redis:', err);
    throw err;
  });
  
  return redisClient;
};

// Promisified Redis get operation
const redisGet = async (key) => {
  try {
    const client = await initRedisClient();
    return await client.get(key);
  } catch (error) {
    console.error(`Redis GET error for key ${key}:`, error);
    return null; // Return null if Redis operation fails
  }
};

// Promisified Redis set operation with confirmation
const redisSet = async (key, value, options = {}) => {
  try {
    const client = await initRedisClient();
    let result;
    
    if (options.expiry) {
      result = await client.set(key, value, { EX: options.expiry });
    } else {
      result = await client.set(key, value);
    }
    
    // Verify the data was stored correctly
    if (result === 'OK') {
      // Optional: verify stored data matches what we tried to store
      const storedValue = await client.get(key);
      if (storedValue === value) {
        console.log(`Successfully stored data in Redis: ${key}`);
        return true;
      } else {
        console.error(`Redis SET verification failed for key ${key} - stored value doesn't match`);
        return false;
      }
    } else {
      console.error(`Redis SET failed for key ${key} - result was ${result}`);
      return false;
    }
  } catch (error) {
    console.error(`Redis SET error for key ${key}:`, error);
    return false; // Return false if Redis operation fails
  }
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Insert Bet Question from Odds API
const insertBetQuestionFromOdds = async (req, res) => {
  try {
    await sleep(1000);
    const { event_id, market_id } = req.params;

    if (!event_id || !market_id) {
      return res.status(400).json({ error: 'Missing required parameters: event_id and market_id are required' });
    }

    console.log(`Processing bet question for event: ${event_id}, market: ${market_id}`);

    // Try to get cached data
    const cacheKey = `event-odds:${event_id}:${market_id}`;
    let data;
    let cacheHit = false;
    
    try {
      const cachedData = await redisGet(cacheKey);
      if (cachedData) {
        console.log('Data retrieved from Redis');
        data = JSON.parse(cachedData);
        cacheHit = true;
      }
    } catch (redisError) {
      console.error('Redis error, continuing without cache:', redisError);
      // Continue without cache if Redis fails
    }

    // If not in cache, fetch event odds from API
    if (!data) {
      const response = await axios.get(`http://65.0.40.23:7003/api/event-odds/${event_id}/${market_id}`);
      data = response.data.data;

      if (!data) {
        return res.status(404).json({ error: 'No data found from event-odds API' });
      }

      // Cache the fetched data in Redis with confirmation
      const dataString = JSON.stringify(data);
      const redisResult = await redisSet(cacheKey, dataString, { expiry: 3600 });
      
      console.log(`Redis cache result for ${cacheKey}: ${redisResult ? 'Success' : 'Failed'}`);
    }

    // Get match_id from matches table
    const [matchResult] = await pool.execute(
      `SELECT id, end_date FROM matches WHERE api_event_id = ? AND api_market_id = ? LIMIT 1`,
      [event_id, market_id]
    );

    if (matchResult.length === 0) {
      return res.status(404).json({ error: 'Match not found for given event_id and market_id' });
    }

    const match_id = matchResult[0].id;
    const {
      market,
      status,
      inplay,
      min = null,
      max = null
    } = data;

    const question = market;
    const end_time = matchResult[0].end_date; // Assuming end_date is in the correct format
    const questionStatus = status === 'OPEN' ? 1 : 0;
    const now = moment().format('YYYY-MM-DD HH:mm:ss');

    // Check if bet question already exists
    const [existingQuestion] = await pool.execute(
      `SELECT id FROM bet_questions WHERE event_id = ? AND market_id = ? LIMIT 1`,
      [event_id, market_id]
    );

    let betQuestionId;
    let sqlOperation = 'None';

    if (existingQuestion.length > 0) {
      // Question exists, update it
      betQuestionId = existingQuestion[0].id;
      const updateSql = `
        UPDATE bet_questions SET
          match_id = ?,
          question = ?,
          end_time = ?,
          status = ?,
          updated_at = ?,
          market_name = ?,
          inplay = ?,
          min_amount = ?,
          max_amount = ?
        WHERE id = ?
      `;

      const updateValues = [
        match_id,
        question,
        end_time,
        questionStatus,
        now,
        market,
        inplay,
        min || 0,
        max || 0,
        betQuestionId
      ];

      await pool.execute(updateSql, updateValues);
      sqlOperation = 'Updated';
      console.log(`Updated bet question ID: ${betQuestionId}`);
    } else {
      // Question doesn't exist, insert it
      const insertSql = `
        INSERT INTO bet_questions (
          match_id, 
          question, 
          end_time, 
          status, 
          created_at, 
          updated_at, 
          market_id, 
          market_name, 
          event_id, 
          inplay, 
          min_amount, 
          max_amount
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const insertValues = [
        match_id,
        question,
        end_time,
        questionStatus,
        now,
        now,
        market_id,
        market,
        event_id,
        inplay,
        min || 0,
        max || 0
      ];

      // Execute the insert
      const [insertResult] = await pool.execute(insertSql, insertValues);
      betQuestionId = insertResult.insertId;
      sqlOperation = 'Inserted';
      console.log(`Inserted new bet question ID: ${betQuestionId}`);
    }

    // Retrieve the bet_question data
    const [betQuestion] = await pool.execute(
      `SELECT * FROM bet_questions WHERE id = ? LIMIT 1`,
      [betQuestionId]
    );

    // Store the bet question in Redis too for faster access
    const betQuestionCacheKey = `bet-question:${event_id}:${market_id}`;
    const betQuestionRedisResult = await redisSet(
      betQuestionCacheKey, 
      JSON.stringify(betQuestion[0]), 
      { expiry: 86400 } // Cache for 24 hours
    );
    
    console.log(`Redis cache result for ${betQuestionCacheKey}: ${betQuestionRedisResult ? 'Success' : 'Failed'}`);

    // Send response with event data
    res.status(200).json({
      message: `✅ Bet question ${sqlOperation.toLowerCase()} successfully`,
      bet_question: betQuestion[0],
      event_data: data,
      operation: sqlOperation,
      cache_info: {
        from_cache: cacheHit,
        stored_in_cache: betQuestionRedisResult
      }
    });
  } catch (error) {
    console.error('❌ Error processing bet question:', error);
    res.status(500).json({ error: 'Failed to process bet question', details: error.message });
  }
};

// Insert Bet Options
const insertBetOptionsController = async (req, res) => {
  try {
    await sleep(1000);
    const { event_id, market_id } = req.params;

    // Validate required parameters
    if (!event_id || !market_id) {
      return res.status(400).json({
        error: 'Missing required parameters: event_id and market_id are required'
      });
    }

    console.log(`Processing bet options for event: ${event_id}, market: ${market_id}`);

    // Check if data is cached in Redis
    const cacheKey = `event-odds:${event_id}:${market_id}`;
    let oddsData;
    let cacheHit = false;
    
    try {
      const cachedData = await redisGet(cacheKey);
      if (cachedData) {
        console.log('Data retrieved from Redis');
        oddsData = JSON.parse(cachedData);
        cacheHit = true;
      }
    } catch (redisError) {
      console.error('Redis error, continuing without cache:', redisError);
      // Continue without cache if Redis fails
    }

    // If no cached data, fetch from API
    if (!oddsData) {
      try {
        // Fetch the odds data from API
        const response = await axios.get(`http://65.0.40.23:7003/api/event-odds/${event_id}/${market_id}`);

        if (!response.data || !response.data.data) {
          return res.status(404).json({ error: 'No data returned from odds API' });
        }

        oddsData = response.data.data;

        // Cache the fetched data in Redis for 1 hour with confirmation
        const dataString = JSON.stringify(oddsData);
        const redisResult = await redisSet(cacheKey, dataString, { expiry: 3600 });
        console.log(`Redis cache result for ${cacheKey}: ${redisResult ? 'Success' : 'Failed'}`);
      } catch (apiError) {
        console.error('Error fetching from odds API:', apiError);
        return res.status(502).json({ error: 'Failed to fetch data from odds API', details: apiError.message });
      }
    }

    // Find the bet question in database
    const [betQuestion] = await pool.execute(
      `SELECT id FROM bet_questions WHERE event_id = ? AND market_id = ? LIMIT 1`,
      [event_id, market_id]
    );

    let question_id;
    
    if (betQuestion.length > 0) {
      question_id = betQuestion[0].id;
    } else {
      // If bet question doesn't exist, create it first
      console.log('Bet question does not exist, creating it first');
      
      // Find match_id
      const [matchResult] = await pool.execute(
        `SELECT id FROM matches WHERE api_event_id = ? AND api_market_id = ? LIMIT 1`,
        [event_id, market_id]
      );
      
      if (matchResult.length === 0) {
        return res.status(404).json({ error: 'Match not found for given event_id and market_id' });
      }
      
      const match_id = matchResult[0].id;
      const now = moment().format('YYYY-MM-DD HH:mm:ss');
      
      const insertQuestionSql = `
        INSERT INTO bet_questions (
          match_id,
          question,
          status,
          created_at,
          updated_at,
          market_id,
          market_name,
          event_id,
          inplay,
          min_amount,
          max_amount
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const [insertQuestionResult] = await pool.execute(insertQuestionSql, [
        match_id,
        oddsData.market || 'Unknown Market',
        1, // status active
        now,
        now,
        market_id,
        oddsData.market || 'Unknown Market',
        event_id,
        oddsData.inplay || 0,
        oddsData.min || 0,
        oddsData.max || 0
      ]);
      
      question_id = insertQuestionResult.insertId;
      console.log(`Created new bet question with ID: ${question_id}`);
    }

    // Process each runner and insert as bet option
    const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
    const results = {
      inserted: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      details: []
    };

    // Make sure we have match_id
    const [match] = await pool.execute(
      `SELECT id FROM matches WHERE api_event_id = ? LIMIT 1`,
      [event_id]
    );
    
    if (match.length === 0) {
      return res.status(404).json({ error: 'Match not found for given event_id' });
    }
    
    const match_id = match[0].id;

    for (const runner of oddsData.runners) {
      try {
        // Ensure we have all required data
        const selection_id = runner.selectionId || null;
        if (!selection_id) {
          console.error('Missing selection_id for runner:', runner);
          results.failed++;
          results.details.push({
            runner: runner.runner || 'Unknown Runner',
            status: 'failed',
            reason: 'Missing selection_id'
          });
          continue;
        }
        
        const [existingOption] = await pool.execute(
          'SELECT id FROM bet_options WHERE question_id = ? AND selection_id = ? LIMIT 1',
          [question_id, selection_id]
        );

        if (existingOption.length > 0) {
          // Update existing option
          const updateOptionSql = `
            UPDATE bet_options SET
              option_name = ?,
              updated_at = ?,
              last_price_traded = ?
            WHERE id = ?
          `;
          
          await pool.execute(updateOptionSql, [
            runner.runner || 'Unknown Runner',
            timestamp,
            runner.lastPriceTraded || 0,
            existingOption[0].id
          ]);
          
          console.log(`Updated bet option: ${runner.runner} (ID: ${existingOption[0].id})`);
          results.updated++;
          results.details.push({
            runner: runner.runner || 'Unknown Runner',
            selection_id: selection_id,
            status: 'updated',
            option_id: existingOption[0].id
          });
        } else {
          // Insert new option
          const insertOptionSql = `
            INSERT INTO bet_options (
              question_id,
              match_id,
              option_name,
              min_amo,
              status,
              created_at,
              updated_at,
              selection_id,
              last_price_traded
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;
          
          const [insertResult] = await pool.execute(insertOptionSql, [
            question_id,
            match_id,
            runner.runner || 'Unknown Runner',
            0, // min_amo default
            1, // status active
            timestamp,
            timestamp,
            selection_id,
            runner.lastPriceTraded || 0
          ]);
          
          const option_id = insertResult.insertId;
          console.log(`Inserted new bet option: ${runner.runner} (ID: ${option_id})`);
          results.inserted++;
          results.details.push({
            runner: runner.runner || 'Unknown Runner',
            selection_id: selection_id,
            status: 'inserted',
            option_id: option_id
          });
        }
        
        // Cache this bet option in Redis too
        const optionCacheKey = `bet-option:${selection_id}`;
        await redisSet(optionCacheKey, JSON.stringify({
          question_id: question_id,
          match_id: match_id,
          option_name: runner.runner || 'Unknown Runner',
          selection_id: selection_id,
          last_price_traded: runner.lastPriceTraded || 0
        }), { expiry: 86400 }); // Cache for 24 hours
      } catch (optionError) {
        console.error(`Failed to process bet option for runner:`, runner, optionError);
        results.failed++;
        results.details.push({
          runner: runner.runner || 'Unknown Runner',
          selection_id: runner.selectionId || 'Unknown',
          status: 'failed',
          error: optionError.message
        });
      }
    }

    // Cache the complete results in Redis
    const resultsCacheKey = `bet-options-results:${event_id}:${market_id}`;
    const resultsRedisResult = await redisSet(
      resultsCacheKey, 
      JSON.stringify(results), 
      { expiry: 3600 }
    );
    
    console.log(`Redis cache result for ${resultsCacheKey}: ${resultsRedisResult ? 'Success' : 'Failed'}`);

    // Send the final results as response
    res.status(200).json({
      message: 'Bet options processing completed',
      results: {
        event_id: event_id,
        market_id: market_id,
        question_id: question_id,
        total_runners: oddsData.runners.length,
        inserted: results.inserted,
        updated: results.updated,
        skipped: results.skipped,
        failed: results.failed
      },
      processed_bet_options: results.details,
      cache_info: {
        from_cache: cacheHit,
        results_cached: resultsRedisResult
      }
    });
  } catch (error) {
    console.error('Error in insertBetOptionsController:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
};

module.exports = {
  insertBetQuestionFromOdds,
  insertBetOptionsController
};