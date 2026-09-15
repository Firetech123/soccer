const WORKER_URL = 'https://dark-surf-6029.firetechsoftware.workers.dev/';
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB limit
let socket = null;
let typingTimeout = null;
let isTyping = false;
let currentUser = null; // { username, displayName, bio, avatar }
let authToken = localStorage.getItem('chat_token') || null;
let activeRecipient = null; // target user object
let activeReply = null;
let activeEdit = null;
let pressTimer = null;
let activeMenu = null;
let pendingImageBase64 = null;
let pendingImageName = '';
let searchTimeout = null;

// WebRTC & Call State Variables
const RTC_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

let localStream = null;
let remoteStream = null;
let peerConnection = null;
let currentCallId = null;
let currentCallType = 'voice'; // 'voice' or 'video'
let currentCallState = 'idle'; // 'idle', 'outgoing_calling', 'incoming_ringing', 'connected', 'ended'
let pendingCallOffer = null;
let isAudioMuted = false;
let isVideoOff = false;
let isCallMinimized = false;
let callTimerInterval = null;
let callDurationSeconds = 0;
let processedSignalIds = new Set();
let pendingIceCandidates = [];
let signalQueue = Promise.resolve();
let editedAvatarBase64 = null;

document.addEventListener('DOMContentLoaded', async () => {
  setupDragAndDropAndPaste();

  // Close menus on outside click
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('hamburger-menu');
    const hamburgerBtn = document.querySelector('.hamburger-btn');
    if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target) && !hamburgerBtn.contains(e.target)) {
      menu.classList.add('hidden');
    }
  });

  if (authToken) {
    const verified = await checkAuthSession();
    if (verified) {
      showChatScreen();
      return;
    }
  }

  showAuthScreen();
});

// Authentication Handlers

function toggleAuthMode(mode) {
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');
  const title = document.getElementById('auth-title');
  const subtitle = document.getElementById('auth-subtitle');
  const errorDiv = document.getElementById('auth-error');

  errorDiv.classList.add('hidden');
  errorDiv.textContent = '';

  if (mode === 'signup') {
    loginForm.classList.add('hidden');
    signupForm.classList.remove('hidden');
    title.textContent = 'Create an Account';
    subtitle.textContent = 'Sign up with a username and password to get started';
  } else {
    signupForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
    title.textContent = 'Log In to Chat';
    subtitle.textContent = 'Enter your account details to start messaging';
  }
}

async function checkAuthSession() {
  try {
    const res = await fetch('/api/users/me', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (res.ok) {
      currentUser = await res.json();
      return true;
    }
  } catch (err) {
    console.error('Session check failed:', err);
  }
  localStorage.removeItem('chat_token');
  authToken = null;
  currentUser = null;
  return false;
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorDiv = document.getElementById('auth-error');

  errorDiv.classList.add('hidden');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (!res.ok) {
      errorDiv.textContent = data.error || 'Failed to log in.';
      errorDiv.classList.remove('hidden');
      return;
    }

    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem('chat_token', authToken);

    showChatScreen();
  } catch (err) {
    errorDiv.textContent = 'Network error. Please try again.';
    errorDiv.classList.remove('hidden');
  }
}

async function handleSignup(e) {
  e.preventDefault();
  const username = document.getElementById('signup-username').value.trim();
  const displayName = document.getElementById('signup-displayname').value.trim();
  const password = document.getElementById('signup-password').value;
  const bio = document.getElementById('signup-bio').value.trim();
  const errorDiv = document.getElementById('auth-error');

  errorDiv.classList.add('hidden');

  try {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, displayName, password, bio })
    });
    const data = await res.json();

    if (!res.ok) {
      errorDiv.textContent = data.error || 'Failed to sign up.';
      errorDiv.classList.remove('hidden');
      return;
    }

    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem('chat_token', authToken);

    showChatScreen();
  } catch (err) {
    errorDiv.textContent = 'Network error. Please try again.';
    errorDiv.classList.remove('hidden');
  }
}

function handleLogout() {
  localStorage.removeItem('chat_token');
  authToken = null;
  currentUser = null;
  activeRecipient = null;
  if (socket) socket.disconnect();
  showAuthScreen();
  showToast('Logged out successfully.');
}

function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('chat-screen').classList.add('hidden');
  toggleAuthMode('login');
}

function showChatScreen() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('chat-screen').classList.remove('hidden');

  updateHamburgerUserInfo();
  setupSocket();
  loadConversations();
  setInterval(pollSignals, 1500);
}

function updateHamburgerUserInfo() {
  if (!currentUser) return;
  document.getElementById('menu-user-name').textContent = currentUser.displayName || currentUser.username;
  document.getElementById('menu-user-handle').textContent = `@${currentUser.username}`;
  document.getElementById('menu-user-avatar').src = currentUser.avatar || 'logo.jpg';
}

function toggleHamburgerMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById('hamburger-menu');
  menu.classList.toggle('hidden');
}

