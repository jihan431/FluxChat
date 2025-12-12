//
const socket = io();
const API_URL = `${window.location.origin}/api`;
let currentUser = JSON.parse(localStorage.getItem('currentUser'));
let selectedUser = null;
let selectedGroup = null;
let peerConnection;
let localStream;
let searchTimeout = null;
let callTimer = null;
let callDuration = 0;
let isVideo = false;
const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// --- CHAT HISTORY TRACKING ---
let chatHistory = {}; // { username/groupId: { name, lastMessage, timestamp, unreadCount, isGroup } }
let typingUsers = {}; // { username: true/false }
let callHistory = []; // Array untuk menyimpan history call
let recentChats = []; // Array untuk riwayat chat (user + group)
let currentTab = 'chats'; // Track tab mana yang aktif
window.userStatusMap = {}; // Initialize status map globally
const FILE_MAX_BYTES = 50 * 1024 * 1024; // 50MB
const ALLOWED_FILE_TYPES = ['image/', 'video/', 'audio/', 'application/pdf', 'text/plain'];
let voiceRecorder = { recorder: null, chunks: [], stream: null, timer: null, startTime: null, interval: null };
let chatSearchTimeout = null;
let callStartTime = null; // Timestamp when call started

// --- 1. TOAST NOTIFICATION SYSTEM ---
const Toast = {
  container: null,
  init() {
    this.container = document.createElement('div');
    this.container.className = 'toast-container';
    document.body.appendChild(this.container);
  },
  show(message, type = 'info') {
    if (!this.container) this.init();
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    
    this.container.appendChild(toast);
    
    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
};

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  if (!bytes) return '';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}

function getFileIcon(type) {
  if (!type) return 'paperclip';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'music';
  if (type === 'application/pdf') return 'file-text';
  return 'paperclip';
}

function isFileTypeAllowed(mime) {
  if (!mime) return false;
  return ALLOWED_FILE_TYPES.some(type => type.endsWith('/') ? mime.startsWith(type) : mime === type);
}

function formatRelativeTime(date) {
  if (!date) return '';
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${minutes}m lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}j lalu`;
  const days = Math.floor(hours / 24);
  return `${days}h lalu`;
}

function getUserStatusText(user) {
  if (!user) return 'Offline';
  const statusMap = window.userStatusMap || {};
  if (statusMap[user.username] === 'online') return 'Online';
  if (user.lastSeen) {
    const last = new Date(user.lastSeen);
    return `Terakhir dilihat ${formatRelativeTime(last)}`;
  }
  return 'Offline';
}

function updateChatStatusHeader() {
  if (!selectedUser) return;
  const statusEl = document.getElementById('chatStatus');
  if (statusEl) statusEl.textContent = getUserStatusText(selectedUser);
}

function toggleChatSearchPanel(forceHide = false) {
  const panel = document.getElementById('chatSearchPanel');
  const input = document.getElementById('chatSearchInput');
  const results = document.getElementById('chatSearchResults');
  if (!panel) return;

  if (forceHide) {
    panel.classList.add('hidden');
    return;
  }

  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) {
    if (results) results.innerHTML = '<div class="empty-state">Ketik untuk mencari pesan</div>';
    if (input) {
      input.value = '';
      input.focus();
    }
  }
}

function renderChatSearchResults(items) {
  const container = document.getElementById('chatSearchResults');
  if (!container) return;

  if (!items || items.length === 0) {
    container.innerHTML = '<div class="empty-state">Tidak ada hasil</div>';
    return;
  }

  container.innerHTML = '';
  items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'chat-search-result-item';
    const ts = new Date(item.timestamp).toLocaleString();
    const snippet = item.message || (item.file && item.file.name ? `📎 ${item.file.name}` : 'Pesan media');
    div.innerHTML = `
      <div class="meta">
        <span>${item.chatName}</span>
        <span>${ts}</span>
      </div>
      <div class="snippet">${snippet}</div>
    `;
    div.onclick = () => openSearchResult(item);
    container.appendChild(div);
  });
}

function openSearchResult(item) {
  if (!item) return;
  if (item.isGroup) {
    if (selectGroupById(item.chatId)) {
      toggleChatSearchPanel(true);
    } else {
      Toast.show('Group tidak ditemukan', 'error');
    }
  } else {
    const user = (window.allUsers || []).find(u => u.username === item.chatId) || { username: item.chatId, nama: item.chatName || item.chatId };
    selectUser(user);
    toggleChatSearchPanel(true);
  }
}

function handleChatSearchInput(e) {
  const q = e.target.value.trim();
  const results = document.getElementById('chatSearchResults');

  if (chatSearchTimeout) clearTimeout(chatSearchTimeout);

  if (!q) {
    if (results) results.innerHTML = '<div class="empty-state">Ketik untuk mencari pesan</div>';
    return;
  }

  if (results) results.innerHTML = '<div class="empty-state">Mencari...</div>';

  chatSearchTimeout = setTimeout(async () => {
    try {
      const res = await fetch(`${API_URL}/messages/search?userId=${currentUser.id}&q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (data.success) {
        renderChatSearchResults(data.results);
      } else {
        if (results) results.innerHTML = '<div class="empty-state">Gagal mencari pesan</div>';
      }
    } catch (err) {
      if (results) results.innerHTML = '<div class="empty-state">Error jaringan</div>';
    }
  }, 300);
}

async function toggleVoiceRecording() {
  if (!selectedUser && !selectedGroup) {
    Toast.show('Pilih chat dulu sebelum merekam suara', 'warning');
    return;
  }

  // Stop jika sedang merekam
  if (voiceRecorder.recorder && voiceRecorder.recorder.state === 'recording') {
    stopVoiceRecording(true);
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceRecorder.stream = stream;
    voiceRecorder.chunks = [];



    const recorder = new MediaRecorder(stream);
    voiceRecorder.recorder = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) voiceRecorder.chunks.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(voiceRecorder.chunks, { type: recorder.mimeType || 'audio/webm' });
      cleanupVoiceRecording();

      if (blob.size === 0) return;

      if (blob.size > FILE_MAX_BYTES) {
        Toast.show('Voice note terlalu besar (>50MB)', 'error');
        return;
      }

      sendVoiceNoteBlob(blob);
    };

    recorder.start();
    updateVoiceButtonState(true);
    
    // Show recording indicator
    showRecordingIndicator();
    
    // Start timer
    voiceRecorder.startTime = Date.now();
    updateRecordingTimer();
    voiceRecorder.interval = setInterval(() => {
      updateRecordingTimer();
    }, 100);

    voiceRecorder.timer = setTimeout(() => stopVoiceRecording(), 120000); // auto stop 2 menit
  } catch (err) {
    Toast.show('Gagal mengakses mikrofon: ' + err.message, 'error');
    cleanupVoiceRecording();
    updateVoiceButtonState(false);
    hideRecordingIndicator();
  }
}

function stopVoiceRecording(manual = false) {
  if (voiceRecorder.timer) {
    clearTimeout(voiceRecorder.timer);
    voiceRecorder.timer = null;
  }
  
  if (voiceRecorder.interval) {
    clearInterval(voiceRecorder.interval);
    voiceRecorder.interval = null;
  }

  if (voiceRecorder.recorder && voiceRecorder.recorder.state === 'recording') {
    voiceRecorder.recorder.stop();
  }
  updateVoiceButtonState(false);
  hideRecordingIndicator();
}

function cleanupVoiceRecording() {
  if (voiceRecorder.stream) {
    voiceRecorder.stream.getTracks().forEach(track => track.stop());
  }
  
  if (voiceRecorder.interval) {
    clearInterval(voiceRecorder.interval);
  }
  
  voiceRecorder = { recorder: null, chunks: [], stream: null, timer: null, startTime: null, interval: null };
}

function sendVoiceNoteBlob(blob) {
  const reader = new FileReader();
  reader.onload = () => {
    const filePayload = {
      name: `Voice-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`,
      type: blob.type || 'audio/webm',
      size: blob.size,
      data: reader.result
    };

    if (selectedGroup) {
      socket.emit('send_message', {
        from: currentUser.username,
        to: selectedGroup._id,
        message: '',
        file: filePayload,
        groupId: selectedGroup._id
      });
      saveLastMessageGroup(selectedGroup._id, '🎤 Voice note', new Date());
    } else if (selectedUser) {
      socket.emit('send_message', {
        from: currentUser.username,
        to: selectedUser.username,
        message: '',
        file: filePayload
      });
      saveLastMessage(selectedUser.username, '🎤 Voice note', new Date());
    }
  };
  reader.readAsDataURL(blob);
}

function updateVoiceButtonState(isRecording) {
  const btn = document.getElementById('voiceNoteBtn');
  if (!btn) return;
  btn.classList.toggle('recording', isRecording);
  const icon = btn.querySelector('i');
  if (icon) {
    icon.setAttribute('data-feather', isRecording ? 'square' : 'mic');
    if (typeof feather !== 'undefined') feather.replace();
  }
}

function showRecordingIndicator() {
  const messageInput = document.getElementById('messageInput');
  const recordingIndicator = document.getElementById('recordingIndicator');
  const voiceNoteBtn = document.getElementById('voiceNoteBtn');
  const sendBtn = document.querySelector('.send-btn');
  
  if (messageInput && recordingIndicator && voiceNoteBtn && sendBtn) {
    messageInput.style.display = 'none';
    recordingIndicator.classList.remove('hidden');
    voiceNoteBtn.style.display = 'flex';
    sendBtn.style.display = 'none';
  }
}

function hideRecordingIndicator() {
  const messageInput = document.getElementById('messageInput');
  const recordingIndicator = document.getElementById('recordingIndicator');
  const voiceNoteBtn = document.getElementById('voiceNoteBtn');
  const sendBtn = document.querySelector('.send-btn');
  
  if (messageInput && recordingIndicator && voiceNoteBtn && sendBtn) {
    messageInput.style.display = '';
    recordingIndicator.classList.add('hidden');
    
    // Restore normal button visibility based on input content
    const hasText = messageInput.value.trim().length > 0;
    if (hasText) {
      voiceNoteBtn.style.display = 'none';
      sendBtn.style.display = 'flex';
    } else {
      voiceNoteBtn.style.display = 'flex';
      sendBtn.style.display = 'none';
    }
  }
}

// Store wavesurfer instances
const wavesurferInstances = {};

function toggleAudioPlayback(audioId, audioSrc) {
  // Get the wavesurfer instance (should already be initialized)
  const wavesurfer = wavesurferInstances[audioId];
  
  if (!wavesurfer) return;
  
  if (wavesurfer.isPlaying()) {
    wavesurfer.pause();
  } else {
    // Pause all other audio players
    Object.keys(wavesurferInstances).forEach(key => {
      if (key !== audioId && wavesurferInstances[key].isPlaying()) {
        wavesurferInstances[key].pause();
      }
    });
    wavesurfer.play();
  }
}

function updateTimeDisplay(currentTime, duration, timeDisplay) {
  const currentMinutes = Math.floor(currentTime / 60);
  const currentSeconds = Math.floor(currentTime % 60);
  const durationMinutes = Math.floor(duration / 60);
  const durationSeconds = Math.floor(duration % 60);
  
  timeDisplay.textContent = `${currentMinutes}:${currentSeconds.toString().padStart(2, '0')} / ${durationMinutes}:${durationSeconds.toString().padStart(2, '0')}`;
}

