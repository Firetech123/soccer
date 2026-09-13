const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const KVStore = require('./kv');

const PORT = process.env.PORT || 3000;
const MAX_USERS = 2;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Helper to load users from Cloudflare KV
async function getUsers() {
  const users = await KVStore.get('users');
  return Array.isArray(users) ? users : [];
}

// Helper to save users to Cloudflare KV
async function saveUsers(users) {
  await KVStore.put('users', users);
}

// Helper to load messages from Cloudflare KV
async function getMessages() {
  const msgs = await KVStore.get('messages');
  return Array.isArray(msgs) ? msgs : [];
}

// Helper to save messages to Cloudflare KV
async function saveMessages(messages) {
  await KVStore.put('messages', messages);
}

// REST Endpoints

// Enter/Join Chat Endpoint
app.post('/api/join', async (req, res) => {
  try {
    const { username } = req.body;

    if (!username || !username.trim()) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 2) {
      return res.status(400).json({ error: 'Username must be at least 2 characters long' });
    }

    const users = await getUsers();
    let existingUser = users.find(u => u.username.toLowerCase() === trimmedUsername.toLowerCase());

    if (!existingUser) {
      if (users.length >= MAX_USERS) {
        return res.status(403).json({ error: 'Chat is full. Maximum limit of 2 users reached.' });
      }

      existingUser = {
        id: Date.now().toString(),
        username: trimmedUsername,
        joinedAt: new Date().toISOString()
      };
      users.push(existingUser);
      await saveUsers(users);
    }

    res.json({
      message: 'Joined successfully',
      user: { id: existingUser.id, username: existingUser.username }
    });
  } catch (err) {
    console.error('Join error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get chat history from Cloudflare KV
app.get('/api/messages', async (req, res) => {
  try {
    const messages = await getMessages();
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve messages' });
  }
});

// Check system user count status
app.get('/api/status', async (req, res) => {
  const users = await getUsers();
  res.json({
    userCount: users.length,
    maxUsers: MAX_USERS,
    available: users.length < MAX_USERS
  });
});

// Real-time WebSockets (Socket.io)
const activeSockets = new Map(); // socketId -> username
const onlineUsers = new Set();  // Set of usernames currently online

io.use((socket, next) => {
  const username = socket.handshake.auth.username;
  if (!username) {
    return next(new Error('Username required for connection'));
  }
  socket.username = username;
  next();
});

io.on('connection', (socket) => {
  const username = socket.username;
  activeSockets.set(socket.id, username);
  onlineUsers.add(username);

  // Broadcast updated online users list
  io.emit('online_users', Array.from(onlineUsers));

  // Handle incoming message
  socket.on('send_message', async (data) => {
    if (!data.text || !data.text.trim()) return;

    const message = {
      id: Date.now().toString() + Math.random().toString(36).substring(2, 6),
      sender: username,
      text: data.text.trim(),
      timestamp: new Date().toISOString()
    };

    const messages = await getMessages();
    messages.push(message);
    await saveMessages(messages);

    io.emit('new_message', message);
  });

  // Typing status handlers
  socket.on('typing', () => {
    socket.broadcast.emit('user_typing', { username });
  });

  socket.on('stop_typing', () => {
    socket.broadcast.emit('user_stop_typing', { username });
  });

  socket.on('disconnect', () => {
    activeSockets.delete(socket.id);

    const remainingSockets = Array.from(activeSockets.values());
    if (!remainingSockets.includes(username)) {
      onlineUsers.delete(username);
    }

    io.emit('online_users', Array.from(onlineUsers));
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = { app, server };
