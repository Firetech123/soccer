const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const KVStore = require('./kv');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-chat-app';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

const RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours

// Helper to filter out messages older than 24 hours
function filterExpiredMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const now = Date.now();
  return messages.filter(item => {
    if (!item) return false;
    let time = item.timestamp ? new Date(item.timestamp).getTime() : null;
    if (!time && item.id && !isNaN(Number(item.id.slice(0, 13)))) {
      time = Number(item.id.slice(0, 13));
    }
    if (!time) return true;
    return now - time < RETENTION_MS;
  });
}

// User helper functions using KVStore
async function getUsers() {
  const users = await KVStore.get('users_db');
  return Array.isArray(users) ? users : [];
}

async function saveUsers(users) {
  await KVStore.put('users_db', users);
}

// Generate unique conversation key between two users
function getConversationKey(username1, username2) {
  const sorted = [username1.toLowerCase(), username2.toLowerCase()].sort();
  return `conversation_${sorted[0]}_${sorted[1]}`;
}

// Helper to load 1-on-1 direct messages between two users
async function getDirectMessages(username1, username2) {
  const key = getConversationKey(username1, username2);
  const msgs = await KVStore.get(key);
  const validMsgs = Array.isArray(msgs) ? msgs : [];
  const filtered = filterExpiredMessages(validMsgs);
  if (filtered.length !== validMsgs.length) {
    await KVStore.put(key, filtered);
  }
  return filtered;
}

// Helper to save direct messages
async function saveDirectMessages(username1, username2, messages) {
  const key = getConversationKey(username1, username2);
  const filtered = filterExpiredMessages(messages);
  await KVStore.put(key, filtered);
}

// Helper middleware for API authentication
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized: Missing token' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Forbidden: Invalid token' });
    req.user = user;
    next();
  });
}

// Track online sockets by username: username -> Set of socket IDs
const onlineUsers = new Map();

// REST Endpoints - Auth & Profiles

// Sign Up
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { username, displayName, password, bio, avatar } = req.body;
    if (!username || !username.trim() || !password || password.length < 4) {
      return res.status(400).json({ error: 'Username and password (min 4 chars) are required.' });
    }

    const cleanUsername = username.trim().toLowerCase();
    if (!/^[a-zA-Z0-9_]+$/.test(cleanUsername)) {
      return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores.' });
    }

    const users = await getUsers();
    if (users.some(u => u.username.toLowerCase() === cleanUsername)) {
      return res.status(400).json({ error: 'Username is already taken.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      username: cleanUsername,
      displayName: (displayName && displayName.trim()) ? displayName.trim() : cleanUsername,
      password: hashedPassword,
      bio: bio || 'Hey there! I am using Chat.',
      avatar: avatar || 'logo.jpg',
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    await saveUsers(users);

    const token = jwt.sign({ username: newUser.username }, JWT_SECRET, { expiresIn: '30d' });
    const { password: _, ...userWithoutPassword } = newUser;

    res.json({ token, user: userWithoutPassword });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Failed to sign up.' });
  }
});

// Log In
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required.' });
    }

    const cleanUsername = username.trim().toLowerCase();
    const users = await getUsers();
    const user = users.find(u => u.username.toLowerCase() === cleanUsername);

    if (!user) {
      return res.status(400).json({ error: 'Invalid username or password.' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid username or password.' });
    }

    const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    const { password: _, ...userWithoutPassword } = user;

    res.json({ token, user: userWithoutPassword });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Failed to log in.' });
  }
});