// Profile & Security Modals

function openProfileModal() {
  document.getElementById('hamburger-menu').classList.add('hidden');
  document.getElementById('edit-display-name').value = currentUser.displayName || '';
  document.getElementById('edit-bio').value = currentUser.bio || '';
  document.getElementById('profile-edit-avatar-preview').src = currentUser.avatar || 'logo.jpg';
  editedAvatarBase64 = null;
  document.getElementById('edit-profile-modal').classList.remove('hidden');
}

function openSecurityModal() {
  document.getElementById('hamburger-menu').classList.add('hidden');
  document.getElementById('current-password').value = '';
  document.getElementById('new-password').value = '';
  document.getElementById('security-modal').classList.remove('hidden');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.add('hidden');
}

function handleProfileAvatarSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('Please select a valid image file');
    return;
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    showToast('Image size exceeds 5MB limit');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(evt) {
    editedAvatarBase64 = evt.target.result;
    document.getElementById('profile-edit-avatar-preview').src = editedAvatarBase64;
  };
  reader.readAsDataURL(file);
}

async function handleSaveProfile(e) {
  e.preventDefault();
  const displayName = document.getElementById('edit-display-name').value.trim();
  const bio = document.getElementById('edit-bio').value.trim();

  const payload = { displayName, bio };
  if (editedAvatarBase64) {
    payload.avatar = editedAvatarBase64;
  }

  try {
    const res = await fetch('/api/users/me', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      currentUser = await res.json();
      updateHamburgerUserInfo();
      closeModal('edit-profile-modal');
      showToast('Profile updated successfully!');
    } else {
      const errData = await res.json();
      showToast(errData.error || 'Failed to update profile');
    }
  } catch (err) {
    showToast('Network error while updating profile');
  }
}

async function handleChangePassword(e) {
  e.preventDefault();
  const currentPassword = document.getElementById('current-password').value;
  const newPassword = document.getElementById('new-password').value;

  try {
    const res = await fetch('/api/users/me/password', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ currentPassword, newPassword })
    });

    const data = await res.json();
    if (res.ok) {
      closeModal('security-modal');
      showToast('Password updated successfully!');
    } else {
      showToast(data.error || 'Failed to change password');
    }
  } catch (err) {
    showToast('Network error while updating password');
  }
}

