const { Server } = require('socket.io');
const prisma = require('../../services/db');
const Redis = require('ioredis');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const initFrontendSocketServer = require('./frontendHandler');
const fs = require('fs');

const redis = new Redis({
    host: 'eu-west-webserver-service-manager.topwebtools.online',
    port: 6379,
    password: 'Sss333123kyan'
});

redis.ping()
    .then(() => console.log("Connected to Redis!"))
    .catch(err => console.error("Failed to connect:", err));

let userCount = 0;

const getCookie = (cookieHeader, cookieName) => {
    const match = cookieHeader && cookieHeader.match(new RegExp(`(^| )${cookieName}=([^;]+)`));
    return match ? match[2] : null;
};

// async function deleteAllFromModel() {
//     try {
//         await prisma.multiplier.deleteMany(); // Replace 'yourModelName' with your actual model name
//         console.log('All data deleted successfully.');
//     } catch (error) {
//         console.error('Error deleting data:', error);
//     } finally {
//         await prisma.$disconnect(); // Disconnect the client after operation
//     }
// }

// deleteAllFromModel();

// Function to verify user by auth_token

const verifyUser = async (authToken) => {
    try {
        const decoded = jwt.verify(authToken, process.env.JWT_SECRET);

        if (!decoded) {
            console.log('Token expired');
            return null;
        }

        return await prisma.user.findUnique({ where: { auth_token: authToken } });
    } catch (error) {
        console.error('Error verifying user:', error);
        return null;
    }
};

const authenticateUser = async (socket, authToken) => {
    if (!authToken) {
        socket.emit('error', 'Authentication token not provided');
        return null;
    }

    try {
        const user = await verifyUser(authToken);
        if (!user) {
            socket.emit('error', 'Authentication failed');
            return null;
        }
        return user;
    } catch (error) {
        console.error('Error during user authentication:', error);
        socket.emit('error', 'Authentication error');
        return null;
    }
};

const fetchLiveBets = async (socket) => {

    try {
        // Fetch the latest multiplier (representing the current round)
        const latestMultiplier = await prisma.multiplier.findFirst({
            orderBy: { id: 'desc' },
        });

        if (!latestMultiplier) {
            console.log('No multiplier found.');
            socket.emit('live-bets', {
                round_id: null,
                bets: [],
                totalBetsCount: 0,
                previousRoundBets: [],
                totalPreviousBetsCount: 0,
            });
            return;
        }
        // Fetch live bets for the latest round
        const liveBets = await prisma.bet.findMany({
            where: { round_id: latestMultiplier.id.toString() },
            orderBy: { bet_amount: 'desc' },
        });

        // Calculate the total number of bets for the latest round
        const totalBetsCount = liveBets.length;

        // Fetch the previous round's multiplier
        const previousRoundMultiplier = await prisma.multiplier.findFirst({
            where: { id: { lt: latestMultiplier.id } }, // Get the previous multiplier by ID
            orderBy: { id: 'desc' },
        });

        // Fetch the previous round's bets
        const previousRoundBets = previousRoundMultiplier
            ? await prisma.bet.findMany({
                where: { round_id: previousRoundMultiplier.id.toString() },
                orderBy: { bet_amount: 'desc' },
            })
            : [];

        // Calculate the total number of bets for the previous round
        const totalPreviousBetsCount = previousRoundBets.length;

        // Emit live bets data
        socket.emit('live-bets', {
            round_id: latestMultiplier.id.toString(),
            bets: liveBets,
            totalBetsCount,
            previousRoundBets,
            totalPreviousBetsCount,
        });

    } catch (error) {
        console.error('Error fetching round data:', error);
        socket.emit('live-bets', {
            round_id: null,
            bets: [],
            totalBetsCount: 0,
            previousRoundBets: [],
            totalPreviousBetsCount: 0,
        });
    }
};

const placeBet = async (socket) => {
    socket.on('new-bet', async (bet) => {
        try {
            if (bet === "") return;
            const { round_id, code, appId } = bet;

            const existingbet = await prisma.bet.findFirst({
                where: {
                    round_id: round_id,
                    code: code,
                    appId: appId,
                },
            });

            if (existingbet) {
                const updatedexistingbet = await prisma.bet.update({
                    where: {
                        id: existingbet.id,
                    },
                    data: bet,
                });
                socket.emit('bet-updated', updatedexistingbet);
                emitAllBetsData(socket)
                fetchLiveBets(socket);
                return;
            }

            const createdBet = await prisma.bet.create({
                data: bet,
            });

            socket.emit('bet-updated', createdBet);
            emitAllBetsData(socket)
            fetchLiveBets(socket);
        } catch (error) {
            console.error('Error creating new bet:', error);
        }
    });
}

