const redis = require("redis");

let redisClient;

const initRedisClient = async () => {
  try {
    if (!redisClient) {
      redisClient = redis.createClient({
        host: process.env.REDIS_HOST || "localhost",
        port: process.env.REDIS_PORT || 6379,
      });

      redisClient.on("error", (err) => {
        console.error("Redis Error:", err);
      });

      redisClient.on("end", () => {
        console.log("Redis connection closed");
        redisClient = null;
      });

      await redisClient.connect();
      console.log("Connected to Redis");
    } else {
      console.log("Redis client already initialized");
    }
    return redisClient;
  } catch (error) {
    console.error("Redis initialization error:", error);
    throw error;
  }
};

const getRedisClient = () => {
  if (!redisClient) {
    throw new Error(
      "Redis client not initialized. Call initRedisClient first."
    );
  }
  return redisClient;
};

const closeRedisConnection = async () => {
  try {
    if (redisClient) {
      await redisClient.quit();
      console.log("Redis client disconnected");
      redisClient = null;
    }
  } catch (error) {
    console.error("Error closing Redis connection:", error);
    throw error;
  }
};

const checkCache = async (req, res, next) => {
  try {
    const client = getRedisClient();
    const cacheKey = req.originalUrl;

    const data = await client.get(cacheKey);

    if (data) {
      console.log(`Cache hit: ${cacheKey}`);
      return res.json(JSON.parse(data));
    }

    console.log(`Cache miss: ${cacheKey}`);
    res.setCache = async (data) => {
      try {
        await client.set(cacheKey, JSON.stringify(data), {
          EX: 3600,
        });
        console.log(`Cache set: ${cacheKey}`);
      } catch (error) {
        console.error("Error setting cache:", error);
      }
    };
    next();
  } catch (error) {
    console.error("Redis Cache Error:", error.message);
    next();
  }
};

module.exports = {
  initRedisClient,
  getRedisClient,
  closeRedisConnection,
  checkCache,
};
