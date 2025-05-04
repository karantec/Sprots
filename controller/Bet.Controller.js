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

// New function to write data to Redis and then to database
const writeToRedisAndDb = async (dataType, data, identifier) => {
  try {
    // Generate a unique Redis key for this data
    const now = moment().unix(); // Unix timestamp for versioning
    const redisKey = `${dataType}:${identifier}:${now}`;
    
    // Add metadata to track processing status
    const dataWithMetadata = {
      ...data,
      _metadata: {
        created_at: now,
        processed_to_db: false,
        retry_count: 0,
        last_retry: null
      }
    };
    
    // Store in Redis
    const redisResult = await redisSet(redisKey, JSON.stringify(dataWithMetadata), { expiry: 86400 });
    
    if (!redisResult) {
      throw new Error(`Failed to write ${dataType} data to Redis`);
    }
    
    // Also add to a processing queue
    await redisClient.lPush('db_write_queue', redisKey);
    
    console.log(`✅ Added ${dataType} data to Redis with key ${redisKey} and queued for DB processing`);
    
    return {
      success: true,
      redis_key: redisKey,
      data_type: dataType,
      identifier: identifier
    };
  } catch (error) {
    console.error(`❌ Error writing ${dataType} to Redis:`, error);
    return {
      success: false,
      error: error.message,
      data_type: dataType,
      identifier: identifier
    };
  }
};

// Process the queue and write to database
const processRedisToDbQueue = async () => {
  try {
    // Get a key from the queue
    const nextKey = await redisClient.rPop('db_write_queue');
    
    if (!nextKey) {
      // Queue is empty
      return { processed: 0 };
    }
    
    console.log(`Processing Redis key for DB write: ${nextKey}`);
    
    // Get the data from Redis
    const dataStr = await redisGet(nextKey);
    
    if (!dataStr) {
      console.error(`Data for key ${nextKey} not found in Redis`);
      return { processed: 0, errors: 1 };
    }
    
    const data = JSON.parse(dataStr);
    
    // Extract data type from key
    const [dataType, identifier] = nextKey.split(':');
    
    let dbWriteSuccess = false;
    
    // Process based on data type
    if (dataType === 'bet_question') {
      dbWriteSuccess = await writeBetQuestionToDb(data);
    } else if (dataType === 'bet_option') {
      dbWriteSuccess = await writeBetOptionToDb(data);
    } else if (dataType === 'event_odds') {
      // Just keep in Redis, no DB write needed for raw odds data
      dbWriteSuccess = true;
    } else {
      console.error(`Unknown data type: ${dataType}`);
      dbWriteSuccess = false;
    }
    
    if (dbWriteSuccess) {
      // Update metadata to show it's processed
      data._metadata.processed_to_db = true;
      data._metadata.processed_at = moment().unix();
      
      // Update the Redis data
      await redisSet(nextKey, JSON.stringify(data), { expiry: 86400 });
      
      console.log(`✅ Successfully processed ${dataType} data to database`);
      return { processed: 1, errors: 0 };
    } else {
      // Mark as retry
      data._metadata.retry_count += 1;
      data._metadata.last_retry = moment().unix();
      
      // Update Redis and add back to queue if under retry limit
      await redisSet(nextKey, JSON.stringify(data), { expiry: 86400 });
      
      if (data._metadata.retry_count < 3) {
        // Add back to queue for retry
        await redisClient.lPush('db_write_queue', nextKey);
        console.log(`⚠️ Failed to process ${dataType}, requeued for retry #${data._metadata.retry_count}`);
      } else {
        console.error(`❌ Failed to process ${dataType} after ${data._metadata.retry_count} attempts`);
      }
      
      return { processed: 0, errors: 1 };
    }
  } catch (error) {
    console.error('Error processing Redis to DB queue:', error);
    return { processed: 0, errors: 1 };
  }
};

// Set up continuous processing
const startQueueProcessor = () => {
  const processInterval = setInterval(async () => {
    try {
      // Process up to 5 items from the queue
      let processedTotal = 0;
      let errorsTotal = 0;
      
      for (let i = 0; i < 5; i++) {
        const result = await processRedisToDbQueue();
        processedTotal += result.processed;
        errorsTotal += result.errors || 0;
        
        // If nothing was processed, queue might be empty
        if (result.processed === 0 && result.errors === 0) {
          break;
        }
      }
      
      if (processedTotal > 0 || errorsTotal > 0) {
        console.log(`Queue processing stats: processed=${processedTotal}, errors=${errorsTotal}`);
      }
    } catch (error) {
      console.error('Error in queue processor interval:', error);
    }
  }, 1000); // Run every second
  
  return processInterval;
};