async function viewUserProfile(targetUsername) {
  try {
    const res = await fetch(`/api/users/${encodeURIComponent(targetUsername)}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) {
      showToast('User profile not found');
      return;
    }
    const userObj = await res.json();

    document.getElementById('view-profile-avatar').src = userObj.avatar || 'logo.jpg';
    document.getElementById('view-profile-displayname').textContent = userObj.displayName || userObj.username;
    document.getElementById('view-profile-username').textContent = `@${userObj.username}`;
    document.getElementById('view-profile-bio').textContent = userObj.bio || 'No bio provided.';

    document.getElementById('view-profile-modal').classList.remove('hidden');
  } catch (err) {
    showToast('Failed to load user profile');
  }
}

function openActiveChatProfileModal() {
  if (activeRecipient) {
    viewUserProfile(activeRecipient.username);
  }
}

// User Search & Conversation List

async function loadConversations() {
  try {
    const res = await fetch('/api/conversations', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;

    const conversations = await res.json();
    renderConversationsList(conversations);
  } catch (err) {
    console.error('Error loading conversations:', err);
  }
}

function renderConversationsList(conversations) {
  const container = document.getElementById('conversations-list');
  container.innerHTML = '';

  if (conversations.length === 0) {
    container.innerHTML = '<div style="padding: 16px; font-size: 13px; color: var(--text-muted); text-align: center;">No conversations yet. Search for a user above to chat!</div>';
    return;
  }

  conversations.forEach(c => {
    const user = c.user;
    const item = document.createElement('div');
    item.className = `conversation-item ${activeRecipient && activeRecipient.username === user.username ? 'active' : ''}`;
    item.onclick = () => selectConversation(user);

    const timeStr = c.lastMessage ? new Date(c.lastMessage.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    item.innerHTML = `
      <img src="${user.avatar || 'logo.jpg'}" class="avatar-img" alt="${user.displayName}">
      <div class="conversation-details">
        <div class="conversation-name-row">
          <span class="conversation-name">${user.displayName || user.username}</span>
          <span class="conversation-time">${timeStr}</span>
        </div>
        <div class="conversation-preview">${c.lastMessage ? (c.lastMessage.text.includes('data:image/') ? '📷 Photo' : c.lastMessage.text) : ''}</div>
      </div>
    `;
    container.appendChild(item);
  });
}

function handleUserSearchInput(e) {
  const query = e.target.value.trim();
  clearTimeout(searchTimeout);

  if (!query) {
    loadConversations();
    return;
  }

  searchTimeout = setTimeout(async () => {
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (!res.ok) return;

      const results = await res.json();
      renderSearchResults(results);
    } catch (err) {
      console.error('Error searching users:', err);
    }
  }, 300);
}

function renderSearchResults(results) {
  const container = document.getElementById('conversations-list');
  container.innerHTML = '<div class="search-section-title">Search Results</div>';

  if (results.length === 0) {
    container.innerHTML += '<div style="padding: 12px; font-size: 13px; color: var(--text-muted); text-align: center;">No users found</div>';
    return;
  }

  results.forEach(user => {
    const item = document.createElement('div');
    item.className = 'conversation-item';
    item.onclick = () => selectConversation(user);

    item.innerHTML = `
      <img src="${user.avatar || 'logo.jpg'}" class="avatar-img" alt="${user.displayName}">
      <div class="conversation-details">
        <div class="conversation-name">${user.displayName || user.username}</div>
        <div class="conversation-preview">@${user.username} • ${user.bio || ''}</div>
      </div>
    `;
    container.appendChild(item);
  });
}

async function selectConversation(userObj) {
  activeRecipient = userObj;
  document.getElementById('no-chat-selected').classList.add('hidden');
  document.getElementById('chat-messages-container').classList.remove('hidden');

  document.getElementById('active-chat-name').textContent = userObj.displayName || userObj.username;
  document.getElementById('active-chat-avatar').src = userObj.avatar || 'logo.jpg';
  document.getElementById('active-chat-status').innerHTML = `<span class="status-dot online"></span> @${userObj.username}`;

  // Reset conversation list highlighting
  const searchInput = document.getElementById('user-search-input');
  if (searchInput.value) {
    searchInput.value = '';
    loadConversations();
  }

  await loadDirectMessages(userObj.username);
}

// 1-on-1 Direct Messaging Functions

async function loadDirectMessages(recipientUsername) {
  try {
    const res = await fetch(`/api/messages/${encodeURIComponent(recipientUsername)}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;

    const messages = await res.json();
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';
    messages.forEach(appendMessage);
    scrollToBottom();
  } catch (err) {
    console.error('Error loading direct messages:', err);
  }
}

function setupSocket() {
  if (socket) socket.disconnect();

  socket = io({
    auth: { token: authToken }
  });

  socket.on('connect_error', (err) => {
    console.error('Socket connection error:', err.message);
  });

  socket.on('new_message', (msg) => {
    if (activeRecipient && (msg.sender.toLowerCase() === activeRecipient.username.toLowerCase() || msg.recipient.toLowerCase() === activeRecipient.username.toLowerCase())) {
      appendMessage(msg);
      scrollToBottom();
    }
    loadConversations();
  });

  socket.on('message_edited', (msg) => {
    if (activeRecipient && (msg.sender.toLowerCase() === activeRecipient.username.toLowerCase() || msg.recipient.toLowerCase() === activeRecipient.username.toLowerCase())) {
      updateMessageInDOM(msg);
    }
    loadConversations();
  });

  socket.on('message_deleted', (data) => {
    if (activeRecipient && (data.recipient.toLowerCase() === activeRecipient.username.toLowerCase() || data.recipient.toLowerCase() === currentUser.username.toLowerCase())) {
      markMessageAsDeletedInDOM(data.id);
    }
    loadConversations();
  });

  socket.on('user_typing', (data) => {
    if (activeRecipient && data.username.toLowerCase() === activeRecipient.username.toLowerCase()) {
      const typingIndicator = document.getElementById('typing-indicator');
      const typingText = document.getElementById('typing-text');
      typingText.textContent = `${activeRecipient.displayName || activeRecipient.username} is typing...`;
      typingIndicator.classList.add('active');
    }
  });

  socket.on('user_stop_typing', (data) => {
    if (activeRecipient && data.username.toLowerCase() === activeRecipient.username.toLowerCase()) {
      document.getElementById('typing-indicator').classList.remove('active');
    }
  });
}

function setupDragAndDropAndPaste() {
  const chatCard = document.getElementById('chat-screen');
  if (!chatCard) return;

  ['dragenter', 'dragover'].forEach(eventName => {
    chatCard.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      chatCard.classList.add('drag-active');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    chatCard.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      chatCard.classList.remove('drag-active');
    }, false);
  });

  chatCard.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files && files.length > 0) {
      processImageFile(files[0]);
    }
  });

  window.addEventListener('paste', (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData)?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.indexOf('image') !== -1) {
        const file = item.getAsFile();
        if (file) {
          processImageFile(file);
          break;
        }
      }
    }
  });
}

function processImageFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    showToast('Please select a valid image file');
    return;
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    showToast('Image size exceeds 5MB limit');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    pendingImageBase64 = e.target.result;
    pendingImageName = file.name || 'Pasted Image';
    showImagePreviewBar(pendingImageBase64, pendingImageName);
  };
  reader.readAsDataURL(file);
}

function handleImageFileSelect(e) {
  const file = e.target.files[0];
  if (file) {
    processImageFile(file);
  }
  e.target.value = '';
}

