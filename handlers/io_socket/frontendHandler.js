const Redis = require('ioredis');
const redisClient = new Redis();

function initFrontendSocketServer(socket) {
    let previousCrashState = null;
    let previousMaxMultiplier = null;
    let previousMultiplier = null;

    const pollInterval = setInterval(async () => {
        try {
            const [crashState, maxMultiplier, multiplier] = await Promise.all([
                redisClient.get('multiplierCrashed'),
                redisClient.get('maxMultiplier'),
                redisClient.get('multiplier')
            ]);
            // console.log("Frontend Handler",crashState)
            if (crashState === 'true') {
                if (crashState !== previousCrashState || maxMultiplier !== previousMaxMultiplier) {
                    socket.emit('maxMultiplier', { value: maxMultiplier });
                    socket.emit('crashed', { crashed: crashState });
                    previousCrashState = crashState;
                    previousMaxMultiplier = maxMultiplier;
                }
                return;
            }

            if (multiplier !== previousMultiplier) {
                const formattedMultiplier = parseFloat(multiplier).toFixed(2);
                socket.emit('multiplier', { multiplier: formattedMultiplier });
                socket.emit('crashed', { crashed: crashState });
                previousMultiplier = multiplier;
                previousCrashState = crashState;
            }
        } catch (err) {
            console.error('Error fetching multiplier from Redis:', err);
        }
    }, 50);
}

module.exports = initFrontendSocketServer;
