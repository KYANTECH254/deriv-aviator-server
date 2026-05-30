const redisClient = require('../../config/redisConfig');

const KEYS = {
  crashed: 'multiplierCrashed',
  maxMultiplier: 'maxMultiplier',
  multiplier: 'multiplier',
  roundId: 'round_id',
};

const POLL_INTERVAL_MS = Number(process.env.FRONTEND_SOCKET_POLL_MS || 200);
const INITIAL_MULTIPLIER = '1.00';

function formatMultiplier(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : INITIAL_MULTIPLIER;
}

function normalizeCrashState(value) {
  return value === 'true' ? 'true' : 'false';
}

function emitSafe(socket, event, payload) {
  if (socket && socket.connected) {
    socket.emit(event, payload);
  }
}

function initFrontendSocketServer(socket) {
  let previousState = {
    crashed: null,
    maxMultiplier: null,
    multiplier: null,
    roundId: null,
  };

  async function emitCurrentState() {
    try {
      const [crashValue, maxValue, multiplierValue, roundValue] = await Promise.all([
        redisClient.get(KEYS.crashed),
        redisClient.get(KEYS.maxMultiplier),
        redisClient.get(KEYS.multiplier),
        redisClient.get(KEYS.roundId),
      ]);

      const crashed = normalizeCrashState(crashValue);
      const multiplier = formatMultiplier(multiplierValue);
      const maxMultiplier = formatMultiplier(maxValue);
      const roundId = roundValue || '';

      const nextState = {
        crashed,
        maxMultiplier,
        multiplier,
        roundId,
      };

      const crashChanged = nextState.crashed !== previousState.crashed;
      const maxChanged = nextState.maxMultiplier !== previousState.maxMultiplier;
      const multiplierChanged = nextState.multiplier !== previousState.multiplier;
      const roundChanged = nextState.roundId !== previousState.roundId;

      if (crashed === 'true') {
        if (crashChanged || maxChanged || roundChanged) {
          emitSafe(socket, 'maxMultiplier', { value: maxMultiplier });
          emitSafe(socket, 'crashed', { crashed });
          emitSafe(socket, 'round_id', { round_id: roundId });
        }

        previousState = nextState;
        return;
      }

      if (multiplierChanged || crashChanged || roundChanged) {
        emitSafe(socket, 'multiplier', { multiplier });
        emitSafe(socket, 'crashed', { crashed });
        emitSafe(socket, 'round_id', { round_id: roundId });
      }

      previousState = nextState;
    } catch (error) {
      console.error('Frontend socket Redis poll failed:', error);
    }
  }

  emitCurrentState();

  const pollInterval = setInterval(() => {
    emitCurrentState();
  }, POLL_INTERVAL_MS);

  socket.on('disconnect', () => {
    clearInterval(pollInterval);
  });

  return () => {
    clearInterval(pollInterval);
  };
}

module.exports = initFrontendSocketServer;