function showImagePreviewBar(base64Data, fileName) {
  const bar = document.getElementById('image-preview-bar');
  const img = document.getElementById('image-preview-img');
  const name = document.getElementById('image-preview-name');

  img.src = base64Data;
  name.textContent = fileName;
  bar.classList.remove('hidden');
}

function removeAttachedImage() {
  pendingImageBase64 = null;
  pendingImageName = '';
  const bar = document.getElementById('image-preview-bar');
  const img = document.getElementById('image-preview-img');
  if (img) img.src = '';
  if (bar) bar.classList.add('hidden');
}

/* ==========================================================================
   Voice & Video Call Implementation
   ========================================================================== */

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function startCallTimer() {
  stopCallTimer();
  callDurationSeconds = 0;
  callTimerInterval = setInterval(() => {
    callDurationSeconds++;
    const durationStr = formatDuration(callDurationSeconds);
    document.getElementById('call-status-text').textContent = durationStr;
    const icon = currentCallType === 'video' ? '📹' : '📞';
    const title = currentCallType === 'video' ? 'Video call' : 'Voice call';
    document.getElementById('minimized-call-text').textContent = `${icon} ${title} • ${durationStr}`;
  }, 1000);
}

function stopCallTimer() {
  if (callTimerInterval) {
    clearInterval(callTimerInterval);
    callTimerInterval = null;
  }
}

function sendSignal(signalData) {
  signalQueue = signalQueue.then(async () => {
    try {
      const res = await fetch(`${WORKER_URL}?key=webrtc_signals`);
      let signals = [];
      if (res.ok) {
        signals = await res.json();
        if (typeof signals === 'string') {
          try { signals = JSON.parse(signals); } catch { signals = []; }
        }
      }
      if (!Array.isArray(signals)) signals = [];

      const now = Date.now();
      signals = signals.filter(s => s.timestamp && (now - s.timestamp < 120000));

      const signalObj = {
        id: now.toString() + Math.random().toString(36).substring(2, 6),
        timestamp: now,
        sender: currentUser ? currentUser.username : 'Anonymous',
        ...signalData
      };

      signals.push(signalObj);

      await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'webrtc_signals',
          value: JSON.stringify(signals)
        })
      });
    } catch (err) {
      console.error('Error sending WebRTC signal:', err);
    }
  });
  return signalQueue;
}

async function pollSignals() {
  if (!currentUser) return;

  try {
    const res = await fetch(`${WORKER_URL}?key=webrtc_signals`);
    if (!res.ok) return;

    let signals = await res.json();
    if (typeof signals === 'string') {
      try { signals = JSON.parse(signals); } catch { signals = []; }
    }
    if (!Array.isArray(signals)) return;

    for (const signal of signals) {
      if (!signal || !signal.id || processedSignalIds.has(signal.id)) continue;
      if (signal.sender === currentUser.username) continue;

      processedSignalIds.add(signal.id);

      if (signal.type === 'offer') {
        if (currentCallState === 'idle') {
          pendingCallOffer = signal;
          currentCallType = signal.callType || 'voice';
          currentCallId = signal.callId;
          showIncomingCallOverlay(signal);
        } else {
          sendSignal({ type: 'decline', callId: signal.callId, reason: 'busy' });
        }
      } else if (signal.type === 'answer') {
        if (signal.callId === currentCallId && peerConnection) {
          if (peerConnection.signalingState === 'have-local-offer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.answer));
            processPendingIceCandidates();
            onCallConnected();
          }
        }
      } else if (signal.type === 'candidate') {
        if (signal.callId === currentCallId) {
          const candidate = new RTCIceCandidate(signal.candidate);
          if (peerConnection && peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
            await peerConnection.addIceCandidate(candidate).catch(e => console.error(e));
          } else {
            pendingIceCandidates.push(candidate);
          }
        }
      } else if (signal.type === 'decline') {
        if (signal.callId === currentCallId) {
          const reasonText = signal.reason === 'busy' ? 'User is busy' : 'Call declined';
          showToast(reasonText);
          logCallHistorySystemMessage(reasonText, currentCallType, false);
          resetCallState();
        }
      } else if (signal.type === 'hangup') {
        if (signal.callId === currentCallId) {
          showToast('Call ended by peer');
          logCallHistorySystemMessage(callDurationSeconds > 0 ? `Call ended • ${formatDuration(callDurationSeconds)}` : 'Call ended', currentCallType, true);
          resetCallState();
        }
      }
    }
  } catch (err) {
    console.error('Error polling WebRTC signals:', err);
  }
}

async function processPendingIceCandidates() {
  if (peerConnection && peerConnection.remoteDescription && pendingIceCandidates.length > 0) {
    for (const candidate of pendingIceCandidates) {
      await peerConnection.addIceCandidate(candidate).catch(e => console.error(e));
    }
    pendingIceCandidates = [];
  }
}

