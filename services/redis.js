// services/redis.js - Redis service
const redis = require('redis');

let redisClient;

const initRedisClient = async () => {
    redisClient = redis.createClient();
    
    redisClient.on('error', (err) => console.error('❌ Redis Error:', err));
    
    await redisClient.connect();
    console.log('✅ Connected to Redis');
    
    return redisClient;
};

const getRedisClient = () => {
    if (!redisClient) {
        throw new Error('Redis client not initialized');
    }
    return redisClient;
};

const closeRedisConnection = async () => {
    if (redisClient) {
        await redisClient.quit();
        console.log('🔴 Redis client disconnected');
    }
};

const checkCache = async (req, res, next) => {
    try {
        const cacheKey = req.originalUrl;
        const data = await redisClient.get(cacheKey);
        
        if (data) {
            console.log(`✅ Cache hit: ${cacheKey}`);
            return res.json(JSON.parse(data));
        } else {
            console.log(`⚠️ Cache miss: ${cacheKey}`);
            next();
        }
    } catch (error) {
        console.error('❌ Redis Cache Error:', error.message);
        next();
    }
};

module.exports = {
    initRedisClient,
    getRedisClient,
    closeRedisConnection,
    checkCache
};