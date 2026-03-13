require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const helmet = require('helmet');
const xss = require('xss');
const crypto = require('crypto');

const app = express();
app.set('trust proxy', 1);

// ── Express Security Middleware ───────────────────────────────
// [Vuln 1] Helmet HTTP Headers & CSP
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Needed for some DOM manipulation and Socket.io client script if not bundled
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'"], // WebSockets restricted
    },
  },
}));

// [Vuln 6] Unbounded JSON Payloads (Memory DoS limit)
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// [Vuln 10] Enforce HTTPS / Secure WebSockets in Production
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect('https://' + req.headers.host + req.url);
  }
  next();
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.NODE_ENV === 'production' ? process.env.APP_URL : 'http://localhost:3000' },
  maxHttpBufferSize: 1e4
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// No-cache headers for all responses
app.use((req, res, next) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store'
  });
  next();
});

// ── Security & Configuration ──────────────────────────────────
// Removing hardcoded SECRET_CODES for dynamic room generation.

// ── Rate Limiter State ────────────────────────────────────────
const loginAttempts = new Map(); // IP -> { count, lockedUntil }
const ipConnections = new Map(); // IP -> active socket count
const MAX_ATTEMPTS = 5; // Lock out IP after 5 wrong tries
const MAX_SOCKETS_PER_IP = 10; // Prevent DDoS socket flooding
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes in milliseconds

// Garbage collect IP connection map to prevent OOM
setInterval(() => {
  for (const [ip, count] of ipConnections.entries()) {
    if (count <= 0) ipConnections.delete(ip);
  }
}, 15 * 60 * 1000);

// ── In-Memory State (zero persistence) ────────────────────────
const activeRooms = new Map(); // roomId -> { createdAt }
const activeUsers = new Map(); // socketId -> { alias, room, lastMessageTime, messageCount }
const activeMessages = new Map(); // messageId -> { senderSocketId }

// ── API Routes ────────────────────────────────────────────────
const rateLimit = require('express-rate-limit');

// Rate Limiter for Room Creation (DoS Protection)
const roomCreationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per `window` (here, per 15 minutes)
  message: { success: false, message: 'Too many rooms created from this IP, please try again after 15 minutes' },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// [Phase 6] Dynamic Room Generation
app.post('/api/create-room', roomCreationLimiter, (req, res) => {
  const clientIp = req.socket.remoteAddress;
  
  // Basic rate limiting for room creation
  const roomId = crypto.randomBytes(8).toString('hex'); // 16-char secure room code
  activeRooms.set(roomId, {
    createdAt: Date.now()
  });

  // Automatically GC empty rooms after 24 hours if completely abandoned
  setTimeout(() => {
    if (getRoomCount(roomId) === 0) {
      activeRooms.delete(roomId);
    }
  }, 24 * 60 * 60 * 1000);

  return res.json({ success: true, room: roomId });
});

