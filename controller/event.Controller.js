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
    const response = await axios.get('http://65.0.40.23:7003/api/event/4/101480');
    const events = response.data.data;

    if (!events || events.length === 0) {
      console.log('❌ No events found');
      return res.status(404).json({ error: 'No events found to store' });
    }

    const eventsToStore = events.slice(1);

    for (const event of eventsToStore) {
      const eventId = event.event.id;
      const eventName = event.event.name;
      const openDate = event.event.openDate;
      const marketIds = event.marketIds;

      const teams = eventName.split(' v ');
      const team1 = teams[0].trim();
      const team2 = teams[1] ? teams[1].trim() : '';
      const team1Slug = team1.toLowerCase().replace(/\s+/g, '-');
      const team2Slug = team2.toLowerCase().replace(/\s+/g, '-');

      const insertMatch = async (marketId) => {
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
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
          1, // hardcoded cat_id
          eventId,
          '', // team 1 image
          '', // team 2 image
          team1,
          team2,
          team1Slug,
          team2Slug,
          eventId,
          eventName,
          marketId,
          openDate,
          '', // end_date
          'upcoming'
        ];

        const [result] = await db.pool.execute(sql, values);

        if (result.affectedRows === 0) {
          console.log(`⚠️ Skipped duplicate: Event ID ${eventId}, Market ID ${marketId}`);
        } else {
          console.log(`✅ Inserted: Event ID ${eventId}, Market ID ${marketId}`);
        }
      };

      if (!marketIds || marketIds.length === 0) {
        console.log(`Event ${eventName} has no markets. Using fallback market.`);
        await insertMatch('fallback-market-id');
      } else {
        for (const market of marketIds) {
          await insertMatch(market.marketId);
        }
      }
    }

    console.log("✅ All matches processed.");
    res.status(200).json({ message: 'Matches saved successfully to MySQL' });
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ error: 'Failed to store matches in MySQL' });
  }
};





  
module.exports = { fetchAndStoreCompetition,
    fetchAndStoreMatches };