// Helper function to write bet question to database
const writeBetQuestionToDb = async (data) => {
  try {
    // Extract just the bet question data and remove metadata
    const { _metadata, ...questionData } = data;
    
    // Check if question already exists
    const [existingQuestion] = await pool.execute(
      `SELECT id FROM bet_questions WHERE event_id = ? AND market_id = ? LIMIT 1`,
      [questionData.event_id, questionData.market_id]
    );
    
    if (existingQuestion.length > 0) {
      // Update existing question
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
      
      await pool.execute(updateSql, [
        questionData.match_id,
        questionData.question,
        questionData.end_time,
        questionData.status,
        moment().format('YYYY-MM-DD HH:mm:ss'),
        questionData.market_name,
        questionData.inplay,
        questionData.min_amount || 0,
        questionData.max_amount || 0,
        existingQuestion[0].id
      ]);
      
      return true;
    } else {
      // Insert new question
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
      
      const now = moment().format('YYYY-MM-DD HH:mm:ss');
      
      await pool.execute(insertSql, [
        questionData.match_id,
        questionData.question,
        questionData.end_time || null,
        questionData.status || 1,
        now,
        now,
        questionData.market_id,
        questionData.market_name,
        questionData.event_id,
        questionData.inplay || 0,
        questionData.min_amount || 0,
        questionData.max_amount || 0
      ]);
      
      return true;
    }
  } catch (error) {
    console.error('Error writing bet question to database:', error);
    return false;
  }
};

// Helper function to write bet option to database
const writeBetOptionToDb = async (data) => {
  try {
    // Extract just the bet option data and remove metadata
    const { _metadata, ...optionData } = data;
    
    // Check if option already exists
    const [existingOption] = await pool.execute(
      'SELECT id FROM bet_options WHERE question_id = ? AND selection_id = ? LIMIT 1',
      [optionData.question_id, optionData.selection_id]
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
        optionData.option_name,
        moment().format('YYYY-MM-DD HH:mm:ss'),
        optionData.last_price_traded || 0,
        existingOption[0].id
      ]);
      
      return true;
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
      
      const now = moment().format('YYYY-MM-DD HH:mm:ss');
      
      await pool.execute(insertOptionSql, [
        optionData.question_id,
        optionData.match_id,
        optionData.option_name,
        optionData.min_amo || 0,
        optionData.status || 1,
        now,
        now,
        optionData.selection_id,
        optionData.last_price_traded || 0
      ]);
      
      return true;
    }
  } catch (error) {
    console.error('Error writing bet option to database:', error);
    return false;
  }
};

