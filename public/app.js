// app.js - Enhanced Application Logic with Telegram-like Features
const API_URL = window.location.origin;
const socket = io(API_URL);

let currentUser = null;
let selectedUser = null;
let allUsers = [];
let onlineUsers = new Set();
let typingTimeout = null;
let selectedFile = null;

// WebRTC variables
let localStream = null;
let remoteStream = null;
let peerConnection = null;
let isCallActive = false;
let callType = null;
let incomingCallData = null;
let isMuted = false;
let isVideoOff = false;
let callStartTime = null;
let callDurationInterval = null;

const config = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Emoji data
const emojis = {
  smileys: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '🥲', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐'],
  animals: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🦟', '🦗', '🕷️', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🦮', '🐈', '🐓', '🦃', '🦚', '🦜', '🦢', '🦩', '🕊️', '🐇', '🦝', '🦨', '🦡', '🦦', '🦥', '🐁', '🐀', '🐿️', '🦔'],
  food: ['🍕', '🍔', '🍟', '🌭', '🍿', '🧈', '🥓', '🥚', '🍳', '🧇', '🥞', '🧈', '🍞', '🥐', '🥨', '🥯', '🥖', '🧀', '🥗', '🥙', '🥪', '🌮', '🌯', '🥫', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🦪', '🍤', '🍙', '🍚', '🍘', '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨', '🍦', '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '🌰', '🥜', '🍯', '🥛', '🍼', '☕', '🍵', '🧃', '🥤', '🍶', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧉', '🍾', '🧊', '🥄', '🍴', '🍽️', '🥣', '🥡', '🥢', '🧂'],
  activities: ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️', '🥌', '🎿', '⛷️', '🏂', '🪂', '🏋️', '🤼', '🤸', '🤺', '🤾', '🏌️', '🏇', '🧘', '🏊', '🤽', '🚣', '🧗', '🚴', '🚵', '🎪', '🎭', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸', '🪕', '🎻', '🎲', '♟️', '🎯', '🎳', '🎮', '🎰', '🧩'],
  travel: ['✈️', '🚀', '🛸', '🚁', '🛶', '⛵', '🚤', '🛥️', '🛳️', '⛴️', '🚢', '⚓', '⛽', '🚧', '🚦', '🚥', '🚏', '🗺️', '🗿', '🗽', '🗼', '🏰', '🏯', '🏟️', '🎡', '🎢', '🎠', '⛲', '⛱️', '🏖️', '🏝️', '🏜️', '🌋', '⛰️', '🏔️', '🗻', '🏕️', '⛺', '🏠', '🏡', '🏘️', '🏚️', '🏗️', '🏭', '🏢', '🏬', '🏣', '🏤', '🏥', '🏦', '🏨', '🏪', '🏫', '🏩', '💒', '🏛️', '⛪', '🕌', '🕍', '🛕', '🕋', '⛩️', '🛤️', '🛣️', '🗾', '🎑', '🏞️', '🌅', '🌄', '🌠', '🎇', '🎆', '🌇', '🌆', '🏙️', '🌃', '🌌', '🌉', '🌁'],
  objects: ['💡', '🔦', '🕯️', '🪔', '🧯', '🛢️', '💸', '💵', '💴', '💶', '💷', '💰', '💳', '🪙', '💎', '⚖️', '🪜', '🧰', '🔧', '🔨', '⚒️', '🛠️', '⛏️', '🔩', '⚙️', '🪛', '🔗', '⛓️', '🧲', '🔫', '💣', '🧨', '🪓', '🔪', '🗡️', '⚔️', '🛡️', '🚬', '⚰️', '⚱️', '🏺', '🔮', '📿', '🧿', '💈', '⚗️', '🔭', '🔬', '🕳️', '🩹', '🩺', '💊', '💉', '🩸', '🧬', '🦠', '🧫', '🧪', '🌡️', '🧹', '🧺', '🧻', '🚽', '🚰', '🚿', '🛁', '🛀', '🧼', '🪒', '🧽', '🧴', '🛎️', '🔑', '🗝️', '🚪', '🪑', '🛋️', '🛏️', '🛌', '🧸', '🖼️', '🛍️', '🛒', '🎁', '🎈', '🎏', '🎀', '🎊', '🎉', '🎎', '🏮', '🎐', '🧧', '✉️', '📩', '📨', '📧', '💌', '📥', '📤', '📦', '🏷️', '📪', '📫', '📬', '📭', '📮', '📯', '📜', '📃', '📄', '📑', '🧾', '📊', '📈', '📉', '🗒️', '🗓️', '📆', '📅', '🗑️', '📇', '🗃️', '🗳️', '🗄️', '📋', '📁', '📂', '🗂️', '🗞️', '📰', '📓', '📔', '📒', '📕', '📗', '📘', '📙', '📚', '📖', '🔖', '🧷', '🔗', '📎', '🖇️', '📐', '📏', '🧮', '📌', '📍', '✂️', '🖊️', '🖋️', '✒️', '🖌️', '🖍️', '📝', '✏️', '🔍', '🔎', '🔏', '🔐', '🔒', '🔓'],
  symbols: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶', '🈚', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗', '❕', '❓', '❔', '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️', '✅', '🈯', '💹', '❇️', '✳️', '❎', '🌐', '💠', 'Ⓜ️', '🌀', '💤', '🏧', '🚾', '♿', '🅿️', '🈳', '🈂️', '🛂', '🛃', '🛄', '🛅', '🚹', '🚺', '🚼', '🚻', '🚮', '🎦', '📶', '🈁', '🔣', 'ℹ️', '🔤', '🔡', '🔠', '🆖', '🆗', '🆙', '🆒', '🆕', '🆓', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', '🔢', '#️⃣', '*️⃣', '⏏️', '▶️', '⏸️', '⏯️', '⏹️', '⏺️', '⏭️', '⏮️', '⏩', '⏪', '⏫', '⏬', '◀️', '🔼', '🔽', '➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', '↙️', '↖️', '↕️', '↔️', '↪️', '↩️', '⤴️', '⤵️', '🔀', '🔁', '🔂', '🔄', '🔃', '🎵']
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  setupEventListeners();
  initializeEmojiPicker();
  
  // Fix for mobile sidebar visibility on load
  if (window.innerWidth <= 768) {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
      sidebar.classList.add('open');
    }
  }
});