function initializeWaveform(audioId, audioSrc) {
  const waveformContainer = document.getElementById(`waveform-${audioId}`);
  
  // Return if already initialized
  if (wavesurferInstances[audioId]) return;
  
  // Initialize wavesurfer
  const wavesurfer = WaveSurfer.create({
    container: waveformContainer,
    waveColor: 'rgba(90, 138, 140, 0.3)', // --primary with transparency
    progressColor: '#5a8a8c', // --primary
    cursorColor: '#5a8a8c', // --primary
    barWidth: 2,
    barRadius: 2,
    barGap: 1,
    height: 32,
    responsive: true,
    normalize: true
  });
  
  wavesurfer.load(audioSrc);
  wavesurferInstances[audioId] = wavesurfer;
  
  // Update time display when ready
  wavesurfer.on('ready', () => {
    const duration = wavesurfer.getDuration();
    const timeDisplay = document.querySelector(`#${audioId} .audio-time`);
    if (timeDisplay) {
      updateTimeDisplay(0, duration, timeDisplay);
    }
  });
  
  // Update progress when playing
  wavesurfer.on('audioprocess', () => {
    const currentTime = wavesurfer.getCurrentTime();
    const duration = wavesurfer.getDuration();
    const timeDisplay = document.querySelector(`#${audioId} .audio-time`);
    if (timeDisplay) {
      updateTimeDisplay(currentTime, duration, timeDisplay);
    }
  });
  
  // Handle play/pause
  wavesurfer.on('play', () => {
    const playIcon = document.querySelector(`#${audioId} .play-icon`);
    const pauseIcon = document.querySelector(`#${audioId} .pause-icon`);
    if (playIcon) playIcon.style.display = 'none';
    if (pauseIcon) pauseIcon.style.display = 'block';
  });
  
  wavesurfer.on('pause', () => {
    const playIcon = document.querySelector(`#${audioId} .play-icon`);
    const pauseIcon = document.querySelector(`#${audioId} .pause-icon`);
    if (playIcon) playIcon.style.display = 'block';
    if (pauseIcon) pauseIcon.style.display = 'none';
  });
  
  wavesurfer.on('finish', () => {
    const playIcon = document.querySelector(`#${audioId} .play-icon`);
    const pauseIcon = document.querySelector(`#${audioId} .pause-icon`);
    if (playIcon) playIcon.style.display = 'block';
    if (pauseIcon) pauseIcon.style.display = 'none';
  });
  
  // Handle click on waveform container
  const waveformParent = waveformContainer.parentElement;
  waveformParent.addEventListener('click', (e) => {
    // Don't trigger if clicking on the play button
    if (e.target.closest('.audio-play-pause')) return;
    
    const rect = waveformParent.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    wavesurfer.seekTo(pos);
  });
}

function updateRecordingTimer() {
  const timerElement = document.getElementById('recordingTimer');
  if (!timerElement || !voiceRecorder.startTime) return;
  
  const elapsed = Date.now() - voiceRecorder.startTime;
  const seconds = Math.floor(elapsed / 1000) % 60;
  const minutes = Math.floor(elapsed / 60000);
  
  timerElement.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}



// --- ANTI-SCREENSHOT PROTECTION SYSTEM ---
const ScreenshotProtection = {
  init() {
    this.setupEventListeners();
    this.setupContextMenu();
    this.setupDevTools();
  },

  setupEventListeners() {
    // Detect Print Screen key
    document.addEventListener('keyup', (e) => {
      if (e.key === 'PrintScreen') {
        this.showProtectionWarning();
        this.blockScreenshot();
      }
    });

    // Detect Volume Down + Power (Android screenshot)
    let volumeDown = false;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'VolumeDown') volumeDown = true;
      if (e.key === 'Power' && volumeDown) {
        this.showProtectionWarning();
        this.blockScreenshot();
        volumeDown = false;
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.key === 'VolumeDown') volumeDown = false;
    });

    // Detect Ctrl+Print Screen
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'PrintScreen') {
        e.preventDefault();
        this.showProtectionWarning();
        this.blockScreenshot();
      }
    });

    // Detect Shift+Print Screen
    document.addEventListener('keydown', (e) => {
      if (e.shiftKey && e.key === 'PrintScreen') {
        e.preventDefault();
        this.showProtectionWarning();
        this.blockScreenshot();
      }
    });
  },

  setupContextMenu() {
    // Disable right-click on no-screenshot elements
    document.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.no-screenshot')) {
        e.preventDefault();
        Toast.show('Screenshots tidak diizinkan di area ini', 'warning');
        return false;
      }
    });

    // Disable copy on no-screenshot elements
    document.addEventListener('copy', (e) => {
      if (e.target.closest('.no-screenshot')) {
        e.preventDefault();
        Toast.show('Copy/paste tidak diizinkan di area ini', 'warning');
        return false;
      }
    });
  },

  setupDevTools() {
    // Detect when DevTools is opened
    const devToolsCheck = setInterval(() => {
      const start = new Date();
      debugger;
      const end = new Date();
      
      if (end - start > 100) {
        this.showProtectionWarning();
      }
    }, 5000);
  },

  showProtectionWarning() {
    Toast.show('⚠️ Screenshot terdeteksi! Aktivitas ini sedang dipantau.', 'warning');
    this.flashOverlay();
  },

  blockScreenshot() {
    // Add visual feedback when screenshot is attempted
    const chatRoom = document.getElementById('chatRoom');
    const videoContainer = document.getElementById('videoContainer');
    
    if (chatRoom && !chatRoom.classList.contains('hidden')) {
      chatRoom.style.opacity = '0.5';
      setTimeout(() => {
        chatRoom.style.opacity = '1';
      }, 500);
    }

    if (videoContainer && !videoContainer.classList.contains('hidden')) {
      videoContainer.style.filter = 'blur(20px)';
      setTimeout(() => {
        videoContainer.style.filter = 'blur(0)';
      }, 500);
    }
  },

  flashOverlay() {
    const overlay = document.getElementById('screenshotOverlay');
    if (overlay) {
      overlay.style.display = 'block';
      overlay.style.background = 'rgba(255, 0, 0, 0.3)';
      setTimeout(() => {
        overlay.style.background = 'rgba(0, 0, 0, 0.1)';
      }, 100);
      setTimeout(() => {
        overlay.style.display = 'none';
      }, 1000);
    }
  }
};

// --- 2. AUTH & INITIALIZATION ---
if (!currentUser) window.location.href = 'login.html';

document.addEventListener('DOMContentLoaded', () => {
  if(typeof feather !== 'undefined') feather.replace();

  // Initialize Screenshot Protection
  ScreenshotProtection.init();

  // Initialize Wavesurfer.js
  if (typeof WaveSurfer === 'undefined') {
    console.warn('Wavesurfer.js not loaded');
  }

  // Sembunyikan modal saat load
  document.getElementById('callModal').classList.add('hidden');
  document.getElementById('profileModal').classList.remove('active');

  // Load unread counts from localStorage
  loadUnreadCounts();

  // Load Daftar Teman & Request (Logika Baru)
  loadFriendsAndRequests();

  // Load Groups dan join socket rooms
  loadGroups();

  // Load Call History
  loadCallHistory();

  // Cek lebar layar saat pertama kali load
  checkScreenSize();
  
  // Event listener untuk resize window
  window.addEventListener('resize', checkScreenSize);

  // Sidebar resizer
  setupSidebarResizer();

  const chatSearchToggle = document.getElementById('chatSearchToggle');
  const chatSearchInput = document.getElementById('chatSearchInput');
  if (chatSearchToggle) {
    chatSearchToggle.addEventListener('click', () => toggleChatSearchPanel());
  }
  if (chatSearchInput) {
    chatSearchInput.addEventListener('input', handleChatSearchInput);
  }

  document.addEventListener('click', (e) => {
    const panel = document.getElementById('chatSearchPanel');
    const toggle = document.getElementById('chatSearchToggle');
    if (panel && !panel.classList.contains('hidden')) {
      if (!panel.contains(e.target) && (!toggle || !toggle.contains(e.target))) {
        toggleChatSearchPanel(true);
      }
    }
  });

  const voiceBtn = document.getElementById('voiceNoteBtn');
  if (voiceBtn) {
    voiceBtn.addEventListener('click', toggleVoiceRecording);
  }

  // --- Event Listeners ---
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.querySelector('.send-btn');
  
  // Initialize button state on page load
  updateSendButtonVisibility();
  
  messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
  
  // Monitor input untuk toggle button
  messageInput.addEventListener('input', () => {
    updateSendButtonVisibility();
    
    // Kalo belum milih user, jangan ngapa-ngapain
    if (!selectedUser) return;

    socket.emit('typing', { 
        to: selectedUser.username, 
        from: currentUser.username 
    });

    clearTimeout(typingTimeout);

    typingTimeout = setTimeout(() => {
        // cek sekali lagi biar aman
        if (!selectedUser) return;
        socket.emit('stop_typing', { 
            to: selectedUser.username, 
            from: currentUser.username 
        });
    }, 1000);
  });
  
  
// Typing indicator
let typingTimeout;

  // Close dropdown user menu
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('userDropdown');
    const userMenu = document.getElementById('userMenu');
    if (dropdown && !dropdown.contains(e.target)) {
      userMenu.classList.add('hidden');
    }
  });

  const backBtn = document.getElementById('backToSidebar');
  if (backBtn) backBtn.addEventListener('click', closeChat);

  // Modal Profil Listeners
  const closeModalBtns = document.querySelectorAll('.close-modal');
  closeModalBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.modal').forEach(m => {
        m.classList.remove('active');
        m.classList.add('hidden'); 
      });
    });
  });

  const saveProfileBtn = document.getElementById('saveProfile');
  if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', saveProfile);
  }

  // Event Listeners untuk Profile Photo Upload (Unified)
  const profilePhotoInput = document.getElementById('profilePhotoInput');
  const profilePhotoPreview = document.getElementById('profilePhotoPreview');
  
  if(profilePhotoInput) {
    profilePhotoInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if(file) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          // Update avatar display in header
          const avatarDisplay = document.getElementById('profileAvatarDisplay');
          avatarDisplay.style.backgroundImage = `url('${evt.target.result}')`;
          avatarDisplay.textContent = '';
        }
        reader.readAsDataURL(file);
      }
    });
  }

  if(profilePhotoPreview) {
    profilePhotoPreview.addEventListener('click', () => {
      if(profilePhotoInput) profilePhotoInput.click();
    });
  }

  // Event Listeners untuk Create Group Modal
  const createGroupBtn = document.getElementById('createGroupBtn');
  if (createGroupBtn) {
    createGroupBtn.addEventListener('click', createGroup);
  }
});

// --- FUNGSI CEK UKURAN LAYAR ---
function checkScreenSize() {
  const isMobile = window.innerWidth <= 768;
  const sidebar = document.getElementById('sidebar');
  const chatArea = document.getElementById('chatArea');
  const chatRoom = document.getElementById('chatRoom');
  const welcomeScreen = document.getElementById('welcomeScreen');
  
  if (isMobile) {
    // Di mobile, tampilkan sidebar atau chat area sesuai state
    if (selectedUser || selectedGroup) {
      // Jika sedang dalam chat, tampilkan chat area
      sidebar.classList.add('hidden-mobile');
      chatArea.classList.add('active');
    } else {
      // Jika tidak dalam chat, tampilkan sidebar
      sidebar.classList.remove('hidden-mobile');
      chatArea.classList.remove('active');
    }
  } else {
    // Di desktop, tampilkan kedua-duanya (sidebar dan chat area)
    sidebar.classList.remove('hidden-mobile');
    chatArea.classList.remove('active');
  }
}

// --- HELPER: Update Sidebar User Avatar (DEPRECATED - Removed from HTML) ---
function updateSidebarUserAvatar() {
  const sidebarAvatar = document.getElementById('sidebarUserAvatar');
  if (!sidebarAvatar) return;
  
  if (currentUser.avatar) {
    // User has uploaded a profile photo
    sidebarAvatar.style.backgroundImage = `url('${currentUser.avatar}')`;
    sidebarAvatar.style.backgroundSize = 'cover';
    sidebarAvatar.style.backgroundPosition = 'center';
    sidebarAvatar.style.background = '';
    sidebarAvatar.textContent = '';
  } else {
    // Show gradient avatar with first letter
    const initial = (currentUser.nama || 'U').charAt(0).toUpperCase();
    const gradient = getAvatarGradient(currentUser.nama || 'User');
    sidebarAvatar.style.backgroundImage = 'none';
    sidebarAvatar.style.background = gradient;
    sidebarAvatar.style.display = 'flex';
    sidebarAvatar.style.alignItems = 'center';
    sidebarAvatar.style.justifyContent = 'center';
    sidebarAvatar.style.color = 'white';
    sidebarAvatar.style.fontWeight = '600';
    sidebarAvatar.style.fontSize = '1rem';
    sidebarAvatar.textContent = initial;
  }
}

