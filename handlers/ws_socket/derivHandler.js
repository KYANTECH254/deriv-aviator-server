const WebSocket = require('ws');
const Redis = require('ioredis');
const redisClient = new Redis();
const initialMultiplier = 1.0;
const priceChangeThreshold = 0.615;
const prisma = require('../../services/db');

function initializeDerivWebSocket() {
    const derivWs = new WebSocket(`${process.env.SOCKET_URL}${process.env.DERIV_ID}`);

    derivWs.on('open', () => {
        console.log('Connected to Deriv WebSocket API');

        // Send authorization message
        derivWs.send(JSON.stringify({
            authorize: process.env.TOKEN,
        }));

        // Subscribe to Volatility 100 index ticks
        derivWs.send(JSON.stringify({
            subscribe: 1,
            ticks: "R_100",
        }));

        // Keep the connection alive
        setInterval(() => {
            derivWs.send(JSON.stringify({ ping: 1 }));
        }, 1000);
    });

    derivWs.on('message', (event) => {
        const message = JSON.parse(event);
        handleTickData(message);
    });

    derivWs.on('error', (error) => {
        console.error('Error with Deriv WebSocket:', error);
    });

    derivWs.on('close', () => {
        console.log('Deriv WebSocket closed.');
    });

    async function handleTickData(message) {
        if (message.tick && message.tick.symbol === "R_100") {
            const newPrice = message.tick.quote;

            redisClient.get('previousPrice', async (err, previousPrice) => {
                if (err) {
                    console.error('Error fetching previous price from Redis:', err);
                    return;
                }

                const priceChange = newPrice - parseFloat(previousPrice);

                if (Math.abs(priceChange) <= priceChangeThreshold) {
                    redisClient.get('multiplier', (err, multiplier) => {
                        const newMultiplier = parseFloat(multiplier) + 0.05;
                        redisClient.set('multiplier', newMultiplier);
                        redisClient.set('previousPrice', newPrice);
                        redisClient.set('multiplierCrashed', 'false'); // Reset crash state

                        console.log(`Multiplier updated to: ${newMultiplier}`);
                    });
                } else {
                    // Set the crash state to true when a crash occurs
                    redisClient.set('multiplierCrashed', 'true');

                    // Fetch the most recent round if it exists
                    const previousRound = await prisma.multiplier.findFirst({
                        orderBy: { createdAt: 'desc' },
                    });

                    // If previous round exists, update it with the current multiplier value
                    if (previousRound) {
                        await prisma.multiplier.update({
                            where: { id: previousRound.id },
                            data: { value: redisClient.get('multiplier') || initialMultiplier },
                        });

                        console.log('Previous round updated with multiplier value after crash.');
                    } else {
                        // If no previous round, create a new round record
                        await prisma.multiplier.create({
                            data: {
                                value: redisClient.get('multiplier') || initialMultiplier,
                                appId: 'R_100', // You can change this appId or use any relevant identifier
                            }
                        });

                        console.log('New round created after crash.');
                    }

                    // Create a new round with no multiplier value and store it in the DB
                    await prisma.multiplier.create({
                        data: {
                            value: null, // Leave value blank for the next round
                            appId: 'R_100', // You can change this appId or use any relevant identifier
                        }
                    });

                    // Reset multiplier and previous price after crash
                    redisClient.set('multiplier', initialMultiplier);
                    redisClient.set('previousPrice', newPrice);

                    console.log('Multiplier crashed. Resetting to initial value and creating new round.');
                }
            });
        }
    }
}

module.exports = initializeDerivWebSocket;
