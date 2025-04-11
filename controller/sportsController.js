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
        // Store in Redis cache with the key 'sports-latest'
        await redisClient.setEx('sports-latest', 600, JSON.stringify(response.data));
        console.log('✅ Sports data updated successfully');
    } catch (error) {
        console.error('❌ Error updating sports data:', error.message);
    }
};

// Controller to fetch sports data
const getSportsData = async (req, res) => {
    try {
        const response = await axios.get(`${BASE_URL}/sports`);
        
        const redisClient = getRedisClient();
        // Store in Redis cache
        await redisClient.setEx(req.originalUrl, 600, JSON.stringify(response.data));
        
        res.json(response.data);
    } catch (error) {
        console.error('❌ Error fetching sports data:', error.message);
        res.status(500).json({ error: 'Failed to fetch sports data' });
    }
};

// Controller to get latest sports data from cache
const getLatestSportsData = async (req, res) => {
    try {
        const redisClient = getRedisClient();
        const data = await redisClient.get('sports-latest');
        
        if (data) {
            console.log('✅ Returning latest cached sports data');
            return res.json(JSON.parse(data));
        } else {
            console.log('⚠️ No latest data available, fetching now');
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