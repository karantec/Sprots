const axios = require('axios');
const moment = require('moment');
const db = require('../db'); // Make sure your db exports pool

// Utility function to add delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const insertBookmakerOddsData = async (req, res) => {
  try {
    const { event_id, market_id } = req.params;

    // Optional delay before starting
    await delay(1000);

    // Fetch bookmaker-odds data
    const response = await axios.get(`http://65.0.40.23:7003/api/bookmaker-odds/${event_id}/${market_id}`);
    const data = response.data?.data;

    if (!data) {
      return res.status(404).json({ error: 'No data found from bookmaker-odds API' });
    }

    const matchEventId = data.evid;

    // Fetch match_id and end_time from matches table
    const [matchResult] = await db.pool.execute(
      `SELECT id, end_date FROM matches WHERE api_event_id = ? AND api_market_id = ? LIMIT 1`,
      [matchEventId, market_id]
    );

    if (matchResult.length === 0) {
      return res.status(404).json({ error: 'Match not found for given evid and market_id' });
    }

    const match_id = matchResult[0]?.id;
    const end_time = matchResult[0]?.end_date; // Assuming end_date is in the correct format
    const safeEndTime = matchResult[0]?.end_time ?? null;

    console.log("✅ match_id:", match_id);
    console.log("⏰ end_time:", safeEndTime);

    const {
      market,
      status,
      inplay,
      min = 0,
      max = 0,
      mname,
      runners = []
    } = data;

    const safeMarket = market ?? null;
    const safeMname = mname ?? null;
    const safeStatus = status ?? 'SUSPENDED';
    const safeInplay = typeof inplay !== 'undefined' ? inplay : 0;
    const safeMin = typeof min !== 'undefined' ? min : 0;
    const safeMax = typeof max !== 'undefined' ? max : 0;

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
        end_time,
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
            runner.runnerName ?? null,
            100,
            runner.status === 'ACTIVE' ? 1 : 0,
            now,
            now,
            runner.selectionId ?? null,
            runner.lastPriceTraded ?? 0
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

    // Add a delay before starting the processing
    await delay(1000);

    const response = await axios.get(`http://65.0.40.23:7003/api/fancy-odds/${event_id}/${market_id}`);
    const data = response.data?.data;

    if (!data || !Array.isArray(data)) {
      return res.status(404).json({ error: 'No fancy-odds data found.' });
    }

    const [matchRow] = await db.pool.execute(
      `SELECT id, end_date FROM matches WHERE api_event_id = ? AND api_market_id = ? LIMIT 1`,
      [event_id, market_id]
    );

    if (matchRow.length === 0) {
      return res.status(404).json({ error: 'Match not found for given event_id and market_id' });
    }
    const end_time = matchRow[0].end_date; // Assuming end_date is in the correct format  
    const match_id = matchRow[0].id;
    const now = moment().format('YYYY-MM-DD HH:mm:ss');

    let inserted = 0, skipped = 0, failed = 0;
    const details = [];

    for (const item of data) {
      try {
        // Validate required fields
        const runnerName = item.RunnerName;
        const selectionId = item.SelectionId;
        
        if (!runnerName || !selectionId) {
          failed++;
          details.push({ runnerName, selectionId, status: 'failed', error: 'Missing RunnerName or SelectionId' });
          continue;
        }

        const gtype = item.gtype || 'session';
        const minAmount = parseInt(item.min) || 100;
        const maxAmount = parseInt(item.max) || 50000;
        const status = item.GameStatus === 'SUSPENDED' ? 0 : 1;

        // Set default prices if needed
        const backPrice = parseFloat(item.BackPrice1) > 0 ? parseFloat(item.BackPrice1) : 1.0;
        const layPrice = parseFloat(item.LayPrice1) > 0 ? parseFloat(item.LayPrice1) : 1.0;

        // Check if the question already exists
        const [existingQuestion] = await db.pool.execute(
          `SELECT id FROM bet_questions WHERE match_id = ? AND question = ? AND market_id = ? LIMIT 1`,
          [match_id, runnerName, market_id]
        );

        let question_id;
        
        if (existingQuestion.length > 0) {
          // Update existing question
          question_id = existingQuestion[0].id;
          await db.pool.execute(
            `UPDATE bet_questions SET 
              status = ?, 
              updated_at = ?,
              min_amount = ?,
              max_amount = ?
            WHERE id = ?`,
            [status, now, minAmount, maxAmount, question_id]
          );
          console.log(`Updated question ID: ${question_id}`);
        } else {
          // Insert new question
          const [insertResult] = await db.pool.execute(
            `INSERT INTO bet_questions (
              match_id, question, end_time, status, created_at, updated_at,
              market_id, market_name, event_id, inplay, min_amount, max_amount
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              match_id,
              runnerName,
              end_time ,
              1,
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
          console.log(`Inserted question ID: ${question_id}`);
        }

        // Handle Back option
        const [backExists] = await db.pool.execute(
          `SELECT id FROM bet_options WHERE selection_id = ? AND match_id = ? AND question_id = ? AND option_name = 'Back' LIMIT 1`,
          [selectionId, match_id, question_id]
        );

        if (backExists.length === 0) {
          // Insert Back option
          await db.pool.execute(
            `INSERT INTO bet_options (
              question_id, match_id, option_name, invest_amount, return_amount, min_amo,
              ratio1, ratio2, bet_limit, status, created_at, updated_at, selection_id, last_price_traded
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              question_id,
              match_id,
              'Back',
              minAmount,
              backPrice,
              minAmount,
              1,
              1,
              maxAmount,
              1,
              now,
              now,
              selectionId,
              backPrice
            ]
          );
          inserted++;
          console.log(`Inserted Back option for question ID: ${question_id}`);
        } else {
          // Update Back option
          await db.pool.execute(
            `UPDATE bet_options SET 
              return_amount = ?, 
              min_amo = ?,
              bet_limit = ?,
              status = ?,
              updated_at = ?,
              last_price_traded = ?
            WHERE id = ?`,
            [backPrice, minAmount, maxAmount, 1, now, backPrice, backExists[0].id]
          );
          console.log(`Updated Back option for question ID: ${question_id}`);
        }

        // Handle Lay option
        const [layExists] = await db.pool.execute(
          `SELECT id FROM bet_options WHERE selection_id = ? AND match_id = ? AND question_id = ? AND option_name = 'Lay' LIMIT 1`,
          [selectionId, match_id, question_id]
        );

        if (layExists.length === 0) {
          // Insert Lay option
          await db.pool.execute(
            `INSERT INTO bet_options (
              question_id, match_id, option_name, invest_amount, return_amount, min_amo,
              ratio1, ratio2, bet_limit, status, created_at, updated_at, selection_id, last_price_traded
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              question_id,
              match_id,
              'Lay',
              minAmount,
              layPrice,
              minAmount,
              1,
              1,
              maxAmount,
              1,
              now,
              now,
              selectionId,
              layPrice
            ]
          );
          inserted++;
          console.log(`Inserted Lay option for question ID: ${question_id}`);
        } else {
          // Update Lay option
          await db.pool.execute(
            `UPDATE bet_options SET 
              return_amount = ?, 
              min_amo = ?,
              bet_limit = ?,
              status = ?,
              updated_at = ?,
              last_price_traded = ?
            WHERE id = ?`,
            [layPrice, minAmount, maxAmount, 1, now, layPrice, layExists[0].id]
          );
          console.log(`Updated Lay option for question ID: ${question_id}`);
        }

        details.push({ 
          runnerName, 
          selectionId, 
          status: 'processed', 
          questionId: question_id,
          backPrice,
          layPrice
        });

        // Add delay between processing items
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (err) {
        console.error(`❌ Error processing ${item?.RunnerName || 'unknown item'}:`, err.message);
        failed++;
        details.push({
          runnerName: item?.RunnerName,
          selectionId: item?.SelectionId,
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
  insertBookmakerOddsData,
  insertFancyOddsData
};