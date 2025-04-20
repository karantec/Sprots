const axios = require('axios');
const {pool} = require('../db'); // adjust based on your DB connection file
const moment = require('moment');
const db = require('../db'); // your MySQL connection


const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const insertBetQuestionFromOdds = async (req, res) => {
  try {

    await sleep(1000);
    const { event_id, market_id } = req.params;

    // Fetch event odds from API
    const response = await axios.get(`http://65.0.40.23:7003/api/event-odds/${event_id}/${market_id}`);
    const data = response.data.data;

    if (!data) {
      return res.status(404).json({ error: 'No data found from event-odds API' });
    }

    // Get match_id from matches table
    const [matchResult] = await db.pool.execute(
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

    const sql = `
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

    const values = [
      match_id,
      question,
      end_time, // end_time can be null unless specified
      1,
      now,
      now,
      market_id,
      market,
      event_id,
      inplay,
      min || 0,
      max || 0
    ];

    await db.pool.execute(sql, values);

    res.status(200).json({ message: '✅ Bet question inserted successfully' });
  } catch (error) {
    console.error('❌ Error inserting bet question:', error);
    res.status(500).json({ error: 'Failed to insert bet question' });
  }
};


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
      
      // First, fetch the question_id from bet_questions table
      try {
        const [questionRows] = await pool.execute(
          'SELECT id,match_id FROM bet_questions WHERE event_id = ? AND market_id = ? LIMIT 1',
          [event_id, market_id]
        );
        
        if (questionRows.length === 0) {
          return res.status(404).json({ 
            error: 'No bet question found for the given event_id and market_id. Create a bet question first.' 
          });
        }
        const match_id = questionRows[0].match_id;
        const question_id = questionRows[0].id;
        console.log(`Found question_id: ${question_id}`);
        
        // Fetch the odds data from API
        const response = await axios.get(`http://65.0.40.23:7003/api/event-odds/${event_id}/${market_id}`);
        
        if (!response.data || !response.data.data) {
          return res.status(404).json({ error: 'No data returned from odds API' });
        }
        
        const oddsData = response.data.data;
        
        // Check if runners data exists
        if (!Array.isArray(oddsData.runners) || oddsData.runners.length === 0) {
          return res.status(400).json({ error: 'No runners found in API response' });
        }
        
        const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
        // const match_id = oddsData.eventid;
        
        // Track insertion results
        const results = {
          inserted: 0,
          skipped: 0,
          failed: 0,
          details: []
        };
        
        // Process each runner and insert as bet option
        for (const runner of oddsData.runners) {
          try {
            // Check if this option already exists to avoid duplicates
            const [existingOption] = await pool.execute(
              'SELECT id FROM bet_options WHERE question_id = ? AND selection_id = ?',
              [question_id, runner.selectionId]
            );
            
            if (existingOption.length > 0) {
              console.log(`Option already exists for selection_id ${runner.selectionId}. Skipping.`);
              results.skipped++;
              results.details.push({
                runner: runner.runner,
                selection_id: runner.selectionId,
                status: 'skipped',
                reason: 'Already exists'
              });
              continue;
            }
            
            // Insert new bet option
            await pool.execute(
                `INSERT INTO bet_options (
                  question_id,
                  match_id,
                  option_name,
                  min_amo,
                  status,
                  created_at,
                  updated_at,
                  selection_id,
                  last_price_traded
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  question_id,
                  match_id,
                  runner.runner || null,
                  min_amo,
                 1,
                  timestamp,
                  timestamp,
                  runner.selectionId || null,
                  runner.lastPriceTraded || 0
                ]
              );
            console.log(`Successfully inserted bet option: ${runner.runner}`);
            results.inserted++;
            results.details.push({
              runner: runner.runner,
              selection_id: runner.selectionId,
              status: 'inserted'
            });
          } catch (optionError) {
            console.error(`Failed to insert bet option for runner: ${runner.runner}`, optionError);
            results.failed++;
            results.details.push({
              runner: runner.runner,
              selection_id: runner.selectionId,
              status: 'failed',
              error: optionError.message
            });
          }
        }
        
        return res.status(200).json({
          message: 'Bet options processing completed',
          results: {
            event_id: event_id,
            market_id: market_id,
            question_id: question_id,
            total_runners: oddsData.runners.length,
            inserted: results.inserted,
            skipped: results.skipped,
            failed: results.failed
          }
        });
        
      } catch (error) {
        console.error('Error fetching data or processing bet options:', error);
        return res.status(500).json({ 
          error: 'Failed to process bet options',
          details: error.message
        });
      }
      
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