const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const KVStore = require('./kv');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

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

// Get chat history from Cloudflare KV
app.get('/api/messages', async (req, res) => {
  try {
    const messages = await getMessages();
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve messages' });
  }
});

// Real-time WebSockets (Socket.io)
io.use((socket, next) => {
  const username = socket.handshake.auth.username || 'Anonymous';
  socket.username = username;
  next();
});

io.on('connection', (socket) => {
  const username = socket.username;

  // Handle incoming message
  socket.on('send_message', async (data) => {
    if (!data.text || !data.text.trim()) return;

    const message = {
      id: Date.now().toString() + Math.random().toString(36).substring(2, 6),
      sender: username,
      text: data.text.trim(),
      replyTo: data.replyTo || null,
      timestamp: new Date().toISOString()
    };

    const messages = await getMessages();
    messages.push(message);
    await saveMessages(messages);

    io.emit('new_message', message);
  });

  // Handle message edit
  socket.on('edit_message', async (data) => {
    if (!data.id || !data.text || !data.text.trim()) return;

    let messages = await getMessages();
    const msgIndex = messages.findIndex(m => m.id === data.id);
    if (msgIndex === -1) return;

    // Check permission: only original sender can edit
    if (messages[msgIndex].sender !== username) return;

    messages[msgIndex].text = data.text.trim();
    messages[msgIndex].isEdited = true;
    messages[msgIndex].editedAt = new Date().toISOString();

    await saveMessages(messages);
    io.emit('message_edited', messages[msgIndex]);
  });

  // Handle message delete
  socket.on('delete_message', async (data) => {
    if (!data.id) return;

    let messages = await getMessages();
    const msgIndex = messages.findIndex(m => m.id === data.id);
    if (msgIndex === -1) return;

    // Check permission: only original sender can delete
    if (messages[msgIndex].sender !== username) return;

    // Completely remove from database / KV store
    const deletedId = messages[msgIndex].id;
    messages.splice(msgIndex, 1);

    await saveMessages(messages);
    io.emit('message_deleted', { id: deletedId });
  });

  // Typing status handlers
  socket.on('typing', () => {
    socket.broadcast.emit('user_typing', { username, socketId: socket.id });
  });

  socket.on('stop_typing', () => {
    socket.broadcast.emit('user_stop_typing', { username, socketId: socket.id });
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = { app, server };
