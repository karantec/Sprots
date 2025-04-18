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
  // cron.schedule('0 * * * *', async () => {
  //   console.log('⚽ Fetching competition data (every 1 hour)...');
  //   await fetchAndStoreCompetition();
  // });

  cron.schedule('*/10 * * * *', async () => {
    console.log('⚽ Fetching matches data (every 10 minutes)...');
    await fetchAndStoreMatches();
  });
 


 
  
  console.log('⏱️ All cron jobs have been scheduled');
};

module.exports = { startCronJob };
