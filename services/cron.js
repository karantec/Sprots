const { fetchAndStoreMatches, fetchAndStoreCompetition } = require('../controller/event.Controller');
const { updateSportsData } = require('../controller/sportsController');
const cron = require('node-cron');


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



 
  
  console.log('⏱️ All cron jobs have been scheduled');
};

module.exports = { startCronJob };