// --- 3. UI HELPERS ---

// Function to update button visibility based on input
function updateSendButtonVisibility() {
  const messageInput = document.getElementById('messageInput');
  const voiceBtn = document.getElementById('voiceNoteBtn');
  const sendBtn = document.querySelector('.send-btn');
  const recordingIndicator = document.getElementById('recordingIndicator');
  const fileInput = document.getElementById('fileInput');
  
  if (messageInput && voiceBtn && sendBtn) {
    // If recording is active, don't change button visibility
    if (recordingIndicator && !recordingIndicator.classList.contains('hidden')) {
      return;
    }
    
    const hasText = messageInput.value.trim().length > 0;
    const hasFile = fileInput && fileInput.files && fileInput.files.length > 0;
    
    if (hasText || hasFile) {
      // Ada teks atau file: tampilkan send button, sembunyikan voice button
      voiceBtn.style.display = 'none';
      sendBtn.style.display = 'flex';
    } else {
      // Tidak ada teks atau file: sembunyikan send button, tampilkan voice button
      voiceBtn.style.display = 'flex';
      sendBtn.style.display = 'none';
    }
  }
}

function switchTab(tabName) {
  // Hide all tabs
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
    tab.classList.add('hidden');
  });
  
  // Remove active from all buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // Show selected tab
  const selectedTab = document.getElementById(`${tabName}-tab`);
  if (selectedTab) {
    selectedTab.classList.add('active');
    selectedTab.classList.remove('hidden');
  }
  
  // Mark button as active
  const activeBtn = document.querySelector(`[data-tab="${tabName}"]`);
  if (activeBtn) {
    activeBtn.classList.add('active');
  }
  
  // Track current tab
  currentTab = tabName;
}

function toggleSearchBar() {
  // Open contacts modal instead of showing search bar
  if (typeof ContactsModal !== 'undefined') {
    ContactsModal.open();
  }
}

function toggleUserMenu() {
  const userMenu = document.getElementById('userMenu');
  userMenu.classList.toggle('hidden');
}

// --- 4. PROFILE MANAGEMENT ---

function openProfile(e) {
  e.preventDefault();
  document.getElementById('userMenu').classList.add('hidden');
  
  // Input nama
  const nameInput = document.getElementById('editNama');
  if (nameInput) nameInput.value = currentUser.nama;

  // Input password (kosong tiap buka)
  const passInput = document.getElementById('editPassword');
  if (passInput) passInput.value = '';

  // Email (readonly)
  const emailInput = document.getElementById('editEmail');
  if (emailInput) emailInput.textContent = currentUser.email || 'user@example.com';

  // Username
  const usernameDisplay = document.getElementById('profileUsernameDisplay');
  if (usernameDisplay) usernameDisplay.textContent = currentUser.username || 'user';

  // Avatar di atas modal
  const avatarDisplay = document.getElementById('profileAvatarDisplay');
  if (
    currentUser.avatar &&
    currentUser.avatar !== 'default' &&
    (currentUser.avatar.startsWith('data:') || currentUser.avatar.startsWith('http'))
  ) {
    avatarDisplay.style = `
      background-image: url("${currentUser.avatar}") !important;
      background-size: cover !important;
      background-position: center !important;
      background-color: transparent !important;
      display: block !important;
    `;
    avatarDisplay.textContent = '';
  } else {
    const initial = currentUser.nama.charAt(0).toUpperCase();
    const gradient = getAvatarGradient(currentUser.nama || 'User');
    avatarDisplay.style = `
      background: ${gradient} !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      color: white !important;
      font-weight: 600 !important;
      font-size: 1.5rem !important;
    `;
    avatarDisplay.textContent = initial;
  }

  // Buka modal
  const modal = document.getElementById('profileModal');
  modal.classList.remove('hidden');
  modal.classList.add('active');
}


function closeProfileModal() {
  const modal = document.getElementById('profileModal');
  modal.classList.add('hidden');
  modal.classList.remove('active');
}

async function saveProfile() {
  const newNama = document.getElementById('editNama').value;
  const newPass = document.getElementById('editPassword').value;
  const photoInput = document.getElementById('profilePhotoInput');
  const photoFile = photoInput ? photoInput.files[0] : null;
  const btn = document.getElementById('saveProfile');

  if(!newNama) return Toast.show("Nama tidak boleh kosong", "error");

  btn.disabled = true;
  btn.innerHTML = '<i data-feather="loader" style="width: 18px; height: 18px; margin-right: 8px; display: inline; animation: spin 1s linear infinite;"></i> Menyimpan...';

  try {
    let photoBase64 = null;
    
    // Convert file to base64 if exists
    if(photoFile) {
      photoBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(photoFile);
      });
    }

    const payload = {
      id: currentUser.id,
      nama: newNama
    };
    
    // Only include password if provided
    if (newPass && newPass.trim() !== '') {
      payload.password = newPass;
    }
    
    // Only include avatar if provided
    if (photoBase64) {
      payload.avatar = photoBase64;
    }
    
    const res = await fetch(`${API_URL}/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.success) {
      Toast.show('Profil berhasil disimpan', 'success');
      currentUser = { ...currentUser, ...data.user };
      localStorage.setItem('currentUser', JSON.stringify(currentUser));
      
      // Clear file input
      if(photoInput) photoInput.value = '';
      
      // Close modal
      closeProfileModal();
    } else {
      Toast.show(data.error || 'Gagal menyimpan profil', 'error');
    }
  } catch (err) {
    Toast.show('Terjadi kesalahan koneksi', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-feather="check" style="width: 18px; height: 18px; margin-right: 8px; display: inline;"></i> Simpan';
    if(typeof feather !== 'undefined') feather.replace();
  }
}

function openBlockedUsers(e) {
  e.preventDefault();
  document.getElementById('userMenu').classList.add('hidden');
  Toast.show('Fitur blokir pengguna akan segera hadir!', 'info');
}

function logout(e) {
  if(e) e.preventDefault();
  localStorage.removeItem('currentUser');
  window.location.href = 'login.html';
}

// --- HELPER: Create Avatar HTML ---
// Helper: Generate consistent gradient color based on user name
function getAvatarGradient(name) {
  // Use single gradient for all avatars
  return 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
}

function createAvatarHTML(user, cssClass = 'avatar small', isOnline = false) {
  const onlineClass = isOnline ? 'online' : '';
  
  // Check if user has a valid profile photo (not "default" and starts with data: or http)
  if (user.avatar && user.avatar !== 'default' && (user.avatar.startsWith('data:') || user.avatar.startsWith('http'))) {
    // User has uploaded a profile photo
    return `<div class="${cssClass} ${onlineClass}" style="background-image: url('${user.avatar}'); background-size: cover; background-position: center;"></div>`;
  } else {
    // Show gradient avatar with first letter
    const initial = (user.nama || user.name || 'U').charAt(0).toUpperCase();
    const gradient = getAvatarGradient(user.nama || user.name || 'User');
    return `<div class="${cssClass} ${onlineClass}" style="background: ${gradient} !important; display: flex !important; align-items: center !important; justify-content: center !important; color: white !important; font-weight: 600 !important; font-size: 1.2rem !important;">${initial}</div>`;
  }
}

// --- 5. FRIEND & SEARCH SYSTEM (CORE NEW LOGIC) ---

// A. Load Teman & Request saat start (dengan cache ringan untuk percepat load/ngrok)
const FRIENDS_CACHE_TTL = 2 * 60 * 1000; // 2 menit
let friendsFetchPromise = null;

function renderFriendRequests(requests = []) {
  const requestContainer = document.getElementById('friendRequestsList');
  if (!requestContainer) return;

  requestContainer.innerHTML = '';
  if (requests.length === 0) return;

  requests.forEach(req => {
    const div = document.createElement('div');
    div.className = 'request-item';
    div.style.cssText = "background: rgba(255, 165, 0, 0.1); border: 1px solid orange; padding: 8px; border-radius: 5px; margin-bottom: 5px; font-size: 0.8rem; display: flex; justify-content: space-between; align-items: center; color: #ddd;";
    div.innerHTML = `
      <span>Wait! <b>${req.from.nama}</b> ingin berteman.</span>
      <div>
        <button onclick="respondFriend('${req.from._id}', 'accept')" style="border:none; cursor:pointer; background:none;">✅</button>
        <button onclick="respondFriend('${req.from._id}', 'reject')" style="border:none; cursor:pointer; background:none;">❌</button>
      </div>
    `;
    requestContainer.appendChild(div);
  });
  Toast.show(`Ada ${requests.length} permintaan pertemanan baru!`, 'info');
}

function applyFriendsPayload(payload) {
  if (!payload) return;
  const { friends = [], requests = [] } = payload;
  window.allUsers = friends;
  // No need to display search results here anymore - contacts are displayed in ContactsModal
  renderFriendRequests(requests);
  // Re-load unread counts before updating display
  loadUnreadCounts();
  updateRecentChatsDisplay();
}

async function loadFriendsAndRequests(forceRefresh = false) {
  const cacheKey = `friends-cache-${currentUser.id}`;

  // 1) Gunakan cache jika masih fresh untuk kurangi waktu tunggu di koneksi lambat/ngrok
  try {
    const cached = localStorage.getItem(cacheKey);
    if (!forceRefresh && cached) {
      const parsed = JSON.parse(cached);
      if (parsed.ts && (Date.now() - parsed.ts) < FRIENDS_CACHE_TTL) {
        applyFriendsPayload(parsed.data);
      }
    }
  } catch (err) {
    // abaikan cache error
  }

  // 2) Hindari fetch paralel yang sama
  if (friendsFetchPromise && !forceRefresh) {
    return friendsFetchPromise;
  }

  // 3) Fetch terbaru di background, lalu update UI + cache
  friendsFetchPromise = (async () => {
    try {
      const res = await fetch(`${API_URL}/friends/list/${currentUser.id}`);
      const data = await res.json();

      if (data.success) {
        applyFriendsPayload({ friends: data.friends, requests: data.requests });
        try {
          localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: { friends: data.friends, requests: data.requests } }));
        } catch (err) {
          // abaikan write error
        }
      }
    } catch (err) {
      Toast.show('Gagal memuat data teman', 'error');
    } finally {
      friendsFetchPromise = null;
    }
  })();

  return friendsFetchPromise;
}

// Sidebar resizer (desktop)
function setupSidebarResizer() {
  const sidebar = document.getElementById('sidebar');
  const resizer = document.getElementById('sidebarResizer');
  if (!sidebar || !resizer) return;

  const MIN = 260;
  const MAX = 600;
  let startX = 0;
  let startWidth = 0;
  let dragging = false;

  const applyWidth = (w) => {
    const clamped = Math.min(MAX, Math.max(MIN, w));
    sidebar.style.width = `${clamped}px`;
  };

  resizer.addEventListener('mousedown', (e) => {
    dragging = true;
    startX = e.clientX;
    startWidth = sidebar.getBoundingClientRect().width;
    document.body.style.userSelect = 'none';
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const delta = e.clientX - startX;
    applyWidth(startWidth + delta);
  });

  window.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      document.body.style.userSelect = '';
    }
  });
}

// B. Fungsi Search dengan Debounce
function searchUsers(query) {
  // Jika search kosong, kembali tampilkan daftar teman saya
  if (!query) {
    if (currentTab === 'chats') {
      updateRecentChatsDisplay();
    } else if (currentTab === 'groups') {
      displayGroups();
    } else {
      loadFriendsAndRequests();
    }
    return;
  }

  if (searchTimeout) clearTimeout(searchTimeout);
  
  searchTimeout = setTimeout(async () => {
    try {
      // Tentukan list mana yang akan di-update
      const listId = currentTab === 'chats' ? 'recentChatsList' : 
                     currentTab === 'groups' ? 'groupsList' : 
                     'recentChatsList'; // Default ke chats jika tab tidak valid
      const list = document.getElementById(listId);
      
      if (list) {
        list.innerHTML = '<div style="text-align:center; padding:10px; color:#94a3b8;">Mencari...</div>';
      }

      const res = await fetch(`${API_URL}/users/search?query=${query}&currentUserId=${currentUser.id}`);
      const data = await res.json();

      if (data.success) {
        if (currentTab === 'chats' || currentTab === 'groups') {
          // Filter results to show in chats/groups tab
          displaySearchResultsInTab(data.users, currentTab);
        }
      }
    } catch (err) {

    }
  }, 300);
}

// Helper untuk menampilkan search results di tab chats/groups
function displaySearchResultsInTab(users, tab) {
  const listId = tab === 'chats' ? 'recentChatsList' : 'groupsList';
  const list = document.getElementById(listId);
  
  if (!list) return;
  
  list.innerHTML = '';
  
  if (!users || users.length === 0) {
    list.innerHTML = '<div style="text-align:center; padding:10px; color:#94a3b8;">Pengguna tidak ditemukan</div>';
    return;
  }

  users.forEach(user => {
    const div = document.createElement('div');
    div.className = 'list-item chat-item';
    div.id = `search-user-${user.username}`;

    // Check if user is online
    const isOnline = window.userStatusMap && window.userStatusMap[user.username] === 'online';
    const onlineClass = isOnline ? 'online' : '';

    // Get last message untuk user ini (hanya untuk teman)
    let lastMessageText = '';
    let lastMessageTime = '';
    if (user.isFriend) {
      const lastMsg = getLastMessageForUser(user.username);
      lastMessageText = lastMsg ? lastMsg.message : 'Tap to start chatting';
      lastMessageTime = lastMsg ? formatMessageTime(lastMsg.timestamp) : '';
    }

    // Logic Tampilan: Jika Teman -> Bisa Chat. Jika Belum -> Tombol Add.
    let actionButton = '';
    if (user.isFriend) {
        // Tampilkan action button kosong untuk space consistency
        actionButton = ``;
    } else if (user.isPending) {
        actionButton = `<button class="icon-btn" disabled style="font-size:0.7rem; width:auto; padding:5px 10px; cursor:default;">Pending ⏳</button>`;
    } else {
        actionButton = `<button onclick="sendFriendRequest(event, '${user._id}')" class="icon-btn" style="background: rgba(99, 102, 241, 0.2); color: #818cf8;">
                        <i data-feather="user-plus" style="width:16px; height:16px;"></i>
                      </button>`;
    }

    div.innerHTML = `
      ${createAvatarHTML(user, 'avatar small', isOnline)}
      <div class="chat-item-info">
        <h4>${user.nama}</h4>
        <small style="font-size: 0.75rem; color: #94a3b8;">@${user.username}</small>
        <small>${lastMessageText}</small>
      </div>
      <div style="font-size:0.7rem; color:#64748b; text-align:right;">${lastMessageTime}</div>
      ${actionButton}
    `;
    
    // Add click handler ke div utama (hanya jika sudah teman)
    if (user.isFriend) {
      div.onclick = () => selectUser(user);
    }
    
    list.appendChild(div);
  });
  
  if(typeof feather !== 'undefined') feather.replace();
}

// Di dalam file app.js
async function sendFriendRequest(e, targetId) {
  e.stopPropagation(); // Mencegah chat terbuka saat klik tombol add
  
  const btn = e.currentTarget;
  const originalContent = btn.innerHTML;
  btn.innerHTML = "⏳"; 
  
  try {
    const res = await fetch(`${API_URL}/friends/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        fromId: currentUser._id || currentUser.id, 
        toId: targetId 
      })
    });
    
    const data = await res.json();
    
    if (data.success) {
      Toast.show("Permintaan terkirim!", "success");
      btn.innerHTML = "Pending ⏳";
      btn.disabled = true;
      btn.style.cursor = "default";
      btn.classList.add('disabled');
      
      // Update UI untuk menunjukkan status pending
      const userItem = document.querySelector(`#search-user-${data.targetUsername}`);
      if (userItem) {
        const btnContainer = userItem.querySelector('button');
        if (btnContainer) {
          btnContainer.innerHTML = "Pending ⏳";
          btnContainer.disabled = true;
          btnContainer.classList.add('disabled');
        }
      }
    } else {
      Toast.show(data.error || "Gagal mengirim request", "error");
      btn.innerHTML = originalContent;
      if(typeof feather !== 'undefined') feather.replace();
    }
  } catch (err) {
    console.error('Send friend request error:', err);
    Toast.show("Gagal mengirim request (Koneksi)", "error");
    btn.innerHTML = originalContent;
    if(typeof feather !== 'undefined') feather.replace();
  }
}

