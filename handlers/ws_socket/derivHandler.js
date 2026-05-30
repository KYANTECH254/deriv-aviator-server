const WebSocket = require('ws');
const prisma = require('../../services/db');
const redisClient = require('../../config/redisConfig');

const INITIAL_MULTIPLIER = 1;
const DERIV_SYMBOL = process.env.DERIV_SYMBOL || 'R_100';
const CRASH_DELAY_MS = Number(process.env.CRASH_DELAY_MS || 7000);
const PING_INTERVAL_MS = Number(process.env.DERIV_PING_INTERVAL_MS || 30000);
const PRICE_CHANGE_THRESHOLD = Number(process.env.PRICE_CHANGE_THRESHOLD || 0.04863);
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
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function initializeDerivWebSocket(io) {
  let ws = null;
  let pingTimer = null;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let isHandlingCrash = false;
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

  async function finishCrashCooldown() {
    if (isHandlingCrash) {
      return;
    }

    isHandlingCrash = true;

    try {
      await wait(CRASH_DELAY_MS);

      await Promise.all([
        redisClient.set(KEYS.crashed, 'false'),
        redisClient.set(KEYS.multiplier, formatMultiplier(INITIAL_MULTIPLIER)),
        redisClient.set(KEYS.maxMultiplier, formatMultiplier(INITIAL_MULTIPLIER)),
        redisClient.del(KEYS.previousPrice),
      ]);
    } catch (error) {
      console.error('Crash cooldown failed:', error);
    } finally {
      isHandlingCrash = false;
    }
  }

  async function handleCrash(multiplier) {
    if (isHandlingCrash) {
      return;
    }

    isHandlingCrash = true;

    const maxMultiplier = formatMultiplier(multiplier);

    try {
      await Promise.all([
        redisClient.set(KEYS.crashed, 'true'),
        redisClient.set(KEYS.maxMultiplier, maxMultiplier),
        redisClient.set(KEYS.multiplier, formatMultiplier(INITIAL_MULTIPLIER)),
        redisClient.del(KEYS.previousPrice),
      ]);

      emit(io, 'maxMultiplier', maxMultiplier);

      try {
        await persistRound(maxMultiplier);
      } catch (error) {
        console.error('Failed to persist multiplier round:', error);
      }

      await wait(CRASH_DELAY_MS);

      await Promise.all([
        redisClient.set(KEYS.crashed, 'false'),
        redisClient.set(KEYS.multiplier, formatMultiplier(INITIAL_MULTIPLIER)),
        redisClient.set(KEYS.maxMultiplier, formatMultiplier(INITIAL_MULTIPLIER)),
      ]);
    } catch (error) {
      console.error('Failed to handle crash:', error);
    } finally {
      isHandlingCrash = false;
    }
  }

  async function animateMultiplier(currentMultiplier, targetMultiplier) {
    const start = parseNumber(currentMultiplier, INITIAL_MULTIPLIER);
    const end = parseNumber(targetMultiplier, INITIAL_MULTIPLIER);
    const step = 0.01;
    const steps = Math.max(1, Math.round((end - start) / step));
    const interval = Math.max(10, Math.round(1000 / steps));

    let value = start;

    for (let index = 0; index < steps; index += 1) {
      value = Math.min(end, value + step);

      const formatted = formatMultiplier(value);

      await redisClient.set(KEYS.multiplier, formatted);
      emit(io, 'multiplier', formatted);
      await wait(interval);
    }

    await redisClient.set(KEYS.multiplier, formatMultiplier(end));
    emit(io, 'multiplier', formatMultiplier(end));
  }

  async function handleTick(message) {
    if (message?.tick?.symbol !== DERIV_SYMBOL) {
      return;
    }

    const newPrice = parseNumber(message.tick.quote);

    if (!newPrice || newPrice <= 0) {
      return;
    }

    const [crashState, multiplierValue, previousPriceValue] = await Promise.all([
      redisClient.get(KEYS.crashed),
      redisClient.get(KEYS.multiplier),
      redisClient.get(KEYS.previousPrice),
    ]);

    if (crashState === 'true') {
      await finishCrashCooldown();
      return;
    }

    if (isHandlingCrash) {
      return;
    }

    const multiplier = parseNumber(multiplierValue, INITIAL_MULTIPLIER);
    const previousPrice = parseNumber(previousPriceValue);

    if (!previousPrice || previousPrice <= 0) {
      await redisClient.set(KEYS.previousPrice, String(newPrice));
      return;
    }

    const priceChangePercentage = ((newPrice - previousPrice) / previousPrice) * 100;

    if (Math.abs(priceChangePercentage) <= PRICE_CHANGE_THRESHOLD) {
      const targetMultiplier = multiplier * 1.05;

      await animateMultiplier(multiplier, targetMultiplier);
      await redisClient.set(KEYS.previousPrice, String(newPrice));

      return;
    }

    await handleCrash(multiplier);
  }

  async function handleMessage(payload, socket) {
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
      sendJson(socket, {
        subscribe: 1,
        ticks: DERIV_SYMBOL,
      });

      return;
    }

    await handleTick(message);
  }

  function clearPing() {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  function scheduleReconnect() {
    if (stopped) {
      return;
    }

    const delay = Math.min(RECONNECT_MIN_MS * 2 ** reconnectAttempt, RECONNECT_MAX_MS);

    reconnectAttempt += 1;
    reconnectTimer = setTimeout(connect, delay);
  }

  function connect() {
    clearPing();

    ws = new WebSocket(`${SOCKET_URL}?app_id=${DERIV_ID}`);

    ws.on('open', () => {
      reconnectAttempt = 0;

      sendJson(ws, {
        authorize: TOKEN,
      });

      pingTimer = setInterval(() => {
        sendJson(ws, { ping: 1 });
      }, PING_INTERVAL_MS);
    });

    ws.on('message', (payload) => {
      handleMessage(payload, ws).catch((error) => {
        console.error('Failed to handle Deriv message:', error);
      });
    });

    ws.on('error', (error) => {
      console.error('Deriv WebSocket error:', error);
    });

    ws.on('close', () => {
      clearPing();
      scheduleReconnect();
    });
  }

  function close() {
    stopped = true;

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