const Redis = require('ioredis');
const redisClient = new Redis(); 

function initFrontendSocketServer(socket) {
    const pollInterval = setInterval(async () => {
        try {
            const crashState = await redisClient.get('multiplierCrashed');
            const value = await redisClient.get('maxMultiplier');

            // If crashedState is true, stop handling any further ticks
            if (crashState === 'true') {
                socket.emit('maxMultiplier', { value: value });
                socket.emit('crashed', { crashed: crashState });
                console.log('Multiplier is in crashed state. Waiting for reset...');
                return; 
            }

            // If not crashed, fetch the multiplier value and emit it
            const multiplier = await redisClient.get('multiplier');
            if (multiplier) {
                const formattedMultiplier = parseFloat(multiplier).toFixed(2); // Fix precision to 2 decimal places
                socket.emit('multiplier', { multiplier: formattedMultiplier });
                socket.emit('crashed', { crashed: crashState });
                console.log('Multiplier value emitted:', formattedMultiplier);
            }
        } catch (err) {
            console.error('Error fetching multiplier from Redis:', err);
        }
    }, 50); // Polling every 500ms
}

module.exports = initFrontendSocketServer;
