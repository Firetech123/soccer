const WORKER_URL = 'https://dark-surf-6029.firetechsoftware.workers.dev/';
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB limit
let socket = null;
let typingTimeout = null;
let isTyping = false;
let currentUsername = '';
let activeReply = null;
let activeEdit = null;
let pressTimer = null;
let activeMenu = null;
let pendingImageBase64 = null;
let pendingImageName = '';

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

document.addEventListener('DOMContentLoaded', () => {
  setupDragAndDropAndPaste();
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

function setupDragAndDropAndPaste() {
  const chatCard = document.getElementById('chat-screen');
  if (!chatCard) return;

  // Drag and drop handlers
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

  // Clipboard paste listener
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
  reader.onerror = function() {
    showToast('Failed to read image file');
  };
  reader.readAsDataURL(file);
}

function handleImageFileSelect(e) {
  const file = e.target.files[0];
  if (file) {
    processImageFile(file);
  }
  e.target.value = ''; // reset input
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
  setInterval(pollSignals, 1500);
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

  socket.on('message_edited', (msg) => {
    updateMessageInDOM(msg);
  });

  socket.on('message_deleted', (data) => {
    markMessageAsDeletedInDOM(data.id);
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

/* ==========================================================================
   WhatsApp Voice & Video Call Implementation
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
        sender: currentUsername,
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
  if (!currentUsername) return;

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
      if (signal.sender === currentUsername) continue;

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
    const constraints = {
      audio: true,
      video: type === 'video'
    };
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
  if (currentCallState !== 'idle') {
    showToast('Already in a call');
    return;
  }

  currentCallType = type;
  currentCallState = 'outgoing_calling';
  currentCallId = 'call_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

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
  const modal = document.getElementById('call-overlay-modal');
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
  callTypeTitle.textContent = isVideo ? 'WhatsApp Video Call' : 'WhatsApp Voice Call';

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
  if (previewBar) {
    previewBar.classList.add('hidden');
  }
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
    const textToCopy = msg.text;
    navigator.clipboard.writeText(textToCopy).then(() => {
      showToast('Copied to clipboard!');
    }).catch(() => {
      // Fallback
      const textArea = document.createElement('textarea');
      textArea.value = textToCopy;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      showToast('Copied to clipboard!');
    });
    closeContextMenu();
  };
  dialog.appendChild(copyBtn);

  // Edit & Delete Options (Only for sender's own messages)
  if (msg.sender === currentUsername && !msg.isDeleted) {
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
      if (socket) {
        socket.emit('delete_message', { id: msg.id });
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
  // Right click context menu for desktop
  element.oncontextmenu = (e) => {
    clearTimeout(pressTimer);
    openContextMenu(e, msg);
  };

  // Long press for touch devices & click-hold
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
  const input = document.getElementById('message-input');
  const captionText = input.value.trim();

  if ((!captionText && !pendingImageBase64) || !socket) return;

  let combinedText = captionText;
  if (pendingImageBase64) {
    combinedText = captionText ? `${pendingImageBase64}\n${captionText}` : pendingImageBase64;
  }

  if (activeEdit) {
    socket.emit('edit_message', { id: activeEdit.id, text: combinedText });
    input.value = '';
    removeAttachedImage();
    cancelEdit();
    if (isTyping) {
      socket.emit('stop_typing');
      isTyping = false;
    }
    return;
  }

  const payload = { text: combinedText };
  if (activeReply) {
    payload.replyTo = activeReply;
  }

  socket.emit('send_message', payload);
  input.value = '';
  removeAttachedImage();
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