function checkAuth() {
  const userData = localStorage.getItem('currentUser');
  if (!userData) {
    window.location.href = 'login.html';
    return;
  }
  
  currentUser = JSON.parse(userData);
  initializeApp();
}

async function initializeApp() {
  // Update UI with current user info
  document.getElementById('currentUserName').textContent = currentUser.nama;
  document.getElementById('currentUserAvatar').textContent = currentUser.nama.charAt(0).toUpperCase();
  
  // Join socket
  socket.emit('join', currentUser.username);
  
  // Load users
  await loadUsers();
  
  // Setup socket listeners
  setupSocketListeners();
}

function setupEventListeners() {
  // Message input
  const messageInput = document.getElementById('messageInput');
  if (messageInput) {
    messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !messageInput.disabled) {
        sendMessage();
      }
    });
    
    // Typing indicator
    messageInput.addEventListener('input', () => {
      if (selectedUser) {
        socket.emit('typing', {
          from: currentUser.username,
          to: selectedUser.username
        });
        
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
          socket.emit('stop_typing', {
            from: currentUser.username,
            to: selectedUser.username
          });
        }, 3000);
      }
    });
  }
  
  // Search users
  const searchInput = document.getElementById('searchUsers');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      filterUsers(e.target.value);
    });
  }
  
  // Close emoji picker when clicking outside
  document.addEventListener('click', (e) => {
    const emojiPicker = document.getElementById('emojiPicker');
    const emojiButton = e.target.closest('button[onclick="toggleEmojiPicker()"]');
    if (!emojiPicker.contains(e.target) && !emojiButton && !emojiPicker.classList.contains('hidden')) {
      emojiPicker.classList.add('hidden');
    }
  });
  
  // Handle resize events to fix layout
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      const sidebar = document.querySelector('.sidebar');
      sidebar.classList.remove('open'); // Reset for desktop
      sidebar.style.transform = ''; // Clear manual styles
    } else {
      // On mobile, if no user selected, show sidebar
      if (!selectedUser) {
        document.querySelector('.sidebar').classList.add('open');
      }
    }
  });
}

