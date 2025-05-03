const { fetchAndStoreMatches, fetchAndStoreCompetition } = require('../controller/event.Controller');
const axios = require("axios");
const { insertBookmakerToSqlandRedis, fetchAndCacheBookmakerOdds } = require("../controller/bm_data.controller");
const { updateSportsData } = require('../controller/sportsController');
const cron = require('node-cron');

// Utility to fetch event and bookmaker marketId pairs
const getAllBookmakerMarkets = async () => {
  try {
    const res = await axios.get("http://test.book2500.in/api/event/matches/save");
    const events = res.data?.data?.events ?? [];
    const pairs = [];

 for (const evt of events) {
      const event_id = evt.event?.id;
      // Select the first marketId in the marketIds array
      const firstMarket = evt.marketIds?.[0];

      if (event_id && firstMarket) {
        pairs.push({
          event_id,
          market_id: firstMarket.marketId, // Get the first marketId
        });
      }
    }

    return pairs;
  } catch (err) {
    console.error("❌ Failed to fetch event/market pairs:", err.message);
    return [];
  }
};

// Function to loop through all pairs and run the insert logic (every 10 mins)
const runInsertJob = async () => {
  const pairs = await getAllBookmakerMarkets();
  for (const { event_id, market_id } of pairs) {
    try {
      await insertBookmakerToSqlandRedis({ params: { event_id, market_id } }, { status: () => ({ json: () => {} }) });
      console.log(`✅ Inserted to SQL: ${event_id} / ${market_id}`);
    } catch (err) {
      console.error(`❌ Insert SQL failed for ${event_id}/${market_id}:`, err.message);
    }
  }
};

// Function to loop through all pairs and cache them (every 1 sec)
const runCacheJob = async () => {
  const pairs = await getAllBookmakerMarkets();
  for (const { event_id, market_id } of pairs) {
    try {
      await fetchAndCacheBookmakerOdds({ params: { event_id, market_id } }, { json: () => {} });
      console.log(`🟢 Cached: ${event_id} / ${market_id}`);
    } catch (err) {
      console.error(`⚠️ Cache failed for ${event_id}/${market_id}:`, err.message);
    }
  }
};

const startCronJob = () => {
  // Daily sports data update at midnight
  cron.schedule('0 0 * * *', async () => {
    console.log('🌍 Running daily sports data update...');
    await updateSportsData();
  });



  // Runs at minute 0 of every hour
  cron.schedule('0 * * * *', async () => {
    console.log('⏰ Running fetchAndStoreCompetition cron job');
    try {
      await fetchAndStoreCompetition(); // you may remove (req, res) since this is not from a route
    } catch (err) {
      console.error('❌ Cron Job Error:', err);
    }
  });
  cron.schedule('*/30 * * * *', async () => {
    console.log('⏰ Running storeMatches every 30 minutes...');
    try {
      await fetchAndStoreMatches();
    } catch (err) {
      console.error('❌ Cron Job Error in storeMatches:', err);
    }
  });


  //new code for bookmaker
  // Every 1 second - Cache bookmaker odds
  cron.schedule('*/30 * * * * *', async () => {  // * * * * * * for every second
    console.log('🟢 Running cache bookmaker odds...');
    try {
      await runCacheJob();
    } catch (err) {
      console.error('⚠️ Error in caching bookmaker odds:', err);
    }
  });

  // Every 10 minutes - Insert bookmaker odds into SQL
  cron.schedule('*/10 * * * *', async () => {
    console.log('⏰ Running insert bookmaker odds into SQL...');
    try {
      await runInsertJob();
    } catch (err) {
      console.error('❌ Error in inserting bookmaker odds:', err);
    }
  });



 
  
  console.log('⏱️ All cron jobs have been scheduled');
};

module.exports = { startCronJob };