const emitUserDataByToken = async (socket, authToken) => {
    try {
        const user = await verifyUser(authToken);

        if (!user) {
            socket.emit('error', 'Invalid or missing authentication token');
            return;
        }

        socket.emit('username', { username: user.username });
    } catch (error) {
        console.error('Error fetching user data:', error);
        socket.emit('error', 'Failed to fetch user data');
    }
};

const emitMultiplierData = async (socket) => {
    try {
        const multipliers = await prisma.multiplier.findMany();
        socket.emit('multiplier_data', multipliers);

    } catch (error) {
        console.error('Error fetching multiplier data:', error);
        socket.emit('error', 'Failed to fetch multiplier data');
    }
};

const emitAllBetsData = async (socket) => {
    try {
        const bets = await prisma.bet.findMany();
        socket.emit('bets_data', bets);
    } catch (error) {
        console.error('Error fetching or emitting bets:', error);
    }
};

const handleChat = (socket, authToken) => {
    const MAX_MESSAGES = 100

    socket.on('join_chat', async (appId) => {
        try {
            console.log('Joining chat, verifying user...');

            const user = await verifyUser(authToken);
            if (!user) {
                console.log('Authentication failed for user:', authToken);
                socket.emit('error', 'Authentication failed');
                return;
            }

            if (!appId) {
                console.log('Missing Chat ID');
                socket.emit('error', 'Missing Chat ID');
                return;
            }

            const redisKey = `chat_count:${appId}`;
            socket.join(appId);
            console.log(`User ${user.userId} joined chat ${appId}`);

            // Increment user count
            const userCount = await redis.incr(redisKey);
            console.log(`User joined chat ${appId}, count: ${userCount}`);

            // Notify all clients of the updated user count
            socket.emit('chat_count', userCount);

            console.log(`Fetching recent messages for room: ${appId}`);
            const recentMessages = await redis.lrange(`chat:${appId}`, 0, MAX_MESSAGES - 1);

            if (recentMessages.length === 0) {
                console.log(`No messages found in chat room ${appId}`);
            }

            // Process each message to fetch like count and user like status
            const messagesWithLikes = await Promise.all(recentMessages.map(async (msg) => {
                const message = JSON.parse(msg); // Parse the JSON string stored in Redis

                const likeCountKey = `chat:${appId}:message:${message.messageId}:likes`;
                const userLikesKey = `chat:${appId}:message:${message.messageId}:liked_users`;

                // Fetch total like count
                const totalLikes = await redis.get(likeCountKey);
                const likes = totalLikes ? parseInt(totalLikes, 10) : 0;

                const likedUsers = await redis.smembers(userLikesKey); // Fetch all users in the set
                console.log(`Liked Users for Message ${message.messageId}:`, likedUsers);

                // Check if the current user has liked this message
                const userHasLiked = await redis.sismember(userLikesKey, user.userId);

                // Add like info to the message
                return {
                    ...message,
                    likeCount: likes,
                    userHasLiked: userHasLiked === 1, // Convert Redis 1/0 to boolean
                };
            }));

            // Reverse the messages and emit
            const reversedMessages = messagesWithLikes.reverse(); // No need for JSON.parse() here
            socket.emit('receive_message', reversedMessages);

            console.log(`Messages with Likes:`, reversedMessages);
        } catch (error) {
            console.error('Error handling chat join:', error);
            socket.emit('error', 'Failed to join chat');
        }
    });


    socket.on('send_message', async (data) => {
        try {
            console.log('Sending message, verifying user...');

            const user = await verifyUser(authToken);
            if (!user) {
                console.log('Authentication failed for user:', authToken);
                socket.emit('error', 'Authentication failed');
                return;
            }

            const { appId, message, url, gifUrl, messageId, betData } = data;
            console.log(data)
            if (!appId) {
                console.log('Missing room ID');
                socket.emit('error', 'Missing room ID');
                return;
            }

            const msg = { userId: user.username, message, url, gifUrl, messageId, betData, timestamp: Date.now() };
            console.log('Message to be sent:', msg);

            // Add message to Redis
            try {
                console.log(`Adding message to Redis for chat room: ${appId}`);
                await redis.lpush(`chat:${appId}`, JSON.stringify(msg));
                console.log('Message added to Redis');

                // Limit the list to the maximum number of messages
                await redis.ltrim(`chat:${appId}`, 0, MAX_MESSAGES - 1);
                console.log(`Trimmed messages in Redis to the latest ${MAX_MESSAGES} messages`);

                // Broadcast to the room
                await socket.to(appId).emit('receive_message', [msg]);
                console.log(`Message Broadcasted: ${[msg]}`)
            } catch (redisError) {
                console.error('Error saving message to Redis:', redisError);
                socket.emit('error', 'Failed to save message');
            }
        } catch (error) {
            console.error('Error sending message:', error);
            socket.emit('error', 'Failed to send message');
        }
    });

    // Handle toggling like/unlike for a message
    socket.on('toggle_like_message', async (data) => {
        const { appId, messageId, userId } = data;
        const likeCountKey = `chat:${appId}:message:${messageId}:likes`;
        const userLikesKey = `chat:${appId}:message:${messageId}:liked_users`;

        // Check if user has already liked
        const alreadyLiked = await redis.sismember(userLikesKey, userId);

        let newLikeCount = 0;
        if (alreadyLiked) {
            // User is unliking the message
            await redis.srem(userLikesKey, userId);
            newLikeCount = await redis.decr(likeCountKey);  // Decrease like count
        } else {
            // User is liking the message
            await redis.sadd(userLikesKey, userId);
            newLikeCount = await redis.incr(likeCountKey);  // Increase like count
        }

        // Emit the updated like count and user like status to all users in the room
        socket.emit('update_like_count', {
            messageId,
            likeCount: newLikeCount,
            userHasLiked: !alreadyLiked,  // New like status
        });
    });


    socket.on('leave_chat', async (appId) => {
        try {
            if (!appId) {
                console.log('Missing Chat ID for leave_chat');
                return;
            }

            const redisKey = `chat_count:${appId}`;
            const userCount = await redis.decr(redisKey);

            // Ensure the count doesn't go negative
            if (userCount < 0) {
                await redis.set(redisKey, 0);
            }

            console.log(`User left chat ${appId}, count: ${Math.max(userCount, 0)}`);

            // Notify all clients of the updated user count
            socket.emit('chat_count', Math.max(userCount, 0));
        } catch (error) {
            console.error('Error leaving chat:', error);
        }
    });
};

