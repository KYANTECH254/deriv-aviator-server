const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const apiRoutes = require('./routes/apiRoutes');
const { initSocketServer } = require('./handlers/io_socket/socketHandler');
const initializeDerivWebSocket = require('./handlers/ws_socket/derivHandler');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();

// Enable CORS
app.use(cors());
app.use(bodyParser.json());

// Routes
app.use('/api', apiRoutes);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html for all other routes
app.get('*', async (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    const ErrorPath = path.join(__dirname, 'public', '404.html');

    try {
        await fs.promises.access(indexPath, fs.constants.F_OK);
        res.sendFile(indexPath);
    } catch (error) {
        res.sendFile(indexPath); 
    }
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
});

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
    console.log(`> Server running at PORT:${PORT}`);
});

const wss = initializeDerivWebSocket();
const io = initSocketServer(server);

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something went wrong!');
});
