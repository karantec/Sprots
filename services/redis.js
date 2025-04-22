const redis = require('redis');

let redisClient;

const initRedisClient = async () => {
    if (!redisClient) {
        redisClient = redis.createClient();
        
        redisClient.on('error', (err) => {
            console.error('❌ Redis Error:', err);
        });

        redisClient.on('end', () => {
            console.log('🔴 Redis connection closed.');
            redisClient = null; // Set redisClient to null when it is disconnected
        });

        await redisClient.connect();
        console.log('✅ Connected to Redis');
    } else {
        console.log('ℹ️ Redis client already initialized.');
    }
    
    return redisClient;
};

const getRedisClient = () => {
    if (!redisClient) {
        throw new Error('Redis client not initialized. Call initRedisClient first.');
    }
    return redisClient;
};

const closeRedisConnection = async () => {
    if (redisClient) {
        await redisClient.quit();
        console.log('🔴 Redis client disconnected');
        redisClient = null; // Ensure the client is reset after disconnecting
    } else {
        console.log('⚠️ Redis client is already disconnected');
    }
};

const checkCache = async (req, res, next) => {
    try {
        const cacheKey = req.originalUrl;
        const data = await getRedisClient().get(cacheKey); // Always use getRedisClient to ensure client is initialized
        
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
