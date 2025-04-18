const axios = require('axios');
const moment = require('moment');
const db = require('../db'); // Make sure your db exports pool

const insertBookmakerOddsData = async (req, res) => {
  try {
    const { event_id, market_id } = req.params;

    // Fetch bookmaker-odds data
    const response = await axios.get(`http://65.0.40.23:7003/api/bookmaker-odds/${event_id}/${market_id}`);
    const data = response.data?.data;

    if (!data) {
      return res.status(404).json({ error: 'No data found from bookmaker-odds API' });
    }

    const matchEventId = data.evid;

    // Get match_id from matches table using evid
    const [matchResult] = await db.pool.execute(
      `SELECT id FROM matches WHERE api_event_id = ? AND api_market_id = ? LIMIT 1`,
      [matchEventId, market_id]
    );

    if (matchResult.length === 0) {
      return res.status(404).json({ error: 'Match not found for given evid and market_id' });
    }

    const match_id = matchResult[0].id;
    const {
      market,
      status,
      inplay,
      min = 0,
      max = 0,
      mname,
      runners = []
    } = data;

    // Safe handling of undefined values (replace with null or default values)
    const safeMarket = market ?? null;
    const safeMname = mname ?? null; // Default to null if undefined
    const safeStatus = status ?? 'SUSPENDED'; // Default to 'SUSPENDED' if undefined
    const safeInplay = typeof inplay !== 'undefined' ? inplay : 0; // Default to 0 if undefined
    const safeMin = typeof min !== 'undefined' ? min : 0; // Default to 0 if undefined
    const safeMax = typeof max !== 'undefined' ? max : 0; // Default to 0 if undefined

    const now = moment().format('YYYY-MM-DD HH:mm:ss');
    const questionStatus = safeStatus === 'OPEN' ? 1 : 0;

    // Insert bet question
    const [questionInsertResult] = await db.pool.execute(
      `INSERT INTO bet_questions (
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        match_id,
        safeMname,
        null, // You can update this if you want to set a specific value
        questionStatus,
        now,
        now,
        market_id ?? null,
        safeMname,
        matchEventId ?? null,
        safeInplay,
        safeMin,
        safeMax
      ]
    );

    const question_id = questionInsertResult.insertId;

    // Insert bet options from runners
    let inserted = 0, skipped = 0, failed = 0;
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
            status: 'skipped',
            reason: 'Already exists'
          });
          continue;
        }

        // Safe handling of undefined values for bet options
        await db.pool.execute(
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
            runner.runnerName ?? null, // Set null if undefined
            100, // Default minimum amount
            runner.status === 'ACTIVE' ? 1 : 0, // Active status
            now,
            now,
            runner.selectionId ?? null, // Set null if undefined
            runner.lastPriceTraded ?? 0 // Default to 0 if undefined
          ]
        );

        inserted++;
        details.push({
          runnerName: runner.runnerName,
          selection_id: runner.selectionId,
          status: 'inserted'
        });

      } catch (err) {
        failed++;
        details.push({
          runnerName: runner.runnerName,
          selection_id: runner.selectionId,
          status: 'failed',
          error: err.message
        });
      }
    }

    res.status(200).json({
      message: '✅ Bookmaker odds inserted',
      question_id,
      inserted,
      skipped,
      failed,
      details
    });

  } catch (error) {
    console.error('❌ Error in insertBookmakerOddsData:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};




const insertFancyOddsData = async (req, res) => {
  try {
    const { event_id, market_id } = req.params;

    const response = await axios.get(`http://65.0.40.23:7003/api/fancy-odds/${event_id}/${market_id}`);
    const data = response.data?.data;

    if (!data || !Array.isArray(data)) {
      return res.status(404).json({ error: 'No fancy-odds data found.' });
    }

    const [matchRow] = await db.pool.execute(
      `SELECT id FROM matches WHERE api_event_id = ? AND api_market_id = ? LIMIT 1`,
      [event_id, market_id]
    );

    if (matchRow.length === 0) {
      return res.status(404).json({ error: 'Match not found for given event_id and market_id' });
    }

    const match_id = matchRow[0].id;
    const now = moment().format('YYYY-MM-DD HH:mm:ss');

    let inserted = 0, skipped = 0, failed = 0;
    const details = [];

    for (const item of data) {
      try {
        const runnerName = item.RunnerName;
        const selectionId = item.SelectionId;
        const gtype = item.gtype || 'session';
        const minAmount = parseInt(item.min) || 100;
        const maxAmount = parseInt(item.max) || 50000;

        if (!runnerName || !selectionId) {
          failed++;
          details.push({ runnerName, selectionId, status: 'failed', error: 'Missing RunnerName or SelectionId' });
          continue;
        }

        const [existing] = await db.pool.execute(
          `SELECT id FROM bet_questions WHERE match_id = ?  LIMIT 1`,
          [match_id]
        );

        // if (existing.length > 0) {
        //   skipped++;
        //   details.push({ runnerName,  status: 'skipped', reason: 'Already exists' });
        //   continue;
        // }

        const status = item.GameStatus === 'SUSPENDED' ? 0 : 1;

        const [insertResult] = await db.pool.execute(
          `INSERT INTO bet_questions (
            match_id, question, end_time, status, created_at, updated_at,
            market_id, market_name, event_id, inplay, min_amount, max_amount
            
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            match_id,
            runnerName,
            null,
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

        const question_id = insertResult.insertId;

        // Insert back option
        if (item.BackPrice1 > 0) {
          await db.pool.execute(
            `INSERT INTO bet_options (
              question_id, match_id, option_name, min_amo, status,
              created_at, updated_at, selection_id, last_price_traded
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              question_id,
              match_id,
              `Back ${runnerName}`,
              minAmount,
              1,
              now,
              now,
              selectionId,
              item.BackPrice1
            ]
          );
        }

        // Insert lay option
        if (item.LayPrice1 > 0) {
          await db.pool.execute(
            `INSERT INTO bet_options (
              question_id, match_id, option_name, min_amo, status,
              created_at, updated_at, selection_id, last_price_traded
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              question_id,
              match_id,
              `Lay ${runnerName}`,
              minAmount,
              1,
              now,
              now,
              selectionId,
              item.LayPrice1
              
            ]
          );
        }

        inserted++;
        details.push({ runnerName, selectionId, status: 'inserted' });

      } catch (err) {
        failed++;
        details.push({
          runnerName: item.RunnerName,
          selectionId: item.SelectionId,
          status: 'failed',
          error: err.message
        });
      }
    }

    res.status(200).json({
      message: '✅ Fancy odds processed',
      inserted,
      skipped,
      failed,
      details
    });

  } catch (err) {
    console.error('❌ Error inserting fancy odds:', err.message);
    res.status(500).json({ error: err.message });
  }
};


module.exports = {
  insertBookmakerOddsData,insertFancyOddsData
};
