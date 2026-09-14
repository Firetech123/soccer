let socket = null;
let typingTimeout = null;
let isTyping = false;
let currentUsername = '';
let activeReply = null;
let activeEdit = null;
let pressTimer = null;
let activeMenu = null;

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
      // Fallback
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
  textDiv.className = 'message-text-content';

  if (msg.isDeleted) {
    bubble.classList.add('deleted-bubble');
    textDiv.textContent = 'This message was deleted';
  } else {
    textDiv.textContent = msg.text;
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
  const text = input.value.trim();

  if (!text || !socket) return;

  if (activeEdit) {
    socket.emit('edit_message', { id: activeEdit.id, text });
    input.value = '';
    cancelEdit();
    if (isTyping) {
      socket.emit('stop_typing');
      isTyping = false;
    }
    return;
  }

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
