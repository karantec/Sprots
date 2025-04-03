const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = 3000;

// Enable CORS
app.use(cors());

// Base API URL
const BASE_URL = 'http://65.0.40.23:7003/api';

// Route to fetch competition data and then fetch event data
app.get('/fetch-event', async (req, res) => {
    try {
        // Step 1: Fetch competitions data
        const competitionResponse = await axios.get(`${BASE_URL}/competitions/4`);
        const competitions = competitionResponse.data.data;

        if (!competitions || competitions.length === 0) {
            return res.status(404).json({ error: 'No competitions found' });
        }

        // Step 2: Extract the first competition ID
        const competitionId = competitions[0].competition.id;

        // Step 3: Fetch event data using the extracted competition ID
        const eventResponse = await axios.get(`${BASE_URL}/event/4/${competitionId}`);

        // Send the fetched event data as response
        res.json(eventResponse.data);

    } catch (error) {
        console.error('Error fetching data:', error.message);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});



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
