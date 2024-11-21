const Redis = require('ioredis');
const redisClient = new Redis(); // Publisher instance
const { Server } = require('socket.io');

function initFrontendSocketServer(socket) {
    // Poll every 500 ms for the multiplier value and emit it
    setInterval(async () => {
        try {
            const multiplier = await redisClient.get('multiplier');
            if (multiplier) {
                socket.emit('multiplier', { multiplier: parseFloat(multiplier) || 1.0 });
                console.log('Multiplier value emitted:', multiplier);
            }
        } catch (err) {
            console.error('Error fetching multiplier from Redis:', err);
        }
    }, 1500);
}

module.exports = initFrontendSocketServer;