// F. Respon Request (Terima/Tolak)
async function respondFriend(requesterId, action) {
    const endpoint = action === 'accept' ? '/friends/accept' : '/friends/reject';
    
    try {
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id, requesterId })
      });
  
      const data = await res.json();
      if (data.success) {
        Toast.show(data.message, 'success');
        loadFriendsAndRequests(); // Reload list agar update
      } else {
        Toast.show(data.error, 'error');
      }
    } catch (err) {

      Toast.show('Gagal memproses permintaan', 'error');
    }
  }

// --- 6. CHAT LOGIC ---

function selectUser(user) {
  selectedUser = user;
  selectedGroup = null;
  
  // Clear unread count for this user
  clearUnread(user.username);

  const isMobile = window.innerWidth <= 768;
  
  if (isMobile) {
    // Di mobile, sembunyikan sidebar dan tampilkan chat area
    document.getElementById('sidebar').classList.add('hidden-mobile');
    document.getElementById('chatArea').classList.add('active');
  }

  document.getElementById('welcomeScreen').classList.add('hidden');
  document.getElementById('chatRoom').classList.remove('hidden');

  document.getElementById('chatName').textContent = user.nama;
  
  // Set avatar with image if available, otherwise gradient avatar
  const chatAvatarEl = document.getElementById('chatAvatar');
  const hasValidAvatar = user.avatar && 
                         user.avatar !== 'default' && 
                         (user.avatar.startsWith('data:') || user.avatar.startsWith('http'));
  
  if (hasValidAvatar) {
    chatAvatarEl.setAttribute('style', `
      background-image: url("${user.avatar}") !important;
      background-size: cover !important;
      background-position: center !important;
      background-color: transparent !important;
      display: block !important;
    `);
    chatAvatarEl.textContent = '';
  } else {
    const initial = user.nama.charAt(0).toUpperCase();
    const gradient = getAvatarGradient(user.nama || 'User');
    chatAvatarEl.style.backgroundImage = 'none';
    chatAvatarEl.style.background = gradient;
    chatAvatarEl.style.display = 'flex';
    chatAvatarEl.style.alignItems = 'center';
    chatAvatarEl.style.justifyContent = 'center';
    chatAvatarEl.style.color = 'white';
    chatAvatarEl.style.fontWeight = '600';
    chatAvatarEl.style.fontSize = '1.2rem';
    chatAvatarEl.textContent = initial;
  }

  updateChatStatusHeader();

  // Highlight active items
  document.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.group-item').forEach(el => el.classList.remove('active'));
  
  const activeItem = document.getElementById(`user-item-${user.username}`);
  if (activeItem) activeItem.classList.add('active');
  
  const activeChatItem = document.getElementById(`chat-item-${user.username}`);
  if (activeChatItem) activeChatItem.classList.add('active');

  loadMessages(user.username);
}

function closeChat() {
  selectedUser = null;
  selectedGroup = null;
  
  const isMobile = window.innerWidth <= 768;
  
  if (isMobile) {
    // Di mobile, tampilkan kembali sidebar dan sembunyikan chat area
    document.getElementById('sidebar').classList.remove('hidden-mobile');
    document.getElementById('chatArea').classList.remove('active');
  }
  
  document.getElementById('welcomeScreen').classList.remove('hidden');
  document.getElementById('chatRoom').classList.add('hidden');
  
  // Clear selection highlights
  document.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.group-item').forEach(el => el.classList.remove('active'));
}

async function loadMessages(otherUser) {
  const container = document.getElementById('messagesContainer');
  container.innerHTML = '<div style="text-align:center; padding:20px; color:#666;">Memuat pesan...</div>';

  try {
    const res = await fetch(`${API_URL}/messages/${currentUser.username}/${otherUser}`);
    const data = await res.json();
    container.innerHTML = '';

    if (data.messages.length === 0) {
      container.innerHTML = '<div style="text-align:center; padding:20px; color:#666;">Belum ada pesan. Sapa dia! 👋</div>';
    } else {
      data.messages.forEach(addMessageToUI);
    }
    scrollToBottom();
  } catch (err) {

    container.innerHTML = '<div style="text-align:center; padding:20px; color:#ef4444;">Gagal memuat pesan.</div>';
  }
}

  function sendMessage() {
    if (selectedGroup) {
      sendGroupMessage();
    } else if (selectedUser) {
      sendPrivateMessage();
    }
    
    // Update button visibility after sending
    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
      updateSendButtonVisibility();
    }
  }

function sendPrivateMessage() {
  const input = document.getElementById('messageInput');
  const msg = input.value.trim();
  const fileInput = document.getElementById('fileInput');
  const file = fileInput.files[0];

  if ((!msg && !file) || !selectedUser) return;

  if (file) {
    if (!isFileTypeAllowed(file.type)) {
      Toast.show('Tipe file tidak diizinkan', 'error');
      clearFile();
      return;
    }

    if (file.size > FILE_MAX_BYTES) {
      Toast.show('File terlalu besar (Maks 50MB)', 'error');
      clearFile();
      return;
    }
    
    // Kirim file langsung tanpa kompresi
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const payload = {
        from: currentUser.username,
        to: selectedUser.username,
        message: msg,
        file: { name: file.name, type: file.type, size: file.size, data: reader.result }
      };
      socket.emit('send_message', payload);
      const displayMsg = msg || `📎 ${file.name}`;
      saveLastMessage(selectedUser.username, displayMsg, new Date());
      input.value = '';
      clearFile();
    };
  } else {
    socket.emit('send_message', {
      from: currentUser.username,
      to: selectedUser.username,
      message: msg
    });
    // Save last message
    saveLastMessage(selectedUser.username, msg, new Date());
    input.value = '';
    // Update button visibility after clearing input
    updateSendButtonVisibility();
  }
}

// Function to compress image
function compressImage(file, callback) {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = (event) => {
    const img = new Image();
    img.src = event.target.result;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      
      // Resize ke max 400x400px (lebih aggressive)
      const maxWidth = 400;
      const maxHeight = 400;
      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }
      }
      
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      
      // Compress dengan quality lebih rendah - mulai dari 0.4 (40%)
      let compressedBase64 = canvas.toDataURL('image/jpeg', 0.4);
      
      // Jika masih terlalu besar (>300KB), compress lagi dengan quality 0.2
      if (compressedBase64.length > 300000) {
        compressedBase64 = canvas.toDataURL('image/jpeg', 0.2);
      }
      
      // Jika masih terlalu besar (>200KB), compress dengan quality 0.1
      if (compressedBase64.length > 200000) {
        compressedBase64 = canvas.toDataURL('image/jpeg', 0.1);
      }
      
      callback(compressedBase64);
    };
  };
}