async function setupLocalMedia(type) {
  try {
    const constraints = { audio: true, video: type === 'video' };
    localStream = await navigator.mediaDevices.getUserMedia(constraints);

    if (type === 'video') {
      const localVideoEl = document.getElementById('call-local-video');
      localVideoEl.srcObject = localStream;
    }
    return true;
  } catch (err) {
    console.error('Failed to get media devices:', err);
    showToast('Could not access camera/microphone');
    return false;
  }
}

function createPeerConnection() {
  peerConnection = new RTCPeerConnection(RTC_CONFIG);
  remoteStream = new MediaStream();

  const remoteVideoEl = document.getElementById('call-remote-video');
  remoteVideoEl.srcObject = remoteStream;

  if (localStream) {
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
  }

  peerConnection.ontrack = (event) => {
    event.streams[0].getTracks().forEach(track => {
      remoteStream.addTrack(track);
    });
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate && currentCallId) {
      sendSignal({
        type: 'candidate',
        callId: currentCallId,
        candidate: event.candidate
      });
    }
  };

  peerConnection.onconnectionstatechange = () => {
    if (peerConnection.connectionState === 'connected') {
      onCallConnected();
    } else if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
      showToast('Call disconnected');
      resetCallState();
    }
  };
}

async function startCall(type = 'voice') {
  if (!activeRecipient) {
    showToast('Select a conversation to start a call');
    return;
  }
  if (currentCallState !== 'idle') {
    showToast('Already in a call');
    return;
  }

  currentCallType = type;
  currentCallState = 'outgoing_calling';
  currentCallId = 'call_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

  document.getElementById('call-peer-name').textContent = activeRecipient.displayName || activeRecipient.username;
  document.getElementById('call-avatar-img').src = activeRecipient.avatar || 'logo.jpg';
  updateCallOverlayUI();
  document.getElementById('call-overlay-modal').classList.remove('hidden');

  const mediaOk = await setupLocalMedia(type);
  if (!mediaOk) {
    resetCallState();
    return;
  }

  createPeerConnection();

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  await sendSignal({
    type: 'offer',
    callId: currentCallId,
    callType: type,
    offer: offer
  });
}

function showIncomingCallOverlay(signal) {
  currentCallState = 'incoming_ringing';
  updateCallOverlayUI();
  document.getElementById('call-peer-name').textContent = signal.sender || 'Someone';
  document.getElementById('call-overlay-modal').classList.remove('hidden');
}

async function acceptCall() {
  if (!pendingCallOffer) return;

  const offerSignal = pendingCallOffer;
  pendingCallOffer = null;

  currentCallState = 'connecting';
  currentCallType = offerSignal.callType || 'voice';
  currentCallId = offerSignal.callId;

  updateCallOverlayUI();

  const mediaOk = await setupLocalMedia(currentCallType);
  if (!mediaOk) {
    sendSignal({
      type: 'decline',
      callId: currentCallId
    });
    resetCallState();
    return;
  }

  createPeerConnection();

  await peerConnection.setRemoteDescription(new RTCSessionDescription(offerSignal.offer));
  processPendingIceCandidates();

  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  await sendSignal({
    type: 'answer',
    callId: currentCallId,
    answer: answer
  });

  onCallConnected();
}

function handleCallEndOrDecline() {
  if (currentCallState === 'incoming_ringing') {
    declineCall();
  } else {
    endCall('hangup');
  }
}

function declineCall() {
  if (pendingCallOffer) {
    sendSignal({
      type: 'decline',
      callId: pendingCallOffer.callId
    });
    logCallHistorySystemMessage(`Missed ${currentCallType} call`, currentCallType, false, true);
    pendingCallOffer = null;
  }
  resetCallState();
}

function endCall(type = 'hangup') {
  if (currentCallId) {
    sendSignal({
      type: 'hangup',
      callId: currentCallId
    });
    if (currentCallState === 'connected') {
      logCallHistorySystemMessage(`${currentCallType === 'video' ? 'Video' : 'Voice'} call • ${formatDuration(callDurationSeconds)}`, currentCallType, true);
    } else {
      logCallHistorySystemMessage(`Cancelled ${currentCallType} call`, currentCallType, true);
    }
  }
  resetCallState();
}

function onCallConnected() {
  if (currentCallState === 'connected') return;
  currentCallState = 'connected';
  updateCallOverlayUI();
  startCallTimer();
  showToast('Call connected');
}

