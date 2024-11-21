const WebSocket = require('ws');
const Redis = require('ioredis');
const redisClient = new Redis();
const initialMultiplier = 1.0;
const priceChangeThreshold = 0.615;

function initwssWebSocketServer(server) {
    const wss = new WebSocket.Server({ server });

    // Handle incoming WebSocket connections from frontend clients
    wss.on('connection', (client) => {
        console.log('New client connected');

        // Send initial multiplier state to the new client
        redisClient.get('multiplier', (err, multiplier) => {
            client.send(JSON.stringify({ type: 'multiplier', multiplier: parseFloat(multiplier) }));
        });

        // Handle incoming messages from frontend clients
        client.on('message', (message) => {
            console.log('Received message from client:', message);
        });

        // Handle client disconnections
        client.on('close', () => {
            console.log('Client disconnected');
        });
    });

    console.log("Frontend WebSocket server running on ws://localhost:3000");

    // Initialize the WebSocket connection to Deriv API (separate connection)
    const derivWs = new WebSocket(`${process.env.SOCKET_URL}${process.env.DERIV_ID}`);

    derivWs.on('open', () => {
        console.log('Connected to Deriv WebSocket API');
        
        // Send authorization message
        derivWs.send(JSON.stringify({
            authorize: process.env.TOKEN, // Make sure the token is correct
        }));

        // Subscribe to Volatility 100 index symbol for ticks
        derivWs.send(JSON.stringify({
            subscribe: 1,
            ticks: "R_100",
        }));

        // Periodically ping Deriv API to keep the connection alive
        setInterval(() => {
            derivWs.send(JSON.stringify({ ping: 1 }));
        }, 15000);
    });

    derivWs.on('message', (event) => {
        const message = JSON.parse(event);
        handleTickData(message);
    });

    derivWs.on('error', (error) => {
        console.error('Error with Deriv WebSocket:', error);
    });

    derivWs.on('close', (event) => {
        if (!event.wasClean) {
            console.log('Deriv WebSocket closed unexpectedly.');
        }
    });

    // Function to handle tick data and multiplier logic
    function handleTickData(message) {
        if (message.tick && message.tick.symbol === "R_100") {
            const newPrice = message.tick.quote;
            
            redisClient.get('previousPrice', (err, previousPrice) => {
                if (err) {
                    console.error('Error fetching previous price from Redis:', err);
                    return;
                }

                const priceChange = newPrice - parseFloat(previousPrice);

                // If the price change is within the threshold, increase the multiplier
                if (Math.abs(priceChange) <= priceChangeThreshold) {
                    redisClient.get('multiplier', (err, multiplier) => {
                        const newMultiplier = parseFloat(multiplier) + 0.05;
                        redisClient.set('multiplier', newMultiplier);
                        redisClient.set('previousPrice', newPrice);

                        console.log(`Multiplier updated to: ${newMultiplier}`);

                        // Broadcast the new multiplier to all frontend clients
                        wss.clients.forEach(client => {
                            client.send(JSON.stringify({ type: 'multiplier', multiplier: newMultiplier }));
                        });
                    });
                } else {
                    // If the price change exceeds the threshold, reset the multiplier
                    redisClient.set('multiplier', initialMultiplier);
                    redisClient.set('previousPrice', newPrice);

                    console.log('Multiplier crashed. Resetting to initial value.');

                    // Broadcast the reset multiplier to all frontend clients
                    wss.clients.forEach(client => {
                        client.send(JSON.stringify({ type: 'multiplier', multiplier: initialMultiplier }));
                    });
                }
            });
        }
    }
}

// module.exports = { initwssWebSocketServer };
