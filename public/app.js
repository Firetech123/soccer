let socket = null;
let currentUser = null;
let typingTimeout = null;
let isTyping = false;

document.addEventListener('DOMContentLoaded', () => {
  const savedUser = localStorage.getItem('chat_simple_username');
  if (savedUser) {
    currentUser = { username: savedUser };
    initChat();
  }
});

function showError(msg) {
  const errorDiv = document.getElementById('join-error');
  if (errorDiv) {
    errorDiv.textContent = msg;
    errorDiv.classList.remove('hidden');
  }
}

function clearError() {
  const errorDiv = document.getElementById('join-error');
  if (errorDiv) {
    errorDiv.classList.add('hidden');
  }
}

async function handleJoin(e) {
  e.preventDefault();
  clearError();

  const usernameInput = document.getElementById('username-input').value.trim();
  if (!usernameInput) return;

  try {
    const res = await fetch('/api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameInput })
    });

    const data = await res.json();
    if (!res.ok) {
      showError(data.error || 'Unable to join chat');
      return;
    }

    currentUser = data.user;
    localStorage.setItem('chat_simple_username', currentUser.username);

    initChat();
  } catch (err) {
    showError('Network error connecting to backend server');
  }
}

function handleLeave() {
  localStorage.removeItem('chat_simple_username');
  currentUser = null;

  if (socket) {
    socket.disconnect();
    socket = null;
  }

  document.getElementById('chat-screen').classList.add('hidden');
  document.getElementById('prompt-screen').classList.remove('hidden');
}

async function initChat() {
  document.getElementById('prompt-screen').classList.add('hidden');
  document.getElementById('chat-screen').classList.remove('hidden');

  document.getElementById('current-user-name').textContent = currentUser.username;
  document.getElementById('current-user-avatar').textContent = currentUser.username.charAt(0);

  // Load Cloudflare KV stored chat history
  await loadMessages();

  // Connect Socket.io real-time connection
  setupSocket();
}

async function loadMessages() {
  try {
    const res = await fetch('/api/messages');
    if (!res.ok) return;

    const messages = await res.json();
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';
    messages.forEach(appendMessage);
    scrollToBottom();
  } catch (err) {
    console.error('Error loading messages:', err);
  }
}

function setupSocket() {
  if (socket) socket.disconnect();

  socket = io({
    auth: { username: currentUser.username }
  });

  socket.on('connect_error', (err) => {
    console.error('Socket error:', err.message);
  });

  socket.on('online_users', (users) => {
    const peerStatusDot = document.getElementById('peer-status-dot');
    const peerStatusText = document.getElementById('peer-status-text');

    const peerUsers = users.filter(u => u.toLowerCase() !== currentUser.username.toLowerCase());
    if (peerUsers.length > 0) {
      peerStatusDot.className = 'status-dot online';
      peerStatusText.textContent = `${peerUsers[0]} is online`;
    } else {
      peerStatusDot.className = 'status-dot offline';
      peerStatusText.textContent = 'Peer offline';
    }
  });

  socket.on('new_message', (msg) => {
    appendMessage(msg);
    scrollToBottom();
  });

  socket.on('user_typing', (data) => {
    if (data.username.toLowerCase() !== currentUser.username.toLowerCase()) {
      const typingIndicator = document.getElementById('typing-indicator');
      const typingText = document.getElementById('typing-text');
      typingText.textContent = `${data.username} is typing...`;
      typingIndicator.classList.add('active');
    }
  });

  socket.on('user_stop_typing', (data) => {
    if (data.username.toLowerCase() !== currentUser.username.toLowerCase()) {
      document.getElementById('typing-indicator').classList.remove('active');
    }
  });
}

function appendMessage(msg) {
  const container = document.getElementById('chat-messages');
  const isSent = msg.sender.toLowerCase() === currentUser.username.toLowerCase();

  const bubble = document.createElement('div');
  bubble.className = `message-bubble ${isSent ? 'sent' : 'received'}`;

  const senderDiv = document.createElement('div');
  senderDiv.className = 'message-sender';
  senderDiv.textContent = isSent ? 'You' : msg.sender;

  const textDiv = document.createElement('div');
  textDiv.textContent = msg.text;

  const timeDiv = document.createElement('div');
  timeDiv.className = 'message-time';
  const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  timeDiv.textContent = timeStr;

  bubble.appendChild(senderDiv);
  bubble.appendChild(textDiv);
  bubble.appendChild(timeDiv);

  container.appendChild(bubble);
}

function scrollToBottom() {
  const container = document.getElementById('chat-messages');
  container.scrollTop = container.scrollHeight;
}

function handleSendMessage(e) {
  e.preventDefault();
  const input = document.getElementById('message-input');
  const text = input.value.trim();

  if (!text || !socket) return;

  socket.emit('send_message', { text });
  input.value = '';

  if (isTyping) {
    socket.emit('stop_typing');
    isTyping = false;
  }
}

function handleTypingInput() {
  if (!socket) return;

  if (!isTyping) {
    isTyping = true;
    socket.emit('typing');
  }

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    if (isTyping) {
      isTyping = false;
      socket.emit('stop_typing');
    }
  }, 1500);
}