function updateCallOverlayUI() {
  const callTypeIcon = document.getElementById('call-type-icon');
  const callTypeTitle = document.getElementById('call-type-title');
  const statusText = document.getElementById('call-status-text');
  const videoGrid = document.getElementById('call-video-grid');
  const acceptBtn = document.getElementById('call-accept-btn');
  const endBtn = document.getElementById('call-end-btn');
  const pulse1 = document.getElementById('call-pulse-ring-1');
  const pulse2 = document.getElementById('call-pulse-ring-2');
  const userDetails = document.getElementById('call-user-details');

  const isVideo = currentCallType === 'video';
  callTypeIcon.textContent = isVideo ? '📹' : '📞';
  callTypeTitle.textContent = isVideo ? 'Video Call' : 'Voice Call';

  if (isVideo && currentCallState === 'connected') {
    videoGrid.classList.remove('hidden');
    userDetails.style.zIndex = '5';
  } else {
    videoGrid.classList.add('hidden');
    userDetails.style.zIndex = '10';
  }

  if (currentCallState === 'outgoing_calling') {
    statusText.textContent = 'Calling...';
    pulse1.classList.remove('hidden');
    pulse2.classList.remove('hidden');
    acceptBtn.classList.add('hidden');
    endBtn.classList.remove('hidden');
  } else if (currentCallState === 'incoming_ringing') {
    statusText.textContent = `Incoming ${isVideo ? 'video' : 'voice'} call...`;
    pulse1.classList.remove('hidden');
    pulse2.classList.remove('hidden');
    acceptBtn.classList.remove('hidden');
    endBtn.classList.remove('hidden');
  } else if (currentCallState === 'connecting') {
    statusText.textContent = 'Connecting...';
    pulse1.classList.add('hidden');
    pulse2.classList.add('hidden');
    acceptBtn.classList.add('hidden');
    endBtn.classList.remove('hidden');
  } else if (currentCallState === 'connected') {
    statusText.textContent = formatDuration(callDurationSeconds);
    pulse1.classList.add('hidden');
    pulse2.classList.add('hidden');
    acceptBtn.classList.add('hidden');
    endBtn.classList.remove('hidden');
  }
}

function minimizeCallOverlay() {
  isCallMinimized = true;
  document.getElementById('call-overlay-modal').classList.add('hidden');
  document.getElementById('minimized-call-bar').classList.remove('hidden');
}

function expandCallOverlay() {
  isCallMinimized = false;
  document.getElementById('minimized-call-bar').classList.add('hidden');
  document.getElementById('call-overlay-modal').classList.remove('hidden');
}

function toggleAudio() {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    isAudioMuted = !isAudioMuted;
    audioTrack.enabled = !isAudioMuted;
    const btn = document.getElementById('call-toggle-audio-btn');
    if (isAudioMuted) {
      btn.classList.add('off');
      btn.textContent = '🔇';
    } else {
      btn.classList.remove('off');
      btn.textContent = '🎤';
    }
  }
}

function toggleVideo() {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    isVideoOff = !isVideoOff;
    videoTrack.enabled = !isVideoOff;
    const btn = document.getElementById('call-toggle-video-btn');
    if (isVideoOff) {
      btn.classList.add('off');
      btn.textContent = '📷';
    } else {
      btn.classList.remove('off');
      btn.textContent = '📹';
    }
  }
}

function resetCallState() {
  stopCallTimer();

  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  if (remoteStream) {
    remoteStream.getTracks().forEach(track => track.stop());
    remoteStream = null;
  }

  currentCallId = null;
  currentCallState = 'idle';
  pendingCallOffer = null;
  isAudioMuted = false;
  isVideoOff = false;
  isCallMinimized = false;
  callDurationSeconds = 0;
  pendingIceCandidates = [];

  const localVideoEl = document.getElementById('call-local-video');
  const remoteVideoEl = document.getElementById('call-remote-video');
  if (localVideoEl) localVideoEl.srcObject = null;
  if (remoteVideoEl) remoteVideoEl.srcObject = null;

  document.getElementById('call-overlay-modal').classList.add('hidden');
  document.getElementById('minimized-call-bar').classList.add('hidden');

  const audioBtn = document.getElementById('call-toggle-audio-btn');
  const videoBtn = document.getElementById('call-toggle-video-btn');
  if (audioBtn) { audioBtn.classList.remove('off'); audioBtn.textContent = '🎤'; }
  if (videoBtn) { videoBtn.classList.remove('off'); videoBtn.textContent = '📹'; }
}

function logCallHistorySystemMessage(text, type = 'voice', isSent = true, isMissed = false) {
  const icon = type === 'video' ? '📹' : '📞';
  const systemMessage = {
    id: Date.now().toString() + Math.random().toString(36).substring(2, 6),
    isSystem: true,
    text: `${icon} ${text}`,
    isMissed: isMissed,
    timestamp: new Date().toISOString()
  };

  appendMessage(systemMessage);
  scrollToBottom();
}

function setReplyTarget(msg) {
  cancelEdit();
  activeReply = {
    id: msg.id,
    sender: msg.senderDisplayName || msg.sender,
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
  if (previewBar) previewBar.classList.add('hidden');
}

function setEditTarget(msg) {
  cancelReply();
  activeEdit = msg;

  const previewBar = document.getElementById('edit-preview-bar');
  const previewText = document.getElementById('edit-preview-text');

  previewText.textContent = msg.text;
  previewBar.classList.remove('hidden');

  const input = document.getElementById('message-input');
  input.value = msg.text;
  input.focus();
}

function cancelEdit() {
  activeEdit = null;
  const previewBar = document.getElementById('edit-preview-bar');
  if (previewBar) previewBar.classList.add('hidden');
}

function showToast(message) {
  const existing = document.querySelector('.toast-notification');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 2000);
}

