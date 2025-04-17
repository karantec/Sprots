const axios = require('axios');
const db = require('../db'); // your MySQL connection

const fetchAndStoreCompetition = async (req, res) => {
  try {
    const response = await axios.get('http://65.0.40.23:7003/api/competitions/4'); // replace with actual API URL
    const competitions = response.data.data; // ✅ fix here

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

      // Directly call query() on the pool object, without needing `.promise()`
      await db.pool.execute(sql, [competitionId, name, region, marketCount]);
    }

    console.log("✅ Competitions inserted/updated in MySQL");
    res.status(200).json({ message: 'Competitions saved successfully to MySQL' });
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ error: 'Failed to store competitions in MySQL' });
  }
};



const fetchAndStoreMatches = async (req, res) => {
    try {
      // Fetch data from the external API
      const response = await axios.get('http://65.0.40.23:7003/api/event/4/101480');
      
      // Log the full response to see what we are getting
      console.log('Full response:', response.data);
      
      // Access the events data from the response
      const events = response.data.data; // Get events data
      
      // Check if events data is empty
      if (!events || events.length === 0) {
        console.log('❌ No events found');
        return res.status(404).json({ error: 'No events found to store' });
      }
  
      // Log the events data before processing
      console.log('Events data:', events);
      
      // Start from the second event (skip the first one)
      const eventsToStore = events.slice(1);
      
      // Log the events that will be processed
      console.log('Events to store:', eventsToStore);
  
      // Loop through each event to store matches in DB
      for (const event of eventsToStore) {
        const eventId = event.event.id;
        const eventName = event.event.name;
        const openDate = event.event.openDate;
        const marketCount = event.marketCount;
        const marketIds = event.marketIds;
  
        // Log each event's market data
        console.log(`Processing event: ${eventName}`);
        console.log('Market IDs:', marketIds);
  
        // Skip event if marketIds is empty
        if (!marketIds || marketIds.length === 0) {
          console.log(`Event ${eventName} has no markets. Inserting a fallback market.`);
          
          // Insert a default market or fallback record (you can customize this)
          const sql = `
            INSERT INTO matches (
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
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;
  
          const teams = eventName.split(' v ');
          const team1 = teams[0].trim();
          const team2 = teams[1] ? teams[1].trim() : '';
          const team1Slug = team1.toLowerCase().replace(/\s+/g, '-');
          const team2Slug = team2.toLowerCase().replace(/\s+/g, '-');
  
          // Fallback market ID (since marketIds is empty)
          const fallbackMarketId = 'fallback-market-id';
  
          const values = [
            1, // Hardcoded cat_id (assuming 1 for now)
            eventId,
            '', // Placeholder for team 1 image
            '', // Placeholder for team 2 image
            team1,
            team2,
            team1Slug,
            team2Slug,
            eventId,
            eventName,
            fallbackMarketId,
            openDate, // Assuming openDate is the start_date
            '', // Placeholder for end_date (you can set this if available)
            'upcoming' // Placeholder for status (set to 'upcoming' or as required)
          ];
  
          await db.pool.execute(sql, values);
          continue; // Continue to next event
        }
  
        // Insert for each marketId if marketIds are available
        for (const market of marketIds) {
          const marketId = market.marketId;
  
          // Log the market ID before inserting it
          console.log('Inserting market ID:', marketId);
  
          const sql = `
            INSERT INTO matches (
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
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;
  
          const teams = eventName.split(' v ');
          const team1 = teams[0].trim();
          const team2 = teams[1] ? teams[1].trim() : '';
          const team1Slug = team1.toLowerCase().replace(/\s+/g, '-');
          const team2Slug = team2.toLowerCase().replace(/\s+/g, '-');
  
          const values = [
            1, // Hardcoded cat_id (assuming 1 for now)
            eventId,
            '', // Placeholder for team 1 image
            '', // Placeholder for team 2 image
            team1,
            team2,
            team1Slug,
            team2Slug,
            eventId,
            eventName,
            marketId,
            openDate, // Assuming openDate is the start_date
            '', // Placeholder for end_date (you can set this if available)
            'upcoming' // Placeholder for status (set to 'upcoming' or as required)
          ];
  
          await db.pool.execute(sql, values);
        }
      }
  
      console.log("✅ Matches inserted/updated in MySQL");
      res.status(200).json({ message: 'Matches saved successfully to MySQL' });
    } catch (error) {
      console.error('❌ Error:', error);
      res.status(500).json({ error: 'Failed to store matches in MySQL' });
    }
  };





  
module.exports = { fetchAndStoreCompetition,
    fetchAndStoreMatches };
