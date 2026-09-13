const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const KVStore = require('./kv');

const JWT_SECRET = process.env.JWT_SECRET || 'secret-key-private-chat';
const PORT = process.env.PORT || 3000;
const MAX_USERS = 2;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Helper to load users from KV
async function getUsers() {
  const users = await KVStore.get('users');
  return Array.isArray(users) ? users : [];
}

// Helper to save users to KV
async function saveUsers(users) {
  await KVStore.put('users', users);
}

// Helper to load messages from KV
async function getMessages() {
  const msgs = await KVStore.get('messages');
  return Array.isArray(msgs) ? msgs : [];
}

// Helper to save messages to KV
async function saveMessages(messages) {
  await KVStore.put('messages', messages);
}

// REST Endpoints

// Signup endpoint
app.post('/api/signup', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 2) {
      return res.status(400).json({ error: 'Username must be at least 2 characters long' });
    }

    const users = await getUsers();

    // Enforce maximum 2 users
    if (users.length >= MAX_USERS) {
      return res.status(403).json({ error: 'Registration is closed. Maximum limit of 2 user accounts reached.' });
    }

    const existingUser = users.find(u => u.username.toLowerCase() === trimmedUsername.toLowerCase());
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      id: Date.now().toString(),
      username: trimmedUsername,
      password: hashedPassword,
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    await saveUsers(users);

    const token = jwt.sign({ id: newUser.id, username: newUser.username }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user: { id: newUser.id, username: newUser.username }
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Internal server error during registration' });
  }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const users = await getUsers();
    const user = users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      message: 'Logged in successfully',
      token,
      user: { id: user.id, username: user.username }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// Get chat history
app.get('/api/messages', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET);

    const messages = await getMessages();
    res.json(messages);
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

// Check system user count status
app.get('/api/status', async (req, res) => {
  const users = await getUsers();
  res.json({
    userCount: users.length,
    maxUsers: MAX_USERS,
    registrationOpen: users.length < MAX_USERS
  });
});

// Socket.io Real-time Handlers
const activeSockets = new Map(); // socketId -> username
const onlineUsers = new Set();  // Set of usernames currently online

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication error'));
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
});

io.on('connection', (socket) => {
  const username = socket.user.username;
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

    // Check if user has any other active socket connections
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