const initFunctionsOnLiveData = async (socket) => {
    socket.on("load-live-bets", async (data) => {
        try {
            console.log('Loading live bets...');
            await fetchLiveBets(socket);
            await emitMultiplierData(socket);
            await emitAllBetsData(socket);
        } catch (err) {
            console.error('Error loading live bets:', err);
        }
    })
};

const initSocketServer = (httpServer) => {
    const io = new Server(httpServer, {
        pingInterval: 25000,
        pingTimeout: 60000,
        cors: {
            origin: ['*'],
            methods: ['GET', 'POST'],
        },
        allowEIO3: true,
    });

    io.on('connection', async (socket) => {
        console.log('New client connected');
        userCount++;
        io.emit('userCount', userCount);

        const pingInterval = setInterval(() => {
            socket.emit('ping');
        }, 25000);

        const requestedUrl = socket.handshake.headers.referer;

        if (requestedUrl?.includes('https://api-deriv-aviator.topwebtools.online')) {
            socket.emit('info', 'Connected as guest');
            socket.on('disconnect', () => {
                clearInterval(pingInterval);
                console.log('Guest disconnected');
                userCount--;
                io.emit('userCount', userCount);
            });
            return;
        }

        // const authToken = socket.handshake.headers.cookie?.match(/token=(\S+);?/)[1]; 
        // const authToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJWUlRDMTAwMzI2MDkiLCJhcHBJZCI6IjEwODkiLCJ0b2tlbiI6ImExLU5yTHN0elBycURicjlHSGNPeUo3TkQ5YjF5YVBJIiwiaWF0IjoxNzMyMzAwMDE2fQ.u3ky2FJKUsSQ5tDncQBIFcxklJwFZmMyDnkkz1Wq2Ok"
        // console.log('authToken:', authToken)

        try {
            const user = await authenticateUser(socket, authToken);
            if (!user) {
                socket.disconnect();
                return;
            }

            console.log('User authenticated:', user.id);
            await emitUserDataByToken(socket, authToken);

            await placeBet(socket);
            handleChat(socket, authToken);
            await emitAllBetsData(socket);
            await emitMultiplierData(socket);
            await fetchLiveBets(socket);
            initFrontendSocketServer(socket);
            await initFunctionsOnLiveData(socket);


  const longestLosingStreak = await findLongestLosingStreak(prisma);
  console.log("Longest Losing Streak without hitting 1.55:", longestLosingStreak);
  
              
            socket.on('disconnect', () => {
                clearInterval(pingInterval);
                console.log('Client disconnected');
                userCount--;
                io.emit('userCount', userCount);
            });
        } catch (error) {
            console.error('Connection setup failed:', error);
            socket.emit('error', 'Connection setup failed');
        }
    });

    return io;
};

process.on('SIGINT', () => {
    console.log('Interval cleared, shutting down.');
    process.exit(0);
});

module.exports = {
    initSocketServer,
};

