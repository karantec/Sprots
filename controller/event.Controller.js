const axios = require('axios');
const db = require('../db'); // MySQL connection

// Sleep utility
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch and store competitions from external API after 10 minute delay
 */
const fetchAndStoreCompetition = async (req, res) => {
  try {
    console.log("⏳ Waiting for 1 hour before starting competition fetch...");
    await sleep(3600000); // 1 hour = 3,600,000 ms

    const response = await axios.get('http://65.0.40.23:7003/api/competitions/4');
    const competitions = response.data.data;

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

    console.log("✅ Competitions inserted/updated in MySQL");
    res.status(200).json({ message: 'Competitions saved successfully to MySQL' });
  } catch (error) {
    console.error('❌ Error fetching/storing competitions:', error.message);
    res.status(500).json({ error: 'Failed to store competitions in MySQL' });
  }
};


/**
 * Fetch and store matches from external API after 5 minutes delay
 */
const fetchAndStoreMatches = async () => {
  try {
    console.log('⏳ Waiting for 5 seconds before storing matches...');
    await sleep(5000); // 5 seconds

    const response = await axios.get('http://65.0.40.23:7003/api/event/4/101480');
    const events = response.data.data;

    if (!events || events.length === 0) {
      console.log('❌ No events found');
      return;
    }

    const eventsToStore = events.slice(1); // skip the first event

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
            cat_id, event_id, team_1_image, team_2_image,
            team_1, team_2, team_1_slug, team_2_slug,
            api_event_id, api_event_name, api_market_id,
            start_date, end_date, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
          1, eventId, '', '', team1, team2,
          team1Slug, team2Slug, eventId, eventName,
          marketId, openDate, '', 'upcoming'
        ];

        const [result] = await db.pool.execute(sql, values);

        if (result.affectedRows === 0) {
          console.log(`⚠️ Skipped duplicate: Event ID ${eventId}, Market ID ${marketId}`);
        } else {
          console.log(`✅ Inserted: Event ID ${eventId}, Market ID ${marketId}`);
        }
      };

      if (!marketIds || marketIds.length === 0) {
        console.log(`⚠️ Event "${eventName}" has no markets. Using fallback market.`);
        await insertMatch('fallback-market-id');
      } else {
        for (const market of marketIds) {
          await insertMatch(market.marketId);
        }
      }
    }

    console.log("✅ All matches processed.");
  } catch (error) {
    console.error('❌ Error fetching or storing matches:', error.message);
  }
};


module.exports = {
  fetchAndStoreCompetition,
  fetchAndStoreMatches,
};
