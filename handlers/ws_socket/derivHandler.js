const WebSocket = require('ws');
const Redis = require('ioredis');
const redisClient = new Redis();
const initialMultiplier = 1.00;
const prisma = require('../../services/db');
let isHandlingCrash = false;

function initializeDerivWebSocket(server) {
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

    let isHandlingCrash = false;
    let newround_id = '';

    async function handleTickData(message) {
        if (message.tick && message.tick.symbol === 'R_100') {
            const newPrice = parseFloat(message.tick.quote);

            try {
                // Fetch Redis values in a single operation for efficiency
                const [crashState, multiplierValue, previousPriceValue] = await Promise.all([
                    redisClient.get('multiplierCrashed'),
                    redisClient.get('multiplier'),
                    redisClient.get('previousPrice')
                ]);

                const multiplier = parseFloat(multiplierValue) || parseFloat(initialMultiplier);
                let previousPrice = previousPriceValue ? parseFloat(previousPriceValue) : null;
                console.log("Deriv Handler", crashState);

                // If a crash is detected, we need to wait for 7 seconds before resetting
                if (crashState === 'true' && !isHandlingCrash) {
                    console.log('Multiplier crashed. Waiting 7 seconds before resetting...');
                    
                    isHandlingCrash = true;

                    // Use setTimeout to handle the reset after 7 seconds
                    setTimeout(async () => {
                        try {
                            // Reset crash state and multiplier after 7 seconds
                            await redisClient.set('multiplierCrashed', 'false');
                            await redisClient.set('maxMultiplier', 1.00);
                            await redisClient.set('multiplier', 1.00);
                            console.log('Crash handled. Ready for the next round.');
                            isHandlingCrash = false;
                        } catch (error) {
                            console.error('Error resetting crash state:', error);
                        }
                    }, 7000);

                    return;  // Skip further tick processing while handling crash state
                }

                if (!isHandlingCrash) {
                    // Set previous price if not already set
                    if (!previousPrice) {
                        await redisClient.set('previousPrice', newPrice);
                        previousPrice = newPrice;
                    }

                    // Calculate percentage change
                    const priceChangePercentage = ((newPrice - previousPrice) / previousPrice) * 100;
                    const priceChangeThreshold = 0.04863; // Default threshold for price change

                    if (Math.abs(priceChangePercentage) <= priceChangeThreshold) {
                        const targetMultiplier = multiplier * 1.05;

                        // Smooth animation to update multiplier
                        await animateMultiplier(multiplier, targetMultiplier, async (updatedMultiplier) => {
                            await redisClient.set('multiplier', updatedMultiplier.toFixed(2));
                        });

                        // Update previous price
                        await redisClient.set('previousPrice', newPrice);
                        console.log('Multiplier updated to:', targetMultiplier.toFixed(2));
                    } else {
                        // Handle crash if price change exceeds threshold
                        console.log('Multiplier crashed. Resetting...');
                        await redisClient.set('multiplierCrashed', 'true');

                        const currentMultiplier = parseFloat(await redisClient.get('multiplier')) || parseFloat(initialMultiplier);
                        await redisClient.set('maxMultiplier', currentMultiplier.toFixed(2));

                        // Update the previous round in the database
                        const previousRound = await prisma.multiplier.findFirst({ orderBy: { createdAt: 'desc' } });
                        if (previousRound) {
                            await prisma.multiplier.update({
                                where: { id: previousRound.id },
                                data: { value: currentMultiplier.toFixed(2) }
                            });
                        } else {
                            await prisma.multiplier.create({
                                data: {
                                    value: '', // Initial value for the new round
                                    appId: process.env.DERIV_ID
                                }
                            });
                        }

                        // Create a new round for the next game
                        const created_bet = await prisma.multiplier.create({
                            data: {
                                value: '', // Initial value for the new round
                                appId: process.env.DERIV_ID
                            }
                        });
                        if (created_bet) {
                            newround_id = await prisma.multiplier.findFirst({
                                where: {
                                    id: created_bet.id,
                                }
                            });
                            await redisClient.set('round_id', newround_id.id);
                        }

                        // Reset multiplier and previous price
                        await redisClient.set('multiplier', initialMultiplier);
                        await redisClient.del('previousPrice');
                    }
                }
            } catch (error) {
                console.error('Error handling tick data:', error);
            }
        }
    }


    // Smooth animation for multiplier updates
    async function animateMultiplier(currentMultiplier, targetMultiplier, updateMultiplierCallback) {
        const incrementStep = 0.01;
        const steps = Math.round((targetMultiplier - currentMultiplier) / incrementStep);
        const intervalTime = Math.max(10, 1000 / steps); // Calculate interval dynamically for smoother animation

        return new Promise((resolve) => {
            let stepCount = 0;
            const animationInterval = setInterval(async () => {
                try {
                    if (stepCount < steps) {
                        currentMultiplier = Math.round((currentMultiplier + incrementStep) * 100) / 100;
                        await updateMultiplierCallback(currentMultiplier);
                        stepCount++;
                    } else {
                        clearInterval(animationInterval);
                        resolve();
                    }
                } catch (error) {
                    console.error('Error animating multiplier:', error);
                    clearInterval(animationInterval);
                    resolve();
                }
            }, intervalTime);
        });
    }

}

module.exports = initializeDerivWebSocket;
