const express = require('express');
const path = require('path');
const fs = require('fs');
const { initSocketServer } = require('./socket');

// Create an Express application
const app = express();

// Serve the static HTML file (index.html)
app.get('*', (req, res) => {
    const indexPath = path.join(__dirname, 'index.html');

    // Check if the file exists
    fs.exists(indexPath, (exists) => {
        if (exists) {
            res.sendFile(indexPath);  // Serve the index.html file
        } else {
            // If index.html doesn't exist, serve a basic HTML message
            res.status(404).send('<html><body><h1>404 - File not found</h1></body></html>');
        }
    });
});

// Initialize the WebSocket server
const server = app.listen(3000, () => {
    console.log('> Server running at PORT:3000');
});

// Initialize Socket.IO on the server
const io = initSocketServer(server);
