const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
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

// ── Secret Codes ──────────────────────────────────────────────
const SECRET_CODES = {
  '1710': { alias: 'Miss.Universse', room: 'the-void' },
  '2019': { alias: 'Babhan Sheer', room: 'the-void' }
};

// ── In-Memory State (zero persistence) ────────────────────────
const activeUsers = new Map(); // socketId -> { alias, room, code }

// ── Socket.IO ─────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`⚡ Connection: ${socket.id}`);

  // ── Authentication ──────────────────────────────────────────
  socket.on('authenticate', (code, callback) => {
    const trimmed = code.trim();
    const entry = SECRET_CODES[trimmed];

    if (!entry) {
      return callback({ success: false, message: 'ACCESS DENIED — Invalid code' });
    }

    // Check if this alias is already connected
    for (const [, user] of activeUsers) {
      if (user.code === trimmed) {
        return callback({ success: false, message: 'ACCESS DENIED — This identity is already active' });
      }
    }

    // Register the user
    activeUsers.set(socket.id, { alias: entry.alias, room: entry.room, code: trimmed });
    socket.join(entry.room);

    // Notify others in the room
    socket.to(entry.room).emit('user-joined', {
      alias: entry.alias,
      onlineCount: getRoomCount(entry.room)
    });

    callback({
      success: true,
      alias: entry.alias,
      room: entry.room,
      onlineCount: getRoomCount(entry.room)
    });

    console.log(`🔓 ${entry.alias} entered the void`);
  });

  // ── Send Message ────────────────────────────────────────────
  socket.on('send-message', (data) => {
    const user = activeUsers.get(socket.id);
    if (!user) return;

    const message = {
      id: generateId(),
      alias: user.alias,
      text: data.text,
      timestamp: Date.now(),
      seen: false
    };

    // Broadcast to room (including sender for confirmation)
    io.to(user.room).emit('new-message', message);
    // Message exists ONLY in transit — never stored
  });

  // ── Message Seen ────────────────────────────────────────────
  socket.on('message-seen', (messageId) => {
    const user = activeUsers.get(socket.id);
    if (!user) return;

    // Tell everyone in the room to destroy this message
    io.to(user.room).emit('destroy-message', messageId);
  });

  // ── Typing Indicator ───────────────────────────────────────
  socket.on('typing', (isTyping) => {
    const user = activeUsers.get(socket.id);
    if (!user) return;

    socket.to(user.room).emit('user-typing', {
      alias: user.alias,
      isTyping
    });
  });

  // ── Disconnect ──────────────────────────────────────────────
  socket.on('disconnect', () => {
    const user = activeUsers.get(socket.id);
    if (user) {
      socket.to(user.room).emit('user-left', {
        alias: user.alias,
        onlineCount: getRoomCount(user.room) - 1
      });
      activeUsers.delete(socket.id);
      console.log(`💀 ${user.alias} vanished from the void`);
    }
  });
});

// ── Helpers ───────────────────────────────────────────────────
function getRoomCount(room) {
  const r = io.sockets.adapter.rooms.get(room);
  return r ? r.size : 0;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// ── Start Server ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🌑 THE VOID is listening on port ${PORT}`);
  console.log(`   http://localhost:${PORT}\n`);
});
