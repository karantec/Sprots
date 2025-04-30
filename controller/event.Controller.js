const axios = require("axios");
const db = require("../db"); // your MySQL connection
const moment = require("moment");
const { getRedisClient } = require("../services/redis");

const CACHE_TTL = 3600; // Cache time-to-live in seconds (1 hour)

// Fetch and store competitions
const fetchAndStoreCompetition = async (req, res) => {
  try {
    const cacheKey = "competitions:data:4";
    const redisClient = getRedisClient();

    // Try to get data from Redis cache first
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      console.log("✅ Serving competitions data from Redis cache");
      return res.status(200).json({
        message: "Competitions data retrieved from cache",
        data: JSON.parse(cachedData),
        source: "cache",
      });
    }

    // If not in cache, fetch from API
    const response = await axios.get(
      "http://65.0.40.23:7003/api/competitions/4"
    );
    const competitions = response.data.data;

    // Store data in MySQL
    for (const comp of competitions) {
      const competitionId = comp.competition.id;
      const name = comp.competition.name;
      const region = comp.competitionRegion;
      const marketCount = comp.marketCount;

      const sql = `
        INSERT INTO competitions (competition_id, name, region, market_count)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
          name = VALUES(name), 
          region = VALUES(region), 
          market_count = VALUES(market_count)
      `;

      await db.pool.execute(sql, [competitionId, name, region, marketCount]);
    }

    // Store in Redis cache
    await redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(competitions));

    console.log(
      "✅ Competitions inserted/updated in MySQL and cached in Redis"
    );
    res.status(200).json({
      message: "Competitions saved successfully to MySQL and cached in Redis",
      data: competitions,
      source: "api",
    });
  } catch (error) {
    console.error("❌ Error:", error);
    res
      .status(500)
      .json({ error: "Failed to store competitions in MySQL/Redis" });
  }
};