// ── Socket.IO ─────────────────────────────────────────────────
io.on('connection', (socket) => {
  const clientIp = socket.handshake.address;
  
  // [Vuln 7] Socket Connection Flooding (DDoS) Protection
  const currentConns = (ipConnections.get(clientIp) || 0) + 1;
  if (currentConns > MAX_SOCKETS_PER_IP) {
    console.warn(`🚨 DDoS Protection: IP ${clientIp} rejected (Exceeded socket limit).`);
    return socket.disconnect(true);
  }
  ipConnections.set(clientIp, currentConns);

  console.log(`⚡ Connection: ${socket.id} from ${clientIp}`);

  // ── Layer 1: Global Error Handler ───────────────────────────
  // Prevents malformed socket events from crashing the Node process
  socket.on('error', (err) => {
    console.error(`Socket Error from ${socket.id}:`, err.message);
  });

  // ── Authentication ──────────────────────────────────────────
  // Now payload contains dynamic roomId and a chosen alias
  socket.on('authenticate', (data, callback) => {
    const now = Date.now();
    const attemptRecord = loginAttempts.get(clientIp) || { count: 0, lockedUntil: 0 };

    if (attemptRecord.lockedUntil > now) {
      const minutesLeft = Math.ceil((attemptRecord.lockedUntil - now) / 60000);
      return callback({ 
        success: false, 
        message: `SYSTEM LOCKED 🚫 IP blocked for ${minutesLeft} minutes.` 
      });
    }

    if (!data || typeof data !== 'object' || typeof data.room !== 'string' || typeof data.alias !== 'string') {
       return callback({ success: false, message: 'ACCESS DENIED — Malformed entry protocol' });
    }

    const roomId = data.room.trim();
    let alias = data.alias.trim();

    if (!alias || alias.length > 25) {
      return callback({ success: false, message: 'ACCESS DENIED — Invalid or overly long alias' });
    }
    
    // Check if room exists
    if (!activeRooms.has(roomId)) {
      attemptRecord.count += 1;
      if (attemptRecord.count >= MAX_ATTEMPTS) {
        attemptRecord.lockedUntil = now + LOCKOUT_TIME;
        console.log(`🚨 Security Alert: Brute-force blocked! IP ${clientIp} locked out.`);
      }
      loginAttempts.set(clientIp, attemptRecord);
      return callback({ success: false, message: 'ACCESS DENIED — Invalid or occupied void' });
    }

    // Check capacity: STRICT 2 PERSON LIMIT
    if (getRoomCount(roomId) >= 2) {
      return callback({ success: false, message: 'ACCESS DENIED — Invalid or occupied void' });
    }

    // Reset failed attempts on success
    loginAttempts.delete(clientIp);

    // [Vuln 2] Reflected/Stored XSS Protection via Sanitization
    const safeAlias = xss(alias, { whiteList: {} });
    const safeRoom = xss(roomId, { whiteList: {} });

    // Check if this alias is already connected within the room
    for (const [, user] of activeUsers) {
      if (user.room === safeRoom && user.alias === safeAlias) {
        return callback({ success: false, message: 'ACCESS DENIED — This identity is already active inside' });
      }
    }

    // Register the user with chat rate-limiting trackers
    activeUsers.set(socket.id, { 
      alias: safeAlias, 
      room: safeRoom, 
      lastMessageTime: 0,
      messageCount: 0,
      lastTypingTime: 0
    });
    socket.join(safeRoom);

    // Notify others in the room
    socket.to(safeRoom).emit('user-joined', {
      alias: safeAlias,
      onlineCount: getRoomCount(safeRoom)
    });

    callback({
      success: true,
      alias: safeAlias,
      room: safeRoom,
      onlineCount: getRoomCount(safeRoom)
    });

    console.log(`🔓 ${safeAlias} entered the void`);
  });

  // ── Send Message (With 3-Layer Security) ───────────────────
  socket.on('send-message', (data) => {
    const user = activeUsers.get(socket.id);
    if (!user) return; // Must be authenticated

    // Layer 1: Data Type Validation & Prototype Pollution Protection [Vuln 9]
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.getPrototypeOf(data) !== Object.prototype || typeof data.text !== 'string') {
      return console.warn(`🚨 Security: Malformed or polluted payload from ${user.alias}`);
    }

    const text = data.text.trim();

    // Layer 2: Payload Size Limiter (Memory Bomb Protection)
    if (text.length === 0 || text.length > 1500) {
      return console.warn(`🚨 Security: Invalid payload size from ${user.alias} (${text.length} chars)`);
    }

    // Layer 3: Chat Rate Limiter (Denial of Service Protection)
    const now = Date.now();
    if (user.lastMessageTime > 0 && now - user.lastMessageTime < 500) { // Max 1 message per 500ms
      user.messageCount++;
      if (user.messageCount > 10) {
        console.warn(`🚨 Security: Chat spam detected from ${user.alias}. Disconnecting.`);
        return socket.disconnect(true);
      }
    } else {
      user.messageCount = Math.max(0, user.messageCount - 1); // Decay spam counter
    }
    user.lastMessageTime = now;

    const messageId = generateId();
    const message = {
      id: messageId,
      alias: user.alias,
      text: text, // Safe, sized, rate-limited text
      timestamp: now,
      senderSocketId: socket.id
    };

    // Track active message for anti-griefing
    activeMessages.set(messageId, { senderSocketId: socket.id });

    // Clean up memory leak from tracked messages after 30 seconds (if not seen)
    setTimeout(() => {
      activeMessages.delete(messageId);
    }, 30000);

    // Broadcast to room (including sender for confirmation)
    console.log(`[Message Broadcast] from ${user.alias} to room ${user.room} -> [ID: ${messageId}]`);
    io.to(user.room).emit('new-message', message);
    // Message exists ONLY in transit — never stored permanently
  });

  // ── Message Seen (Anti-Griefing Protection) ─────────────────
  socket.on('message-seen', (messageId) => {
    const user = activeUsers.get(socket.id);
    if (!user) return;

    if (typeof messageId !== 'string' || messageId.length > 50) return;

    const msgData = activeMessages.get(messageId);
    if (!msgData) return; // Message already deleted or invalid

    // Anti-Griefing: The sender cannot trigger the self-destruct for others!
    // Nor can they prematurely trigger it. Only recipients can 'see' it.
    if (msgData.senderSocketId === socket.id && getRoomCount(user.room) > 1) {
      return; 
    }

    // Tell everyone in the room to destroy this message
    console.log(`[Message Destroy] triggered by ${user.alias} for message ID ${messageId}`);
    io.to(user.room).emit('destroy-message', messageId);
    activeMessages.delete(messageId); // Clear from tracker memory
  });

  // ── Typing Indicator ───────────────────────────────────────
  socket.on('typing', (data) => {
    const user = activeUsers.get(socket.id);
    if (!user) return;
    
    // Rate limit typing broadcast
    const now = Date.now();
    if (now - user.lastTypingTime < 250) return;
    user.lastTypingTime = now;

    // Strict boolean check
    const isTyping = data === true;

    socket.to(user.room).emit('user-typing', {
      alias: user.alias,
      isTyping
    });
  });

  // ── Panic Button: Burn Notice ───────────────────────────────
  socket.on('burn-notice', () => {
    const user = activeUsers.get(socket.id);
    if (!user) return;
    
    console.log(`🚨 BURN NOTICE triggered by ${user.alias}. Erasing room ${user.room} for all identities.`);
    // Force all active clients in this room (excluding the initiator, who is already burning) to explode
    socket.to(user.room).emit('execute-burn');
  });

  // ── Disconnect ──────────────────────────────────────────────
  socket.on('disconnect', () => {
    // [Vuln 7] Clean up IP connection tracking
    const currentConns = (ipConnections.get(clientIp) || 1) - 1;
    if (currentConns <= 0) ipConnections.delete(clientIp);
    else ipConnections.set(clientIp, currentConns);

    const user = activeUsers.get(socket.id);
    if (user) {
      socket.to(user.room).emit('user-left', {
        alias: user.alias,
        onlineCount: getRoomCount(user.room) - 1
      });
      activeUsers.delete(socket.id);
      console.log(`💀 ${user.alias} vanished from the void`);
      
      // Garbage collect empty rooms instantly
      if (getRoomCount(user.room) === 0) {
        activeRooms.delete(user.room);
        console.log(`🗑️ Room ${user.room} was permanently destroyed (Empty).`);
      }
    }
  });
});

// ── Helpers ───────────────────────────────────────────────────
function getRoomCount(room) {
  const r = io.sockets.adapter.rooms.get(room);
  return r ? r.size : 0;
}

function generateId() {
  // [Vuln 5] Predictable Message IDs Protection
  return crypto.randomBytes(16).toString('hex');
}

// ── Start Server ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🌑 THE VOID is listening on port ${PORT}`);
  console.log(`   http://localhost:${PORT}\n`);
});