function closeContextMenu() {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
}

function openImageModal(src) {
  const backdrop = document.createElement('div');
  backdrop.className = 'image-modal-backdrop';
  backdrop.onclick = (e) => {
    if (e.target === backdrop || e.target.classList.contains('image-modal-close')) {
      backdrop.remove();
    }
  };

  const closeBtn = document.createElement('span');
  closeBtn.className = 'image-modal-close';
  closeBtn.innerHTML = '&times;';

  const img = document.createElement('img');
  img.className = 'image-modal-content';
  img.src = src;
  img.alt = 'Full size preview';

  backdrop.appendChild(closeBtn);
  backdrop.appendChild(img);
  document.body.appendChild(backdrop);
}

function openContextMenu(event, msg) {
  event.preventDefault();
  closeContextMenu();

  const backdrop = document.createElement('div');
  backdrop.className = 'message-menu-backdrop';
  backdrop.onclick = (e) => {
    if (e.target === backdrop) closeContextMenu();
  };

  const dialog = document.createElement('div');
  dialog.className = 'message-menu-dialog';

  // Copy Option
  const copyBtn = document.createElement('button');
  copyBtn.className = 'message-menu-item';
  copyBtn.innerHTML = '<span>📋</span> Copy';
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(msg.text).then(() => {
      showToast('Copied to clipboard!');
    }).catch(() => {
      const textArea = document.createElement('textarea');
      textArea.value = msg.text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      showToast('Copied to clipboard!');
    });
    closeContextMenu();
  };
  dialog.appendChild(copyBtn);

  // Edit & Delete Options
  if (msg.sender.toLowerCase() === currentUser.username.toLowerCase() && !msg.isDeleted) {
    const editBtn = document.createElement('button');
    editBtn.className = 'message-menu-item';
    editBtn.innerHTML = '<span>✏️</span> Edit';
    editBtn.onclick = () => {
      setEditTarget(msg);
      closeContextMenu();
    };

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'message-menu-item danger';
    deleteBtn.innerHTML = '<span>🗑️</span> Delete';
    deleteBtn.onclick = () => {
      if (socket && activeRecipient) {
        socket.emit('delete_message', { id: msg.id, recipient: activeRecipient.username });
      }
      closeContextMenu();
    };

    dialog.appendChild(editBtn);
    dialog.appendChild(deleteBtn);
  }

  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  activeMenu = backdrop;
}

function attachHoldAndContextMenuEvents(element, msg) {
  element.oncontextmenu = (e) => {
    clearTimeout(pressTimer);
    openContextMenu(e, msg);
  };

  const startPress = (e) => {
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      openContextMenu(e, msg);
    }, 500);
  };

  const cancelPress = () => {
    clearTimeout(pressTimer);
  };

  element.ontouchstart = startPress;
  element.ontouchend = cancelPress;
  element.ontouchmove = cancelPress;
  element.onmousedown = startPress;
  element.onmouseup = cancelPress;
  element.onmouseleave = cancelPress;
}

