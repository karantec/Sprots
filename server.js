const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = 3000;

// Enable CORS
app.use(cors());

// Base API URL
const BASE_URL = 'http://65.0.40.23:7003/api';

// Route to fetch event details (eventId and marketId)
app.get('/fetch-event', async (req, res) => {
    try {
        // Step 1: Fetch competitions data
        const competitionResponse = await axios.get(`${BASE_URL}/competitions/4`);
        const competitions = competitionResponse.data.data;

        if (!competitions || competitions.length === 0) {
            return res.status(404).json({ error: 'No competitions found' });
        }

        // Extract the competition ID from the first competition
        const competitionId = competitions[0].competition.id;

        // Step 2: Fetch event data using the extracted competition ID
        const eventResponse = await axios.get(`${BASE_URL}/event/4/${competitionId}`);
        const eventData = eventResponse.data;

        if (!eventData || !eventData.data || eventData.data.length === 0) {
            return res.status(404).json({ error: 'No event data found' });
        }

        // Step 3: Extract eventId and marketId from the first event
        const firstEvent = eventData.data[0];
        const eventId = firstEvent.event.id; // using the nested event object's id
        let marketId = null;
        if (firstEvent.marketIds && firstEvent.marketIds.length > 0) {
            // For example, select the first marketId; alternatively, you can filter by marketName if needed.
            marketId = firstEvent.marketIds[0].marketId;
        }

        if (!eventId || !marketId) {
            return res.status(404).json({ error: 'Event ID or Market ID not found' });
        }

        // Return the extracted eventId and marketId
        res.json({ eventId, marketId });

    } catch (error) {
        console.error('Error fetching event data:', error.message);
        res.status(500).json({ error: 'Failed to fetch event data' });
    }
});

// Route to fetch event odds using the eventId and marketId from /fetch-event
app.get('/fetch-event-odds', async (req, res) => {
    try {
        // Get event details from the /fetch-event route
        const eventDetailsResponse = await axios.get(`http://localhost:${PORT}/fetch-event`);
        const { eventId, marketId } = eventDetailsResponse.data;

        if (!eventId || !marketId) {
            return res.status(404).json({ error: 'Event ID or Market ID missing' });
        }

        // Fetch event odds using the obtained eventId and marketId
        const oddsResponse = await axios.get(`${BASE_URL}/event-odds/${eventId}/${marketId}`);

        
        res.json(oddsResponse.data);

    } catch (error) {
        console.error('Error fetching event odds:', error.message);
        res.status(500).json({ error: 'Failed to fetch event odds' });
    }
});

// Route to fetch sports data
app.get('/sports', async (req, res) => {
    try {
        const response = await axios.get(`${BASE_URL}/sports`);
        res.json(response.data);
    } catch (error) {
        console.error('Error fetching sports data:', error.message);
        res.status(500).json({ error: 'Failed to fetch sports data' });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
