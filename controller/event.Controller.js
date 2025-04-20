const axios = require('axios');
const db = require('../db'); // your MySQL connection
const moment = require('moment');
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
    const { data } = await axios.get('http://65.0.40.23:7003/api/event/4/101480');
    const events = data.data;

    if (!Array.isArray(events) || events.length < 2) {
      return res.status(404).json({ error: 'No events found to store' });
    }

    // Skip index 0 (league-wide or meta record)
    const fixtures = events.slice(1);

    for (const fixture of fixtures) {
      const { event, marketIds } = fixture;
      const { id: eventId, name: eventName, openDate } = event;

    
      const startDate = new Date(openDate); // Ensure it's a Date object

       const endDate = new Date(startDate.getTime() + 7 * 60 * 60 * 1000);
      // split teams
      const [team1, team2 = ''] = eventName.split(' v ').map(s => s.trim());
      const slug = s => s.toLowerCase().replace(/\s+/g, '-');

      // helper to insert one match record
      const insertOne = async marketId => {
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
          6,                // cat_id
          24,
          '',               // team_1_image
          '',               // team_2_image
          team1,
          team2,
          slug(team1),
          slug(team2),
          eventId,
          eventName,
          marketId,
          startDate,
          endDate,
          1
        ];
        const [result] = await db.pool.execute(sql, values);
        if (result.affectedRows) {
          console.log(`✅ Inserted match_id=${result.insertId}`);
        } else {
          console.log(`⚠️  Skipped duplicate: event=${eventId} market=${marketId}`);
        }
      };

      // if no markets, use fallback
      if (!Array.isArray(marketIds) || marketIds.length === 0) {
        console.log(`⚠️  No markets for ${eventName}; using fallback`);
        await insertOne('fallback-market-id');
      } else {
        for (const m of marketIds) {
          await insertOne(m.marketId);
        }
      }
    }

    return res.status(200).json({ message: 'Matches saved successfully' });
  } catch (err) {
    console.error('❌ Error in fetchAndStoreMatches:', err);
    return res.status(500).json({ error: 'Failed to store matches', details: err.message });
  }
};
  
module.exports = { fetchAndStoreCompetition,
    fetchAndStoreMatches };