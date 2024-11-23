const WebSocket = require('ws');
const Redis = require('ioredis');
const redisClient = new Redis();
const initialMultiplier = 1.00;
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
            console.log(crashState)

            // If a crash is in progress, do nothing
            if (crashState === 'true') {
                console.log('Waiting 7 seconds before restarting...');
                setTimeout(async () => {
                    await redisClient.set('multiplierCrashed', 'false');
                    console.log('Crash handled. Restarting process.');
                }, 7000);
                return;
            }

            let previousPrice = await redisClient.get('previousPrice');
            if (!previousPrice) {
                // Set the initial previous price for the first tick
                await redisClient.set('previousPrice', newPrice);
                previousPrice = newPrice;
            }

            const previousPriceFloat = parseFloat(previousPrice);

            // Calculate the price change percentage
            const priceChangePercentage = ((newPrice - previousPriceFloat) / previousPriceFloat) * 100;

            // Define the price change threshold for multiplier update (±0.04863%)
            const priceChangeThreshold = 0.04863; // ± 0.04863% threshold

            if (Math.abs(priceChangePercentage) <= priceChangeThreshold) {
                const multiplier = parseFloat(await redisClient.get('multiplier')) || parseFloat(initialMultiplier);

                // Prevent further processing if multiplier is less than 1
                if (multiplier < 1.00) return;
                const animateMultiplier = async (currentMultiplier, targetMultiplier, updateMultiplierCallback) => {
                    const incrementStep = 0.01; // Small step to simulate smooth animation
                    const steps = Math.round((targetMultiplier - currentMultiplier) / incrementStep); // Total steps needed
                    const intervalTime = 50; // Time between each step to animate faster
                    let stepCount = 0;

                    return new Promise((resolve) => {
                        const animationInterval = setInterval(async () => {
                            if (stepCount < steps) {
                                // Increase the multiplier by incrementStep towards the target multiplier
                                currentMultiplier = Math.round((currentMultiplier + incrementStep) * 100) / 100; // Round to 2 decimals
                                await updateMultiplierCallback(currentMultiplier); // Update the multiplier in Redis
                                stepCount++;
                            } else {
                                clearInterval(animationInterval); // Stop the animation after completing the steps
                                resolve(); // Notify completion
                            }
                        }, intervalTime);
                    });
                };

                // Calculate the new multiplier by multiplying the current multiplier by 1.05
                const targetMultiplier = multiplier * 1.05;

                // Animate the multiplier to reach the target multiplier smoothly
                await animateMultiplier(multiplier, targetMultiplier, async (updatedMultiplier) => {
                    await redisClient.set('multiplier', updatedMultiplier.toFixed(2)); // Update Redis with the new multiplier
                });

                // Update the previous price with the latest price
                await redisClient.set('previousPrice', newPrice);

                console.log('Multiplier updated:', targetMultiplier.toFixed(2));

            } else {
                // Handle crash
                console.log('Multiplier crashed. Resetting and starting a new round.');
                await redisClient.set('multiplierCrashed', 'true');
                const currentMultiplier = parseFloat(await redisClient.get('multiplier')) || parseFloat(initialMultiplier);
                await redisClient.set('maxMultiplier', currentMultiplier.toFixed(2));
                console.log("Saved maxMultiplier:", currentMultiplier.toFixed(2), "to database")
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
                await redisClient.del('previousPrice');
               
            }
        }
    }
}

module.exports = initializeDerivWebSocket;
