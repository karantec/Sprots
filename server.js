const express = require('express');
const axios = require('axios');
const cors = require('cors');
const redis = require('redis');

const app = express();
const PORT = 3000;

// Enable CORS
app.use(cors());

const BASE_URL = 'http://65.0.40.23:7003/api';

// ✅ Properly Initialize Redis Client
const redisClient = redis.createClient();

redisClient.on('error', (err) => console.error('❌ Redis Error:', err));

// ✅ Ensure Redis is connected before using
(async () => {
    try {
        await redisClient.connect();
        console.log('✅ Connected to Redis');
    } catch (error) {
        console.error('❌ Redis connection failed:', error);
    }
})();

// Middleware to check Redis cache
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

// Fetch event details (with Redis caching)
app.get('/fetch-event', checkCache, async (req, res) => {
    try {
        const competitionResponse = await axios.get(`${BASE_URL}/competitions/4`);
        const competitions = competitionResponse.data.data;

        if (!competitions || competitions.length === 0) {
            return res.status(404).json({ error: 'No competitions found' });
        }

        const competitionId = competitions[0].competition.id;
        const eventResponse = await axios.get(`${BASE_URL}/event/4/${competitionId}`);
        const eventData = eventResponse.data;

        if (!eventData || !eventData.data || eventData.data.length === 0) {
            return res.status(404).json({ error: 'No event data found' });
        }

        // ✅ Store response in Redis (cache for 10 minutes)
        await redisClient.setEx(req.originalUrl, 600, JSON.stringify(eventData));

        res.json(eventData);
    } catch (error) {
        console.error('❌ Error fetching event data:', error.message);
        res.status(500).json({ error: 'Failed to fetch event data' });
    }
});

app.get('/fetch-event-with-odds', checkCache, async (req, res) => {
    try {
        const competitionResponse = await axios.get(`${BASE_URL}/competitions/4`);
        const competitions = competitionResponse.data.data;

        if (!competitions || competitions.length === 0) {
            return res.status(404).json({ error: 'No competitions found' });
        }

        const competitionId = competitions[0].competition.id;
        const eventResponse = await axios.get(`${BASE_URL}/event/4/${competitionId}`);
        let eventData = eventResponse.data;

        if (!eventData || !eventData.data || eventData.data.length === 0) {
            return res.status(404).json({ error: 'No event data found' });
        }

        // Fetch match odds for each event with a market ID
        const eventsWithOdds = await Promise.all(eventData.data.map(async (event) => {
            const matchOddsMarket = event.marketIds.find(m => m.marketName === 'Match Odds');
            if (!matchOddsMarket) return event;

            try {
                const oddsResponse = await axios.get(`${BASE_URL}/event-odds/${event.event.id}/${matchOddsMarket.marketId}`);
                return {
                    ...event,
                    matchOdds: oddsResponse.data.data.runners.map(runner => ({
                        runner: runner.runner,
                        back: runner.back,
                        lay: runner.lay
                    }))
                };
            } catch (oddsError) {
                console.error(`❌ Error fetching odds for event ${event.event.id}:`, oddsError.message);
                return {
                    ...event,
                    matchOdds: null
                };
            }
        }));

        // Create response object matching the structure
        const responseData = {
            message: "success",
            data: eventsWithOdds
        };

        // Store response in Redis
        await redisClient.setEx(req.originalUrl, 600, JSON.stringify(responseData));

        res.json(responseData);
    } catch (error) {
        console.error('❌ Error fetching event data:', error.message);
        res.status(500).json({ error: 'Failed to fetch event data' });
    }
});


// Fetch event odds (with Redis caching)
app.get('/fetch-event-odds/:eventId/:marketId', async (req, res) => {
    try {
        const { eventId, marketId } = req.params;
        const url = `${BASE_URL}/event-odds/${eventId}/${marketId}`;

        const oddsResponse = await axios.get(url);

        // ✅ Store in Redis cache
        // await redisClient.setEx(req.originalUrl, 600, JSON.stringify(oddsResponse.data));

        res.json(oddsResponse.data);
    } catch (error) {
        console.error('❌ Error fetching event odds:', error.message);
        res.status(500).json({ error: 'Failed to fetch event odds' });
    }
});

app.get('/fetch-fancy-odds/:eventId/:marketId', async (req, res) => {
    try {
        const { eventId, marketId } = req.params;
        const url = `${BASE_URL}/fancy-odds/${eventId}/${marketId}`;

        console.log(`🔍 Fetching fancy odds from: ${url}`);

        const oddsResponse = await axios.get(url);

        // ✅ Check if API response is valid before caching
        if (!oddsResponse.data) {
            return res.status(404).json({ error: 'No fancy odds found' });
        }

        // ✅ Store response in Redis (cache for 10 minutes)
        await redisClient.setEx(req.originalUrl, 600, JSON.stringify(oddsResponse.data));

        res.json(oddsResponse.data);
    } catch (error) {
        console.error('❌ Error fetching fancy odds:', error.message);
        res.status(500).json({ error: 'Failed to fetch fancy odds' });
    }
});
app.get('/fetch-bookmaker-odds/:eventId/:marketId', async (req, res) => {
    try {
        const { eventId, marketId } = req.params;
        const url = `${BASE_URL}/bookmaker-odds/${eventId}/${marketId}`; // Updated API endpoint

        console.log(`🔍 Fetching bookmaker odds from: ${url}`);

        const oddsResponse = await axios.get(url);

        // ✅ Check if API response is valid before caching
        if (!oddsResponse.data) {
            return res.status(404).json({ error: 'No bookmaker odds found' });
        }

        // ✅ Store response in Redis (cache for 10 minutes)
        await redisClient.setEx(req.originalUrl, 600, JSON.stringify(oddsResponse.data));

        res.json(oddsResponse.data);
    } catch (error) {
        console.error('❌ Error fetching bookmaker odds:', error.message);
        res.status(500).json({ error: 'Failed to fetch bookmaker odds' });
    }
});



// Fetch sports data (with Redis caching)
app.get('/sports', checkCache, async (req, res) => {
    try {
        const response = await axios.get(`${BASE_URL}/sports`);

        // ✅ Store in Redis cache
        await redisClient.setEx(req.originalUrl, 600, JSON.stringify(response.data));

        res.json(response.data);
    } catch (error) {
        console.error('❌ Error fetching sports data:', error.message);
        res.status(500).json({ error: 'Failed to fetch sports data' });
    }
});

// ✅ Gracefully handle Redis client disconnection
process.on('SIGINT', async () => {
    await redisClient.quit();
    console.log('🔴 Redis client disconnected');
    process.exit(0);
});

// ✅ Start the server
app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
