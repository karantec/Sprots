// services/cron.js - Cron job service
const cron = require('node-cron');
const { updateSportsData } = require('../controller/sportsController');
const { updateEventData } = require('../controller/eventController');

const startCronJob = () => {
  // Sports data cron job - runs every 5 seconds
  cron.schedule('*/10 * * * * *', updateSportsData);
  console.log('⏱️ Sports data cron job started - updating every 5 seconds');

  // Event data cron job - runs every 5 seconds
  cron.schedule('*/10 * * * * *', updateEventData);
  console.log('⏱️ Event data cron job started - updating every 5 seconds');
};

module.exports = {
  startCronJob
};
