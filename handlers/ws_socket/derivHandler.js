const WebSocket = require('ws');
const prisma = require('../../services/db');
const redisClient = require('../../config/redisConfig');

const INITIAL_MULTIPLIER = 1;
const DERIV_SYMBOL = process.env.DERIV_SYMBOL || 'R_100';
const CRASH_DELAY_MS = Number(process.env.CRASH_DELAY_MS || 7000);
const PING_INTERVAL_MS = Number(process.env.DERIV_PING_INTERVAL_MS || 30000);
const PRICE_CHANGE_THRESHOLD = Number(process.env.PRICE_CHANGE_THRESHOLD || 0.04863);
const DISPLAY_INTERVAL_MS = Number(process.env.DISPLAY_INTERVAL_MS || 50);
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

function initializeDerivWebSocket(io) {
  let ws = null;
  let pingTimer = null;
  let reconnectTimer = null;
  let displayTimer = null;
  let reconnectAttempt = 0;
  let confirmedMultiplier = INITIAL_MULTIPLIER;
  let displayedMultiplier = INITIAL_MULTIPLIER;
  let targetMultiplier = INITIAL_MULTIPLIER;
  let lastEmittedMultiplier = '';
  let isHandlingCrash = false;
  let isWritingDisplay = false;
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

  function stopDisplay() {
    if (displayTimer) {
      clearInterval(displayTimer);
      displayTimer = null;
    }
  }

  function startDisplay() {
    if (displayTimer || isHandlingCrash) {
      return;
    }

    displayTimer = setInterval(async () => {
      if (isHandlingCrash || isWritingDisplay) {
        return;
      }

      const remaining = targetMultiplier - displayedMultiplier;

      if (remaining <= 0.0001) {
        displayedMultiplier = targetMultiplier;

        const formatted = formatMultiplier(displayedMultiplier);

        if (formatted !== lastEmittedMultiplier) {
          lastEmittedMultiplier = formatted;
          await redisClient.set(KEYS.multiplier, formatted);
          emit(io, 'multiplier', { multiplier: formatted });
        }

        stopDisplay();
        return;
      }

      isWritingDisplay = true;

      try {
        const step = Math.max(0.002, remaining * 0.18);

        displayedMultiplier = Math.min(targetMultiplier, displayedMultiplier + step);

        const formatted = formatMultiplier(displayedMultiplier);

        if (formatted !== lastEmittedMultiplier) {
          lastEmittedMultiplier = formatted;
          await redisClient.set(KEYS.multiplier, formatted);
          emit(io, 'multiplier', { multiplier: formatted });
        }
      } catch (error) {
        console.error('Multiplier display update failed:', error);
      } finally {
        isWritingDisplay = false;
      }
    }, DISPLAY_INTERVAL_MS);
  }

  async function setConfirmedMultiplier(value) {
    confirmedMultiplier = value;
    targetMultiplier = value;

    if (displayedMultiplier > targetMultiplier) {
      displayedMultiplier = targetMultiplier;
    }

    startDisplay();
  }

  async function emitMultiplierImmediately(value) {
    const formatted = formatMultiplier(value);

    displayedMultiplier = value;
    targetMultiplier = value;
    confirmedMultiplier = value;
    lastEmittedMultiplier = formatted;

    await redisClient.set(KEYS.multiplier, formatted);
    emit(io, 'multiplier', { multiplier: formatted });
  }

  async function resetRoundState() {
    stopDisplay();

    confirmedMultiplier = INITIAL_MULTIPLIER;
    displayedMultiplier = INITIAL_MULTIPLIER;
    targetMultiplier = INITIAL_MULTIPLIER;
    lastEmittedMultiplier = formatMultiplier(INITIAL_MULTIPLIER);

    await Promise.all([
      redisClient.set(KEYS.crashed, 'false'),
      redisClient.set(KEYS.multiplier, lastEmittedMultiplier),
      redisClient.set(KEYS.maxMultiplier, lastEmittedMultiplier),
      redisClient.del(KEYS.previousPrice),
    ]);

    emit(io, 'crashed', { crashed: 'false' });
    emit(io, 'multiplier', { multiplier: lastEmittedMultiplier });

    console.log('Multiplier reset to:', lastEmittedMultiplier);
  }

  async function handleCrash() {
    if (isHandlingCrash) {
      return;
    }

    isHandlingCrash = true;
    stopDisplay();

    const maxMultiplier = formatMultiplier(confirmedMultiplier);

    try {
      await Promise.all([
        redisClient.set(KEYS.crashed, 'true'),
        redisClient.set(KEYS.maxMultiplier, maxMultiplier),
        redisClient.set(KEYS.multiplier, maxMultiplier),
        redisClient.del(KEYS.previousPrice),
      ]);

      displayedMultiplier = confirmedMultiplier;
      targetMultiplier = confirmedMultiplier;
      lastEmittedMultiplier = maxMultiplier;

      emit(io, 'multiplier', { multiplier: maxMultiplier });
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
      await emitMultiplierImmediately(INITIAL_MULTIPLIER);
      return;
    }

    const priceChangePercentage = ((newPrice - previousPrice) / previousPrice) * 100;

    console.log('Tick state:', {
      crashState,
      previousPriceValue,
      newPrice,
      priceChangePercentage,
      confirmedMultiplier: formatMultiplier(confirmedMultiplier),
    });

    if (Math.abs(priceChangePercentage) > PRICE_CHANGE_THRESHOLD) {
      console.log('Crash triggered:', {
        priceChangePercentage,
        threshold: PRICE_CHANGE_THRESHOLD,
        maxMultiplier: formatMultiplier(confirmedMultiplier),
      });

      await handleCrash();
      return;
    }

    const nextMultiplier = confirmedMultiplier * 1.05;

    await redisClient.set(KEYS.previousPrice, String(newPrice));
    await setConfirmedMultiplier(nextMultiplier);

    console.log('Confirmed multiplier target:', {
      from: formatMultiplier(confirmedMultiplier / 1.05),
      to: formatMultiplier(nextMultiplier),
    });
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
      stopDisplay();
      clearPing();
      scheduleReconnect();
    });
  }

  function close() {
    stopped = true;

    stopDisplay();
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