function addMessageToUI(msg) {
  const container = document.getElementById('messagesContainer');
  if (container.innerText.includes('Belum ada pesan') || container.innerText.includes('Memuat') || container.innerText.includes('Gagal')) {
    container.innerHTML = '';
  }

  const isMe = msg.from === currentUser.username;
  const div = document.createElement('div');
  
  // Jika ada image, jangan kasih background/padding
  const hasImage = msg.file && msg.file.data && msg.file.type && msg.file.type.startsWith('image/');
  const fileOnly = msg.file && msg.file.data && !msg.message && !hasImage;
  
  if (hasImage && !msg.message) {
    // Hanya gambar tanpa text
    div.className = `message-img ${isMe ? 'outgoing' : 'incoming'}`;
  } else {
    div.className = `message ${isMe ? 'outgoing' : 'incoming'}${fileOnly ? ' file-only' : ''}`;
  }

  let content = '';
  if (msg.file && msg.file.data) {
    if (msg.file.type && msg.file.type.startsWith('audio/')) {
      const audioId = `audio-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      content += `
        <div class="audio-player" id="${audioId}">
          <button class="audio-play-pause" onclick="toggleAudioPlayback('${audioId}', '${msg.file.data}')">
            <i data-feather="play" class="play-icon"></i>
            <i data-feather="pause" class="pause-icon" style="display:none;"></i>
          </button>
          <div class="audio-waveform-container">
            <div class="audio-waveform" id="waveform-${audioId}"></div>
          </div>
          <span class="audio-time">0:00 / 0:00</span>
          <audio src="${msg.file.data}" id="audio-element-${audioId}" style="display: none;"></audio>
        </div>
      `;
    } else if (msg.file.type && msg.file.type.startsWith('image/')) {
      content += `<img src="${msg.file.data}" class="msg-img" onclick="openImagePreview('${msg.file.data.replace(/'/g, "\\'")}')" style="cursor: pointer;">`;
    } else {
      content += `<div class="file-bubble">
                    <a href="${msg.file.data}" download="${msg.file.name || 'file'}" class="file-bubble-link">
                      <i data-feather="${getFileIcon(msg.file.type)}"></i> 
                      <span class="file-bubble-text">
                        <span>${msg.file.name || 'Download File'}</span>
                        <small>${msg.file.size ? formatBytes(msg.file.size) : ''} ${msg.file.type ? '• ' + msg.file.type : ''}</small>
                      </span>
                    </a>
                  </div>`;
    }
  }
  if (msg.message) content += `<p style="margin:0;">${msg.message}</p>`;
  content += `<span class="msg-time">${new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`;

  div.innerHTML = content;
  container.appendChild(div);
  
  // Initialize waveform for audio messages
  if (msg.file && msg.file.data && msg.file.type && msg.file.type.startsWith('audio/')) {
    // Find the audioId in the newly added content
    const audioElements = div.querySelectorAll('[id^="audio-"]');
    if (audioElements.length > 0) {
      const audioId = audioElements[0].id.replace('audio-element-', '');
      initializeWaveform(audioId, msg.file.data);
    }
  }
  
  if(typeof feather !== 'undefined') feather.replace();
  scrollToBottom();

  // Save last message for display in contacts
  if (selectedUser && !isMe) {
    const messageText = msg.message 
      || (msg.file && msg.file.type && msg.file.type.startsWith('audio/') ? '🎤 Voice note' : '')
      || (msg.file && msg.file.name ? `📎 ${msg.file.name}` : '');
    saveLastMessage(selectedUser.username, messageText, msg.timestamp);
  }
}

function scrollToBottom() {
  const container = document.getElementById('messagesContainer');
  container.scrollTop = container.scrollHeight;
}

const fileInput = document.getElementById('fileInput');
if(fileInput){
    fileInput.addEventListener('change', function() {
      if (this.files[0]) {
        const file = this.files[0];
        if (!isFileTypeAllowed(file.type)) {
          Toast.show('Tipe file tidak diizinkan', 'error');
          clearFile();
          return;
        }

        if (file.size > FILE_MAX_BYTES) {
          Toast.show('File terlalu besar (Maks 50MB)', 'error');
          clearFile();
          return;
        }

        const preview = document.getElementById('filePreview');
        const nameEl = document.getElementById('fileName');
        const metaEl = document.getElementById('fileMeta');
        const iconEl = document.querySelector('#filePreview i');

        if (preview) preview.classList.remove('hidden');
        if (nameEl) nameEl.textContent = file.name;
        if (metaEl) metaEl.textContent = `${formatBytes(file.size)} • ${file.type || 'file'}`;
        if (iconEl) {
          iconEl.setAttribute('data-feather', getFileIcon(file.type));
          if (typeof feather !== 'undefined') feather.replace();
        }
        
        // Update send button visibility when file is selected
        updateSendButtonVisibility();
      }
    });
}

function clearFile() {
  const fi = document.getElementById('fileInput');
  if(fi) {
    fi.value = '';
    fi.files = null;
  }
  const preview = document.getElementById('filePreview');
  if (preview) {
    preview.classList.add('hidden');
    document.getElementById('fileName').textContent = '';
    const metaEl = document.getElementById('fileMeta');
    if (metaEl) metaEl.textContent = '';
  }
  
  // Update send button visibility when file is cleared
  updateSendButtonVisibility();
}

// --- CHAT HISTORY FUNCTIONS ---

function addToChatHistory(id, name, message, isGroup) {
  // Truncate long messages
  const truncated = message.length > 50 ? message.substring(0, 50) + '...' : message;
  
  // Initialize unread count if not exists
  if (!chatHistory[id]) {
    chatHistory[id] = {
      name: name,
      lastMessage: truncated,
      timestamp: new Date(),
      unreadCount: 0,
      isGroup: isGroup
    };
  } else {
    chatHistory[id].lastMessage = truncated;
    chatHistory[id].timestamp = new Date();
  }
  
  // Save to localStorage untuk persistent storage
  if (isGroup) {
    saveLastMessageGroup(id, truncated, new Date());
  } else {
    saveLastMessage(id, truncated, new Date());
  }
  
  // Update recent chats display
  updateRecentChatsDisplay();
}

function incrementUnread(id) {
  // Increment unread counter
  if (chatHistory[id]) {
    chatHistory[id].unreadCount = (chatHistory[id].unreadCount || 0) + 1;
  }
  // Save to localStorage
  saveUnreadCount(id, (chatHistory[id]?.unreadCount || 0));
  updateRecentChatsDisplay();
}

function clearUnread(id) {
  if (chatHistory[id]) {
    chatHistory[id].unreadCount = 0;
  }
  // Save to localStorage
  saveUnreadCount(id, 0);
  updateRecentChatsDisplay();
}

// Save unread count to localStorage
function saveUnreadCount(id, count) {
  try {
    const unreadMap = JSON.parse(localStorage.getItem('unreadCounts') || '{}');
    unreadMap[id] = count;
    localStorage.setItem('unreadCounts', JSON.stringify(unreadMap));
  } catch (err) {
    console.error('Error saving unread count:', err);
  }
}

// Load unread counts from localStorage
function loadUnreadCounts() {
  try {
    const unreadMap = JSON.parse(localStorage.getItem('unreadCounts') || '{}');
    // Apply unread counts to chatHistory
    Object.keys(unreadMap).forEach(id => {
      // Initialize chatHistory entry if not exists
      if (!chatHistory[id]) {
        chatHistory[id] = {
          unreadCount: unreadMap[id] || 0
        };
      } else {
        chatHistory[id].unreadCount = unreadMap[id];
      }
    });
    console.log('Loaded unread counts from localStorage:', unreadMap);
  } catch (err) {
    console.error('Error loading unread counts:', err);
  }
}

// Build recent chats from localStorage
function buildRecentChatsFromStorage() {
  recentChats = [];
  
  // Load all chat histories dari localStorage
  if (window.allUsers) {
    window.allUsers.forEach(user => {
      const lastMsg = getLastMessageForUser(user.username);
      if (lastMsg) {
        recentChats.push({
          id: user.username,
          name: user.nama,
          lastMessage: lastMsg.message,
          timestamp: new Date(lastMsg.timestamp),
          isGroup: false,
          user: user
        });
      }
    });
  }
  
  // Load group histories
  if (window.allGroups) {
    window.allGroups.forEach(group => {
      const lastMsg = getLastMessageForGroup(group._id);
      if (lastMsg) {
        recentChats.push({
          id: group._id,
          name: group.nama,
          lastMessage: lastMsg.message,
          timestamp: new Date(lastMsg.timestamp),
          isGroup: true,
          group: group
        });
      }
    });
  }
  
  // Sort by timestamp (most recent first)
  recentChats.sort((a, b) => b.timestamp - a.timestamp);
}

// Get last message untuk group
function getLastMessageForGroup(groupId) {
  try {
    const storage = localStorage.getItem(`lastMsg-${currentUser.username}-group-${groupId}`);
    if (storage) return JSON.parse(storage);
  } catch (err) {

  }
  return null;
}

// Save last message untuk group
function saveLastMessageGroup(groupId, message, timestamp) {
  try {
    const lastMsg = { message, timestamp };
    localStorage.setItem(`lastMsg-${currentUser.username}-group-${groupId}`, JSON.stringify(lastMsg));
  } catch (err) {

  }
}

function updateRecentChatsDisplay() {
  const list = document.getElementById('recentChatsList');
  if (!list) return;
  
  // Build recent chats dari storage
  buildRecentChatsFromStorage();
  
  list.innerHTML = '';
  
  if (recentChats.length === 0) {
    list.innerHTML = '<div style="text-align:center; padding:10px; color:#94a3b8; font-size:0.85rem;">Mulai chat...</div>';
    return;
  }
  
  recentChats.forEach(chat => {
    const div = document.createElement('div');
    div.className = 'list-item chat-item';
    div.id = `chat-item-${chat.id}`;
    
    const isActive = (selectedUser && selectedUser.username === chat.id) || 
                    (selectedGroup && selectedGroup._id === chat.id);
    
    if (isActive) div.classList.add('active');
    
    const timeText = formatMessageTime(chat.timestamp);
    
    // Check if user is online (only for non-group chats)
    const isOnline = !chat.isGroup && window.userStatusMap && window.userStatusMap[chat.id] === 'online';
    
    // Use createAvatarHTML for consistent avatar display with photos/initials
    let avatarHTML;
    if (chat.isGroup) {
      // For groups, show gradient background with first letter
      avatarHTML = `<div class="avatar small ${isOnline ? 'online' : ''}" style="background: linear-gradient(135deg, #8b5cf6, #6366f1);">${chat.name.charAt(0).toUpperCase()}</div>`;
    } else {
      // For users, use createAvatarHTML to show photo or initial
      if (chat.user) {
        avatarHTML = createAvatarHTML(chat.user, 'avatar small', isOnline);
      } else {
        // Fallback if user data not available
        avatarHTML = `<div class="avatar small ${isOnline ? 'online' : ''}">${chat.name.charAt(0).toUpperCase()}</div>`;
      }
    }
    
    const unreadCount = chatHistory[chat.id]?.unreadCount || 0;
    const badgeHTML = unreadCount > 0 ? `<span class="unread-badge">${unreadCount > 99 ? '99+' : unreadCount}</span>` : '';
    
    div.innerHTML = `
      ${avatarHTML}
      <div class="chat-item-info">
        <h4>${chat.name}</h4>
        <small style="color:#94a3b8; font-size:0.75rem; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${chat.lastMessage}</small>
      </div>
      <div style="font-size:0.7rem; color:#64748b; text-align:right; display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
        <span>${timeText}</span>
        ${badgeHTML}
      </div>
    `;
    
    // Ensure online status is properly applied to avatar
    if (!chat.isGroup && isOnline) {
      const avatar = div.querySelector('.avatar.small');
      if (avatar && !avatar.classList.contains('online')) {
        avatar.classList.add('online');
      }
    }
    
    div.onclick = () => {
      if (chat.isGroup) {
        selectGroup(chat.id);
      } else if (chat.user) {

        selectUser(chat.user);
      }
    };
    
    list.appendChild(div);
  });
  
  if(typeof feather !== 'undefined') feather.replace();
}

// --- 7. SOCKET LISTENERS ---

socket.on('message_sent', (msg) => {
  // Track chat history for recent chats
  addToChatHistory(msg.to, msg.to, msg.message, false);
  
  if (selectedUser && msg.to === selectedUser.username) {
    addMessageToUI(msg);
  }
});

socket.on('message_error', (payload) => {
  const message = payload?.error || 'Gagal mengirim pesan';
  Toast.show(message, 'error');
});