const fetchEventWithOdds = async (req, res) => {
  try {
    const competitionResponse = await axios.get(`${BASE_URL}/competitions/4`);
    const competitions = competitionResponse.data.data;

    if (!competitions || competitions.length === 0) {
      return res.status(404).json({ error: "No competitions found" });
    }

    const competitionId = competitions[0].competition.id;
    const eventResponse = await axios.get(
      `${BASE_URL}/event/4/${competitionId}`
    );
    let eventData = eventResponse.data;

    if (!eventData || !eventData.data || eventData.data.length === 0) {
      return res.status(404).json({ error: "No event data found" });
    }

    const eventsWithOdds = await Promise.all(
      eventData.data.map(async (event) => {
        const matchOddsMarket = event.marketIds.find(
          (m) => m.marketName === "Match Odds"
        );
        if (!matchOddsMarket) return event;

        try {
          const oddsResponse = await axios.get(
            `${BASE_URL}/event-odds/${event.event.id}/${matchOddsMarket.marketId}`
          );
          return {
            ...event,
            matchOdds: oddsResponse.data.data.runners.map((runner) => ({
              runner: runner.runner,
              back: runner.back,
              lay: runner.lay,
            })),
          };
        } catch (oddsError) {
          console.error(
            `❌ Error fetching odds for event ${event.event.id}:`,
            oddsError.message
          );
          return {
            ...event,
            matchOdds: null,
          };
        }
      })
    );

    const responseData = {
      message: "success",
      data: eventsWithOdds,
    };

    await redisClient.setEx(req.originalUrl, 600, JSON.stringify(responseData));

    res.json(responseData);
  } catch (error) {
    console.error("❌ Error fetching event data:", error.message);
    res.status(500).json({ error: "Failed to fetch event data" });
  }
};
// Fetch and store matches
const fetchAndStoreMatches = async (req, res) => {
  try {
    const competitionId = req.params.competitionId || 4;
    const eventId = req.params.eventId || 101480;
    const cacheKey = `matches:data:${competitionId}:${eventId}`;
    const redisClient = getRedisClient();

    // Try to get data from Redis cache first
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      console.log(`✅ Serving matches data from Redis cache for ${cacheKey}`);
      return res.status(200).json({
        message: "Matches data retrieved from cache",
        data: JSON.parse(cachedData),
        source: "cache",
      });
    }

    // If not in cache, fetch from API
    const { data } = await axios.get(
      `http://65.0.40.23:7003/api/event/${competitionId}/${eventId}`
    );
    const events = data.data;

    if (!Array.isArray(events) || events.length < 2) {
      return res.status(404).json({ error: "No events found to store" });
    }

    // Skip index 0 (league-wide or meta record)
    const fixtures = events.slice(1);
    const savedMatches = [];

    for (const fixture of fixtures) {
      const { event, marketIds } = fixture;
      const { id: eventId, name: eventName, openDate } = event;

      const startDate = new Date(openDate);
      const endDate = new Date(startDate.getTime() + 7 * 60 * 60 * 1000);

      // split teams
      const [team1, team2 = ""] = eventName.split(" v ").map((s) => s.trim());
      const slug = (s) => s.toLowerCase().replace(/\s+/g, "-");

      // helper to insert one match record
      const insertOne = async (marketId) => {
        const sql = `
          INSERT IGNORE INTO matches (
            cat_id,
            event_id,
            team_1_image,
            team_2_image,
            team_1,
            team_2,
            team_1_slug,
            team_2_slug,
            api_event_id,
            api_event_name,
            api_market_id,
            start_date,
            end_date,
            status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const values = [
          6, // cat_id
          24,
          "", // team_1_image
          "", // team_2_image
          team1,
          team2,
          slug(team1),
          slug(team2),
          eventId,
          eventName,
          marketId,
          startDate,
          endDate,
          1,
        ];

        const [result] = await db.pool.execute(sql, values);

        const matchData = {
          match_id: result.insertId || 0,
          event_id: eventId,
          team1,
          team2,
          marketId,
          start_date: startDate,
        };

        savedMatches.push(matchData);

        if (result.affectedRows) {
          console.log(`✅ Inserted match_id=${result.insertId}`);
        } else {
          console.log(
            `⚠️  Skipped duplicate: event=${eventId} market=${marketId}`
          );
        }

        return matchData;
      };

      // if no markets, use fallback
      if (!Array.isArray(marketIds) || marketIds.length === 0) {
        console.log(`⚠️  No markets for ${eventName}; using fallback`);
        await insertOne("fallback-market-id");
      } else {
        for (const m of marketIds) {
          await insertOne(m.marketId);
        }
      }
    }

    // Store in Redis cache
    await redisClient.setEx(
      cacheKey,
      CACHE_TTL,
      JSON.stringify({
        events: fixtures,
        savedMatches,
      })
    );

    return res.status(200).json({
      message: "Matches saved successfully to MySQL and cached in Redis",
      data: {
        events: fixtures,
        savedMatches,
      },
      source: "api",
    });
  } catch (err) {
    console.error("❌ Error in fetchAndStoreMatches:", err);
    return res.status(500).json({
      error: "Failed to store matches",
      details: err.message,
    });
  }
};

// Add a new function to clear cache if needed
const clearCache = async (req, res) => {
  try {
    const { key } = req.params;
    const redisClient = getRedisClient();

    if (key === "all") {
      await redisClient.flushAll();
      return res
        .status(200)
        .json({ message: "All cache cleared successfully" });
    } else {
      await redisClient.del(key);
      return res
        .status(200)
        .json({ message: `Cache for ${key} cleared successfully` });
    }
  } catch (error) {
    console.error("❌ Error clearing cache:", error);
    return res.status(500).json({ error: "Failed to clear cache" });
  }
};

// New function to view cached data
const getCachedData = async (req, res) => {
  try {
    const { key } = req.params;
    const redisClient = getRedisClient();

    const data = await redisClient.get(key);
    if (data) {
      return res.status(200).json({
        key,
        data: JSON.parse(data),
      });
    } else {
      return res
        .status(404)
        .json({ message: `No cached data found for key: ${key}` });
    }
  } catch (error) {
    console.error("❌ Error retrieving cached data:", error);
    return res.status(500).json({ error: "Failed to retrieve cached data" });
  }
};

// New function to list all cached keys
const listCacheKeys = async (req, res) => {
  try {
    const redisClient = getRedisClient();
    const keys = await redisClient.keys("*");

    return res.status(200).json({
      count: keys.length,
      keys,
    });
  } catch (error) {
    console.error("❌ Error listing cache keys:", error);
    return res.status(500).json({ error: "Failed to list cache keys" });
  }
};

module.exports = {
  fetchAndStoreCompetition,
  fetchAndStoreMatches,
  fetchEventWithOdds,
  clearCache,
  getCachedData,
  listCacheKeys,
};
