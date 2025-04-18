const { updateSportsData } = require('../controller/sportsController');
const { fetchAndStoreCompetition, fetchAndStoreMatches } = require('../controller/event.Controller');
const cron = require('node-cron');

const startCronJob = () => {
  // Daily sports data update at midnight
  cron.schedule('0 0 * * *', async () => {
    console.log('🌍 Running daily sports data update...');
    await updateSportsData();
  });

  // Competition data fetch every 1 hour
  cron.schedule('0 * * * *', async () => {
    console.log('⚽ Fetching competition data (every 1 hour)...');
    await fetchAndStoreCompetition();
  });

  // Match/event data fetch every 10 minutes
  cron.schedule('*/10 * * * *', async () => {
    console.log('🏟️ Fetching match/event data (every 10 mins)...');
    await fetchAndStoreMatches();
  });

  


  
  console.log('⏱️ All cron jobs have been scheduled');
};

module.exports = { startCronJob };
