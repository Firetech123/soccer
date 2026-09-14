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