// Request online users list when socket connects
socket.on('connect', () => {
  socket.emit('get_online_users');
});

// Receive online users list from server
socket.on('online_users_list', (users) => {
  console.log('Received online_users_list:', users);
  window.userStatusMap = window.userStatusMap || {};
  
  // First, mark all users as offline
  if (window.allUsers) {
    window.allUsers.forEach(user => {
      window.userStatusMap[user.username] = 'offline';
    });
  }
  
  // Then mark received online users as online
  users.forEach(username => {
    window.userStatusMap[username] = 'online';
  });
  
  console.log('Updated userStatusMap:', window.userStatusMap);
  
  // Update DOM for all users (both in chat list and contacts)
  users.forEach(username => {
    // Update chat item avatar
    const chatItem = document.getElementById(`chat-item-${username}`);
    if (chatItem) {
      const avatar = chatItem.querySelector('.avatar.small');
      if (avatar) avatar.classList.add('online');
    }
    
    // Update user item avatar (in contacts tab)
    const userItem = document.getElementById(`user-item-${username}`);
    if (userItem) {
      const avatar = userItem.querySelector('.avatar.small');
      if (avatar) avatar.classList.add('online');
    }
  });
  
  // Mark all others as offline in DOM
  if (window.allUsers) {
    window.allUsers.forEach(user => {
      if (!users.includes(user.username)) {
        // Remove online class for offline users
        const chatItem = document.getElementById(`chat-item-${user.username}`);
        if (chatItem) {
          const avatar = chatItem.querySelector('.avatar.small');
          if (avatar) avatar.classList.remove('online');
        }
        
        const userItem = document.getElementById(`user-item-${user.username}`);
        if (userItem) {
          const avatar = userItem.querySelector('.avatar.small');
          if (avatar) avatar.classList.remove('online');
        }
      }
    });
  }
  
  // Re-render recent chats to show updated status
  updateRecentChatsDisplay();
  
  // Also update contacts modal if it's rendered
  if (window.ContactsModal && window.ContactsModal.currentUsers) {
    window.ContactsModal.renderUserList(window.ContactsModal.currentUsers);
  }
});

socket.on('user_status_change', (data) => {
  const statusEl = document.getElementById(`status-${data.username}`);
  if (statusEl) statusEl.className = `user-status ${data.status}`;

  // Update global status map
  window.userStatusMap = window.userStatusMap || {};
  window.userStatusMap[data.username] = data.status;

  if (selectedUser && selectedUser.username === data.username) {
    if (data.status === 'offline') {
      selectedUser.lastSeen = new Date();
    }
    updateChatStatusHeader();
  }

  // Update avatar status indicator di list items
  // Update di tab CHATS
  const chatItem = document.getElementById(`chat-item-${data.username}`);
  if (chatItem) {
    const avatar = chatItem.querySelector('.avatar.small');
    if (avatar) {
      if (data.status === 'online') {
        avatar.classList.add('online');
      } else {
        avatar.classList.remove('online');
      }
    }
  }

  // Update di tab CONTACTS
  const userItem = document.getElementById(`user-item-${data.username}`);
  if (userItem) {
    const avatar = userItem.querySelector('.avatar.small');
    if (avatar) {
      if (data.status === 'online') {
        avatar.classList.add('online');
      } else {
        avatar.classList.remove('online');
      }
    }
  }
  
  // Also update contacts modal if it's rendered
  if (window.ContactsModal && window.ContactsModal.currentUsers) {
    window.ContactsModal.renderUserList(window.ContactsModal.currentUsers);
  }

  // Re-render recent chats jika ada perubahan status
  // Ini memastikan status online selalu muncul dengan benar
  setTimeout(() => {
    updateRecentChatsDisplay();
  }, 50);
});

// Notifikasi Request Pertemanan Realtime
socket.on('new_friend_request', (data) => {
    Toast.show(`Permintaan pertemanan baru dari ${data.from.nama}`, 'info');
    loadFriendsAndRequests(); // Refresh list otomatis
});

// Typing indicator
socket.on('user_typing', (data) => {
  if (selectedUser && selectedUser.username === data.from) {
    document.getElementById('chatStatus').innerHTML = '<em style="font-style: italic; color: #22c55e;">sedang mengetik...</em>';
    
    // Clear after 3 seconds
    if (window.typingTimeout) clearTimeout(window.typingTimeout);
    window.typingTimeout = setTimeout(() => {
      updateChatStatusHeader();
    }, 3000);
  }
  
  // Update chat list item to show typing
  const chatItem = document.getElementById(`chat-item-${data.from}`);
  if (chatItem) {
    const msg = chatItem.querySelector('small');
    if (msg) {
      msg.innerHTML = `<i data-feather="edit-3" style="font-size:0.8rem; color:#22c55e;"></i> sedang mengetik...`;
      if(typeof feather !== 'undefined') feather.replace();
    }
  }
});

socket.on('stop_typing', (data) => {
  // Restore last message in chat item
  if (chatHistory[data.from]) {
    const chatItem = document.getElementById(`chat-item-${data.from}`);
    if (chatItem) {
      const msg = chatItem.querySelector('small');
      if (msg) {
        msg.textContent = chatHistory[data.from].lastMessage;
      }
    }
  }
  if (selectedUser && selectedUser.username === data.from) {
    updateChatStatusHeader();
  }
});

// --- 8. WEBRTC / CALL LOGIC ---

// Initiate call dari history
async function initiateCallFromHistory(event, username, callType) {
  event.stopPropagation();
  
  // Cari user dari allUsers berdasarkan username
  const user = window.allUsers ? window.allUsers.find(u => u.username === username) : null;
  
  if (!user) {
    Toast.show('User tidak ditemukan', 'error');
    return;
  }
  
  // Select user terlebih dahulu
  selectUser(user);
  
  // Tunggu sebentar agar UI update
  setTimeout(() => {
    startCall(callType);
  }, 100);
}

function startCallTimer() {
  callDuration = 0;
  callStartTime = Date.now(); // Record when the call started
  if (callTimer) clearInterval(callTimer);
  callTimer = setInterval(() => {
    callDuration++;
    const minutes = Math.floor(callDuration / 60);
    const seconds = callDuration % 60;
    const timeString = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    document.getElementById('callStatus').textContent = timeString;
  }, 1000);
}

function stopCallTimer() {
  if (callTimer) {
    clearInterval(callTimer);
    callTimer = null;
  }
}

async function startCall(type) {
  if (!selectedUser && !selectedGroup) return;
  
  // Group call belum support, hanya personal call
  if (selectedGroup) {
    Toast.show('Group video call sedang dalam pengembangan', 'info');
    return;
  }
  
  isVideo = type === 'video';

  const modal = document.getElementById('callModal');
  modal.classList.remove('hidden');
  modal.classList.add('active');

  document.getElementById('callTargetName').textContent = selectedUser.nama;
  document.getElementById('callStatus').textContent = '';
  document.getElementById('incomingActions').classList.add('hidden');
  document.getElementById('activeCallActions').classList.remove('hidden');

  document.getElementById('videoContainer').classList.toggle('hidden', !isVideo);

  if (isVideo) {
    document.getElementById('callAvatar').classList.add('hidden');
    document.getElementById('callTargetName').classList.add('hidden');
  }

  await setupMedia();
  createPeerConnection();

  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('call_offer', { offer, to: selectedUser.username, from: currentUser.username, type });
  } catch (e) {

    endCall();
  }
}

socket.on('call_offer', (data) => {
  const modal = document.getElementById('callModal');
  modal.classList.remove('hidden');
  modal.classList.add('active');

  document.getElementById('callTargetName').textContent = data.from;
  document.getElementById('callStatus').textContent = '';
  document.getElementById('incomingActions').classList.remove('hidden');
  document.getElementById('activeCallActions').classList.add('hidden');
  document.getElementById('videoContainer').classList.add('hidden');

  isVideo = data.type === 'video';
  window.pendingOffer = data.offer;
  window.callerUsername = data.from;
  
  // Set timer untuk missed call (30 detik)
  window.missedCallTimer = setTimeout(() => {
    if (window.callerUsername && !window.callAnswered) {
      // Panggilan tidak dijawab
      saveCallToHistoryWithStatus(data.from, data.from, data.type, 0, 'missed');
      Toast.show('Panggilan tidak terjawab', 'info');
      closeCallUI();
    }
  }, 30000);
});

