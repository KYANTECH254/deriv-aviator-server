const { Server } = require('socket.io');
const prisma = require('../../services/db');
const Redis = require('ioredis');
const cors = require('cors');
const redis = new Redis();
const initFrontendSocketServer = require('./frontendHandler');

// Utility function to get the cookie from the request headers
const getCookie = (cookieHeader, cookieName) => {
    const match = cookieHeader && cookieHeader.match(new RegExp(`(^| )${cookieName}=([^;]+)`));
    return match ? match[2] : null;
};

function generateRandomMessageId() {
    return Math.random().toString(36).substring(2, 7);
}

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
        return await prisma.user.findUnique({ where: { auth_token: authToken } });
    } catch (error) {
        console.error('Error verifying user:', error);
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

        console.log(`Latest Round ID: ${latestMultiplier.id}`);

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

        console.log(
            `Live Bets Count: ${totalBetsCount}, Previous Round Bets Count: ${totalPreviousBetsCount}`
        );
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
            const createdBet = await prisma.bet.create({
                data: bet,
            });

            io.emit('bet-updated', createdBet);
        } catch (error) {
            console.error('Error creating new bet:', error);
        }
    });
}
// Function to emit user data (e.g., username) to the client
const emitUserDataByToken = async (socket, authToken) => {
    try {
        const user = await verifyUser(authToken);

        if (!user) {
            socket.emit('error', 'Invalid or missing authentication token');
            return;
        }

        socket.emit('username', { username: user.username });
        console.log(`Emitted username for user ${user.username}`);
    } catch (error) {
        console.error('Error fetching user data:', error);
        socket.emit('error', 'Failed to fetch user data');
    }
};

// Function to emit multipliers data
const emitMultiplierData = async (socket, authToken) => {
    try {
        const user = await verifyUser(authToken);
        if (!user) {
            socket.emit('error', 'Invalid or missing authentication token');
            return;
        }

        const multipliers = await prisma.multiplier.findMany();
        socket.emit('multiplier_data', multipliers);
        console.log('Emitted multiplier data');
    } catch (error) {
        console.error('Error fetching multiplier data:', error);
        socket.emit('error', 'Failed to fetch multiplier data');
    }
};

// Function to emit all bets data
const emitAllBetsData = async (socket, authToken) => {
    try {
        const bets = await prisma.bet.findMany();
        socket.emit('bets_data', bets);
        console.log('Emitted bet data');
    } catch (error) {
        console.error('Error fetching bet data:', error);
        socket.emit('error', 'Failed to fetch bet data');
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

let userCount = 0;

// Initialize WebSocket server
const initSocketServer = (httpServer) => {
    const io = new Server(httpServer, {
        cors: {
            origin: '*',
            methods: ["GET", "POST"],
        },
        allowEIO3: true
    });

    io.on('connection', async (socket) => {
        console.log('New client connected');

        userCount++;
        io.emit('userCount', userCount);

        const requestedUrl = socket.handshake.headers.referer;
        console.log("Url:", requestedUrl);

        if (requestedUrl && requestedUrl.includes('https://api-deriv-aviator.topwebtools.online')) {
            console.log('Status access allowed based on URL');
            socket.emit('info', 'Connected as guest');
        
            socket.on('disconnect', async () => {
                console.log('Client disconnected');
                userCount--;
                io.emit('userCount', userCount);
            });
        
            return; // Early exit, preventing further code execution
        }
        

        // If not a guest, check for token authentication
        const cookieHeader = socket.handshake.headers.cookie;
        // const authToken = getCookie(cookieHeader, 'token');
        const authToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJWUlRDMTAwMzI2MDkiLCJhcHBJZCI6IjEwODkiLCJ0b2tlbiI6ImExLU5yTHN0elBycURicjlHSGNPeUo3TkQ5YjF5YVBJIiwiaWF0IjoxNzMyMzAwMDE2fQ.u3ky2FJKUsSQ5tDncQBIFcxklJwFZmMyDnkkz1Wq2Ok"
        console.log('authToken:', authToken)
        if (authToken) {
            try {
                // Authenticate user
                const user = await verifyUser(authToken);
                if (!user) {
                    socket.emit('error', 'Authentication failed');
                    socket.disconnect();
                    return;
                }

                console.log('user verified')
                // Emit user data
                await emitUserDataByToken(socket, authToken);

                // Emit live bets
                await fetchLiveBets(socket);

                // Emit bets
                await placeBet(socket);

                // Emit multiplier data
                await emitMultiplierData(socket, authToken);

                // Emit bets data
                await emitAllBetsData(socket, authToken)

                // Emit multiplier
                initFrontendSocketServer(socket);

                // Handle chat interactions
                handleChat(socket, authToken);
            } catch (error) {
                console.error('Error during connection setup:', error);
                socket.emit('error', 'Connection error');
            }
        } else {
            socket.emit('error', 'Authentication token not provided');
            socket.disconnect();
        }

        // Listen for disconnect
        socket.on('disconnect', async () => {
            console.log('Client disconnected');
            userCount--;
            io.emit('userCount', userCount);
        });

        return io;
    });
};

module.exports = { initSocketServer };
