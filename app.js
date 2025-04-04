const express = require('express');
const redis = require('redis');

const app = express();
const PORT = 3000;

// ✅ Properly Initialize Redis Client
const client = redis.createClient();

client.on('error', (err) => {
    console.error('❌ Redis connection error:', err);
});

// ✅ Ensure Redis is connected before processing requests
(async () => {
    await client.connect();
    console.log('✅ Connected to Redis');
})();

// Middleware to cache API responses
const cache = async (req, res, next) => {
    try {
        const key = req.url;
        const data = await client.get(key);

        if (data) {
            return res.json(JSON.parse(data));
        } else {
            next();
        }
    } catch (error) {
        console.error('❌ Redis Cache Error:', error);
        next();
    }
};

// Sample API Route (Fetch User Data)
app.get('/user/:id', cache, async (req, res) => {
    const userId = req.params.id;

    // Simulated Database Call
    const userData = { id: userId, name: 'John Doe', age: 30 };

    // Store in Redis with expiry (10 minutes)
    await client.setEx(req.url, 600, JSON.stringify(userData));

    res.json(userData);
});

// Start the Express server
app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
