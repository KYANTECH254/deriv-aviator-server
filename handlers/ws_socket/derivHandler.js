const WebSocket = require('ws');
const prisma = require('../../services/db');
const redisClient = require('../../config/redisConfig');

const INITIAL_MULTIPLIER = 1;
const DERIV_SYMBOL = process.env.DERIV_SYMBOL || 'R_100';
const CRASH_DELAY_MS = Number(process.env.CRASH_DELAY_MS || 7000);
const PING_INTERVAL_MS = Number(process.env.DERIV_PING_INTERVAL_MS || 30000);
const PRICE_CHANGE_THRESHOLD = Number(process.env.PRICE_CHANGE_THRESHOLD || 0.04863);
const COUNTER_INTERVAL_MS = Number(process.env.COUNTER_INTERVAL_MS || 50);
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;

const KEYS = {
  crashed: 'multiplierCrashed',
  multiplier: 'multiplier',
  maxMultiplier: 'maxMultiplier',
  previousPrice: 'previousPrice',
  roundId: 'round_id',
};

function requiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const SOCKET_URL = requiredEnv('SOCKET_URL');
const DERIV_ID = requiredEnv('DERIV_ID');
const TOKEN = requiredEnv('TOKEN');

function formatMultiplier(value) {
  return Number(value || INITIAL_MULTIPLIER).toFixed(2);
}

function parseNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emit(io, event, payload) {
  if (io && typeof io.emit === 'function') {
    io.emit(event, payload);
  }
}

