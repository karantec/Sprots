// controllers/sportsController.js - Sports data controller
const axios = require('axios');
const { getRedisClient } = require('../services/redis');

const BASE_URL = 'http://65.0.40.23:7003/api';

// Function to update sports data (used by cron job)
const updateSportsData = async () => {
    try {
        console.log('🔄 Updating sports data from cron job...');
        const response = await axios.get(`${BASE_URL}/sports`);
        
        const redisClient = getRedisClient();
        // Store in Redis cache with the key 'sports-latest', cache expires in 10 minutes (600 seconds)
        await redisClient.setEx('sports-latest', 600, JSON.stringify(response.data));
        console.log('✅ Sports data updated successfully');
    } catch (error) {
        console.error('❌ Error updating sports data:', error.message);
    }
};

// Controller to fetch sports data (on-demand from external API)
const getSportsData = async (req, res) => {
    try {
        // Fetch the latest sports data from the external API
        const response = await axios.get(`${BASE_URL}/sports`);
        
        const redisClient = getRedisClient();
        // Store the fetched data in Redis cache with a 10-minute expiration
        await redisClient.setEx(req.originalUrl, 600, JSON.stringify(response.data));
        
        // Send the fetched data as the response
        res.json(response.data);
    } catch (error) {
        console.error('❌ Error fetching sports data:', error.message);
        res.status(500).json({ error: 'Failed to fetch sports data' });
    }
};

// Controller to get the latest sports data from cache (if available)
const getLatestSportsData = async (req, res) => {
    try {
        const redisClient = getRedisClient();
        const data = await redisClient.get('sports-latest');
        
        if (data) {
            // If data is available in cache, return it
            console.log('✅ Returning latest cached sports data');
            return res.json(JSON.parse(data));
        } else {
            // If no cached data, fetch from the external API and return it
            console.log('⚠️ No latest data available in cache, fetching now...');
            const response = await axios.get(`${BASE_URL}/sports`);
            res.json(response.data);
        }
    } catch (error) {
        console.error('❌ Error fetching latest sports data:', error.message);
        res.status(500).json({ error: 'Failed to fetch latest sports data' });
    }
};

module.exports = {
    updateSportsData,
    getSportsData,
    getLatestSportsData
};
