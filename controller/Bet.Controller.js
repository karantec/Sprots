const axios = require('axios');
const { pool } = require('../db');
const moment = require('moment');
const db = require('../db');

// Utility function to introduce delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// INSERT BET QUESTION CONTROLLER
const insertBetQuestionFromOdds = async (req, res) => {
  try {
    const { event_id, market_id } = req.params;

    // 1-second delay
    await delay(1000);

    const response = await axios.get(`http://65.0.40.23:7003/api/event-odds/${event_id}/${market_id}`);
    const data = response.data.data;

    if (!data) {
      return res.status(404).json({ error: 'No data found from event-odds API' });
    }

    const [matchResult] = await db.pool.execute(
      `SELECT id FROM matches WHERE api_event_id = ? AND api_market_id = ? LIMIT 1`,
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
      null,
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

    await db.pool.execute(sql, values);

    res.status(200).json({ message: '✅ Bet question inserted successfully' });
  } catch (error) {
    console.error('❌ Error inserting bet question:', error);
    res.status(500).json({ error: 'Failed to insert bet question' });
  }
};

// INSERT BET OPTIONS CONTROLLER
const insertBetOptionsController = async (req, res) => {
  try {
    const { event_id, market_id } = req.params;

    if (!event_id || !market_id) {
      return res.status(400).json({ error: 'Missing required parameters: event_id and market_id' });
    }

    console.log(`Processing bet options for event: ${event_id}, market: ${market_id}`);

    // 1-second delay
    await delay(1000);

    const [questionRows] = await pool.execute(
      'SELECT id FROM bet_questions WHERE event_id = ? AND market_id = ? LIMIT 1',
      [event_id, market_id]
    );

    if (questionRows.length === 0) {
      return res.status(404).json({ error: 'No bet question found. Create a bet question first.' });
    }

    const question_id = questionRows[0].id;
    console.log(`Found question_id: ${question_id}`);

    const response = await axios.get(`http://65.0.40.23:7003/api/event-odds/${event_id}/${market_id}`);
    const oddsData = response.data?.data;

    if (!oddsData || !Array.isArray(oddsData.runners)) {
      return res.status(400).json({ error: 'No runners found in API response' });
    }

    const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
    const match_id = oddsData.eventid;

    const results = { inserted: 0, skipped: 0, failed: 0, details: [] };

    for (const runner of oddsData.runners) {
      try {
        // 1-second delay per runner
        await delay(1000);

        const [existingOption] = await pool.execute(
          'SELECT id FROM bet_options WHERE question_id = ? AND selection_id = ?',
          [question_id, runner.selectionId]
        );

        if (existingOption.length > 0) {
          results.skipped++;
          results.details.push({
            runner: runner.runner,
            selection_id: runner.selectionId,
            status: 'skipped',
            reason: 'Already exists'
          });
          continue;
        }

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
            100,
            runner.status === 'ACTIVE' ? 1 : 0,
            timestamp,
            timestamp,
            runner.selectionId || null,
            runner.lastPriceTraded || 0
          ]
        );

        results.inserted++;
        results.details.push({
          runner: runner.runner,
          selection_id: runner.selectionId,
          status: 'inserted'
        });
      } catch (optionError) {
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
      message: 'Bet options processed',
      results: {
        event_id,
        market_id,
        question_id,
        total_runners: oddsData.runners.length,
        ...results
      }
    });

  } catch (error) {
    console.error('Error in insertBetOptionsController:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

module.exports = {
  insertBetQuestionFromOdds,
  insertBetOptionsController
};