function setupSocketListeners() {
  // Receive message
  socket.on('receive_message', (data) => {
    if (!selectedUser) return;
    
    if ((data.from === selectedUser.username && data.to === currentUser.username) ||
        (data.from === currentUser.username && data.to === selectedUser.username)) {
      displayMessage(data);
      
      // Mark as read if we're viewing the chat
      if (data.from === selectedUser.username) {
        socket.emit('message_read', {
          messageId: data.id,
          from: currentUser.username,
          to: selectedUser.username
        });
      }
    }
  });
  
  // User online status
  socket.on('user_online', (users) => {
    onlineUsers = new Set(users);
    updateOnlineStatus();
  });
  
  // Typing indicator
  socket.on('user_typing', (data) => {
    if (data.from === selectedUser?.username && data.to === currentUser.username) {
      showTypingIndicator();
    }
  });
  
  socket.on('user_stop_typing', (data) => {
    if (data.from === selectedUser?.username && data.to === currentUser.username) {
      hideTypingIndicator();
    }
  });
  
  // Message read receipt
  socket.on('message_read', (data) => {
    if (data.from === selectedUser?.username) {
      updateMessageReadStatus(data.messageId);
    }
  });
  
  // Incoming call
  socket.on('incoming_call', async (data) => {
    if (data.to !== currentUser.username) return;
    
    incomingCallData = data;
    callType = data.type;
    
    const caller = allUsers.find(u => u.username === data.from);
    document.getElementById('callerName').textContent = caller ? caller.nama : data.from;
    document.getElementById('callerAvatar').textContent = caller ? caller.nama.charAt(0).toUpperCase() : 'U';
    document.getElementById('callType').textContent = `${data.type === 'video' ? 'Video' : 'Voice'} Call masuk...`;
    document.getElementById('incomingCallModal').classList.remove('hidden');
  });
  
  // Call accepted
  socket.on('call_accepted', async (data) => {
    if (data.to !== currentUser.username) return;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
  });
  
  // Call rejected
  socket.on('call_rejected', (data) => {
    if (data.to !== currentUser.username) return;
    showNotification('Panggilan ditolak', 'error');
    endCall();
  });
  
  // ICE candidate
  socket.on('ice_candidate', async (data) => {
    if (data.to !== currentUser.username || !peerConnection) return;
    
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (error) {
      console.error('Error adding ICE candidate:', error);
    }
  });
  
  // Call ended
  socket.on('call_ended', (data) => {
    if (data.to !== currentUser.username) return;
    endCall();
  });
}

// User Management
async function loadUsers() {
  try {
    const res = await fetch(`${API_URL}/api/users`);
    const data = await res.json();
    
    if (data.success) {
      allUsers = data.users.filter(u => u.username !== currentUser.username);
      renderUsers(allUsers);
    }
  } catch (error) {
    console.error('Error loading users:', error);
  }
}

function renderUsers(users) {
  const usersList = document.getElementById('usersList');
  usersList.innerHTML = users.map(user => {
    const isOnline = onlineUsers.has(user.username);
    return `
      <div class="user-item ${selectedUser?.username === user.username ? 'active' : ''}" 
           onclick="selectUser('${user.username}', '${user.nama}')">
        <div class="avatar">
          ${user.nama.charAt(0).toUpperCase()}
          <span class="status-badge ${isOnline ? 'online' : ''}"></span>
        </div>
        <div class="user-item-info">
          <h4>${user.nama}</h4>
          <p>@${user.username}</p>
        </div>
      </div>
    `;
  }).join('');
}

