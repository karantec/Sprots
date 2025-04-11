// controllers/eventController.js - Handle event-related operations
const axios = require('axios');
const { getRedisClient } = require('../services/redis');
const db = require('../db');  // Assuming you have a MySQL service to handle DB operations
const BASE_URL = 'http://65.0.40.23:7003/api';

// Format match data for database storage with the new column structure

const formatMatchData = (eventData, competitionId) => {
  const createSlug = (teamName) => {
    return teamName
      ? teamName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
      : '';
  };

  const mapEventStatus = (apiStatus) => {
    const statusMap = {
      'scheduled': 'upcoming',
      'live': 'live',
      'in_progress': 'live',
      'completed': 'completed',
      'finished': 'completed',
      'cancelled': 'cancelled',
      'postponed': 'postponed'
    };
    return statusMap[apiStatus?.toLowerCase()] || 'upcoming';
  };

  return eventData.map((item) => {
    const event = item.event || {};
    const eventName = event.name || '';
    const [homeTeam, awayTeam] = eventName.includes(' v ')
      ? eventName.split(' v ')
      : ['Unknown Team 1', 'Unknown Team 2'];

    return {
      cat_id: parseInt(competitionId, 10),
      event_id: event.id || null,
      team_1: homeTeam.trim(),
      team_2: awayTeam.trim(),
      team_1_slug: createSlug(homeTeam),
      team_2_slug: createSlug(awayTeam),
      team_1_image: null, // Add actual team logo URLs if available
      team_2_image: null,
      start_date: event.openDate || new Date().toISOString(),
      end_date: null, // Optional: can be calculated or stored later
      status: mapEventStatus('scheduled'), // You can change if status comes dynamically
      market_id: item.marketIds?.[0]?.marketId || null,
      market_name: item.marketIds?.[0]?.marketName || null,
      market_start_time: item.marketIds?.[0]?.marketStartTime || null,
      total_matched: item.marketIds?.[0]?.totalMatched || "0"
    };
  });
};




// Fetch event data and store in MySQL
const updateEventData = async () => {
  try {
    console.log('🔄 Fetching event data from API...');
    // Get competition data first
    const competitionResponse = await axios.get(`${BASE_URL}/competitions/4`);
    const competitions = competitionResponse.data.data;
    
    if (!competitions || competitions.length === 0) {
      console.log('⚠️ No competitions found');
      return;
    }
    
    // For each competition, get events and store them
    for (const comp of competitions) {
      const competitionId = comp.competition.id;
      console.log(`🔍 Processing competition ID: ${competitionId}`);
      
      const eventResponse = await axios.get(`${BASE_URL}/event/4/${competitionId}`);
      const eventData = eventResponse.data;
      
      if (!eventData || !eventData.data || eventData.data.length === 0) {
        console.log(`⚠️ No event data found for competition ${competitionId}`);
        continue;
      }
      
      // Format data for database and cache
      const formattedMatches = formatMatchData(eventData.data, competitionId);
      
      // Cache in Redis
      const redisClient = getRedisClient();
      await redisClient.setEx(`events:${competitionId}`, 600, JSON.stringify(formattedMatches));
      
      // Store each match in MySQL using the db.saveMatch function
      for (const match of formattedMatches) {
        await db.saveMatch(match);
      }
      
      console.log(`✅ Stored ${formattedMatches.length} matches for competition ${competitionId}`);
    }
    
    console.log('✅ Event data updated successfully');
  } catch (error) {
    console.error('❌ Error updating event data:', error.message);
  }
};

// HTTP handler to fetch event data
const fetchEvent = async (req, res) => {
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
    
    // Format data for database
    const formattedMatches = formatMatchData(eventData.data, competitionId);
    
    // Store in Redis
    const redisClient = getRedisClient();
    await redisClient.setEx(req.originalUrl, 600, JSON.stringify(eventData));
    
    // Store in MySQL
    for (const match of formattedMatches) {
      await db.saveMatch(match);
    }
    
    res.json(eventData);
  } catch (error) {
    console.error('❌ Error fetching event data:', error.message);
    res.status(500).json({ error: 'Failed to fetch event data' });
  }
};

// Get matches from database
const getMatches = async (req, res) => {
  try {
    const matches = await db.getAllMatches();
    res.json({ success: true, data: matches });
  } catch (error) {
    console.error('❌ Error fetching matches from database:', error.message);
    res.status(500).json({ error: 'Failed to fetch matches' });
  }
};

module.exports = {
  updateEventData,
  fetchEvent,
  getMatches
};