// Get Current Authenticated User Profile
app.get('/api/users/me', authenticateToken, async (req, res) => {
  try {
    const users = await getUsers();
    const user = users.find(u => u.username.toLowerCase() === req.user.username.toLowerCase());
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const { password, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user profile.' });
  }
});

// Update Profile (Display Name, Bio, Avatar)
app.put('/api/users/me', authenticateToken, async (req, res) => {
  try {
    const { displayName, bio, avatar } = req.body;
    const users = await getUsers();
    const userIndex = users.findIndex(u => u.username.toLowerCase() === req.user.username.toLowerCase());
    if (userIndex === -1) return res.status(404).json({ error: 'User not found.' });

    if (displayName !== undefined && displayName.trim()) {
      users[userIndex].displayName = displayName.trim();
    }
    if (bio !== undefined) {
      users[userIndex].bio = bio;
    }
    if (avatar !== undefined) {
      users[userIndex].avatar = avatar;
    }

    await saveUsers(users);
    const { password, ...userWithoutPassword } = users[userIndex];
    res.json(userWithoutPassword);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// Change Password
app.put('/api/users/me/password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 4) {
      return res.status(400).json({ error: 'Current password and new password (min 4 chars) are required.' });
    }

    const users = await getUsers();
    const userIndex = users.findIndex(u => u.username.toLowerCase() === req.user.username.toLowerCase());
    if (userIndex === -1) return res.status(404).json({ error: 'User not found.' });

    const validPassword = await bcrypt.compare(currentPassword, users[userIndex].password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }

    users[userIndex].password = await bcrypt.hash(newPassword, 10);
    await saveUsers(users);

    res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to change password.' });
  }
});

// Search Users by Username or Display Name
app.get('/api/users/search', authenticateToken, async (req, res) => {
  try {
    const query = (req.query.q || '').trim().toLowerCase();
    const users = await getUsers();
    const currentUsername = req.user.username.toLowerCase();

    const filtered = users
      .filter(u => u.username.toLowerCase() !== currentUsername)
      .filter(u => !query || u.username.toLowerCase().includes(query) || u.displayName.toLowerCase().includes(query))
      .map(({ password, ...u }) => u);

    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: 'Failed to search users.' });
  }
});

// Get User Profile by Username
app.get('/api/users/:username', authenticateToken, async (req, res) => {
  try {
    const targetUsername = req.params.username.toLowerCase();
    const users = await getUsers();
    const user = users.find(u => u.username.toLowerCase() === targetUsername);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const { password, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile.' });
  }
});

// Get Direct Messages with a specific user
app.get('/api/messages/:recipient', authenticateToken, async (req, res) => {
  try {
    const currentUser = req.user.username;
    const recipient = req.params.recipient;
    const messages = await getDirectMessages(currentUser, recipient);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load messages.' });
  }
});

// Get recent conversations for authenticated user
app.get('/api/conversations', authenticateToken, async (req, res) => {
  try {
    const currentUser = req.user.username.toLowerCase();
    const users = await getUsers();
    const conversations = [];

    for (const u of users) {
      if (u.username.toLowerCase() === currentUser) continue;
      const msgs = await getDirectMessages(currentUser, u.username);
      if (msgs.length > 0) {
        const lastMsg = msgs[msgs.length - 1];
        conversations.push({
          user: {
            username: u.username,
            displayName: u.displayName,
            avatar: u.avatar,
            bio: u.bio
          },
          lastMessage: lastMsg
        });
      }
    }

    // Sort by most recent message timestamp
    conversations.sort((a, b) => new Date(b.lastMessage.timestamp) - new Date(a.lastMessage.timestamp));
    res.json(conversations);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load conversations.' });
  }
});

// Real-time WebSockets (Socket.io) with Authentication Token
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication token required'));
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return next(new Error('Authentication failed: Invalid token'));
    socket.user = decoded;
    socket.username = decoded.username.toLowerCase();
    next();
  });
});