function filterUsers(query) {
  const filtered = allUsers.filter(user => 
    user.nama.toLowerCase().includes(query.toLowerCase()) ||
    user.username.toLowerCase().includes(query.toLowerCase())
  );
  renderUsers(filtered);
}

function updateOnlineStatus() {
  renderUsers(allUsers);
  
  // Update selected user status
  if (selectedUser) {
    const statusBadge = document.getElementById('selectedUserStatus');
    if (statusBadge) {
      if (onlineUsers.has(selectedUser.username)) {
        statusBadge.classList.add('online');
      } else {
        statusBadge.classList.remove('online');
      }
    }
  }
}

async function selectUser(username, nama) {
  selectedUser = { username, nama };
  
  // Update UI
  const sidebar = document.querySelector('.sidebar');
  sidebar.classList.remove('open'); // Hides sidebar on mobile
  
  document.getElementById('chatPlaceholder').classList.add('hidden');
  document.getElementById('chatArea').classList.remove('hidden');
  document.getElementById('selectedUserName').textContent = nama;
  document.getElementById('selectedUserAvatar').textContent = nama.charAt(0).toUpperCase();
  
  // Update status badge
  const statusBadge = document.querySelector('.status-badge');
  if (statusBadge) {
    if (onlineUsers.has(username)) {
      statusBadge.classList.add('online');
    } else {
      statusBadge.classList.remove('online');
    }
  }
  
  document.getElementById('messageInput').disabled = false;
  document.querySelector('.btn-send').disabled = false;
  
  renderUsers(allUsers);
  
  // Load chat history
  await loadChatHistory();
}

