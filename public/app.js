let socket = null;
let typingTimeout = null;
let isTyping = false;
let currentUsername = '';

document.addEventListener('DOMContentLoaded', () => {
  const savedName = localStorage.getItem('chat_username');
  if (savedName && savedName.trim()) {
    currentUsername = savedName.trim();
    document.getElementById('join-screen').classList.add('hidden');
    document.getElementById('chat-screen').classList.remove('hidden');
    initChat();
  } else {
    document.getElementById('username-input').focus();
  }
});

function handleJoinChat(e) {
  e.preventDefault();
  const input = document.getElementById('username-input');
  const name = input.value.trim();
  if (!name) return;

  currentUsername = name;
  localStorage.setItem('chat_username', name);

  document.getElementById('join-screen').classList.add('hidden');
  document.getElementById('chat-screen').classList.remove('hidden');

  initChat();
}

async function initChat() {
  await loadMessages();
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
    auth: { username: currentUsername }
  });

  socket.on('connect_error', (err) => {
    console.error('Socket connection error:', err.message);
  });

  socket.on('new_message', (msg) => {
    appendMessage(msg);
    scrollToBottom();
  });

  socket.on('user_typing', (data) => {
    if (data.socketId !== socket.id) {
      const typingIndicator = document.getElementById('typing-indicator');
      const typingText = document.getElementById('typing-text');
      typingText.textContent = `${data.username || 'Anonymous'} is typing...`;
      typingIndicator.classList.add('active');
    }
  });

  socket.on('user_stop_typing', (data) => {
    if (data.socketId !== socket.id) {
      document.getElementById('typing-indicator').classList.remove('active');
    }
  });
}

function appendMessage(msg) {
  const container = document.getElementById('chat-messages');
  // Compare socket or message sender display
  const isSent = msg.sender === currentUsername;

  const bubble = document.createElement('div');
  bubble.className = `message-bubble ${isSent ? 'sent' : 'received'}`;

  const senderDiv = document.createElement('div');
  senderDiv.className = 'message-sender';
  senderDiv.textContent = msg.sender || 'Anonymous';

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
