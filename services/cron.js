// services/cron.js - Cron job service

const { updateSportsData } = require('../controller/sportsController');
const cron = require('node-cron');

const startCronJob = () => {
  // Schedule job to run daily at midnight
  cron.schedule('0 0 * * *', async () => {
    console.log('🌍 Running daily sports data update...');
    await updateSportsData();
  });

  console.log('⏱️ Cron job for daily sports data scheduled');
};

module.exports = { startCronJob };