async function loadChatHistory() {
  try {
    const res = await fetch(`${API_URL}/api/messages/${currentUser.username}/${selectedUser.username}`);
    const data = await res.json();
    
    if (data.success) {
      const chatMessages = document.getElementById('chatMessages');
      chatMessages.innerHTML = '';
      
      data.messages.forEach(msg => {
        displayMessage(msg, false);
      });
      
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  } catch (error) {
    console.error('Error loading chat history:', error);
  }
}

// Messaging
function sendMessage() {
  const input = document.getElementById('messageInput');
  const message = input.value.trim();
  
  if (!message && !selectedFile) return;
  if (!selectedUser) return;
  
  const messageData = {
    from: currentUser.username,
    to: selectedUser.username,
    message: message || '',
    timestamp: new Date().toISOString()
  };
  
  // Handle file attachment
  if (selectedFile) {
    messageData.file = {
      name: selectedFile.name,
      size: selectedFile.size,
      type: selectedFile.type,
      data: selectedFile.data
    };
    cancelFileUpload();
  }
  
  socket.emit('send_message', messageData);
  
  input.value = '';
  
  // Stop typing indicator
  socket.emit('stop_typing', {
    from: currentUser.username,
    to: selectedUser.username
  });
}

function displayMessage(data, animate = true) {
  const chatMessages = document.getElementById('chatMessages');
  const isSent = data.from === currentUser.username;
  
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
  if (!animate) messageDiv.style.animation = 'none';
  
  let fileHTML = '';
  if (data.file) {
    const isImage = data.file.type.startsWith('image/');
    if (isImage) {
      fileHTML = `<img src="${data.file.data}" class="message-image" alt="${data.file.name}">`;
    } else {
      const fileIcon = getFileIcon(data.file.type);
      fileHTML = `
        <div class="message-file" onclick="downloadFile('${data.file.data}', '${data.file.name}')">
          <div class="file-preview-icon">${fileIcon}</div>
          <div class="message-file-info">
            <div class="message-file-name">${data.file.name}</div>
            <div class="message-file-size">${formatFileSize(data.file.size)}</div>
          </div>
        </div>
      `;
    }
  }
  
  const statusIcon = isSent ? `
    <div class="message-status ${data.read ? 'read' : ''}">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      ${data.delivered || data.read ? `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left: -6px;">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      ` : ''}
    </div>
  ` : '';
  
  messageDiv.innerHTML = `
    <div class="message-content">
      ${fileHTML}
      ${data.message ? `<div class="message-bubble">${escapeHtml(data.message)}</div>` : ''}
      <div class="message-info">
        <div class="message-time">${formatTime(data.timestamp)}</div>
        ${statusIcon}
      </div>
    </div>
  `;
  
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showTypingIndicator() {
  const indicator = document.getElementById('typingIndicator');
  indicator.classList.remove('hidden');
}

function hideTypingIndicator() {
  const indicator = document.getElementById('typingIndicator');
  indicator.classList.add('hidden');
}

function updateMessageReadStatus(messageId) {
  // Update UI to show message as read
  const messages = document.querySelectorAll('.message.sent .message-status');
  messages.forEach(status => {
    status.classList.add('read');
  });
}

// File Handling
function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    selectedFile = {
      name: file.name,
      size: file.size,
      type: file.type,
      data: e.target.result
    };
    
    showFilePreview(file);
  };
  reader.readAsDataURL(file);
}

function showFilePreview(file) {
  const preview = document.getElementById('filePreview');
  document.getElementById('filePreviewName').textContent = file.name;
  document.getElementById('filePreviewSize').textContent = formatFileSize(file.size);
  preview.classList.remove('hidden');
}

function cancelFileUpload() {
  selectedFile = null;
  document.getElementById('filePreview').classList.add('hidden');
  document.getElementById('fileInput').value = '';
}

function downloadFile(dataUrl, filename) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  link.click();
}

function getFileIcon(type) {
  if (type.startsWith('image/')) return '🖼️';
  if (type.startsWith('video/')) return '🎥';
  if (type.startsWith('audio/')) return '🎵';
  if (type.includes('pdf')) return '📄';
  if (type.includes('word') || type.includes('document')) return '📝';
  if (type.includes('excel') || type.includes('spreadsheet')) return '📊';
  if (type.includes('zip') || type.includes('rar')) return '📦';
  return '📎';
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Emoji Picker
function initializeEmojiPicker() {
  const emojiGrid = document.getElementById('emojiGrid');
  const categories = document.querySelectorAll('.emoji-category');
  
  // Render default category
  renderEmojis('smileys');
  
  // Category switching
  categories.forEach(cat => {
    cat.addEventListener('click', () => {
      categories.forEach(c => c.classList.remove('active'));
      cat.classList.add('active');
      renderEmojis(cat.dataset.category);
    });
  });
  
  // Emoji search
  const emojiSearch = document.getElementById('emojiSearch');
  emojiSearch.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    if (query) {
      searchEmojis(query);
    } else {
      const activeCategory = document.querySelector('.emoji-category.active');
      renderEmojis(activeCategory.dataset.category);
    }
  });
}

function renderEmojis(category) {
  const emojiGrid = document.getElementById('emojiGrid');
  const categoryEmojis = emojis[category] || [];
  
  emojiGrid.innerHTML = categoryEmojis.map(emoji => `
    <div class="emoji-item" onclick="insertEmoji('${emoji}')">${emoji}</div>
  `).join('');
}

function searchEmojis(query) {
  const emojiGrid = document.getElementById('emojiGrid');
  const allEmojis = Object.values(emojis).flat();
  
  // Simple search - in production, you'd want a better emoji search
  emojiGrid.innerHTML = allEmojis.slice(0, 50).map(emoji => `
    <div class="emoji-item" onclick="insertEmoji('${emoji}')">${emoji}</div>
  `).join('');
}

function toggleEmojiPicker() {
  const picker = document.getElementById('emojiPicker');
  picker.classList.toggle('hidden');
}

function insertEmoji(emoji) {
  const input = document.getElementById('messageInput');
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const text = input.value;
  
  input.value = text.substring(0, start) + emoji + text.substring(end);
  input.focus();
  input.selectionStart = input.selectionEnd = start + emoji.length;
  
  // Trigger typing indicator
  if (selectedUser) {
    socket.emit('typing', {
      from: currentUser.username,
      to: selectedUser.username
    });
  }
}

// WebRTC Calls
async function startCall(type) {
  if (!selectedUser) return;
  
  // Clean up any existing call first
  if (isCallActive) {
    endCall();
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  callType = type;
  isCallActive = true;
  
  try {
    const constraints = {
      audio: true,
      video: type === 'video'
    };
    
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    
    // Ensure old peerConnection is cleaned up
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
    
    peerConnection = new RTCPeerConnection(config);
    
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
    
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice_candidate', {
          from: currentUser.username,
          to: selectedUser.username,
          candidate: event.candidate
        });
      }
    };
    
    peerConnection.ontrack = (event) => {
      if (!remoteStream) {
        remoteStream = new MediaStream();
        const remoteVideo = document.getElementById('remoteVideo');
        if (remoteVideo) {
          remoteVideo.srcObject = remoteStream;
        }
      }
      remoteStream.addTrack(event.track);
    };
    
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    socket.emit('call_user', {
      from: currentUser.username,
      to: selectedUser.username,
      offer: offer,
      type: type
    });
    
    showActiveCall(type);
    
  } catch (error) {
    console.error('Error starting call:', error);
    showNotification('Gagal memulai panggilan. Pastikan izin kamera/mikrofon sudah diberikan.', 'error');
    endCall();
  }
}

function showActiveCall(type) {
  const activeCallModal = document.getElementById('activeCall');
  const videoGrid = document.getElementById('videoGrid');
  const localVideo = document.getElementById('localVideo');
  const remoteVideo = document.getElementById('remoteVideo');
  
  // Ensure elements exist before accessing
  if (!activeCallModal || !videoGrid || !localVideo || !remoteVideo) {
    console.error('Call UI elements not found');
    return;
  }
  
  activeCallModal.classList.remove('hidden');
  
  if (type === 'voice') {
    // Voice call: hide videos but keep them in DOM
    videoGrid.className = 'video-grid voice-call';
    localVideo.style.display = 'none';
    remoteVideo.style.display = 'none';
    
    // Add voice call overlay
    let voiceOverlay = document.getElementById('voiceCallOverlay');
    if (!voiceOverlay) {
      voiceOverlay = document.createElement('div');
      voiceOverlay.id = 'voiceCallOverlay';
      voiceOverlay.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; z-index: 10;';
      videoGrid.appendChild(voiceOverlay);
    }
    voiceOverlay.innerHTML = `
      <div class="avatar large" style="width: 120px; height: 120px; font-size: 48px; margin: 0 auto;">${selectedUser.nama.charAt(0).toUpperCase()}</div>
      <h2 style="color: white; margin-top: 20px;">${selectedUser.nama}</h2>
    `;
    
    // Set audio streams
    if (localStream) {
      localVideo.srcObject = localStream;
    }
    if (remoteStream) {
      remoteVideo.srcObject = remoteStream;
    }
  } else {
    // Video call: show videos
    videoGrid.className = 'video-grid';
    
    // Remove voice overlay if exists
    const voiceOverlay = document.getElementById('voiceCallOverlay');
    if (voiceOverlay) {
      voiceOverlay.remove();
    }
    
    localVideo.style.display = 'block';
    remoteVideo.style.display = 'block';
    
    // Ensure proper layout based on screen size and orientation
    updateVideoGridLayout();
    
    if (localStream) {
      localVideo.srcObject = localStream;
    }
    if (remoteStream) {
      remoteVideo.srcObject = remoteStream;
    }
  }
  
  startCallDuration();
}

function updateVideoGridLayout() {
  const videoGrid = document.getElementById('videoGrid');
  if (!videoGrid) return;
  
  const isPortrait = window.innerHeight > window.innerWidth;
  const remoteVideo = document.getElementById('remoteVideo');
  const localVideoWrapper = document.getElementById('localVideo');
  
  if (!remoteVideo || !localVideoWrapper) return;
  
  if (isPortrait) {
    // Portrait: vertical split 1:1
    videoGrid.style.gridTemplateColumns = '1fr';
    videoGrid.style.gridTemplateRows = '1fr 1fr';
    remoteVideo.style.gridRow = '1';
    remoteVideo.style.gridColumn = '1';
    localVideoWrapper.style.gridRow = '2';
    localVideoWrapper.style.gridColumn = '1';
  } else {
    // Landscape: horizontal split 1:1
    videoGrid.style.gridTemplateColumns = '1fr 1fr';
    videoGrid.style.gridTemplateRows = '1fr';
    remoteVideo.style.gridRow = '1';
    remoteVideo.style.gridColumn = '1';
    localVideoWrapper.style.gridRow = '1';
    localVideoWrapper.style.gridColumn = '2';
  }
}

async function acceptCall() {
  document.getElementById('incomingCallModal').classList.add('hidden');
  isCallActive = true;
  
  try {
    const constraints = {
      audio: true,
      video: callType === 'video'
    };
    
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    
    peerConnection = new RTCPeerConnection(config);
    
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
    
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice_candidate', {
          from: currentUser.username,
          to: incomingCallData.from,
          candidate: event.candidate
        });
      }
    };
    
    peerConnection.ontrack = (event) => {
      if (!remoteStream) {
        remoteStream = new MediaStream();
        const remoteVideo = document.getElementById('remoteVideo');
        if (remoteVideo) {
          remoteVideo.srcObject = remoteStream;
        }
      }
      remoteStream.addTrack(event.track);
    };
    
    await peerConnection.setRemoteDescription(new RTCSessionDescription(incomingCallData.offer));
    
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    socket.emit('call_accepted', {
      from: currentUser.username,
      to: incomingCallData.from,
      answer: answer
    });
    
    // Update selectedUser to caller
    const caller = allUsers.find(u => u.username === incomingCallData.from);
    if (caller) {
      selectedUser = { username: caller.username, nama: caller.nama };
    }
    
    showActiveCall(callType);
    
  } catch (error) {
    console.error('Error accepting call:', error);
    showNotification('Gagal menerima panggilan.', 'error');
    endCall();
  }
}

function rejectCall() {
  document.getElementById('incomingCallModal').classList.add('hidden');
  socket.emit('call_rejected', {
    from: currentUser.username,
    to: incomingCallData.from
  });
  incomingCallData = null;
}

function toggleMute() {
  if (!localStream) return;
  
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(track => {
    track.enabled = !isMuted;
  });
  
  const muteBtn = document.getElementById('muteBtn');
  if (muteBtn) {
    if (isMuted) {
      muteBtn.style.background = 'var(--danger)';
    } else {
      muteBtn.style.background = 'rgba(255, 255, 255, 0.25)';
    }
  }
}

function toggleVideo() {
  if (!localStream || callType === 'voice') return;
  
  isVideoOff = !isVideoOff;
  localStream.getVideoTracks().forEach(track => {
    track.enabled = !isVideoOff;
  });
  
  const videoBtn = document.getElementById('videoBtn');
  if (videoBtn) {
    if (isVideoOff) {
      videoBtn.style.background = 'var(--danger)';
    } else {
      videoBtn.style.background = 'rgba(255, 255, 255, 0.25)';
    }
  }
}

function endCall() {
  // Emit end call signal if call was active
  if (selectedUser && isCallActive) {
    socket.emit('end_call', {
      from: currentUser.username,
      to: selectedUser.username
    });
  }
  
  // Stop all media tracks
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  
  if (remoteStream) {
    remoteStream.getTracks().forEach(track => track.stop());
    remoteStream = null;
  }
  
  // Close peer connection
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  
  // Clean up video elements
  const localVideo = document.getElementById('localVideo');
  const remoteVideo = document.getElementById('remoteVideo');
  if (localVideo) {
    localVideo.srcObject = null;
    localVideo.style.display = 'none';
  }
  if (remoteVideo) {
    remoteVideo.srcObject = null;
    remoteVideo.style.display = 'none';
  }
  
  // Remove voice call overlay if exists
  const voiceOverlay = document.getElementById('voiceCallOverlay');
  if (voiceOverlay) {
    voiceOverlay.remove();
  }
  
  // Reset video grid class
  const videoGrid = document.getElementById('videoGrid');
  if (videoGrid) {
    videoGrid.className = 'video-grid';
  }
  
  // Hide call UI
  const activeCallModal = document.getElementById('activeCall');
  const incomingCallModal = document.getElementById('incomingCallModal');
  if (activeCallModal) {
    activeCallModal.classList.add('hidden');
  }
  if (incomingCallModal) {
    incomingCallModal.classList.add('hidden');
  }
  
  // Stop call duration timer
  stopCallDuration();
  
  // Reset call state
  isCallActive = false;
  isMuted = false;
  isVideoOff = false;
  callType = null;
  incomingCallData = null;
  
  // Reset button styles
  const muteBtn = document.getElementById('muteBtn');
  const videoBtn = document.getElementById('videoBtn');
  if (muteBtn) {
    muteBtn.style.background = 'rgba(255, 255, 255, 0.25)';
  }
  if (videoBtn) {
    videoBtn.style.background = 'rgba(255, 255, 255, 0.25)';
  }
}

function startCallDuration() {
  callStartTime = Date.now();
  const callDurationElement = document.getElementById('callDuration');
  if (!callDurationElement) return;
  
  callDurationInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const seconds = (elapsed % 60).toString().padStart(2, '0');
    const durationElement = document.getElementById('callDuration');
    if (durationElement) {
      durationElement.textContent = `${minutes}:${seconds}`;
    }
  }, 1000);
}

function stopCallDuration() {
  if (callDurationInterval) {
    clearInterval(callDurationInterval);
    callDurationInterval = null;
  }
  callStartTime = null;
}

// Mobile sidebar toggle
function toggleSidebarMobile() {
  const sidebar = document.querySelector('.sidebar');
  sidebar.classList.toggle('open');
}

function showUserInfo() {
  if (selectedUser) {
    showNotification(`${selectedUser.nama} (@${selectedUser.username})`, 'success');
  }
}

// Go back to sidebar
function goBackToSidebar() {
  const sidebar = document.querySelector('.sidebar');
  sidebar.classList.add('open'); // Show sidebar on mobile
  
  document.querySelector('.sidebar').classList.remove('hidden');
  document.getElementById('chatArea').classList.add('hidden');
  document.getElementById('chatPlaceholder').classList.remove('hidden');
  
  // Reset selection
  selectedUser = null;
  const messageInput = document.getElementById('messageInput');
  if (messageInput) messageInput.disabled = true;
  const sendBtn = document.querySelector('.btn-send');
  if (sendBtn) sendBtn.disabled = true;
  
  // Re-render users to clear active state
  renderUsers(allUsers);
  
  // Clear chat messages
  const chatMessages = document.getElementById('chatMessages');
  if (chatMessages) chatMessages.innerHTML = '';
}

// Utilities
function logout() {
  localStorage.removeItem('currentUser');
  window.location.href = 'login.html';
}

function showNotification(message, type = 'success') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.classList.add('show');
  }, 100);
  
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('id-ID', { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Handle window resize for responsive video grid
window.addEventListener('resize', () => {
  const videoGrid = document.getElementById('videoGrid');
  const activeCall = document.getElementById('activeCall');
  
  // Only adjust if video call is active and not hidden
  if (videoGrid && activeCall && !activeCall.classList.contains('hidden') && 
      !videoGrid.classList.contains('voice-call')) {
    updateVideoGridLayout();
  }
});

// Also listen for orientation change
window.addEventListener('orientationchange', () => {
  setTimeout(() => {
    const videoGrid = document.getElementById('videoGrid');
    const activeCall = document.getElementById('activeCall');
    
    if (videoGrid && activeCall && !activeCall.classList.contains('hidden') && 
        !videoGrid.classList.contains('voice-call')) {
      updateVideoGridLayout();
    }
  }, 100);
});