async function answerCall() {
  // Clear missed call timer
  if (window.missedCallTimer) clearTimeout(window.missedCallTimer);
  window.callAnswered = true;
  
  document.getElementById('incomingActions').classList.add('hidden');
  document.getElementById('activeCallActions').classList.remove('hidden');
  if (isVideo) {
    document.getElementById('videoContainer').classList.remove('hidden');
    document.getElementById('callAvatar').classList.add('hidden');
    document.getElementById('callTargetName').classList.add('hidden');
  }

  await setupMedia();
  createPeerConnection();
  await peerConnection.setRemoteDescription(new RTCSessionDescription(window.pendingOffer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  socket.emit('call_answer', { answer, to: window.callerUsername, from: currentUser.username });
  
  // Start the call timer when the call is answered
  startCallTimer();
}

function endCall() {
  const target = selectedUser ? selectedUser.username : window.callerUsername;
  const targetName = selectedUser ? selectedUser.nama : window.callerUsername;
  
  // Save call history with 'completed' status
  // Save for both outgoing and incoming calls
  if (selectedUser) {
    // Outgoing call
    saveCallToHistoryWithStatus(target, targetName, isVideo ? 'video' : 'voice', callDuration, 'completed');
  } else if (window.callerUsername) {
    // Incoming call (when ending from receiver side)
    const callerName = window.callerUsername;
    saveCallToHistoryWithStatus(callerName, callerName, isVideo ? 'video' : 'voice', callDuration, 'completed');
  }
  
  if (target) socket.emit('end_call', { to: target });
  closeCallUI();
}

function rejectCall() {
  if (window.callerUsername && window.userStatusMap) {
    const callerName = window.callerUsername;
    saveCallToHistoryWithStatus(window.callerUsername, callerName, isVideo ? 'video' : 'voice', 0, 'rejected');
  }
  if (window.callerUsername) socket.emit('end_call', { to: window.callerUsername });
  closeCallUI();
}

function closeCallUI() {
  stopCallTimer();
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  const modal = document.getElementById('callModal');
  modal.classList.add('hidden');
  modal.classList.remove('active');

  document.getElementById('callAvatar').classList.remove('hidden');
  document.getElementById('callTargetName').classList.remove('hidden');
  window.pendingOffer = null;
  window.callerUsername = null;
  callStartTime = null; // Reset call start time
  isVideo = false;
}

socket.on('call_ended', () => {
    Toast.show('Panggilan diakhiri', 'info');
    
    // Save call history for incoming calls when ended by caller
    if (window.callerUsername && callStartTime) {
        const callDuration = Math.floor((Date.now() - callStartTime) / 1000);
        const callerName = window.callerUsername;
        saveCallToHistoryWithStatus(callerName, callerName, isVideo ? 'video' : 'voice', callDuration, 'completed');
        displayCallHistory(); // Refresh the call history display
    }
    
    closeCallUI();
});

socket.on('call_answer', async (data) => {
  await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on('ice_candidate', async (data) => {
  if (peerConnection) await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
});

async function setupMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
    document.getElementById('localVideo').srcObject = localStream;
  } catch (e) {
    Toast.show('Gagal akses kamera/mic', 'error');
    closeCallUI();
  }
}

function createPeerConnection() {
  peerConnection = new RTCPeerConnection(config);
  if (localStream) localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
  peerConnection.ontrack = (e) => {
    document.getElementById('remoteVideo').srcObject = e.streams[0];
    startCallTimer();
  };
  peerConnection.onicecandidate = (e) => {
    if (e.candidate) {
      const target = selectedUser ? selectedUser.username : window.callerUsername;
      socket.emit('ice_candidate', { candidate: e.candidate, to: target, from: currentUser.username });
    }
  };
}

function toggleMute() {
  if(!localStream) return;
  const track = localStream.getAudioTracks()[0];
  track.enabled = !track.enabled;
  document.getElementById('muteBtn').style.backgroundColor = track.enabled ? '#475569' : '#ef4444';
}

function toggleCamera() {
  if(!localStream) return;
  const track = localStream.getVideoTracks()[0];
  track.enabled = !track.enabled;
  document.getElementById('camBtn').style.backgroundColor = track.enabled ? '#475569' : '#ef4444';
}

// --- 9. GROUP CHAT FUNCTIONS ---

let allGroups = [];

// Load groups saat aplikasi dimulai
async function loadGroups() {
  try {
    const res = await fetch(`${API_URL}/groups/${currentUser.id}`);
    const data = await res.json();
    
    if (data.success) {
      allGroups = data.groups || [];
      displayGroups();
      
      // Initialize chat history for groups
      allGroups.forEach(group => {
        if (!chatHistory[group._id]) {
          chatHistory[group._id] = {
            id: group._id,
            name: group.nama,
            lastMessage: 'Mulai chat...',
            timestamp: new Date(),
            unreadCount: 0,
            isGroup: true
          };
        }
      });
      updateRecentChatsDisplay();
      
      // Request online users list before joining
      socket.emit('get_online_users');
      
      // Emit join dengan username dan group IDs
      const groupIds = allGroups.map(g => g._id);
      socket.emit('join', { username: currentUser.username, groupIds });
    }
  } catch (err) {

    // Fallback: emit join dengan format lama jika error
    // Request online users list sebelum join
    socket.emit('get_online_users');
    socket.emit('join', currentUser.username);
  }
}

function displayGroups() {
  const list = document.getElementById('groupsList');
  if (!list) return;
  
  list.innerHTML = '';
  
  if (!allGroups || allGroups.length === 0) {
    list.innerHTML = '<div style="text-align:center; padding:10px; color:#94a3b8; font-size:0.85rem;">Belum ada group</div>';
    return;
  }

  // Sort groups by last message timestamp
  const sortedGroups = [...allGroups].sort((a, b) => {
    const lastMsgA = getLastMessageForGroup(a._id);
    const lastMsgB = getLastMessageForGroup(b._id);
    const timeA = lastMsgA ? new Date(lastMsgA.timestamp) : new Date(0);
    const timeB = lastMsgB ? new Date(lastMsgB.timestamp) : new Date(0);
    return timeB - timeA;
  });

  sortedGroups.forEach(group => {
    const div = document.createElement('div');
    div.className = 'list-item chat-item';
    div.id = `group-item-${group._id}`;
    
    const isActive = selectedGroup && selectedGroup._id === group._id;
    if (isActive) div.classList.add('active');
    
    const avatar = group.avatar || group.nama.charAt(0).toUpperCase();
    const lastMsg = getLastMessageForGroup(group._id);
    const timeText = lastMsg ? formatMessageTime(new Date(lastMsg.timestamp)) : '';
    
    div.innerHTML = `
      <div class="avatar small" style="background: linear-gradient(135deg, #8b5cf6, #6366f1);">${avatar}</div>
      <div class="chat-item-info">
        <h4>${group.nama}</h4>
        <small>${lastMsg ? lastMsg.message : `${group.members.length} anggota`}</small>
      </div>
      <div style="font-size:0.7rem; color:#64748b; text-align:right;">${timeText}</div>
    `;
    
    div.onclick = () => selectGroup(group._id);
    
    list.appendChild(div);
  });
  
  if(typeof feather !== 'undefined') feather.replace();
}

function openCreateGroupModal() {
  const modal = document.getElementById('createGroupModal');
  modal.classList.remove('hidden');
  modal.classList.add('active');
  
  // Populate members list
  populateMembersCheckbox();
  
  // Reset form
  document.getElementById('groupNameInput').value = '';
  document.querySelectorAll('input[name="groupMembers"]').forEach(cb => cb.checked = false);
  
  if(typeof feather !== 'undefined') feather.replace();
}

async function populateMembersCheckbox() {
  const container = document.getElementById('membersListContainer');
  
  if (!window.allUsers || window.allUsers.length === 0) {
    container.innerHTML = '<div style="padding:10px; color:#94a3b8;">Tidak ada teman</div>';
    return;
  }
  
  container.innerHTML = '';
  
  window.allUsers.forEach(user => {
    const div = document.createElement('div');
    div.className = 'member-checkbox';
    
    const id = `member-${user._id}`;
    
    // Check if user has a profile photo
    let avatarHtml = '';
    if (user.avatar) {
      // User has uploaded a profile photo
      avatarHtml = `<div class="user-avatar-small" style="background-image: url('${user.avatar}'); background-size: cover; background-position: center;"></div>`;
    } else {
      // Generate text avatar with first letter
      const avatarText = user.nama ? user.nama.charAt(0).toUpperCase() : user.username.charAt(0).toUpperCase();
      avatarHtml = `<div class="user-avatar-small">${avatarText}</div>`;
    }
    
    div.innerHTML = `
      ${avatarHtml}
      <label for="${id}" class="member-name">${user.nama || user.username}</label>
      <input type="checkbox" id="${id}" name="groupMembers" value="${user._id}">
    `;
    
    container.appendChild(div);
  });
}

async function createGroup() {
  const groupName = document.getElementById('groupNameInput').value.trim();
  
  if (!groupName) {
    Toast.show('Nama group tidak boleh kosong', 'error');
    return;
  }
  
  if (groupName.length > 50) {
    Toast.show('Nama group terlalu panjang (max 50 karakter)', 'error');
    return;
  }
  
  // Ambil member yang dipilih
  const selectedMembers = Array.from(document.querySelectorAll('input[name="groupMembers"]:checked'))
    .map(cb => cb.value);
  
  if (selectedMembers.length === 0) {
    Toast.show('Pilih minimal 1 anggota', 'error');
    return;
  }
  
  const btn = document.getElementById('createGroupBtn');
  const originalText = btn.innerText;
  btn.disabled = true;
  btn.innerText = 'Membuat...';
  
  try {
    const res = await fetch(`${API_URL}/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nama: groupName,
        createdBy: currentUser.id || currentUser._id,
        members: selectedMembers
      })
    });
    
    const data = await res.json();
    
    if (data.success) {
      Toast.show('Group berhasil dibuat!', 'success');
      
      // Tambah ke local list
      allGroups.unshift(data.group);
      displayGroups();
      
      // Add to chat history
      chatHistory[data.group._id] = {
        id: data.group._id,
        name: data.group.nama,
        lastMessage: 'Mulai chat...',
        timestamp: new Date(),
        unreadCount: 0,
        isGroup: true
      };
      updateRecentChatsDisplay();
      
      // Tutup modal
      document.getElementById('createGroupModal').classList.remove('active');
      document.getElementById('createGroupModal').classList.add('hidden');
      
      // Select group yang baru dibuat
      setTimeout(() => selectGroup(data.group._id), 300);
    } else {
      Toast.show(data.error || 'Gagal membuat group', 'error');
    }
  } catch (err) {

    Toast.show('Terjadi kesalahan saat membuat group', 'error');
  } finally {
    btn.disabled = false;
    btn.innerText = originalText;
  }
}

function selectGroupById(groupId) {
  if (!Array.isArray(allGroups)) return false;
  const found = allGroups.find(g => g._id === groupId);
  if (!found) return false;
  selectGroup(groupId);
  return true;
}

function selectGroup(groupId) {
  selectedGroup = allGroups.find(g => g._id === groupId);
  selectedUser = null; // Clear selectedUser saat membuka group
  
  if (!selectedGroup) return;
  
  // Clear unread count for this group
  clearUnread(groupId);
  
  const isMobile = window.innerWidth <= 768;
  
  if (isMobile) {
    document.getElementById('sidebar').classList.add('hidden-mobile');
    document.getElementById('chatArea').classList.add('active');
  }
  
  document.getElementById('welcomeScreen').classList.add('hidden');
  document.getElementById('chatRoom').classList.remove('hidden');
  
  // Update chat header untuk group
  document.getElementById('chatName').textContent = selectedGroup.nama;
  document.getElementById('chatAvatar').textContent = selectedGroup.avatar || 'G';
  document.getElementById('chatStatus').textContent = `${selectedGroup.members.length} anggota`;
  
  // Highlight active group
  document.querySelectorAll('.group-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
  
  const activeGroup = document.getElementById(`group-item-${groupId}`);
  if (activeGroup) activeGroup.classList.add('active');
  
  const activeChatItem = document.getElementById(`chat-item-${groupId}`);
  if (activeChatItem) activeChatItem.classList.add('active');
  
  loadGroupMessages(groupId);
}

async function loadGroupMessages(groupId) {
  const container = document.getElementById('messagesContainer');
  container.innerHTML = '<div style="text-align:center; padding:20px; color:#666;">Memuat pesan...</div>';

  try {
    const res = await fetch(`${API_URL}/groups/${groupId}/messages`);
    const data = await res.json();
    container.innerHTML = '';

    if (data.messages.length === 0) {
      container.innerHTML = '<div style="text-align:center; padding:20px; color:#666;">Belum ada pesan. Mulai percakapan! 💬</div>';
    } else {
      data.messages.forEach(msg => addGroupMessageToUI(msg));
    }
    scrollToBottom();
  } catch (err) {

    container.innerHTML = '<div style="text-align:center; padding:20px; color:#ef4444;">Gagal memuat pesan.</div>';
  }
}

function addGroupMessageToUI(msg) {
  const container = document.getElementById('messagesContainer');
  if (container.innerText.includes('Belum ada pesan') || container.innerText.includes('Memuat') || container.innerText.includes('Gagal')) {
    container.innerHTML = '';
  }

  const isMe = msg.from === currentUser.username;
  
  // Jika ada image, jangan kasih background/padding
  const hasImage = msg.file && msg.file.data && msg.file.type && msg.file.type.startsWith('image/');
  
  const div = document.createElement('div');
  const fileOnly = msg.file && msg.file.data && !msg.message && !hasImage;
  if (hasImage && !msg.message) {
    div.className = `message-img ${isMe ? 'outgoing' : 'incoming group-message'}`;
  } else {
    div.className = `message ${isMe ? 'outgoing' : 'incoming group-message'}${fileOnly ? ' file-only' : ''}`;
  }

  let content = '';
  if (!isMe) {
    content += `<small style="color: var(--primary); font-weight: 600; display: block; margin-bottom: 4px;">${msg.from}</small>`;
  }
  
  if (msg.file && msg.file.data) {
    if (msg.file.type && msg.file.type.startsWith('audio/')) {
      const audioId = `audio-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      content += `
        <div class="audio-player" id="${audioId}">
          <button class="audio-play-pause" onclick="toggleAudioPlayback('${audioId}', '${msg.file.data}')">
            <svg class="play-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
            <svg class="pause-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none;">
              <rect x="6" y="4" width="4" height="16"></rect>
              <rect x="14" y="4" width="4" height="16"></rect>
            </svg>
          </button>
          <div class="audio-waveform-container">
            <div class="audio-waveform" id="waveform-${audioId}"></div>
          </div>
          <span class="audio-time">0:00 / 0:00</span>
          <audio src="${msg.file.data}" id="audio-element-${audioId}" style="display: none;"></audio>
        </div>
      `;
    } else if (msg.file.type && msg.file.type.startsWith('image/')) {
      content += `<img src="${msg.file.data}" class="msg-img" onclick="openImagePreview('${msg.file.data.replace(/'/g, "\\'")}')" style="cursor: pointer;">`;
    } else {
      content += `<div class="file-bubble">
                    <a href="${msg.file.data}" download="${msg.file.name || 'file'}" class="file-bubble-link">
                      <i data-feather="${getFileIcon(msg.file.type)}"></i> 
                      <span class="file-bubble-text">
                        <span>${msg.file.name || 'Download File'}</span>
                        <small>${msg.file.size ? formatBytes(msg.file.size) : ''} ${msg.file.type ? '• ' + msg.file.type : ''}</small>
                      </span>
                    </a>
                  </div>`;
    }
  }
  if (msg.message) content += `<p style="margin:0;">${msg.message}</p>`;
  content += `<span class="msg-time">${new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`;

  div.innerHTML = content;
  container.appendChild(div);
  
  // Initialize waveform for audio messages
  if (msg.file && msg.file.data && msg.file.type && msg.file.type.startsWith('audio/')) {
    // Find the audioId in the newly added content
    const audioElements = div.querySelectorAll('[id^="audio-"]');
    if (audioElements.length > 0) {
      const audioId = audioElements[0].id.replace('audio-element-', '');
      initializeWaveform(audioId, msg.file.data);
    }
  }
  
  if(typeof feather !== 'undefined') feather.replace();
  scrollToBottom();
}

function sendGroupMessage() {
  if (!selectedGroup) return;
  
  const input = document.getElementById('messageInput');
  const msg = input.value.trim();
  const fileInput = document.getElementById('fileInput');
  const file = fileInput.files[0];

  if (!msg && !file) return;

  if (file) {
    if (!isFileTypeAllowed(file.type)) {
      Toast.show('Tipe file tidak diizinkan', 'error');
      clearFile();
      return;
    }

    if (file.size > FILE_MAX_BYTES) {
      Toast.show('File terlalu besar (Maks 50MB)', 'error');
      clearFile();
      return;
    }
    
    // Kirim file langsung tanpa kompresi
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      socket.emit('send_message', {
        from: currentUser.username,
        to: selectedGroup._id,
        message: msg,
        file: { name: file.name, type: file.type, size: file.size, data: reader.result },
        groupId: selectedGroup._id
      });
      const displayMsg = msg || `📎 ${file.name}`;
      saveLastMessageGroup(selectedGroup._id, displayMsg, new Date());
      input.value = '';
      clearFile();
      // Update button visibility after clearing input
      updateSendButtonVisibility();
    };
  } else {
    socket.emit('send_message', {
      from: currentUser.username,
      to: selectedGroup._id,
      message: msg,
      groupId: selectedGroup._id
    });
    // Save last message untuk group
    saveLastMessageGroup(selectedGroup._id, msg, new Date());
    input.value = '';
    // Update button visibility after clearing input
    updateSendButtonVisibility();
  }
}

// Update socket listener untuk group messages
socket.on('receive_message', function(msg) {
  const summaryText = msg.message 
    || (msg.file && msg.file.type && msg.file.type.startsWith('audio/') ? '🎤 Voice note' : '')
    || (msg.file && msg.file.name ? `📎 ${msg.file.name}` : '');

  // Track chat history
  if (msg.groupId) {
    addToChatHistory(msg.groupId, msg.groupName || 'Group', summaryText, true);
    
    // Group message
    if (selectedGroup && msg.groupId === selectedGroup._id) {
      addGroupMessageToUI(msg);
    } else {
      // Cari group yang menerima message
      incrementUnread(msg.groupId);
    }
  } else {
    addToChatHistory(msg.from, msg.from, summaryText, false);
    
    // Private message (handle seperti sebelumnya)
    if (selectedUser && (msg.from === selectedUser.username || msg.to === selectedUser.username)) {
      addMessageToUI(msg);
    } else {
      const userItem = document.getElementById(`user-item-${msg.from}`);
      if(userItem) {
          userItem.style.background = "rgba(99, 102, 241, 0.1)"; 
          setTimeout(() => userItem.style.background = "", 3000);
      }
      incrementUnread(msg.from);
    }
  }
});

// --- HELPER FUNCTIONS FOR MESSAGE & CALL HISTORY ---

// Get last message untuk user tertentu
function getLastMessageForUser(username) {
  try {
    const storage = localStorage.getItem(`lastMsg-${currentUser.username}-${username}`);
    if (storage) return JSON.parse(storage);
  } catch (err) {

  }
  return null;
}

// Save last message
function saveLastMessage(username, message, timestamp) {
  try {
    const lastMsg = { message, timestamp };
    localStorage.setItem(`lastMsg-${currentUser.username}-${username}`, JSON.stringify(lastMsg));
  } catch (err) {

  }
}

// Format message time untuk display
function formatMessageTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString('id-ID', { month: 'short', day: 'numeric' });
}

