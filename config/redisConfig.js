const Redis = require('ioredis'); // Make sure you're using ioredis

const redisClient = new Redis({
    host: 'localhost',
    port: 6379,
    password: '',
    lazyConnect: true // This prevents automatic connection
});

// Connect only if not already connected
if (!redisClient.status === 'connecting' && !redisClient.status === 'connect') {
    redisClient.connect()
        .then(() => console.log("Connected to Redis!"))
        .catch(err => console.error("Redis connection error:", err));
}

module.exports = redisClient;