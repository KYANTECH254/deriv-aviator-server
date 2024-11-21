const WebSocket = require('ws');
const Redis = require('ioredis');
const redisClient = new Redis();
const initialMultiplier = 1.00;
const priceChangeThreshold = 0.615;
const prisma = require('../../services/db');

function initializeDerivWebSocket() {
    const derivWs = new WebSocket(`${process.env.SOCKET_URL}${process.env.DERIV_ID}`);

    derivWs.on('open', () => {
        console.log('Connected to Deriv WebSocket API');

        // Send authorization message
        derivWs.send(
            JSON.stringify({
                authorize: process.env.TOKEN,
            })
        );

        // Subscribe to Volatility 100 index ticks
        derivWs.send(
            JSON.stringify({
                subscribe: 1,
                ticks: 'R_100',
            })
        );

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
        if (message.tick && message.tick.symbol === 'R_100') {
            const newPrice = message.tick.quote;

            // Fetch the crash state from Redis
            const crashState = await redisClient.get('multiplierCrashed');

            // If a crash is in progress, do nothing
            // if (crashState === 'true') {
            //     return;
            // }

            // Fetch or initialize the previous price
            let previousPrice = await redisClient.get('previousPrice');
            if (!previousPrice) {
                // Set the initial previous price for the first tick
                await redisClient.set('previousPrice', newPrice);
                previousPrice = newPrice;
            }

            const priceChange = newPrice - parseFloat(previousPrice);

            if (Math.abs(priceChange) <= priceChangeThreshold) {
                // Update multiplier if price change is within threshold
                const multiplier = parseFloat(await redisClient.get('multiplier')) || parseFloat(initialMultiplier);
                const newMultiplier = (Math.round((multiplier + 0.05) * 100) / 100).toFixed(2);

                await redisClient.set('multiplier', newMultiplier);
                await redisClient.set('previousPrice', newPrice); 
                // console.log(Updated multiplier: ${newMultiplier});
                
            } else {
                // Handle crash
                console.log('Multiplier crashed. Resetting and starting a new round.');
                await redisClient.set('multiplierCrashed', 'true');

                const currentMultiplier = parseFloat(await redisClient.get('multiplier')) || parseFloat(initialMultiplier);

                // Update or create a round in the database
                const previousRound = await prisma.multiplier.findFirst({ orderBy: { createdAt: 'desc' } });
                if (previousRound) {
                    await prisma.multiplier.update({
                        where: { id: previousRound.id },
                        data: { value: currentMultiplier.toFixed(2) },
                    });
                    console.log('Previous round updated with multiplier value after crash.');
                } else {
                    await prisma.multiplier.create({
                        data: {
                            value: currentMultiplier.toFixed(2),
                            appId: process.env.DERIV_ID,
                        },
                    });
                    console.log('New round created after crash.');
                }

                // Create a new round for the next game
                await prisma.multiplier.create({
                    data: {
                        value: '',
                        appId: `${process.env.DERIV_ID}`,
                    },
                });

                // Reset multiplier but wait for the first valid tick to reset `previousPrice`
                await redisClient.set('multiplier', initialMultiplier);
                await redisClient.del('previousPrice'); // Clear previousPrice temporarily

                console.log('Waiting 7 seconds before restarting...');
                setTimeout(async () => {
                    await redisClient.set('multiplierCrashed', 'false');
                    console.log('Crash handled. Restarting process.');
                }, 7000); // Wait for 7 seconds
            }
        }
    }
}

module.exports = initializeDerivWebSocket;