function appendMessage(msg) {
  const container = document.getElementById('chat-messages');

  if (msg.isSystem) {
    const systemDiv = document.createElement('div');
    systemDiv.className = `system-call-bubble ${msg.isMissed ? 'missed' : ''}`;
    systemDiv.textContent = msg.text;
    container.appendChild(systemDiv);
    return;
  }

  const isSent = msg.sender.toLowerCase() === currentUser.username.toLowerCase();

  const bubble = document.createElement('div');
  bubble.className = `message-bubble ${isSent ? 'sent' : 'received'}`;
  bubble.dataset.id = msg.id;

  const headerRow = document.createElement('div');
  headerRow.className = 'message-header-row';

  const senderDiv = document.createElement('div');
  senderDiv.className = 'message-sender';
  senderDiv.textContent = msg.senderDisplayName || msg.sender;
  senderDiv.onclick = () => viewUserProfile(msg.sender);

  const replyBtn = document.createElement('button');
  replyBtn.type = 'button';
  replyBtn.className = 'reply-btn';
  replyBtn.textContent = 'Reply';
  replyBtn.onclick = () => setReplyTarget(msg);

  headerRow.appendChild(senderDiv);
  headerRow.appendChild(replyBtn);
  bubble.appendChild(headerRow);

  if (msg.replyTo) {
    const quoteDiv = document.createElement('div');
    quoteDiv.className = 'reply-quote';

    const quoteSender = document.createElement('div');
    quoteSender.className = 'reply-quote-sender';
    quoteSender.textContent = msg.replyTo.sender || 'User';

    const quoteText = document.createElement('div');
    quoteText.className = 'reply-quote-text';

    let displayQuoteText = msg.replyTo.text || '';
    if (displayQuoteText.includes('data:image/')) {
      const match = displayQuoteText.match(/data:image\/[a-zA-Z]+;base64,[^\n\s]+/);
      if (match) {
        const caption = displayQuoteText.replace(match[0], '').trim();
        displayQuoteText = caption ? `📷 Image: ${caption}` : '📷 Image';
      }
    }
    quoteText.textContent = displayQuoteText;

    quoteDiv.appendChild(quoteSender);
    quoteDiv.appendChild(quoteText);
    bubble.appendChild(quoteDiv);
  }

  const textDiv = document.createElement('div');
  textDiv.className = 'message-text-content';

  if (msg.isDeleted) {
    bubble.classList.add('deleted-bubble');
    textDiv.textContent = 'This message was deleted';
  } else {
    const fullText = msg.text || '';
    const base64Regex = /data:image\/[a-zA-Z]+;base64,[^\n\s]+/;
    const match = fullText.match(base64Regex);

    if (match) {
      const imageSrc = match[0];
      const captionText = fullText.replace(imageSrc, '').trim();

      const imgEl = document.createElement('img');
      imgEl.src = imageSrc;
      imgEl.alt = 'Uploaded Image';
      imgEl.className = 'chat-image-thumbnail';
      imgEl.onclick = (e) => {
        e.stopPropagation();
        openImageModal(imageSrc);
      };
      textDiv.appendChild(imgEl);

      if (captionText) {
        const captionDiv = document.createElement('div');
        captionDiv.textContent = captionText;
        textDiv.appendChild(captionDiv);
      }
    } else {
      textDiv.textContent = fullText;
    }

    if (msg.isEdited) {
      const editedSpan = document.createElement('span');
      editedSpan.className = 'edited-tag';
      editedSpan.textContent = ' (edited)';
      textDiv.appendChild(editedSpan);
    }
  }

  const timeDiv = document.createElement('div');
  timeDiv.className = 'message-time';
  const timeStr = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  timeDiv.textContent = timeStr;

  bubble.appendChild(textDiv);
  bubble.appendChild(timeDiv);

  if (!msg.isDeleted) {
    attachHoldAndContextMenuEvents(bubble, msg);
  }

  container.appendChild(bubble);
}

function updateMessageInDOM(msg) {
  const bubble = document.querySelector(`.message-bubble[data-id="${msg.id}"]`);
  if (!bubble) return;

  const textDiv = bubble.querySelector('.message-text-content');
  if (textDiv) {
    textDiv.textContent = msg.text;
    if (msg.isEdited) {
      const editedSpan = document.createElement('span');
      editedSpan.className = 'edited-tag';
      editedSpan.textContent = ' (edited)';
      textDiv.appendChild(editedSpan);
    }
    attachHoldAndContextMenuEvents(bubble, msg);
  }
}

function markMessageAsDeletedInDOM(msgId) {
  const bubble = document.querySelector(`.message-bubble[data-id="${msgId}"]`);
  if (!bubble) return;

  bubble.classList.add('deleted-bubble');
  const textDiv = bubble.querySelector('.message-text-content');
  if (textDiv) {
    textDiv.textContent = 'This message was deleted';
  }
}

function scrollToBottom() {
  const container = document.getElementById('chat-messages');
  container.scrollTop = container.scrollHeight;
}

function handleSendMessage(e) {
  e.preventDefault();
  if (!activeRecipient || !socket) return;

  const input = document.getElementById('message-input');
  const captionText = input.value.trim();

  if (!captionText && !pendingImageBase64) return;

  let combinedText = captionText;
  if (pendingImageBase64) {
    combinedText = captionText ? `${pendingImageBase64}\n${captionText}` : pendingImageBase64;
  }

  if (activeEdit) {
    socket.emit('edit_message', { id: activeEdit.id, recipient: activeRecipient.username, text: combinedText });
    input.value = '';
    removeAttachedImage();
    cancelEdit();
    if (isTyping) {
      socket.emit('stop_typing', { recipient: activeRecipient.username });
      isTyping = false;
    }
    return;
  }

  const payload = { recipient: activeRecipient.username, text: combinedText };
  if (activeReply) {
    payload.replyTo = activeReply;
  }

  socket.emit('send_message', payload);
  input.value = '';
  removeAttachedImage();
  cancelReply();

  if (isTyping) {
    socket.emit('stop_typing', { recipient: activeRecipient.username });
    isTyping = false;
  }
}

function handleTypingInput() {
  if (!socket || !activeRecipient) return;

  if (!isTyping) {
    isTyping = true;
    socket.emit('typing', { recipient: activeRecipient.username });
  }

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    if (isTyping) {
      isTyping = false;
      socket.emit('stop_typing', { recipient: activeRecipient.username });
    }
  }, 1500);
}