io.on('connection', (socket) => {
  const username = socket.username;

  // Track online sockets
  if (!onlineUsers.has(username)) {
    onlineUsers.set(username, new Set());
  }
  onlineUsers.get(username).add(socket.id);

  socket.on('send_message', async (data) => {
    if (!data.recipient || !data.text || !data.text.trim()) return;

    const recipient = data.recipient.toLowerCase();
    const users = await getUsers();
    const senderObj = users.find(u => u.username.toLowerCase() === username);

    const message = {
      id: Date.now().toString() + Math.random().toString(36).substring(2, 6),
      sender: username,
      senderDisplayName: senderObj ? senderObj.displayName : username,
      senderAvatar: senderObj ? senderObj.avatar : 'logo.jpg',
      recipient: recipient,
      text: data.text.trim(),
      replyTo: data.replyTo || null,
      timestamp: new Date().toISOString()
    };

    const messages = await getDirectMessages(username, recipient);
    messages.push(message);
    await saveDirectMessages(username, recipient, messages);

    // Emit to sender sockets
    const senderSockets = onlineUsers.get(username);
    if (senderSockets) {
      for (const sId of senderSockets) {
        io.to(sId).emit('new_message', message);
      }
    }

    // Emit to recipient sockets
    const recipientSockets = onlineUsers.get(recipient);
    if (recipientSockets) {
      for (const rId of recipientSockets) {
        io.to(rId).emit('new_message', message);
      }
    }
  });

  socket.on('edit_message', async (data) => {
    if (!data.id || !data.recipient || !data.text || !data.text.trim()) return;

    const recipient = data.recipient.toLowerCase();
    let messages = await getDirectMessages(username, recipient);
    const msgIndex = messages.findIndex(m => m.id === data.id);
    if (msgIndex === -1) return;

    if (messages[msgIndex].sender.toLowerCase() !== username) return;

    messages[msgIndex].text = data.text.trim();
    messages[msgIndex].isEdited = true;
    messages[msgIndex].editedAt = new Date().toISOString();

    await saveDirectMessages(username, recipient, messages);

    const editedMsg = messages[msgIndex];
    const senderSockets = onlineUsers.get(username);
    if (senderSockets) {
      for (const sId of senderSockets) io.to(sId).emit('message_edited', editedMsg);
    }
    const recipientSockets = onlineUsers.get(recipient);
    if (recipientSockets) {
      for (const rId of recipientSockets) io.to(rId).emit('message_edited', editedMsg);
    }
  });

  socket.on('delete_message', async (data) => {
    if (!data.id || !data.recipient) return;

    const recipient = data.recipient.toLowerCase();
    let messages = await getDirectMessages(username, recipient);
    const msgIndex = messages.findIndex(m => m.id === data.id);
    if (msgIndex === -1) return;

    if (messages[msgIndex].sender.toLowerCase() !== username) return;

    const deletedId = messages[msgIndex].id;
    messages.splice(msgIndex, 1);
    await saveDirectMessages(username, recipient, messages);

    const senderSockets = onlineUsers.get(username);
    if (senderSockets) {
      for (const sId of senderSockets) io.to(sId).emit('message_deleted', { id: deletedId, recipient });
    }
    const recipientSockets = onlineUsers.get(recipient);
    if (recipientSockets) {
      for (const rId of recipientSockets) io.to(rId).emit('message_deleted', { id: deletedId, recipient });
    }
  });

  socket.on('typing', (data) => {
    if (!data.recipient) return;
    const recipientSockets = onlineUsers.get(data.recipient.toLowerCase());
    if (recipientSockets) {
      for (const rId of recipientSockets) {
        io.to(rId).emit('user_typing', { username, socketId: socket.id });
      }
    }
  });

  socket.on('stop_typing', (data) => {
    if (!data.recipient) return;
    const recipientSockets = onlineUsers.get(data.recipient.toLowerCase());
    if (recipientSockets) {
      for (const rId of recipientSockets) {
        io.to(rId).emit('user_stop_typing', { username, socketId: socket.id });
      }
    }
  });

  socket.on('disconnect', () => {
    const userSockets = onlineUsers.get(username);
    if (userSockets) {
      userSockets.delete(socket.id);
      if (userSockets.size === 0) {
        onlineUsers.delete(username);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = { app, server };