function sendJson(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function getCounterStep(multiplier) {
  if (multiplier < 2) return 0.01;
  if (multiplier < 10) return 0.02;
  if (multiplier < 20) return 0.03;
  if (multiplier < 50) return 0.05;
  if (multiplier < 100) return 0.08;
  return 0.1;
}

function initializeDerivWebSocket(io) {
  let ws = null;
  let pingTimer = null;
  let reconnectTimer = null;
  let counterTimer = null;
  let reconnectAttempt = 0;
  let currentMultiplier = INITIAL_MULTIPLIER;
  let isHandlingCrash = false;
  let isWritingMultiplier = false;
  let stopped = false;

  async function persistRound(multiplier) {
    const appId = String(DERIV_ID);
    const value = formatMultiplier(multiplier);
    const roundId = await redisClient.get(KEYS.roundId);

    let currentRound = null;

    if (roundId) {
      currentRound = await prisma.multiplier
        .update({
          where: { id: roundId },
          data: { value },
        })
        .catch(() => null);
    }

    if (!currentRound) {
      const latestRound = await prisma.multiplier.findFirst({
        where: { appId },
        orderBy: { createdAt: 'desc' },
      });

      if (latestRound) {
        currentRound = await prisma.multiplier.update({
          where: { id: latestRound.id },
          data: { value },
        });
      }
    }

    if (!currentRound) {
      await prisma.multiplier.create({
        data: { value, appId },
      });
    }

    const nextRound = await prisma.multiplier.create({
      data: { value: '', appId },
    });

    await redisClient.set(KEYS.roundId, nextRound.id);
  }

  function stopCounter() {
    if (counterTimer) {
      clearInterval(counterTimer);
      counterTimer = null;
    }
  }

  function startCounter() {
    if (counterTimer || isHandlingCrash) {
      return;
    }

    counterTimer = setInterval(async () => {
      if (isHandlingCrash || isWritingMultiplier) {
        return;
      }

      isWritingMultiplier = true;

      try {
        currentMultiplier += getCounterStep(currentMultiplier);

        const formatted = formatMultiplier(currentMultiplier);

        await redisClient.set(KEYS.multiplier, formatted);
        emit(io, 'multiplier', { multiplier: formatted });
      } catch (error) {
        console.error('Counter update failed:', error);
      } finally {
        isWritingMultiplier = false;
      }
    }, COUNTER_INTERVAL_MS);
  }

  async function resetRoundState() {
    stopCounter();

    currentMultiplier = INITIAL_MULTIPLIER;

    const initialValue = formatMultiplier(INITIAL_MULTIPLIER);

    await Promise.all([
      redisClient.set(KEYS.crashed, 'false'),
      redisClient.set(KEYS.multiplier, initialValue),
      redisClient.set(KEYS.maxMultiplier, initialValue),
      redisClient.del(KEYS.previousPrice),
    ]);

    emit(io, 'crashed', { crashed: 'false' });
    emit(io, 'multiplier', { multiplier: initialValue });

    console.log('Multiplier reset to:', initialValue);
  }

  async function handleCrash() {
    if (isHandlingCrash) {
      return;
    }

    isHandlingCrash = true;
    stopCounter();

    const maxMultiplier = formatMultiplier(currentMultiplier);

    try {
      await Promise.all([
        redisClient.set(KEYS.crashed, 'true'),
        redisClient.set(KEYS.maxMultiplier, maxMultiplier),
        redisClient.set(KEYS.multiplier, maxMultiplier),
        redisClient.del(KEYS.previousPrice),
      ]);

      emit(io, 'crashed', { crashed: 'true' });
      emit(io, 'maxMultiplier', { value: maxMultiplier });

      try {
        await persistRound(maxMultiplier);
      } catch (error) {
        console.error('Failed to persist multiplier round:', error);
      }

      await wait(CRASH_DELAY_MS);
      await resetRoundState();
    } catch (error) {
      console.error('Failed to handle crash:', error);
    } finally {
      isHandlingCrash = false;
    }
  }

  async function handleTick(message) {
    if (message?.tick?.symbol !== DERIV_SYMBOL) {
      return;
    }

    const newPrice = parseNumber(message.tick.quote);

    if (!newPrice || newPrice <= 0) {
      return;
    }

    const [crashState, previousPriceValue] = await Promise.all([
      redisClient.get(KEYS.crashed),
      redisClient.get(KEYS.previousPrice),
    ]);

    if (crashState === 'true' || isHandlingCrash) {
      return;
    }

    const previousPrice = parseNumber(previousPriceValue);

    if (!previousPrice || previousPrice <= 0) {
      await redisClient.set(KEYS.previousPrice, String(newPrice));
      startCounter();
      return;
    }

    const priceChangePercentage = ((newPrice - previousPrice) / previousPrice) * 100;

    if (Math.abs(priceChangePercentage) <= PRICE_CHANGE_THRESHOLD) {
      await redisClient.set(KEYS.previousPrice, String(newPrice));
      startCounter();
      return;
    }

    console.log('Crash triggered:', {
      priceChangePercentage,
      threshold: PRICE_CHANGE_THRESHOLD,
      maxMultiplier: formatMultiplier(currentMultiplier),
    });

    await handleCrash();
  }

  async function handleMessage(payload) {
    let message;

    try {
      message = JSON.parse(payload.toString());
    } catch (error) {
      console.error('Invalid Deriv message:', error);
      return;
    }

    if (message.error) {
      console.error('Deriv API error:', message.error);
      return;
    }

    if (message.msg_type === 'authorize') {
      console.log('Deriv authorization successful');
      return;
    }

    if (message.msg_type === 'tick') {
      await handleTick(message);
    }
  }

  function clearPing() {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) {
      return;
    }

    const delay = Math.min(RECONNECT_MIN_MS * 2 ** reconnectAttempt, RECONNECT_MAX_MS);

    reconnectAttempt += 1;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect() {
    clearPing();

    ws = new WebSocket(`${SOCKET_URL}?app_id=${DERIV_ID}`);

    ws.on('open', () => {
      reconnectAttempt = 0;

      console.log('Connected to Deriv WebSocket API');

      sendJson(ws, {
        authorize: TOKEN,
      });

      sendJson(ws, {
        subscribe: 1,
        ticks: DERIV_SYMBOL,
      });

      resetRoundState().catch((error) => {
        console.error('Failed to reset round state:', error);
      });

      pingTimer = setInterval(() => {
        sendJson(ws, { ping: 1 });
      }, PING_INTERVAL_MS);
    });

    ws.on('message', (payload) => {
      handleMessage(payload).catch((error) => {
        console.error('Failed to handle Deriv message:', error);
      });
    });

    ws.on('error', (error) => {
      console.error('Deriv WebSocket error:', error);
    });

    ws.on('close', () => {
      stopCounter();
      clearPing();
      scheduleReconnect();
    });
  }

  function close() {
    stopped = true;

    stopCounter();
    clearPing();

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (ws) {
      ws.close();
      ws = null;
    }
  }

  connect();

  return { close };
}

module.exports = initializeDerivWebSocket;