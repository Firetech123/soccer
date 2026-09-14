let socket = null;
let typingTimeout = null;
let isTyping = false;
let currentUsername = '';
let activeReply = null;

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

function setReplyTarget(msg) {
  activeReply = {
    id: msg.id,
    sender: msg.sender || 'Anonymous',
    text: msg.text
  };

  const previewBar = document.getElementById('reply-preview-bar');
  const previewSender = document.getElementById('reply-preview-sender');
  const previewText = document.getElementById('reply-preview-text');

  previewSender.textContent = `Replying to ${activeReply.sender}`;
  previewText.textContent = activeReply.text;
  previewBar.classList.remove('hidden');

  const input = document.getElementById('message-input');
  input.focus();
}

function cancelReply() {
  activeReply = null;
  const previewBar = document.getElementById('reply-preview-bar');
  if (previewBar) {
    previewBar.classList.add('hidden');
  }
}

function appendMessage(msg) {
  const container = document.getElementById('chat-messages');
  const isSent = msg.sender === currentUsername;

  const bubble = document.createElement('div');
  bubble.className = `message-bubble ${isSent ? 'sent' : 'received'}`;
  bubble.dataset.id = msg.id;

  // Header row with sender & reply action
  const headerRow = document.createElement('div');
  headerRow.className = 'message-header-row';

  const senderDiv = document.createElement('div');
  senderDiv.className = 'message-sender';
  senderDiv.textContent = msg.sender || 'Anonymous';

  const replyBtn = document.createElement('button');
  replyBtn.type = 'button';
  replyBtn.className = 'reply-btn';
  replyBtn.textContent = 'Reply';
  replyBtn.onclick = () => setReplyTarget(msg);

  headerRow.appendChild(senderDiv);
  headerRow.appendChild(replyBtn);
  bubble.appendChild(headerRow);

  // If this message is a reply to another message
  if (msg.replyTo) {
    const quoteDiv = document.createElement('div');
    quoteDiv.className = 'reply-quote';

    const quoteSender = document.createElement('div');
    quoteSender.className = 'reply-quote-sender';
    quoteSender.textContent = msg.replyTo.sender || 'Anonymous';

    const quoteText = document.createElement('div');
    quoteText.className = 'reply-quote-text';
    quoteText.textContent = msg.replyTo.text || '';

    quoteDiv.appendChild(quoteSender);
    quoteDiv.appendChild(quoteText);
    bubble.appendChild(quoteDiv);
  }

  const textDiv = document.createElement('div');
  textDiv.textContent = msg.text;

  const timeDiv = document.createElement('div');
  timeDiv.className = 'message-time';
  const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  timeDiv.textContent = timeStr;

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

  const payload = { text };
  if (activeReply) {
    payload.replyTo = activeReply;
  }

  socket.emit('send_message', payload);
  input.value = '';
  cancelReply();

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