// --- CALL HISTORY TRACKING ---

// Save call ke history dengan status
function saveCallToHistoryWithStatus(targetUsername, targetName, type, duration, status) {
  const call = {
    id: Date.now(),
    username: targetUsername,
    name: targetName,
    type: type, // 'voice' or 'video'
    duration: duration,
    timestamp: new Date(),
    status: status // 'completed', 'missed', 'rejected'
  };
  
  callHistory.unshift(call);
  
  // Simpan ke localStorage (limit 50 call terakhir)
  try {
    const stored = JSON.parse(localStorage.getItem(`callHistory-${currentUser.username}`) || '[]');
    stored.unshift(call);
    localStorage.setItem(`callHistory-${currentUser.username}`, JSON.stringify(stored.slice(0, 50)));
  } catch (err) {

  }
}

// Keep old function for backward compatibility
function saveCallToHistory(targetUsername, targetName, type, duration) {
  saveCallToHistoryWithStatus(targetUsername, targetName, type, duration, 'completed');
}

// Load call history dari localStorage
function loadCallHistory() {
  try {
    const stored = localStorage.getItem(`callHistory-${currentUser.username}`);
    callHistory = stored ? JSON.parse(stored) : [];
    displayCallHistory();
  } catch (err) {

    displayCallHistory();
  }
}

// Display call history
function displayCallHistory() {
  const list = document.getElementById('callsList');
  
  if (!list) return;
  
  list.innerHTML = '';

  if (!callHistory || callHistory.length === 0) {
    list.innerHTML = `
      <div class="call-empty">
        <i data-feather="phone" style="width: 48px; height: 48px; opacity: 0.5; margin-bottom: 15px;"></i>
        <p>No call history yet</p>
      </div>
    `;
    if(typeof feather !== 'undefined') feather.replace();
    return;
  }

  callHistory.forEach(call => {
    const div = document.createElement('div');
    div.className = 'call-item';
    
    // Hanya tampilkan durasi untuk completed call
    let durationText = '';
    if (call.status === 'completed' && call.duration) {
      durationText = formatDuration(call.duration);
    }
    
    const typeIcon = call.type === 'video' ? 'video' : 'phone';
    const callDate = new Date(call.timestamp);
    
    // Tombol call sesuai dengan tipe history
    const callButtonIcon = call.type === 'video' ? 'video' : 'phone';
    const callButtonText = call.type === 'video' ? 'Video Call' : 'Voice Call';
    
    // Tentukan status badge
    let statusBadge = '';
    if (call.status === 'missed') {
      statusBadge = '<span class="call-status missed" title="Tidak Terjawab"><i data-feather="phone-missed" style="width:14px; height:14px;"></i></span>';
    } else if (call.status === 'rejected') {
      statusBadge = '<span class="call-status rejected" title="Ditolak"><i data-feather="phone-off" style="width:14px; height:14px;"></i></span>';
    } else if (call.status === 'completed') {
      statusBadge = '<span class="call-status completed" title="Diterima"><i data-feather="check" style="width:14px; height:14px;"></i></span>';
    }
    
    div.innerHTML = `
      <div class="avatar small" style="background: linear-gradient(135deg, #8b5cf6, #6366f1);">
        ${call.name.charAt(0).toUpperCase()}
      </div>
      <div class="call-item-info">
        <h4>${call.name}</h4>
      </div>
      <div class="call-item-time">
        ${statusBadge}
        <small>${formatCallDate(callDate)}</small>
      </div>
      <button onclick="initiateCallFromHistory(event, '${call.username}', '${call.type}')" class="icon-btn" title="${callButtonText}">
        <i data-feather="${callButtonIcon}" style="width:18px; height:18px;"></i>
      </button>
    `;
    
    list.appendChild(div);
  });
  
  if(typeof feather !== 'undefined') feather.replace();
}


function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

// Format call date untuk display
function formatCallDate(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString('id-ID', { month: 'short', day: 'numeric' });
}

// --- KEYBOARD DETECTION UNTUK MOBILE ---
let previousInnerHeight = window.innerHeight;

window.addEventListener('resize', () => {
  const currentInnerHeight = window.innerHeight;
  const keyboardHeight = previousInnerHeight - currentInnerHeight;
  
  // Jika tinggi window berkurang, keyboard mungkin sedang terbuka
  if (currentInnerHeight < previousInnerHeight) {
    // Keyboard sedang terbuka - scroll ke bawah otomatis
    const messagesContainer = document.getElementById('messagesContainer');
    if (messagesContainer) {
      setTimeout(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }, 100);
    }
  }
  
  previousInnerHeight = currentInnerHeight;
});

// Juga handle input focus untuk scroll
document.addEventListener('focusin', (e) => {
  if (e.target.matches('.input-area input, textarea')) {
    setTimeout(() => {
      const messagesContainer = document.getElementById('messagesContainer');
      if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    }, 100);
  }
});

// --- IMAGE PREVIEW FUNCTIONS ---

// Store current preview image for download
let currentPreviewImage = null;
let currentPreviewImageName = 'image.jpg';

function openImagePreview(imageSrc) {
  currentPreviewImage = imageSrc;
  const modal = document.getElementById('imagePreviewModal');
  const imgElement = document.getElementById('previewImageSrc');
  
  imgElement.src = imageSrc;
  modal.classList.remove('hidden');
  modal.classList.add('active');
  
  // Disable body scroll
  document.body.style.overflow = 'hidden';
}

function closeImagePreview() {
  const modal = document.getElementById('imagePreviewModal');
  modal.classList.add('hidden');
  modal.classList.remove('active');
  currentPreviewImage = null;
  
  // Enable body scroll
  document.body.style.overflow = 'auto';
}

function downloadPreviewImage() {
  if (!currentPreviewImage) return;
  
  // Create link element
  const link = document.createElement('a');
  link.href = currentPreviewImage;
  link.download = currentPreviewImageName || 'image.jpg';
  
  // Trigger download
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  Toast.show('Gambar sedang diunduh...', 'success');
}

// Close preview when clicking outside the image
document.addEventListener('click', (e) => {
  const modal = document.getElementById('imagePreviewModal');
  if (modal && modal.classList.contains('active')) {
    if (e.target === modal || e.target.id === 'imagePreviewModal') {
      closeImagePreview();
    }
  }
});

// Close preview with ESC key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('imagePreviewModal');
    if (modal && modal.classList.contains('active')) {
      closeImagePreview();
    }
  }
});

// --- GROUP CALL FUNCTIONS ---

function startGroupCall(type) {
  if (!selectedGroup) return;
  
  const callType = type === 'video' ? 'Video Call' : 'Voice Call';
  const message = `📞 ${currentUser.nama} mengajukan ${callType} kepada grup ini`;
  
  // Kirim notifikasi call ke group
  socket.emit('send_message', {
    from: currentUser.username,
    to: selectedGroup._id,
    message: message,
    groupId: selectedGroup._id,
    isCallNotification: true,
    callType: type
  });
}

function openUserProfile() {
  if (!selectedUser) return;
  
  localStorage.setItem('selectedUserProfile', JSON.stringify({
    ...selectedUser,
    status: window.userStatusMap?.[selectedUser.username] === 'online' ? 'online' : 'offline'
  }));
  
  window.location.href = 'profiles.html';
}

function closeUserProfile() {
}

function blockUser() {
  if (!selectedUser) return;
  
  if (!confirm(`Block @${selectedUser.username}?`)) return;
  
  fetch(`${API_URL}/users/block/${selectedUser._id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blockerId: currentUser.id })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      Toast.show(`${selectedUser.nama} has been blocked`, 'success');
      window.history.back();
      closeChat();
      loadFriendsAndRequests();
    } else {
      Toast.show(data.message || 'Failed to block user', 'error');
    }
  })
  .catch(err => {
    Toast.show('Error blocking user', 'error');
  });
}
