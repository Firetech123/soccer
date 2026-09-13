let socket = null;
let currentUser = null;
let token = localStorage.getItem('chat_token');
let typingTimeout = null;
let isTyping = false;

document.addEventListener('DOMContentLoaded', () => {
  checkSystemStatus();
  if (token) {
    // Attempt auto-login with token
    const savedUser = localStorage.getItem('chat_username');
    if (savedUser) {
      currentUser = { username: savedUser };
      initChat();
    }
  }
});

async function checkSystemStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    const signupBtn = document.getElementById('signup-submit-btn');
    const notice = document.getElementById('account-limit-notice');

    if (!data.registrationOpen) {
      if (signupBtn) signupBtn.disabled = true;
      if (notice) {
        notice.textContent = 'Registration closed (Maximum 2/2 accounts registered).';
        notice.style.color = '#ef4444';
      }
    } else {
      if (signupBtn) signupBtn.disabled = false;
      if (notice) {
        notice.textContent = `Max limit: 2 users total (${data.userCount}/2 registered).`;
        notice.style.color = '#94a3b8';
      }
    }
  } catch (err) {
    console.error('Error checking system status:', err);
  }
}

function switchTab(tab) {
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');
  const tabLogin = document.getElementById('tab-login');
  const tabSignup = document.getElementById('tab-signup');
  clearAuthAlerts();

  if (tab === 'login') {
    loginForm.classList.remove('hidden');
    signupForm.classList.add('hidden');
    tabLogin.classList.add('active');
    tabSignup.classList.remove('active');
  } else {
    signupForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
    tabSignup.classList.add('active');
    tabLogin.classList.remove('active');
    checkSystemStatus();
  }
}

function showAuthAlert(msg, type = 'error') {
  const errorDiv = document.getElementById('auth-error');
  const infoDiv = document.getElementById('auth-info');
  clearAuthAlerts();

  if (type === 'error') {
    errorDiv.textContent = msg;
    errorDiv.classList.remove('hidden');
  } else {
    infoDiv.textContent = msg;
    infoDiv.classList.remove('hidden');
  }
}

function clearAuthAlerts() {
  document.getElementById('auth-error').classList.add('hidden');
  document.getElementById('auth-info').classList.add('hidden');
}

async function handleLogin(e) {
  e.preventDefault();
  clearAuthAlerts();
  const usernameInput = document.getElementById('login-username').value;
  const passwordInput = document.getElementById('login-password').value;

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameInput, password: passwordInput })
    });
    const data = await res.json();

    if (!res.ok) {
      showAuthAlert(data.error || 'Login failed');
      return;
    }

    token = data.token;
    currentUser = data.user;
    localStorage.setItem('chat_token', token);
    localStorage.setItem('chat_username', currentUser.username);

    initChat();
  } catch (err) {
    showAuthAlert('Network error during login');
  }
}

async function handleSignup(e) {
  e.preventDefault();
  clearAuthAlerts();
  const usernameInput = document.getElementById('signup-username').value;
  const passwordInput = document.getElementById('signup-password').value;

  try {
    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameInput, password: passwordInput })
    });
    const data = await res.json();

    if (!res.ok) {
      showAuthAlert(data.error || 'Signup failed');
      return;
    }

    token = data.token;
    currentUser = data.user;
    localStorage.setItem('chat_token', token);
    localStorage.setItem('chat_username', currentUser.username);

    initChat();
  } catch (err) {
    showAuthAlert('Network error during signup');
  }
}

function handleLogout() {
  localStorage.removeItem('chat_token');
  localStorage.removeItem('chat_username');
  token = null;
  currentUser = null;

  if (socket) {
    socket.disconnect();
    socket = null;
  }

  document.getElementById('chat-screen').classList.add('hidden');
  document.getElementById('auth-screen').classList.remove('hidden');
  checkSystemStatus();
}

async function initChat() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('chat-screen').classList.remove('hidden');

  document.getElementById('current-user-name').textContent = currentUser.username;
  document.getElementById('current-user-avatar').textContent = currentUser.username.charAt(0);

  // Load message history
  await loadMessages();

  // Connect Socket.io
  setupSocket();
}

async function loadMessages() {
  try {
    const res = await fetch('/api/messages', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      if (res.status === 401) handleLogout();
      return;
    }
    const messages = await res.json();
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';
    messages.forEach(appendMessage);
    scrollToBottom();
  } catch (err) {
    console.error('Error loading chat history:', err);
  }
}

function setupSocket() {
  if (socket) socket.disconnect();

  socket = io({
    auth: { token }
  });

  socket.on('connect_error', (err) => {
    console.error('Socket connection error:', err.message);
    if (err.message.includes('Authentication error')) {
      handleLogout();
    }
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
