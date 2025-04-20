const { updateSportsData } = require('../controller/sportsController');
const cron = require('node-cron');


const startCronJob = () => {
  // Daily sports data update at midnight
  cron.schedule('0 0 * * *', async () => {
    console.log('🌍 Running daily sports data update...');
    await updateSportsData();
  });


 


 
  
  console.log('⏱️ All cron jobs have been scheduled');
};

module.exports = { startCronJob };
