const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const apiRoutes = require('./routes/apiRoutes');
const { initSocketServer } = require('./socket');
const bodyParser = require('body-parser');

// Create an Express application
const app = express();

// Enable CORS
app.use(cors()); // Consider restricting origins in production
app.use(bodyParser.json());

// Routes
app.use('/api', apiRoutes);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html for all other routes
app.get('*', async (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');

    try {
        await fs.promises.access(indexPath, fs.constants.F_OK);
        res.sendFile(indexPath); // Serve the index.html file
    } catch (error) {
        res.status(404).send('<html><body><h1>404 - File not found</h1></body></html>');
    }
});

// Initialize the WebSocket server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`> Server running at PORT:${PORT}`);
});

// Initialize Socket.IO on the server
const io = initSocketServer(server);

// Centralized error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something went wrong!');
});