// Insert Bet Question from Odds API - REDIS FIRST approach
const insertBetQuestionFromOdds = async (req, res) => {
  try {
    await sleep(1000);
    const { event_id, market_id } = req.params;

    if (!event_id || !market_id) {
      return res.status(400).json({ error: 'Missing required parameters: event_id and market_id are required' });
    }

    console.log(`Processing bet question for event: ${event_id}, market: ${market_id}`);

    // Always fetch fresh data from API and store in Redis first
    let oddsData;
    
    try {
      const response = await axios.get(`http://65.0.40.23:7003/api/event-odds/${event_id}/${market_id}`);
      oddsData = response.data.data;

      if (!oddsData) {
        return res.status(404).json({ error: 'No data found from event-odds API' });
      }
      
      // Store raw event odds in Redis
      const eventOddsCacheKey = `event-odds:${event_id}:${market_id}`;
      await redisSet(eventOddsCacheKey, JSON.stringify(oddsData), { expiry: 3600 });
    } catch (apiError) {
      // If API call fails, try to get from Redis as fallback
      const cachedData = await redisGet(`event-odds:${event_id}:${market_id}`);
      if (cachedData) {
        console.log('Using cached data as API call failed');
        oddsData = JSON.parse(cachedData);
      } else {
        return res.status(502).json({ error: 'Failed to fetch data from odds API and no cache available', details: apiError.message });
      }
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
    const end_time = matchResult[0].end_date;
    const {
      market,
      status,
      inplay,
      min = null,
      max = null
    } = oddsData;

    const question = market;
    const questionStatus = status === 'OPEN' ? 1 : 0;
    const now = moment().format('YYYY-MM-DD HH:mm:ss');

    // Prepare bet question data
    const betQuestionData = {
      match_id,
      question,
      end_time,
      status: questionStatus,
      updated_at: now,
      created_at: now,
      market_id,
      market_name: market,
      event_id,
      inplay: inplay ? 1 : 0,
      min_amount: min || 0,
      max_amount: max || 0
    };

    // Write to Redis first, and queue for DB processing
    const redisWriteResult = await writeToRedisAndDb('bet_question', betQuestionData, `${event_id}:${market_id}`);
    
    // Store in persistent Redis cache as well (this is separate from the queue)
    const betQuestionCacheKey = `bet-question:${event_id}:${market_id}`;
    await redisSet(betQuestionCacheKey, JSON.stringify(betQuestionData), { expiry: 86400 });
    
    // Check if bet question already exists in DB
    const [existingQuestion] = await pool.execute(
      `SELECT id FROM bet_questions WHERE event_id = ? AND market_id = ? LIMIT 1`,
      [event_id, market_id]
    );
    
    let sqlOperation = existingQuestion.length > 0 ? 'Updated' : 'Inserted';
    
    // Send response with event data
    res.status(200).json({
      message: `✅ Bet question data written to Redis and queued for database ${sqlOperation.toLowerCase()}`,
      bet_question: betQuestionData,
      event_data: oddsData,
      redis_result: redisWriteResult,
      operation: sqlOperation
    });
    
    // Start processing the queue (this runs async in background)
    processRedisToDbQueue().catch(console.error);
  } catch (error) {
    console.error('❌ Error processing bet question:', error);
    res.status(500).json({ error: 'Failed to process bet question', details: error.message });
  }
};

// Insert Bet Options - REDIS FIRST approach
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

    // Always fetch fresh data from API and update Redis
    let oddsData;
    
    try {
      const response = await axios.get(`http://65.0.40.23:7003/api/event-odds/${event_id}/${market_id}`);
      
      if (!response.data || !response.data.data) {
        return res.status(404).json({ error: 'No data returned from odds API' });
      }
      
      oddsData = response.data.data;
      
      // Update the Redis cache immediately
      const eventOddsCacheKey = `event-odds:${event_id}:${market_id}`;
      await redisSet(eventOddsCacheKey, JSON.stringify(oddsData), { expiry: 3600 });
    } catch (apiError) {
      // If API call fails, try to get from Redis as fallback
      const cachedData = await redisGet(`event-odds:${event_id}:${market_id}`);
      if (cachedData) {
        console.log('Using cached data as API call failed');
        oddsData = JSON.parse(cachedData);
      } else {
        return res.status(502).json({ error: 'Failed to fetch data from odds API and no cache available', details: apiError.message });
      }
    }

    // Get bet question from database
    const [betQuestion] = await pool.execute(
      `SELECT id FROM bet_questions WHERE event_id = ? AND market_id = ? LIMIT 1`,
      [event_id, market_id]
    );

    let question_id;
    
    // Get match_id
    const [match] = await pool.execute(
      `SELECT id FROM matches WHERE api_event_id = ? LIMIT 1`,
      [event_id]
    );
    
    if (match.length === 0) {
      return res.status(404).json({ error: 'Match not found for given event_id' });
    }
    
    const match_id = match[0].id;
    
    if (betQuestion.length > 0) {
      question_id = betQuestion[0].id;
    } else {
      // If bet question doesn't exist in DB, create it in Redis first
      const betQuestionData = {
        match_id,
        question: oddsData.market || 'Unknown Market',
        status: 1,
        created_at: moment().format('YYYY-MM-DD HH:mm:ss'),
        updated_at: moment().format('YYYY-MM-DD HH:mm:ss'),
        market_id,
        market_name: oddsData.market || 'Unknown Market',
        event_id,
        inplay: oddsData.inplay || 0,
        min_amount: oddsData.min || 0,
        max_amount: oddsData.max || 0
      };
      
      // Write question to Redis and queue for DB
      await writeToRedisAndDb('bet_question', betQuestionData, `${event_id}:${market_id}`);
      
      // For simplicity in this flow, we'll create a temporary question ID
      // The actual ID will be assigned when written to DB
      question_id = `temp_${event_id}_${market_id}`;
      
      console.log(`Created temporary bet question with ID: ${question_id} in Redis`);
    }

    // Process each runner and insert into Redis first
    const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
    const results = {
      total: oddsData.runners.length,
      processed: 0,
      details: []
    };

    for (const runner of oddsData.runners) {
      try {
        // Ensure we have all required data
        const selection_id = runner.selectionId || null;
        if (!selection_id) {
          console.error('Missing selection_id for runner:', runner);
          results.details.push({
            runner: runner.runner || 'Unknown Runner',
            status: 'failed',
            reason: 'Missing selection_id'
          });
          continue;
        }
        
        // Prepare bet option data
        const betOptionData = {
          question_id,
          match_id,
          option_name: runner.runner || 'Unknown Runner',
          min_amo: 0,
          status: 1,
          created_at: timestamp,
          updated_at: timestamp,
          selection_id,
          last_price_traded: runner.lastPriceTraded || 0
        };
        
        // Write to Redis and queue for DB
        const redisKey = `bet-option:${event_id}:${market_id}:${selection_id}`;
        await redisSet(redisKey, JSON.stringify(betOptionData), { expiry: 86400 });
        
        // Also queue for DB write
        await writeToRedisAndDb('bet_option', betOptionData, `${event_id}:${market_id}:${selection_id}`);
        
        results.processed++;
        results.details.push({
          runner: runner.runner || 'Unknown Runner',
          selection_id: selection_id,
          status: 'processed',
          redis_key: redisKey
        });
      } catch (optionError) {
        console.error(`Failed to process bet option for runner:`, runner, optionError);
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
    await redisSet(resultsCacheKey, JSON.stringify(results), { expiry: 3600 });

    // Send the final results as response
    res.status(200).json({
      message: 'Bet options written to Redis and queued for database processing',
      results: {
        event_id: event_id,
        market_id: market_id,
        question_id: question_id,
        total_runners: oddsData.runners.length,
        processed: results.processed
      },
      processed_bet_options: results.details
    });
    
    // Start processing the queue (this runs async in background)
    processRedisToDbQueue().catch(console.error);
  } catch (error) {
    console.error('Error in insertBetOptionsController:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
};

// Background service to continuously update Redis from API
const setupAutoUpdate = async () => {
  try {
    // Get all active events from database
    const [activeEvents] = await pool.execute(`
      SELECT DISTINCT api_event_id as event_id, api_market_id as market_id 
      FROM matches 
      JOIN bet_questions ON matches.id = bet_questions.match_id 
      WHERE bet_questions.status = 1 
        AND matches.end_date > NOW()
    `);
    
    console.log(`Setting up auto-update for ${activeEvents.length} active events`);
    
    // Set up refresh interval for each event
    activeEvents.forEach(event => {
      // For in-play events, refresh every 15 seconds
      // For regular events, refresh every 2 minutes
      let refreshInterval = 120000; // 2 minutes by default
      
      // Check if inplay
      const refreshFunction = async () => {
        try {
          // Get fresh data from API
          const response = await axios.get(`http://65.0.40.23:7003/api/event-odds/${event.event_id}/${event.market_id}`);
          const freshData = response.data.data;
          
          if (freshData) {
            // Update Redis cache
            await redisSet(`event-odds:${event.event_id}:${event.market_id}`, JSON.stringify(freshData), { expiry: 3600 });
            console.log(`Auto-updated Redis for event: ${event.event_id}, market: ${event.market_id}`);
            
            // Adjust refresh rate based on inplay status
            if (freshData.inplay && refreshInterval > 30000) {
              // Switch to faster refresh (every 15 seconds) for inplay events
              clearInterval(event.intervalId);
              refreshInterval = 15000;
              event.intervalId = setInterval(refreshFunction, refreshInterval);
              console.log(`Switched to fast refresh mode (15s) for inplay event: ${event.event_id}`);
            } else if (!freshData.inplay && refreshInterval < 30000) {
              // Switch back to slower refresh
              clearInterval(event.intervalId);
              refreshInterval = 120000;
              event.intervalId = setInterval(refreshFunction, refreshInterval);
              console.log(`Switched to standard refresh mode (2m) for event: ${event.event_id}`);
            }
          }
        } catch (error) {
          console.error(`Auto-update failed for event: ${event.event_id}`, error);
        }
      };
      
      // Start interval
      event.intervalId = setInterval(refreshFunction, refreshInterval);
      console.log(`Set up auto-update for event: ${event.event_id}, market: ${event.market_id} every ${refreshInterval/1000}s`);
      
      // Run immediately once
      refreshFunction().catch(console.error);
    });
    
    // Also start the queue processor
    const queueProcessorId = startQueueProcessor();
    console.log('Queue processor started');
    
    return {
      events: activeEvents.length,
      queueProcessor: queueProcessorId
    };
  } catch (error) {
    console.error('Error setting up auto-update:', error);
    return { error: error.message };
  }
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Initialize system on server start
const initSystem = async () => {
  try {
    // Initialize Redis client
    await initRedisClient();
    console.log('Redis client initialized');
    
    // Start auto-update system
    const setupResult = await setupAutoUpdate();
    console.log('Auto-update system initialized:', setupResult);
    
    return true;
  } catch (error) {
    console.error('Failed to initialize system:', error);
    return false;
  }
};

// Call this when server starts
initSystem().catch(console.error);

module.exports = {
  insertBetQuestionFromOdds,
  insertBetOptionsController,
  initSystem
};
