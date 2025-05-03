const redis = require("redis");

let redisClient;

// Redis configuration options
const REDIS_CONFIG = {
  socket: {
    host: process.env.REDIS_HOST || "localhost",
    port: process.env.REDIS_PORT || 6379,
  },
  password: process.env.REDIS_PASSWORD,
  retry_strategy: function (options) {
    if (options.error && options.error.code === "ECONNREFUSED") {
      return new Error("Redis server refused connection");
    }
    if (options.total_retry_time > 1000 * 60 * 60) {
      return new Error("Retry time exhausted");
    }
    if (options.attempt > 10) {
      return new Error("Max attempts reached");
    }
    return Math.min(options.attempt * 100, 3000);
  },
};

const initRedisClient = async () => {
  try {
    if (!redisClient) {
      redisClient = redis.createClient(REDIS_CONFIG);

      redisClient.on("error", (err) => {
        console.error("❌ Redis Error:", err);
      });

      redisClient.on("connect", () => {
        console.log("🔄 Attempting to connect to Redis...");
      });

      redisClient.on("ready", () => {
        console.log("✅ Redis is ready for use");
      });

      redisClient.on("end", () => {
        console.log("🔴 Redis connection closed");
        redisClient = null;
      });

      await redisClient.connect();
      console.log("✅ Connected to Redis successfully");
    } else {
      console.log("ℹ️ Redis client already initialized");
    }

    return redisClient;
  } catch (error) {
    console.error("❌ Redis initialization error:", error);
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
      console.log("🔴 Redis client disconnected successfully");
      redisClient = null;
    } else {
      console.log("⚠️ Redis client is already disconnected");
    }
  } catch (error) {
    console.error("❌ Error closing Redis connection:", error);
    throw error;
  }
};

const checkCache = async (req, res, next) => {
  try {
    const client = getRedisClient();
    const cacheKey = req.originalUrl;

    const data = await client.get(cacheKey);

    if (data) {
      console.log(✅ Cache hit: ${cacheKey});
      return res.json(JSON.parse(data));
    }

    console.log(⚠️ Cache miss: ${cacheKey});
    // Add the setCache function to the response object for later use
    res.setCache = async (data) => {
      try {
        await client.set(cacheKey, JSON.stringify(data), {
          EX: 3600, // Cache for 1 hour
        });
        console.log(✅ Cache set: ${cacheKey});
      } catch (error) {
        console.error("❌ Error setting cache:", error);
      }
    };
    next();
  } catch (error) {
    console.error("❌ Redis Cache Error:", error.message);
    next();
  }
};

// Utility functions for common Redis operations
const cacheOperations = {
  set: async (key, value, expireTime = 3600) => {
    try {
      const client = getRedisClient();
      await client.set(key, JSON.stringify(value), {
        EX: expireTime,
      });
      console.log(✅ Cache set: ${key});
    } catch (error) {
      console.error("❌ Error setting cache:", error);
      throw error;
    }
  },

  get: async (key) => {
    try {
      const client = getRedisClient();
      const data = await client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error("❌ Error getting cache:", error);
      throw error;
    }
  },

  delete: async (key) => {
    try {
      const client = getRedisClient();
      await client.del(key);
      console.log(✅ Cache deleted: ${key});
    } catch (error) {
      console.error("❌ Error deleting cache:", error);
      throw error;
    }
  },
};

module.exports = {
  initRedisClient,
  getRedisClient,
  closeRedisConnection,
  checkCache,
  cacheOperations,
};
