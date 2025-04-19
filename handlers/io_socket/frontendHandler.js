const redisClient = require('../../config/redisConfig');

function initFrontendSocketServer(socket) {
    let previousCrashState = null;
    let previousMaxMultiplier = null;
    let previousMultiplier = null;
    let previousRoundID = null;

    const pollInterval = setInterval(async () => {
        try {
            const [crashState, maxMultiplier, multiplier, round_id] = await Promise.all([
                redisClient.get('multiplierCrashed'),
                redisClient.get('maxMultiplier'),
                redisClient.get('multiplier'),
                redisClient.get('round_id')
            ]);
            // console.log("Frontend Handler",crashState)
            if (crashState === 'true') {
                if (crashState !== previousCrashState || maxMultiplier !== previousMaxMultiplier || round_id !== previousRoundID) {
                    socket.emit('maxMultiplier', { value: maxMultiplier });
                    socket.emit('crashed', { crashed: crashState });
                    socket.emit('round_id', { round_id: round_id })
                    previousCrashState = crashState;
                    previousMaxMultiplier = maxMultiplier;
                    previousRoundID = round_id;
                }
                return;
            }

            if (multiplier !== previousMultiplier || round_id !== previousRoundID) {
                const formattedMultiplier = parseFloat(multiplier).toFixed(2);
                socket.emit('multiplier', { multiplier: formattedMultiplier });
                socket.emit('crashed', { crashed: crashState });
                socket.emit('round_id', { round_id: round_id })
                console.log("Emitted multiplier:", formattedMultiplier)
                previousMultiplier = multiplier;
                previousCrashState = crashState;
                previousRoundID = round_id;
            }
        } catch (err) {
            console.error('Error fetching multiplier from Redis:', err);
        }
    }, 200);
}

module.exports = initFrontendSocketServer;
