//
const socket = io({
  extraHeaders: {
    "ngrok-skip-browser-warning": "true"
  }
});
const API_URL = `${window.location.origin}/api`;

// --- NGROK BYPASS: Override fetch untuk menambahkan header otomatis ---
const originalFetch = window.fetch;
window.fetch = function(url, options = {}) {
  const newOptions = { ...options };
  newOptions.headers = newOptions.headers || {};
  if (newOptions.headers.constructor === Object) {
    newOptions.headers['ngrok-skip-browser-warning'] = 'true';
  }
  return originalFetch(url, newOptions);
};

let currentUser = JSON.parse(localStorage.getItem('currentUser'));
let selectedUser = null;
let selectedGroup = null;
let peerConnection;
let localStream;
let searchTimeout = null;
let callTimer = null;
let callDuration = 0;
let isVideo = false;
let currentReplyContext = null; // To store { messageId, senderName, content }
let selectedMessageElement = null; // To store the DOM element being right-clicked
const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// --- CHAT HISTORY TRACKING ---
let chatHistory = {}; // { username/groupId: { name, lastMessage, timestamp, unreadCount, isGroup } }
let typingUsers = {}; // { username: true/false }
let callHistory = []; // Array untuk menyimpan history call
let recentChats = []; // Array untuk riwayat chat (user + group)
let currentTab = 'chats'; // Track tab mana yang aktif
window.userStatusMap = {}; // Initialize status map globally
const FILE_MAX_BYTES = 10 * 1024 * 1024; // 10MB (Sesuaikan dengan server)
const ALLOWED_FILE_TYPES = ['image/', 'video/', 'audio/', 'application/pdf', 'text/plain'];
let voiceRecorder = { recorder: null, chunks: [], stream: null, timer: null, startTime: null, interval: null };
let chatSearchTimeout = null;
let callStartTime = null; // Timestamp when call started

// Status Viewer Globals
let currentStatuses = {};
let statusQueue = [];
let currentStatusIndex = 0;
let statusTimer = null;
let statusUserOrder = [];
let currentViewedUserId = null;

let statusImageBase64 = null;
let statusNavLock = false; // Mencegah double-click/skip tidak sengaja

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
    
    const icons = {
      success: 'check-circle',
      error: 'alert-octagon',
      info: 'info',
      warning: 'alert-triangle'
    };
    const iconName = icons[type] || 'info';

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <div class="toast-icon"><i data-feather="${iconName}"></i></div>
      <div class="toast-content">${message}</div>
    `;
    
    this.container.appendChild(toast);
    if (typeof feather !== 'undefined') feather.replace();
    
    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 400);
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

// --- SECURITY: Prevent XSS ---
function escapeHtml(text) {
  if (!text) return text;
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
    container.innerHTML = '<div class="empty-state">Tidak ada hasil ditemukan di chat ini.</div>';
    return;
  }

  container.innerHTML = '';
  items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'chat-search-result-item';
    const ts = new Date(item.timestamp).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const snippet = item.message || (item.file && item.file.name ? `📎 ${item.file.name}` : 'Pesan media');
    const senderName = escapeHtml(item.sender ? (item.sender.username === currentUser.username ? 'Anda' : item.sender.nama) : item.from);

    div.innerHTML = `
      <div class="meta">
        <span>Dari: <strong>${senderName}</strong></span>
        <span>${ts}</span>
      </div>
      <div class="snippet">${escapeHtml(snippet)}</div>
    `;
    div.onclick = (e) => {
      scrollToMessage(e, item.id);
      toggleChatSearchPanel(true);
    };
    container.appendChild(div);
  });
}

function handleChatSearchInput(e) {
  const q = e.target.value.trim();
  const results = document.getElementById('chatSearchResults');

  if (chatSearchTimeout) clearTimeout(chatSearchTimeout);

  if (!q) {
    if (results) results.innerHTML = '<div class="empty-state">Ketik untuk mencari pesan di chat ini</div>';
    return;
  }

  if (!selectedUser && !selectedGroup) {
    if (results) results.innerHTML = '<div class="empty-state">Pilih sebuah chat terlebih dahulu</div>';
    return;
  }

  if (results) results.innerHTML = '<div class="empty-state">Mencari...</div>';

  chatSearchTimeout = setTimeout(async () => {
    try {
      let searchQuery = `userId=${currentUser.id}&q=${encodeURIComponent(q)}`;
      if (selectedUser) {
        searchQuery += `&chatId=${selectedUser.username}`;
      } else if (selectedGroup) {
        searchQuery += `&chatId=${selectedGroup._id}&isGroup=true`;
      }

      const res = await fetch(`${API_URL}/messages/search?${searchQuery}`);
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
        Toast.show('Voice note terlalu besar (>10MB)', 'error');
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

    const tempId = `temp-${Date.now()}-${Math.random()}`;

    if (selectedGroup) {
      const payload = {
        from: currentUser.username,
        to: selectedGroup._id,
        message: '',
        file: filePayload,
        groupId: selectedGroup._id,
        tempId
      };
      socket.emit('send_message', payload);
      addGroupMessageToUI({ ...payload, timestamp: new Date().toISOString(), _id: tempId });
      saveLastMessageGroup(selectedGroup._id, '🎤 Voice note', new Date(), tempId);
    } else if (selectedUser) {
      const payload = {
        from: currentUser.username,
        to: selectedUser.username,
        message: '',
        file: filePayload,
        tempId
      };
      socket.emit('send_message', payload);
      addMessageToUI({ ...payload, timestamp: new Date().toISOString(), _id: tempId });
      saveLastMessage(selectedUser.username, '🎤 Voice note', new Date(), tempId);
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
    progressColor: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
    cursorColor: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
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

// --- FUNGSI BARU: Dropdown untuk Lampiran File ---
function setupAttachmentDropdown() {
  const fileInput = document.getElementById('fileInput');
  // Jika elemen input file tidak ditemukan, hentikan eksekusi.
  if (!fileInput) {
    console.warn('Gagal menyiapkan dropdown lampiran: elemen #fileInput tidak ditemukan.');
    return;
  }

  // Sembunyikan tombol lampiran asli (biasanya berupa label) untuk menghindari duplikasi.
  const originalLabel = document.querySelector('label[for="fileInput"]');
  if (originalLabel) {
    originalLabel.style.display = 'none';
  }

  // 1. Buat struktur HTML untuk dropdown
  const dropdownHTML = `
    <div class="attachment-container">
      <button class="icon-btn" id="attachmentDropdownBtn" title="Kirim File">
        <i data-feather="paperclip"></i>
      </button>
      <div class="attachment-menu" id="attachmentMenu">
        <a href="#" data-type="image/*,video/*">
          <i data-feather="image"></i><span>Gambar & Video</span>
        </a>
        <a href="#" data-type="application/pdf,text/plain">
          <i data-feather="file-text"></i><span>Dokumen</span>
        </a>
        <a href="#" data-type="audio/*">
          <i data-feather="music"></i><span>Audio</span>
        </a>
        <a href="#" data-type="*">
          <i data-feather="folder"></i><span>Semua File</span>
        </a>
      </div>
    </div>
  `;

  // 3. Sisipkan HTML sebelum input file
  fileInput.insertAdjacentHTML('beforebegin', dropdownHTML);
  if (typeof feather !== 'undefined') feather.replace();

  // 4. Tambahkan Event Listener untuk fungsionalitas
  const menu = document.getElementById('attachmentMenu');
  const btn = document.getElementById('attachmentDropdownBtn');

  if (!menu) return;

  // Toggle menu saat tombol diklik (untuk Mobile/Android)
  if (btn) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // Mencegah event bubbling ke document
      menu.classList.toggle('active');
    });

    // Tutup menu saat klik di luar area menu/tombol
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && !btn.contains(e.target)) {
        menu.classList.remove('active');
      }
    });
  }

  menu.addEventListener('click', (e) => {
    e.preventDefault();
    const target = e.target.closest('a');
    if (target) {
      const fileType = target.dataset.type;
      
      if (fileType === '*') {
        fileInput.removeAttribute('accept');
      } else {
        fileInput.setAttribute('accept', fileType);
      }
      
      fileInput.click();
      menu.classList.remove('active'); // Tutup menu setelah memilih file
    }
  });
}

// --- 2. AUTH & INITIALIZATION ---
if (!currentUser) window.location.href = 'login.html';

document.addEventListener('DOMContentLoaded', () => {
  if(typeof feather !== 'undefined') feather.replace();

  // Initialize Wavesurfer.js
  if (typeof WaveSurfer === 'undefined') {
    console.warn('Wavesurfer.js not loaded');
  }

  // Panggil fungsi untuk membuat dropdown lampiran
  setupAttachmentDropdown();

  // --- EVENT LISTENERS FOR CREATE STATUS MODAL ---
  const statusTypeToggle = document.querySelector('.status-type-toggle');
  if (statusTypeToggle) {
    statusTypeToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.toggle-btn');
      if (btn) {
        switchStatusType(btn.dataset.type);
      }
    });
  }

  const statusImageInput = document.getElementById('statusImageInput');
  if (statusImageInput) {
    statusImageInput.addEventListener('change', handleStatusImageSelect);
  }

  const postStatusBtn = document.getElementById('postStatusBtn');
  if (postStatusBtn) {
    postStatusBtn.addEventListener('click', postStatus);
  }

  const colorPalette = document.querySelector('.color-palette');
  if (colorPalette) {
    colorPalette.addEventListener('click', (e) => {
      const dot = e.target.closest('.color-dot');
      if (dot) {
        const color = dot.dataset.color;
        document.getElementById('statusTextInput').style.backgroundColor = color;
        document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
      }
    });
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

  // Load Status placeholder
  displayStatusUpdates();

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
  
  // Gemini Input Listener
  const geminiInput = document.getElementById('geminiInput');
  if (geminiInput) {
    geminiInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendGeminiMessage(); });
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
    // 1. Handle Close Status Button (Delegation) - FIX untuk tombol tidak bisa diklik
    const closeStatusBtn = e.target.closest('.close-status-viewer');
    if (closeStatusBtn) {
      e.preventDefault();
      e.stopPropagation();
      closeStatusViewer();
      return;
    }

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

  // Specific handler for Create Status Modal close button to ensure UI restoration
  const createStatusModal = document.getElementById('createStatusModal');
  if (createStatusModal) {
    const closeBtn = createStatusModal.querySelector('.close-modal');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeCreateStatusModal();
      });
    }
  }

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

  // --- CONTEXT MENU FOR MESSAGES ---
  const messagesContainer = document.getElementById('messagesContainer');
  messagesContainer.addEventListener('contextmenu', function(e) {
    const messageEl = e.target.closest('.message, .message-img');
    // Prevent context menu on already deleted messages
    if (messageEl && !messageEl.classList.contains('deleted-message')) {
      e.preventDefault();
      selectedMessageElement = messageEl; // Store the element
      
      const menu = document.getElementById('messageContextMenu');
      const deleteForMeBtn = document.getElementById('deleteForMeBtn');
      const deleteForEveryoneBtn = document.getElementById('deleteForEveryoneBtn');
      const isMyMessage = messageEl.classList.contains('outgoing');

      if (deleteForMeBtn) deleteForMeBtn.style.display = 'flex';
      if (deleteForEveryoneBtn) deleteForEveryoneBtn.style.display = isMyMessage ? 'flex' : 'none';
      
      // Temporarily show menu off-screen to get its dimensions
      menu.style.visibility = 'hidden';
      menu.classList.remove('hidden');
      const menuWidth = menu.offsetWidth;
      menu.classList.add('hidden');
      menu.style.visibility = '';

      let leftPosition = e.clientX;
      // For outgoing messages (on the right), position menu to the left of the cursor
      if (isMyMessage) {
        leftPosition = e.clientX - menuWidth;
      }
      
      menu.style.top = `${e.clientY}px`;
      menu.style.left = `${leftPosition}px`;
      menu.classList.remove('hidden');
    }
  });

  // Hide context menu on click outside
  document.addEventListener('click', function(e) {
    const menu = document.getElementById('messageContextMenu');
    if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target)) {
      menu.classList.add('hidden');
      selectedMessageElement = null;
    }
  });

  // --- Event Listeners untuk Modal Pengaturan Grup ---
  const saveGroupBtn = document.getElementById('saveGroupProfileBtn');
  if (saveGroupBtn) {
      saveGroupBtn.addEventListener('click', saveGroupProfile);
  }

  const groupAvatarPreview = document.getElementById('groupAvatarPreview');
  const groupAvatarInput = document.getElementById('groupAvatarInput');
  if (groupAvatarPreview && groupAvatarInput) {
      groupAvatarPreview.addEventListener('click', () => groupAvatarInput.click());
      groupAvatarInput.addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (file) {
              const reader = new FileReader();
              reader.onload = (evt) => {
                  groupAvatarPreview.style.backgroundImage = `url('${evt.target.result}')`;
                  groupAvatarPreview.textContent = '';
              };
              reader.readAsDataURL(file);
          }
      });
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
    // Reset width style on mobile to allow CSS 100% to take over
    sidebar.style.width = '';
  } else {
    // Di desktop, tampilkan kedua-duanya (sidebar dan chat area)
    sidebar.classList.remove('hidden-mobile');
    chatArea.classList.remove('active');
    
    // Logic lebar sidebar desktop
    // FIX: Cek juga apakah status viewer/creator sedang terbuka
    const isStatusOpen = (document.getElementById('viewStatusModal') && !document.getElementById('viewStatusModal').classList.contains('hidden')) || 
                         (document.getElementById('createStatusModal') && !document.getElementById('createStatusModal').classList.contains('hidden'));

    if (!selectedUser && !selectedGroup && !isStatusOpen) {
      sidebar.style.width = '50%';
    } else if (sidebar.style.width === '' || sidebar.style.width === '50%') {
      sidebar.style.width = '380px';
    }
  }

  // Handle Status Viewer responsiveness during resize
  const statusModal = document.getElementById('viewStatusModal');
  if (statusModal && !statusModal.classList.contains('hidden')) {
    if (isMobile) {
      if (statusModal.parentNode !== document.body) {
        document.body.appendChild(statusModal);
        statusModal.classList.remove('desktop-embedded');
      }
    } else {
      const chatArea = document.getElementById('chatArea');
      if (statusModal.parentNode !== chatArea) {
        chatArea.appendChild(statusModal);
        statusModal.classList.add('desktop-embedded');
        document.getElementById('welcomeScreen').classList.add('hidden');
        document.getElementById('chatRoom').classList.add('hidden');
      }
    }
  }

  // Handle Create Status Modal responsiveness
  const createStatusModal = document.getElementById('createStatusModal');
  if (createStatusModal && !createStatusModal.classList.contains('hidden')) {
    if (isMobile) {
      if (createStatusModal.parentNode !== document.body) {
        document.body.appendChild(createStatusModal);
        createStatusModal.classList.remove('desktop-embedded');
      }
    } else {
      const chatArea = document.getElementById('chatArea');
      if (createStatusModal.parentNode !== chatArea) {
        chatArea.appendChild(createStatusModal);
        createStatusModal.classList.add('desktop-embedded');
        document.getElementById('welcomeScreen').classList.add('hidden');
        document.getElementById('chatRoom').classList.add('hidden');
      }
    }
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

  // --- GEMINI FULLSCREEN MODE ---
  const appLayout = document.querySelector('.app-layout');
  const resizer = document.getElementById('sidebarResizer');

  if (tabName === 'gemini') {
    if (appLayout) appLayout.classList.add('gemini-mode');
    if (resizer) resizer.classList.add('hidden');
  } else {
    if (appLayout) appLayout.classList.remove('gemini-mode');
    if (resizer) resizer.classList.remove('hidden');
    // Kembalikan ukuran sidebar seperti semula
    checkScreenSize();
  }
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
  btn.innerHTML = '<i data-feather="loader" class="spinner-animation"></i> Menyimpan...';

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
    btn.innerHTML = '<i data-feather="check" style="width: 18px; height: 18px; margin-right: 8px; vertical-align: -4px;"></i> Simpan';
    if(typeof feather !== 'undefined') feather.replace();
  }
}

function logout(e) {
  if(e) e.preventDefault();
  localStorage.clear(); // Hapus semua cache (history chat, unread, user) agar bersih
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
  const hasValidAvatar = user.avatar && user.avatar !== 'default' && 
                         (user.avatar.startsWith('data:') || user.avatar.startsWith('http'));

  if (hasValidAvatar) {
    // User has uploaded a profile photo
    // Menggunakan struktur img dengan fallback untuk menangani error ORB/404
    const initial = (user.nama || user.name || 'U').charAt(0).toUpperCase();
    const gradient = getAvatarGradient(user.nama || user.name || 'User');
    
    // FIX: Struktur nested div. Outer div (overflow visible) untuk badge online, Inner div (overflow hidden) untuk crop gambar.
    return `<div class="${cssClass} ${onlineClass}" style="position: relative; padding: 0; flex-shrink: 0; background: transparent !important; overflow: visible !important;">
      <div style="width: 100%; height: 100%; border-radius: 50%; overflow: hidden; position: relative;">
        <div style="width: 100%; height: 100%; position: absolute; top: 0; left: 0; background: ${gradient}; display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 1.2rem;">${initial}</div>
        <img src="${user.avatar}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'">
      </div>
    </div>`;
  } else {
    // Show gradient avatar with first letter
    const initial = (user.nama || user.name || 'U').charAt(0).toUpperCase();
    const gradient = getAvatarGradient(user.nama || user.name || 'User');
    return `<div class="${cssClass} ${onlineClass}" style="background: ${gradient} !important; display: flex !important; align-items: center !important; justify-content: center !important; color: white !important; font-weight: 600 !important; flex-shrink: 0;">${initial}</div>`;
  }
}

// --- 5. FRIEND & SEARCH SYSTEM (CORE NEW LOGIC) ---

// A. Load Teman & Request saat start (dengan cache ringan untuk percepat load/ngrok)
const FRIENDS_CACHE_TTL = 2 * 60 * 1000; // 2 menit
let friendsFetchPromise = null;

function applyFriendsPayload(payload) {
  if (!payload) return;
  const { friends = [], requests = [] } = payload;
  window.allUsers = friends;
  window.allRequests = requests; // Simpan requests secara global
  
  updateContactBadge(); // Update badge notifikasi

  // Jika ContactsModal sedang terbuka, refresh isinya
  if (window.ContactsModal && window.ContactsModal.isOpen) {
    // FIX: Gunakan renderFullList langsung agar tidak loading ulang (spinner)
    const listContainer = document.getElementById('contactsList');
    if (listContainer) {
      window.ContactsModal.renderFullList(listContainer);
    }
  } else if (requests.length > 0) {
    // Opsional: Tampilkan notifikasi toast jika ada request baru dan modal tertutup
    // Toast.show(`Ada ${requests.length} permintaan pertemanan baru!`, 'info');
  }

  // Re-load unread counts before updating display
  loadUnreadCounts();
  updateRecentChatsDisplay();
}

function updateContactBadge() {
  const badge = document.getElementById('contactsBadge');
  if (!badge) return;
  
  const count = window.allRequests ? window.allRequests.length : 0;
  if (count > 0) {
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
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

  const MIN = 300;
  const MAX = window.innerWidth * 0.8; // Izinkan resize hingga 80% layar
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
    } else if (currentTab === 'status') {
      displayStatusUpdates();
    } else if (currentTab === 'calls') {
      displayCallHistory();
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
        list.innerHTML = '<div class="search-center-padding">Mencari...</div>';
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
      console.error('Search error:', err);
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
    list.innerHTML = '<div class="search-not-found">Pengguna tidak ditemukan</div>';
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
        actionButton = `<button class="icon-btn search-user-pending">Pending ⏳</button>`;
    } else {
        actionButton = `<button onclick="sendFriendRequest(event, '${user._id}')" class="icon-btn search-add-button">
                        <i data-feather="user-plus"></i>
                      </button>`;
    }

    div.innerHTML = `
      ${createAvatarHTML(user, 'avatar small', isOnline)}
      <div class="chat-item-info">
        <h4>${user.nama}</h4>
        <small class="search-username-small">@${user.username}</small>
        <small>${lastMessageText}</small>
      </div>
      <div class="search-last-message">${lastMessageTime}</div>
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
    
    // Simpan state lama untuk rollback jika error
    const prevRequests = window.allRequests ? [...window.allRequests] : [];
    const prevFriends = window.allUsers ? [...window.allUsers] : [];

    // 0. INSTANT VISUAL FEEDBACK (Fallback)
    // Sembunyikan elemen HTML secara langsung agar terasa instan
    try {
        if (window.event && window.event.target) {
            const btn = window.event.target.closest('.contact-action-btn');
            if (btn) {
                const item = btn.closest('.contact-item');
                if (item) item.style.display = 'none';
            }
        }
    } catch (e) { /* ignore */ }

    try {
      // 1. Optimistic Update: Update UI duluan sebelum server merespon
      let newRequests = [...prevRequests];
      let newFriends = [...prevFriends];
      
      // FIX: Pencarian ID yang lebih aman (handle string/object)
      const reqIndex = newRequests.findIndex(req => {
          const fromId = req.from && (req.from._id || req.from);
          return fromId && fromId.toString() === requesterId.toString();
      });

      if (reqIndex !== -1) {
          const request = newRequests[reqIndex];
          newRequests.splice(reqIndex, 1); // Hapus dari list request
          
          if (action === 'accept') {
              // Tambahkan ke list teman secara instan
              const friendData = request.from;
              const newFriend = { ...friendData, isFriend: true, isPending: false };
              // Cek duplikasi ID sebelum push
              if (!newFriends.find(u => u._id.toString() === newFriend._id.toString())) {
                  newFriends.push(newFriend);
              }
          }
      }
      // Terapkan perubahan ke UI
      applyFriendsPayload({ friends: newFriends, requests: newRequests });

      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id, requesterId })
      });
  
      const data = await res.json();
      if (data.success) {
        // Toast dihapus sesuai permintaan
        // FIX: Beri jeda 500ms sebelum sync server agar DB pasti sudah update
        setTimeout(() => loadFriendsAndRequests(true), 500);
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      // Rollback ke state sebelumnya jika error
      applyFriendsPayload({ friends: prevFriends, requests: prevRequests });
      Toast.show('Gagal memproses permintaan', 'error');
    }
  }

// Expose function to window agar bisa dipanggil dari onclick HTML
window.respondFriend = respondFriend;

// --- 6. CHAT LOGIC ---

function selectUser(user) {
  selectedUser = user;
  selectedGroup = null;
  
  // FIX: Tutup modal status jika sedang terbuka agar chat langsung terlihat
  if (document.getElementById('viewStatusModal') && !document.getElementById('viewStatusModal').classList.contains('hidden')) {
    closeStatusViewer();
  }
  if (document.getElementById('createStatusModal') && !document.getElementById('createStatusModal').classList.contains('hidden')) {
    closeCreateStatusModal();
  }

  // Clear unread count for this user
  clearUnread(user.username);

  // Animasi Sidebar Desktop: Kecilkan saat chat dibuka
  if (window.innerWidth > 768) {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.style.width = '380px';
  }

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
      flex-shrink: 0;
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
    chatAvatarEl.style.flexShrink = '0';
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

  // Toggle menu items
  document.getElementById('menuOpenProfile')?.style.setProperty('display', 'flex', 'important');
  document.getElementById('menuGroupSettings')?.style.setProperty('display', 'none', 'important');

  loadMessages(user.username);
}

function closeChat() {
  selectedUser = null;
  selectedGroup = null;
  
  // Animasi Sidebar Desktop: Lebarkan (50%) saat chat ditutup
  if (window.innerWidth > 768) {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.style.width = '50%';
  }

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
  container.innerHTML = '<div class="loading-messages">Memuat pesan...</div>';

  try {
    const res = await fetch(`${API_URL}/messages/${currentUser.username}/${otherUser}`);
    const data = await res.json();
    container.innerHTML = '';

    if (data.messages.length === 0) {
      container.innerHTML = '<div class="empty-chat-message">Belum ada pesan. Sapa dia! 👋</div>';
      
      // FIX: Hapus cache lokal jika server kosong (Sinkronisasi setelah reset DB)
      const cacheKey = `lastMsg-${currentUser.username}-${otherUser}`;
      if (localStorage.getItem(cacheKey)) {
        localStorage.removeItem(cacheKey);
        updateRecentChatsDisplay(); // Refresh sidebar agar pesan hantu hilang
      }
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

  const tempId = `temp-${Date.now()}-${Math.random()}`;

  if ((!msg && !file) || !selectedUser) return;

  if (file) {
    if (!isFileTypeAllowed(file.type)) {
      Toast.show('Tipe file tidak diizinkan', 'error');
      clearFile();
      return;
    }

    if (file.size > FILE_MAX_BYTES) {
      Toast.show('File terlalu besar (Maks 10MB)', 'error');
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
      payload.tempId = tempId;
      if (currentReplyContext) {
        payload.replyTo = currentReplyContext;
      }
      socket.emit('send_message', payload);

      // Optimistic UI update to show reply immediately
      addMessageToUI({ ...payload, timestamp: new Date().toISOString(), _id: tempId });

      const displayMsg = msg || `📎 ${file.name}`;
      saveLastMessage(selectedUser.username, displayMsg, new Date(), tempId);
      input.value = '';
      clearFile();
      if (currentReplyContext) cancelReply();
    };
  } else {
    const payload = {
      from: currentUser.username,
      to: selectedUser.username,
      message: msg
    };
    payload.tempId = tempId;
    if (currentReplyContext) {
      payload.replyTo = currentReplyContext;
    }
    socket.emit('send_message', payload);

    // Optimistic UI update to show reply immediately
    addMessageToUI({ ...payload, timestamp: new Date().toISOString(), _id: tempId });

    // Save last message
    saveLastMessage(selectedUser.username, msg, new Date(), tempId);
    input.value = '';
    // Update button visibility after clearing input
    if (currentReplyContext) cancelReply();
    updateSendButtonVisibility();
  }
}

// Function to compress image
function compressImage(file, callback, maxWidth = 800, maxHeight = 800) {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = (event) => {
    const img = new Image();
    img.src = event.target.result;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      
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

  if (msg.isDeleted) {
    const isMe = msg.from === currentUser.username;
    const div = document.createElement('div');
    div.id = `message-${msg._id}`;
    div.className = `message ${isMe ? 'outgoing' : 'incoming'}`;

    let deletedContent = `<p class="deleted-message">${msg.message || 'Pesan ini telah dihapus'}</p>`;
    deletedContent += `<span class="msg-time">${new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`;
    
    div.innerHTML = deletedContent;
    container.appendChild(div);
    scrollToBottom();
    return;
  }

  if (container.innerText.includes('Belum ada pesan') || container.innerText.includes('Memuat') || container.innerText.includes('Gagal')) {
    container.innerHTML = '';
  }

  // Fallback for missing message ID from server
  if (!msg._id) {
    msg._id = `${msg.from}-${msg.timestamp}`;
  }

  const isMe = msg.from === currentUser.username;
  const div = document.createElement('div');
  div.id = `message-${msg._id}`;
  div.dataset.messageId = msg._id;
  
  // Set sender name for reply context. Use display name for consistency.
  let senderDisplayName = '';
  if (isMe) {
    senderDisplayName = currentUser.nama;
  } else if (selectedUser) {
    senderDisplayName = selectedUser.nama;
  } else {
    senderDisplayName = msg.from; // Fallback to username
  }
  div.dataset.senderName = senderDisplayName;
  
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

  // RENDER REPLY BLOCK
  if (msg.replyTo) {
    const isStatus = msg.replyTo.messageId && msg.replyTo.messageId.startsWith('status-');
    // Jika status reply, arahkan ke viewStatus. Jika chat reply biasa, scroll ke pesan.
    const clickAction = isStatus && msg.replyTo.userId 
      ? `viewStatus('${msg.replyTo.userId}', '${msg.replyTo.messageId.replace('status-', '')}')` 
      : `scrollToMessage(event, '${msg.replyTo.messageId}')`;

    let mediaHtml = '';
    if (msg.replyTo.mediaUrl) {
      mediaHtml = `<img src="${msg.replyTo.mediaUrl}">`;
    }

    content += `
      <div class="reply-quote" onclick="${clickAction}" style="cursor: pointer;">
        ${mediaHtml}
        <div style="min-width: 0;">
          <strong>${msg.replyTo.senderName}</strong>
          <p>${msg.replyTo.content}</p>
        </div>
      </div>
    `;
  }
  if (msg.file && msg.file.data) {
    if (msg.file.type && msg.file.type.startsWith('audio/')) {
      const audioId = `audio-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      content += `
        <div class="audio-player" id="${audioId}">
          <button class="audio-play-pause" onclick="toggleAudioPlayback('${audioId}', '${msg.file.data}')">
            <i data-feather="play" class="play-icon"></i>
            <i data-feather="pause" class="pause-icon pause-icon-hidden"></i>
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
  if (msg.message) content += `<p style="margin:0;">${escapeHtml(msg.message)}</p>`;
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
    saveLastMessage(selectedUser.username, messageText, msg.timestamp, msg._id);
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
          Toast.show('File terlalu besar (Maks 10MB)', 'error');
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

function addToChatHistory(id, name, message, isGroup, messageId, timestamp) {
  // Truncate long messages
  const truncated = message.length > 50 ? message.substring(0, 50) + '...' : message;
  
  // Initialize unread count if not exists
  if (!chatHistory[id]) {
    chatHistory[id] = {
      name: name,
      lastMessage: truncated,
      timestamp: timestamp || new Date(),
      unreadCount: 0,
      isGroup: isGroup
    };
  } else {
    chatHistory[id].lastMessage = truncated;
    chatHistory[id].timestamp = new Date(timestamp);
  }
  
  // Save to localStorage untuk persistent storage
  if (isGroup) {
    saveLastMessageGroup(id, truncated, timestamp || new Date(), messageId);
  } else {
    saveLastMessage(id, truncated, timestamp || new Date(), messageId);
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
      // Selalu tampilkan semua teman, bahkan yang belum ada chat
      recentChats.push({
        id: user.username,
        name: user.nama,
        lastMessage: lastMsg ? lastMsg.message : 'Ketuk untuk memulai chat',
        timestamp: lastMsg ? new Date(lastMsg.timestamp) : new Date(0), // Timestamp 0 untuk sorting
        isGroup: false,
        user: user
      });
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
function saveLastMessageGroup(groupId, message, timestamp, messageId) {
  try {
    const lastMsg = { message, timestamp, id: messageId };
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
    list.innerHTML = '<div class="empty-chat-message-start">Mulai chat...</div>';
    return;
  }
  
  recentChats.forEach(chat => {
    const div = document.createElement('div');
    div.className = 'list-item chat-item';
    div.id = `chat-item-${chat.id}`;
    
    const isActive = (selectedUser && selectedUser.username === chat.id) || 
                    (selectedGroup && selectedGroup._id === chat.id);
    
    if (isActive) div.classList.add('active');
    
    // Jangan tampilkan waktu jika tidak ada history chat
    const timeText = chat.timestamp.getTime() > 0 ? formatMessageTime(chat.timestamp) : '';
    
    // Check if user is online (only for non-group chats)
    const isOnline = !chat.isGroup && window.userStatusMap && window.userStatusMap[chat.id] === 'online';
    
    // Use createAvatarHTML for consistent avatar display with photos/initials
    let avatarHTML;
    let avatarContent;
    if (chat.isGroup) {
      // For groups, show gradient background with first letter
      avatarContent = `<div class="avatar small ${isOnline ? 'online' : ''} group-avatar">${chat.name.charAt(0).toUpperCase()}</div>`;
    } else {
      // For users, use createAvatarHTML to show photo or initial
      if (chat.user) {
        avatarContent = createAvatarHTML(chat.user, 'avatar small', isOnline);
      } else {
        // Fallback if user data not available
        avatarContent = `<div class="avatar small ${isOnline ? 'online' : ''}">${chat.name.charAt(0).toUpperCase()}</div>`;
      }
    }
    
    // Wrapper for avatar to standardize size and add status ring if needed
    if (!chat.isGroup && chat.user && currentStatuses && currentStatuses[chat.user._id]) {
      // User with status: wrap with ring container
      avatarHTML = `<div class="avatar-container-ring" onclick="event.stopPropagation(); viewStatus('${chat.user._id}')">
          <div class="status-ring"></div>
          ${avatarContent}
      </div>`;
    } else {
      // Group or user without status: wrap with a standard size container
      avatarHTML = `<div class="chat-avatar-wrapper">${avatarContent}</div>`;
    }

    const unreadCount = chatHistory[chat.id]?.unreadCount || 0;
    const badgeHTML = unreadCount > 0 ? `<span class="unread-badge">${unreadCount > 99 ? '99+' : unreadCount}</span>` : '';
    
    div.innerHTML = `
      ${avatarHTML}
      <div class="chat-item-info">
        <h4>${chat.name}</h4>
        <small class="last-message-small">${chat.lastMessage}</small>
      </div>
      <div class="last-message-time">
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
  // Update the temporary message ID with the permanent one from the DB
  if (msg.tempId) {
    const tempElement = document.getElementById(`message-${msg.tempId}`);
    if (tempElement) {
      tempElement.id = `message-${msg._id}`;
      tempElement.dataset.messageId = msg._id;
    }
  }

  // Track chat history upon confirmation from server
  const summaryText = msg.message || (msg.file && msg.file.name ? `📎 ${msg.file.name}` : 'Pesan media');
  if (msg.groupId) {
    // It's a group message confirmation
    addToChatHistory(msg.groupId, selectedGroup?.nama || 'Group', summaryText, true, msg._id, msg.timestamp);
  } else {
    // It's a private message confirmation
    addToChatHistory(msg.to, selectedUser?.nama || msg.to, summaryText, false, msg._id, msg.timestamp);
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
    // Toast dihapus, hanya update badge via reload
    loadFriendsAndRequests(); // Refresh list otomatis
});

// Notifikasi saat teman menerima request
socket.on('friend_request_accepted', (data) => {
  Toast.show(`${data.user.nama} menerima permintaan pertemanan!`, 'success');
  loadFriendsAndRequests(true); // Force refresh friends list
});

// Typing indicator
socket.on('user_typing', (data) => {
  if (selectedUser && selectedUser.username === data.from) {
    document.getElementById('chatStatus').innerHTML = '<em class="typing-indicator">sedang mengetik...</em>';
    
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
      msg.innerHTML = `<i class="typing-indicator-icon"></i> sedang mengetik...`;
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
async function initiateCallFromHistory(event, username, callType, name = '') {
  event.stopPropagation();
  
  // Cari user dari allUsers berdasarkan username
  let user = window.allUsers ? window.allUsers.find(u => u.username === username) : null;
  
  if (!user) {
    // Fallback: Jika user tidak ada di list teman (allUsers), buat objek sementara
    if (name) {
      user = {
        username: username,
        nama: name,
        avatar: 'default', // Avatar default
        _id: username // Fallback ID jika diperlukan
      };
    } else {
      Toast.show('User tidak ditemukan', 'error');
      return;
    }
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
  
  // Set Avatar
  const avatarContainer = document.getElementById('callAvatarContainer');
  avatarContainer.innerHTML = createAvatarHTML(selectedUser, 'avatar', false);
  avatarContainer.classList.remove('pulse');

  if (isVideo) {
    document.querySelector('.call-info-container').classList.add('hidden');
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

  // Find caller info
  let caller = window.allUsers ? window.allUsers.find(u => u.username === data.from) : null;
  if (!caller) {
     caller = { username: data.from, nama: data.from, avatar: 'default' };
  }

  document.getElementById('callTargetName').textContent = caller.nama;
  document.getElementById('callStatus').textContent = '';
  document.getElementById('incomingActions').classList.remove('hidden');
  document.getElementById('activeCallActions').classList.add('hidden');
  document.getElementById('videoContainer').classList.add('hidden');
  document.querySelector('.call-info-container').classList.remove('hidden');

  // Set Avatar with Pulse
  const avatarContainer = document.getElementById('callAvatarContainer');
  avatarContainer.innerHTML = createAvatarHTML(caller, 'avatar', false);
  const avatarEl = avatarContainer.querySelector('.avatar');
  if(avatarEl) avatarEl.classList.add('pulse');

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
    document.querySelector('.call-info-container').classList.add('hidden');
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

  document.querySelector('.call-info-container').classList.remove('hidden');
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
    list.innerHTML = `
      <div class="no-groups-message">
        <i data-feather="users" style="width: 48px; height: 48px; margin-bottom: 12px; opacity: 0.5;"></i>
        <span>Belum ada group</span>
      </div>`;
    if(typeof feather !== 'undefined') feather.replace();
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
      <div class="avatar small group-avatar">${avatar}</div>
      <div class="chat-item-info">
        <h4>${group.nama}</h4>
        <small>${lastMsg ? lastMsg.message : `${group.members.length} anggota`}</small>
      </div>
      <div class="last-message-time">${timeText}</div>
    `;
    
    div.onclick = () => selectGroup(group._id);
    
    list.appendChild(div);
  });
  
  if(typeof feather !== 'undefined') feather.replace();
}

async function displayStatusUpdates() {
  const list = document.getElementById('statusList');
  if (!list) return;

  list.innerHTML = '<div class="status-placeholder"><div class="spinner"></div><p>Memuat status...</p></div>';

  try {
    const res = await fetch(`${API_URL}/statuses?userId=${currentUser.id}`);
    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || 'Gagal memuat status');
    }

    list.innerHTML = ''; // Clear loading

    // Group statuses by user
    const groupedStatuses = data.statuses.reduce((acc, status) => {
      const userIdStr = status.user._id.toString();
      if (!acc[userIdStr]) {
        acc[userIdStr] = {
          user: status.user,
          statuses: []
        };
      }
      acc[userIdStr].statuses.push(status);
      return acc;
    }, {});

    currentStatuses = groupedStatuses; // Store globally for viewer
    
    // FIX: Refresh tampilan chat list agar ring status muncul
    updateRecentChatsDisplay();

    // 1. "My Status" item
    const myStatusData = groupedStatuses[currentUser.id];
    const myStatusItem = document.createElement('div');
    myStatusItem.className = 'status-item';
    const myLastStatus = myStatusData ? myStatusData.statuses[0] : null;
    const myLastStatusIcon = myLastStatus && myLastStatus.type === 'image' ? '<i data-feather="camera" style="width:12px; height:12px; margin-right:4px;"></i>' : '';
    
    const itemClickAction = myStatusData ? `viewStatus('${currentUser.id}')` : 'openCreateStatusModal()';

    myStatusItem.innerHTML = `
      <div class="avatar-container" onclick="${itemClickAction}">
        ${myStatusData ? '<div class="avatar-ring"></div>' : ''}
        ${createAvatarHTML(currentUser, 'avatar', false)}
        <div class="add-status-icon" onclick="event.stopPropagation(); openCreateStatusModal()">+</div>
      </div>
      <div class="status-item-info" onclick="${itemClickAction}">
        <h4>Status Saya</h4>
        <small>${myStatusData ? `${myLastStatusIcon}${myStatusData.statuses.length} pembaruan` : 'Ketuk untuk menambahkan'}</small>
      </div>
    `;
    list.appendChild(myStatusItem);

    // Add a divider
    const divider = document.createElement('div');
    divider.innerHTML = `<small style="padding: 8px 16px; display: block; color: var(--text-secondary);text-align:center;">Pembaruan terkini</small>`;
    list.appendChild(divider);

    // 2. Friends' statuses
    const friendStatuses = Object.values(groupedStatuses).filter(s => s.user._id !== currentUser.id);
    
    // FIX: Simpan urutan user untuk navigasi next/prev antar user
    statusUserOrder = friendStatuses.map(s => s.user._id);

    if (friendStatuses.length === 0) {
      list.innerHTML += '<div class="status-placeholder"><p>Belum ada status dari teman Anda.</p></div>';
    } else {
      friendStatuses.forEach(statusGroup => {
        const friendItem = document.createElement('div');
        const lastStatus = statusGroup.statuses[0];
        const lastStatusIcon = lastStatus.type === 'image' ? '<i data-feather="camera" style="width:12px; height:12px; margin-right:4px;"></i>' : '';
        friendItem.className = 'status-item';
        friendItem.innerHTML = `
          <div class="avatar-container">
            <div class="avatar-ring"></div>
            ${createAvatarHTML(statusGroup.user, 'avatar', false)}
          </div>
          <div class="status-item-info">
            <h4>${statusGroup.user.nama}</h4>
            <small>${lastStatusIcon}${statusGroup.statuses.length} pembaruan • ${formatRelativeTime(new Date(lastStatus.createdAt))}</small>
          </div>
        `;
        friendItem.onclick = () => viewStatus(statusGroup.user._id);
        list.appendChild(friendItem);
      });
    }

  } catch (err) {
    list.innerHTML = `<div class="status-placeholder"><i data-feather="alert-circle"></i><p>${err.message}</p></div>`;
  } finally {
    if(typeof feather !== 'undefined') feather.replace();
  }
}

async function viewStatus(userId, startStatusId = null) {
  currentViewedUserId = userId; // FIX: Track user yang sedang dilihat
  // Jika data status belum ada (misal klik dari chat), coba fetch dulu
  if (!currentStatuses[userId]) {
    await displayStatusUpdates();
  }

  const data = currentStatuses[userId];
  if (!data || !data.statuses.length) {
    return Toast.show('Status tidak tersedia atau sudah kadaluarsa', 'info');
  }

  // Sort oldest to newest for viewing (Story style)
  // Backend sends newest first, so we reverse it
  statusQueue = [...data.statuses].reverse();
  
  // Jika ada ID status spesifik (dari reply), mulai dari situ
  if (startStatusId) {
    const index = statusQueue.findIndex(s => s._id === startStatusId);
    currentStatusIndex = index !== -1 ? index : 0;
  } else {
    currentStatusIndex = 0;
  }

  const modal = document.getElementById('viewStatusModal');
  
  // LOGIC: Pindahkan modal ke dalam chatArea jika Desktop
  const isDesktop = window.innerWidth > 768;
  if (isDesktop) {
    const chatArea = document.getElementById('chatArea');
    if (modal.parentNode !== chatArea) {
      chatArea.appendChild(modal);
    }
    document.getElementById('welcomeScreen').classList.add('hidden');
    document.getElementById('chatRoom').classList.add('hidden');
    modal.classList.add('desktop-embedded');
    
    // FIX: Resize sidebar saat buka status
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.style.width = '380px';
  } else {
    if (modal.parentNode !== document.body) {
      document.body.appendChild(modal);
    }
    modal.classList.remove('desktop-embedded');
  }

  modal.classList.remove('hidden');
  modal.classList.add('active'); // Ensure flex display

  renderStatus();
}

function closeStatusViewer() {
  const modal = document.getElementById('viewStatusModal');
  modal.classList.add('hidden');
  modal.classList.remove('active');
  modal.classList.remove('desktop-embedded'); // FIX: Hapus class agar display:flex tidak memaksa tampil
  
  // Restore Desktop UI
  if (window.innerWidth > 768) {
      if (selectedUser || selectedGroup) {
          document.getElementById('welcomeScreen').classList.add('hidden'); // Pastikan welcome hidden
          document.getElementById('chatRoom').classList.remove('hidden');
      } else {
          document.getElementById('chatRoom').classList.add('hidden'); // Pastikan chatroom hidden
          document.getElementById('welcomeScreen').classList.remove('hidden');
          
          // FIX: Kembalikan sidebar ke 50% jika tidak ada chat aktif
          const sidebar = document.getElementById('sidebar');
          if (sidebar) sidebar.style.width = '50%';
      }
  }
  
  if (statusTimer) clearTimeout(statusTimer);
  statusQueue = [];
  currentStatusIndex = 0;
  closeViewersPanel(); // Pastikan panel tertutup
}

function renderStatus() {
  const status = statusQueue[currentStatusIndex];
  if (!status) return closeStatusViewer();

  const body = document.getElementById('statusViewerBody');
  const name = document.getElementById('statusViewerName');
  const time = document.getElementById('statusViewerTime');
  const avatarContainer = document.getElementById('statusViewerAvatar');
  const footer = document.getElementById('statusFooter');
  
  // Update Header
  name.textContent = status.user.nama;
  time.textContent = formatRelativeTime(new Date(status.createdAt));
  avatarContainer.innerHTML = createAvatarHTML(status.user, 'avatar small', false);
  
  // Update Body
  body.innerHTML = '';
  if (status.type === 'text') {
    const div = document.createElement('div');
    div.className = 'status-text-content';
    div.style.backgroundColor = status.backgroundColor || '#31363F';
    div.textContent = status.content;
    body.appendChild(div);
  } else if (status.type === 'image') {
    const img = document.createElement('img');
    img.src = status.content;
    img.className = 'status-image-content';
    body.appendChild(img);
    
    if (status.caption) {
      const captionDiv = document.createElement('div');
      captionDiv.className = 'status-caption-display';
      captionDiv.textContent = status.caption;
      body.appendChild(captionDiv);
    }
  }
  
  // Add Tap Navigation (Instagram Style)
  // Klik kiri layar = Prev, Klik kanan layar = Next
  body.onclick = (e) => {
    // Abaikan jika klik pada elemen interaktif lain
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('a')) return;
    
    const rect = body.getBoundingClientRect();
    const x = e.clientX - rect.left;
    // 30% area kiri untuk Prev, sisanya Next
    if (x < rect.width * 0.3) prevStatus();
    else nextStatus();
  };

  // Update Footer (Reply or Viewers)
  footer.innerHTML = '';
  const isMyStatus = status.user._id === currentUser.id;

  if (isMyStatus) {
    // Show Viewers Trigger
    const viewerCount = status.viewers ? status.viewers.length : 0;
    const trigger = document.createElement('div');
    trigger.className = 'status-viewers-trigger';
    trigger.innerHTML = `
      <i data-feather="eye"></i>
      <span>${viewerCount}</span>
    `;
    trigger.onclick = () => openViewersPanel(status.viewers);
    footer.appendChild(trigger);
  } else {
    // Show Reply Input
    const replyContainer = document.createElement('div');
    replyContainer.className = 'status-reply-container';
    replyContainer.innerHTML = `
      <input type="text" class="status-reply-input" placeholder="Balas..." id="statusReplyInput">
      <button class="status-reply-btn" onclick="sendStatusReply('${status._id}')">
        <i data-feather="send" style="width: 18px; height: 18px;"></i>
      </button>
    `;
    footer.appendChild(replyContainer);

    // Handle Enter key
    const input = replyContainer.querySelector('input');
    
    // Stop timer saat mengetik
    input.addEventListener('focus', () => {
      if (statusTimer) clearTimeout(statusTimer);

      // Pause visual progress bar immediately
      const bars = document.querySelectorAll('.status-progress-fill');
      if (bars[currentStatusIndex]) {
        const bar = bars[currentStatusIndex];
        const computedStyle = window.getComputedStyle(bar);
        const currentWidth = computedStyle.getPropertyValue('width');
        bar.style.width = currentWidth;
        bar.style.transition = 'none';
      }
    });
    
    // Lanjut timer saat selesai mengetik (blur)
    input.addEventListener('blur', () => {
      if (statusTimer) clearTimeout(statusTimer);
      if (!document.getElementById('viewStatusModal').classList.contains('hidden')) {
        const bars = document.querySelectorAll('.status-progress-fill');
        if (bars[currentStatusIndex]) {
            const bar = bars[currentStatusIndex];
            bar.style.transition = 'width 3s linear';
            bar.style.width = '100%';
        }
        statusTimer = setTimeout(nextStatus, 3000);
      }
    });

    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendStatusReply(status._id);
    });
    
    // Mark as viewed (if not already)
    markStatusViewed(status._id);
  }
  if(typeof feather !== 'undefined') feather.replace();
  
  // Update Progress Bars
  const duration = status.type === 'image' ? 10000 : 5000; // 10s untuk foto, 5s untuk teks
  updateStatusProgressBars(duration);
  
  // Auto advance
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(nextStatus, duration);
}

async function markStatusViewed(statusId) {
  try {
    await fetch(`${API_URL}/statuses/${statusId}/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id })
    });
  } catch (e) {
    console.error("Failed to mark status viewed", e);
  }
}

function sendStatusReply(statusId) {
  const input = document.getElementById('statusReplyInput');
  const text = input.value.trim();
  if (!text) return;

  const status = statusQueue.find(s => s._id === statusId);
  if (!status) return;

  // Construct reply message
  const replyTo = {
    messageId: `status-${status._id}`,
    senderName: status.user.nama,
    content: status.type === 'text' ? status.content : (status.caption || 'Status'),
    mediaUrl: status.type === 'image' ? status.content : null,
    type: 'status',
    userId: status.user._id
  };
  
  const payload = {
    from: currentUser.username,
    to: status.user.username,
    message: text,
    replyTo: replyTo,
    tempId: `temp-${Date.now()}`
  };

  socket.emit('send_message', payload);
  
  // Feedback visual
  input.value = '';
  Toast.show('Balasan terkirim', 'success');
  // Optional: close viewer?
  // closeStatusViewer();
}

function openViewersPanel(viewers) {
  const panel = document.getElementById('statusViewersPanel');
  const list = document.getElementById('viewersList');
  const count = document.getElementById('viewersCount');
  
  // Pause timer saat melihat viewers
  if (statusTimer) clearTimeout(statusTimer);

  count.textContent = viewers ? viewers.length : 0;
  list.innerHTML = '';

  if (!viewers || viewers.length === 0) {
    list.innerHTML = '<div class="status-placeholder"><p>Belum ada yang melihat</p></div>';
  } else {
    // Reverse array agar yang terbaru (terakhir masuk) ada di paling atas
    [...viewers].reverse().forEach(v => {
      const item = document.createElement('div');
      item.className = 'viewer-item';
      item.innerHTML = `
        ${createAvatarHTML(v.user, 'avatar small', false)}
        <div class="viewer-info">
          <h5>${v.user.nama}</h5>
          <small>${formatRelativeTime(new Date(v.viewedAt))}</small>
        </div>
      `;
      list.appendChild(item);
    });
  }

  panel.classList.add('active');
}

function closeViewersPanel() {
  const panel = document.getElementById('statusViewersPanel');
  if (panel) panel.classList.remove('active');
  
  // Resume timer (jika viewer masih terbuka)
  if (!document.getElementById('viewStatusModal').classList.contains('hidden')) {
     // Cek apakah panel benar-benar tertutup sebelum resume, atau resume saja langsung
     // Sederhananya, kita resume timer status saat ini
     if (statusQueue.length > 0) {
        if (statusTimer) clearTimeout(statusTimer);
        const currentStatus = statusQueue[currentStatusIndex];
        const duration = currentStatus && currentStatus.type === 'image' ? 10000 : 5000;
        statusTimer = setTimeout(nextStatus, duration);
     }
  }
}

function updateStatusProgressBars(duration = 5000) {
  const container = document.getElementById('statusProgressBarContainer');
  container.innerHTML = '';
  
  statusQueue.forEach((_, idx) => {
    const bar = document.createElement('div');
    bar.className = 'status-progress-bar';
    const fill = document.createElement('div');
    fill.className = 'status-progress-fill';
    
    if (idx < currentStatusIndex) {
      fill.classList.add('filled');
    } else if (idx === currentStatusIndex) {
      // Animate current bar
      setTimeout(() => {
        fill.style.transition = `width ${duration}ms linear`;
        fill.style.width = '100%';
      }, 50);
    }
    
    bar.appendChild(fill);
    container.appendChild(bar);
  });
}

function nextStatus() {
  // Debounce: Cegah navigasi ganda jika dipanggil terlalu cepat
  if (statusNavLock) return;
  statusNavLock = true;
  setTimeout(() => statusNavLock = false, 300);

  if (currentStatusIndex < statusQueue.length - 1) {
    currentStatusIndex++;
    renderStatus();
  } else {
    // Cek apakah ada user berikutnya
    const currentUserIdx = statusUserOrder.indexOf(currentViewedUserId);
    if (currentUserIdx !== -1 && currentUserIdx < statusUserOrder.length - 1) {
      // Pindah ke user berikutnya
      const nextUserId = statusUserOrder[currentUserIdx + 1];
      viewStatus(nextUserId);
    } else if (currentUserIdx === -1 && currentViewedUserId === currentUser.id && statusUserOrder.length > 0) {
      // Dari status saya, lanjut ke teman pertama
      viewStatus(statusUserOrder[0]);
    } else {
      closeStatusViewer();
    }
  }
}

function prevStatus() {
  // Debounce: Cegah navigasi ganda
  if (statusNavLock) return;
  statusNavLock = true;
  setTimeout(() => statusNavLock = false, 300);

  if (currentStatusIndex > 0) {
    currentStatusIndex--;
    renderStatus();
  } else {
    // Cek apakah ada user sebelumnya
    const currentUserIdx = statusUserOrder.indexOf(currentViewedUserId);
    if (currentUserIdx > 0) {
      // Pindah ke user sebelumnya
      const prevUserId = statusUserOrder[currentUserIdx - 1];
      viewStatus(prevUserId);
    } else if (currentUserIdx === 0 && currentStatuses[currentUser.id]) {
      // Opsional: Dari teman pertama, kembali ke status saya (jika ada)
      viewStatus(currentUser.id);
    } else {
      closeStatusViewer();
    }
  }
}

// Expose status navigation globally to ensure timer and onclick works
window.nextStatus = nextStatus;
window.prevStatus = prevStatus;
window.closeStatusViewer = closeStatusViewer;

function openCreateStatusModal() {
  const modal = document.getElementById('createStatusModal');
  if (modal) {
    // LOGIC: Pindahkan modal ke dalam chatArea jika Desktop
    const isDesktop = window.innerWidth > 768;
    if (isDesktop) {
      const chatArea = document.getElementById('chatArea');
      if (modal.parentNode !== chatArea) {
        chatArea.appendChild(modal);
      }
      document.getElementById('welcomeScreen').classList.add('hidden');
      document.getElementById('chatRoom').classList.add('hidden');
      modal.classList.add('desktop-embedded');
      
      // FIX: Resize sidebar saat buat status
      const sidebar = document.getElementById('sidebar');
      if (sidebar) sidebar.style.width = '380px';
    } else {
      if (modal.parentNode !== document.body) {
        document.body.appendChild(modal);
      }
      modal.classList.remove('desktop-embedded');
    }

    modal.classList.remove('hidden');
    modal.classList.add('active');
    
    // Reset text input
    const textInput = document.getElementById('statusTextInput');
    textInput.value = '';
    textInput.style.backgroundColor = '#31363F';
    document.querySelectorAll('.color-dot').forEach(dot => dot.classList.remove('active'));
    const defaultColorDot = document.querySelector('.color-dot[data-color="#31363F"]');
    if (defaultColorDot) defaultColorDot.classList.add('active');

    // Reset image input
    statusImageBase64 = null;
    const imageInput = document.getElementById('statusImageInput');
    if (imageInput) imageInput.value = '';
    document.getElementById('imagePreviewWrapper').classList.add('hidden');
    const captionInput = document.getElementById('statusImageCaption');
    if (captionInput) captionInput.value = '';
    
    document.querySelector('.image-upload-placeholder').classList.remove('hidden');

    // Default to text tab
    switchStatusType('text');
  }
}

function closeCreateStatusModal() {
  const modal = document.getElementById('createStatusModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('active');
    modal.classList.remove('desktop-embedded');

    // Restore Desktop UI
    if (window.innerWidth > 768) {
      if (selectedUser || selectedGroup) {
          document.getElementById('welcomeScreen').classList.add('hidden');
          document.getElementById('chatRoom').classList.remove('hidden');
      } else {
          document.getElementById('chatRoom').classList.add('hidden');
          document.getElementById('welcomeScreen').classList.remove('hidden');
          
          // FIX: Kembalikan sidebar ke 50% jika tidak ada chat aktif
          const sidebar = document.getElementById('sidebar');
          if (sidebar) sidebar.style.width = '50%';
      }
    }
  }
}

window.closeCreateStatusModal = closeCreateStatusModal;

async function postStatus() {
  const activeType = document.querySelector('.status-type-toggle .toggle-btn.active').dataset.type;
  
  let payloadBody;

  if (activeType === 'text') {
    const content = document.getElementById('statusTextInput').value.trim();
    const backgroundColor = document.getElementById('statusTextInput').style.backgroundColor || '#31363F';
    if (!content) return Toast.show('Status tidak boleh kosong', 'error');
    payloadBody = { userId: currentUser.id, type: 'text', content, backgroundColor };
  } else { // image
    if (!statusImageBase64) return Toast.show('Pilih gambar terlebih dahulu', 'error');
    const caption = document.getElementById('statusImageCaption').value.trim();
    payloadBody = { userId: currentUser.id, type: 'image', content: statusImageBase64, caption };
  }
  const btn = document.getElementById('postStatusBtn');
  btn.disabled = true;
  btn.innerHTML = '<i data-feather="loader" class="spinner-animation" style="margin-right: 0;"></i>';
  if(typeof feather !== 'undefined') feather.replace();

  try {
    const res = await fetch(`${API_URL}/statuses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadBody)
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Gagal memposting status');
    
    Toast.show('Status berhasil diposting!', 'success');
    closeCreateStatusModal();
    displayStatusUpdates();
  } catch (err) {
    Toast.show(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-feather="send"></i>';
    if(typeof feather !== 'undefined') feather.replace();
    statusImageBase64 = null; // Clear after attempt
  }
}

function switchStatusType(type) {
  const textCreator = document.getElementById('textStatusCreator');
  const imageCreator = document.getElementById('imageStatusCreator');
  const textBtn = document.querySelector('.toggle-btn[data-type="text"]');
  const imageBtn = document.querySelector('.toggle-btn[data-type="image"]');

  if (type === 'image') {
    textCreator.classList.add('hidden');
    textCreator.classList.remove('slide-in-left');
    
    imageCreator.classList.remove('hidden');
    imageCreator.classList.remove('slide-in-right');
    void imageCreator.offsetWidth; // Trigger reflow untuk restart animasi
    imageCreator.classList.add('slide-in-right');

    textBtn.classList.remove('active');
    imageBtn.classList.add('active');
  } else { // text
    imageCreator.classList.add('hidden');
    imageCreator.classList.remove('slide-in-right');

    textCreator.classList.remove('hidden');
    textCreator.classList.remove('slide-in-left');
    void textCreator.offsetWidth; // Trigger reflow untuk restart animasi
    textCreator.classList.add('slide-in-left');

    textBtn.classList.add('active');
    imageBtn.classList.remove('active');
  }
}

function handleStatusImageSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    Toast.show('Hanya file gambar yang diizinkan', 'error');
    return;
  }
  if (file.size > 5 * 1024 * 1024) { // 5MB limit for status
    Toast.show('Ukuran gambar terlalu besar (Maks 5MB)', 'error');
    return;
  }

  // Gunakan kompresi gambar agar upload dan load status lebih cepat
  // Max 1024px agar kualitas tetap oke di HP tapi size kecil
  compressImage(file, (base64) => {
    statusImageBase64 = base64;
    const preview = document.getElementById('statusImagePreview');
    const placeholder = document.querySelector('.image-upload-placeholder');
    const wrapper = document.getElementById('imagePreviewWrapper');
    preview.src = statusImageBase64;
    wrapper.classList.remove('hidden');
    placeholder.classList.add('hidden');
  }, 1024, 1024);
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
  
  // Reset search
  const searchInput = document.getElementById('groupMemberSearch');
  if (searchInput) {
    searchInput.value = '';
    searchInput.oninput = (e) => filterGroupMembers(e.target.value);
  }
  
  if(typeof feather !== 'undefined') feather.replace();
}

async function populateMembersCheckbox() {
  const container = document.getElementById('membersListContainer');
  
  if (!window.allUsers || window.allUsers.length === 0) {
    container.innerHTML = '<div class="no-friends-message">Tidak ada teman</div>';
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
      avatarHtml = `<div class="user-avatar-small user-avatar-small-bg" style="background-image: url('${user.avatar}');"></div>`;
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

    // Make row clickable
    div.onclick = (e) => {
      // Prevent double toggle if clicking directly on checkbox or label
      if (e.target.type !== 'checkbox' && e.target.tagName !== 'LABEL') {
        const checkbox = div.querySelector('input[type="checkbox"]');
        checkbox.checked = !checkbox.checked;
        // Trigger change event manually to update style
        checkbox.dispatchEvent(new Event('change'));
      }
    };

    // Update style on selection
    const checkbox = div.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        div.classList.add('selected');
      } else {
        div.classList.remove('selected');
      }
    });
    
    container.appendChild(div);
  });
}

function filterGroupMembers(query) {
  const container = document.getElementById('membersListContainer');
  const items = container.querySelectorAll('.member-checkbox');
  const lowerQuery = query.toLowerCase();
  
  items.forEach(item => {
    const name = item.querySelector('.member-name').textContent.toLowerCase();
    if (name.includes(lowerQuery)) {
      item.style.display = 'flex';
    } else {
      item.style.display = 'none';
    }
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

socket.on('group_updated', ({ group }) => {
    if (!group) return;

    // 1. Update the group in the main `allGroups` array
    const groupIndex = allGroups.findIndex(g => g._id === group._id);
    if (groupIndex > -1) {
        allGroups[groupIndex] = group;
    } else {
        allGroups.push(group);
    }

    // 2. If the updated group is the currently selected one, update the chat view
    if (selectedGroup && selectedGroup._id === group._id) {
        selectedGroup = group; // Update the selectedGroup object
        
        // Update chat header
        document.getElementById('chatName').textContent = group.nama;
        document.getElementById('chatAvatar').textContent = group.avatar || group.nama.charAt(0).toUpperCase();
        document.getElementById('chatStatus').textContent = `${group.members.length} anggota`;
    }

    // 3. Re-render the group list and recent chats list to reflect changes
    displayGroups();
    updateRecentChatsDisplay();

    Toast.show(`Info grup "${group.nama}" telah diperbarui.`, 'info');
});

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

  // FIX: Tutup modal status jika sedang terbuka agar chat group langsung terlihat
  if (document.getElementById('viewStatusModal') && !document.getElementById('viewStatusModal').classList.contains('hidden')) {
    closeStatusViewer();
  }
  if (document.getElementById('createStatusModal') && !document.getElementById('createStatusModal').classList.contains('hidden')) {
    closeCreateStatusModal();
  }
  
  // Clear unread count for this group
  clearUnread(groupId);
  
  // Animasi Sidebar Desktop: Kecilkan saat chat dibuka
  if (window.innerWidth > 768) {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.style.width = '380px';
  }

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
  
  // Toggle menu items
  document.getElementById('menuOpenProfile')?.style.setProperty('display', 'none', 'important');
  const menuGroupSettings = document.getElementById('menuGroupSettings');
  if (menuGroupSettings) {
    const createdById = selectedGroup.createdBy._id || selectedGroup.createdBy;
    const isCreator = createdById === currentUser.id;
    menuGroupSettings.style.display = isCreator ? 'flex' : 'none';
  }

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
      
      // FIX: Hapus cache lokal grup jika server kosong
      const cacheKey = `lastMsg-${currentUser.username}-group-${groupId}`;
      if (localStorage.getItem(cacheKey)) {
        localStorage.removeItem(cacheKey);
        updateRecentChatsDisplay(); // Refresh sidebar
      }
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

  if (msg.isDeleted) {
    const isMe = msg.from === currentUser.username;
    const div = document.createElement('div');
    div.id = `message-${msg._id}`;
    div.className = `message ${isMe ? 'outgoing' : 'incoming'} group-message`;

    let deletedContent = '';
    if (!isMe) {
      const senderUser = (window.allUsers || []).find(u => u.username === msg.from);
      const senderDisplayName = senderUser ? senderUser.nama : msg.from;
      deletedContent += `<small style="color: var(--primary); font-weight: 600; display: block; margin-bottom: 4px;">${senderDisplayName}</small>`;
    }
    
    deletedContent += `<p style="margin:0; font-style:italic; opacity:0.7;">${msg.message || 'Pesan ini telah dihapus'}</p>`;
    deletedContent += `<span class="msg-time">${new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`;
    
    div.innerHTML = deletedContent;
    container.appendChild(div);
    scrollToBottom();
    return;
  }

  if (container.innerText.includes('Belum ada pesan') || container.innerText.includes('Memuat') || container.innerText.includes('Gagal')) {
    container.innerHTML = '';
  }

  // Fallback for missing message ID from server
  if (!msg._id) {
    msg._id = `${msg.from}-${msg.timestamp}`;
  }

  const isMe = msg.from === currentUser.username;
  
  // Jika ada image, jangan kasih background/padding
  const hasImage = msg.file && msg.file.data && msg.file.type && msg.file.type.startsWith('image/');
  
  const div = document.createElement('div');
  div.id = `message-${msg._id}`;
  div.dataset.messageId = msg._id;

  // Set sender name for reply context. Use display name for consistency.
  let senderDisplayName = '';
  if (isMe) {
    senderDisplayName = currentUser.nama;
  } else {
    const senderUser = (window.allUsers || []).find(u => u.username === msg.from);
    senderDisplayName = senderUser ? senderUser.nama : msg.from; // Fallback to username if not a friend
  }
  div.dataset.senderName = senderDisplayName;

  const fileOnly = msg.file && msg.file.data && !msg.message && !hasImage;
  if (hasImage && !msg.message) {
    div.className = `message-img ${isMe ? 'outgoing' : 'incoming group-message'}`;
  } else {
    div.className = `message ${isMe ? 'outgoing' : 'incoming group-message'}${fileOnly ? ' file-only' : ''}`;
  }

  let content = '';

  // RENDER REPLY BLOCK
  if (msg.replyTo) {
    const isStatus = msg.replyTo.messageId && msg.replyTo.messageId.startsWith('status-');
    const clickAction = isStatus && msg.replyTo.userId 
      ? `viewStatus('${msg.replyTo.userId}', '${msg.replyTo.messageId.replace('status-', '')}')` 
      : `scrollToMessage(event, '${msg.replyTo.messageId}')`;

    let mediaHtml = '';
    if (msg.replyTo.mediaUrl) {
      mediaHtml = `<img src="${msg.replyTo.mediaUrl}">`;
    }

    content += `
      <div class="reply-quote" onclick="${clickAction}" style="cursor: pointer;">
        ${mediaHtml}
        <div style="min-width: 0;">
          <strong>${msg.replyTo.senderName}</strong>
          <p>${msg.replyTo.content}</p>
        </div>
      </div>
    `;
  }

  if (!isMe) {
    content += `<small style="color: var(--primary); font-weight: 600; display: block; margin-bottom: 4px;">${senderDisplayName}</small>`;
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
  if (msg.message) content += `<p style="margin:0;">${escapeHtml(msg.message)}</p>`;
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

  const tempId = `temp-${Date.now()}-${Math.random()}`;

  if (!msg && !file) return;

  if (file) {
    if (!isFileTypeAllowed(file.type)) {
      Toast.show('Tipe file tidak diizinkan', 'error');
      clearFile();
      return;
    }

    if (file.size > FILE_MAX_BYTES) {
      Toast.show('File terlalu besar (Maks 10MB)', 'error');
      clearFile();
      return;
    }
    
    // Kirim file langsung tanpa kompresi
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const payload = {
        from: currentUser.username,
        to: selectedGroup._id,
        message: msg,
        file: { name: file.name, type: file.type, size: file.size, data: reader.result },
        groupId: selectedGroup._id
      };
      payload.tempId = tempId;
      if (currentReplyContext) {
        payload.replyTo = currentReplyContext;
      }
      socket.emit('send_message', payload);

      // Optimistic UI update
      addGroupMessageToUI({ ...payload, timestamp: new Date().toISOString(), _id: tempId });
      const displayMsg = msg || `📎 ${file.name}`;
      saveLastMessageGroup(selectedGroup._id, displayMsg, new Date(), tempId);

      input.value = '';
      clearFile();
      // Update button visibility after clearing input
      updateSendButtonVisibility();
      if (currentReplyContext) cancelReply();
    };
  } else {
    const payload = {
      from: currentUser.username,
      to: selectedGroup._id,
      message: msg,
      groupId: selectedGroup._id
    };
    payload.tempId = tempId;
    if (currentReplyContext) {
      payload.replyTo = currentReplyContext;
    }
    socket.emit('send_message', payload);

    // Optimistic UI update
    addGroupMessageToUI({ ...payload, timestamp: new Date().toISOString(), _id: tempId });
    saveLastMessageGroup(selectedGroup._id, msg, new Date(), tempId);

    input.value = '';
    // Update button visibility after clearing input
    updateSendButtonVisibility();
    if (currentReplyContext) cancelReply();
  }
}

function openGroupProfileModal() {
  if (!selectedGroup) return;

  const modal = document.getElementById('groupProfileModal');
  if (!modal) return;

  // Populate data
  document.getElementById('editGroupName').value = selectedGroup.nama;
  
  const avatarPreview = document.getElementById('groupAvatarPreview');
  if (selectedGroup.avatar && (selectedGroup.avatar.startsWith('data:') || selectedGroup.avatar.startsWith('http'))) {
      avatarPreview.style.backgroundImage = `url('${selectedGroup.avatar}')`;
      avatarPreview.textContent = '';
  } else {
      avatarPreview.style.backgroundImage = 'none';
      avatarPreview.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
      avatarPreview.textContent = selectedGroup.nama.charAt(0).toUpperCase();
  }

  // Populate members list
  const membersListContainer = document.getElementById('groupMembersList');
  membersListContainer.innerHTML = '<h4>Anggota</h4>';
  selectedGroup.members.forEach(member => {
      const createdById = selectedGroup.createdBy._id || selectedGroup.createdBy;
      const isCreator = member._id === createdById;
      const memberDiv = document.createElement('div');
      memberDiv.className = 'group-member-item';
      memberDiv.innerHTML = `
          ${createAvatarHTML(member, 'avatar small', window.userStatusMap[member.username] === 'online')}
          <span>${member.nama} ${isCreator ? '(Admin)' : ''}</span>
      `;
      membersListContainer.appendChild(memberDiv);
  });

  // Show/hide save button based on permission (creator only)
  const createdById = selectedGroup.createdBy._id || selectedGroup.createdBy;
  const isCreator = createdById === currentUser.id;
  
  document.getElementById('editGroupName').readOnly = !isCreator;
  document.getElementById('groupAvatarPreview').style.pointerEvents = isCreator ? 'auto' : 'none';
  document.querySelector('#groupProfileModal .modal-footer').style.display = isCreator ? 'flex' : 'none';

  modal.classList.remove('hidden');
  modal.classList.add('active');
  if(typeof feather !== 'undefined') feather.replace();
}

function closeGroupProfileModal() {
  const modal = document.getElementById('groupProfileModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('active');
  }
}

async function saveGroupProfile() {
  if (!selectedGroup) return;

  const newName = document.getElementById('editGroupName').value.trim();
  const avatarInput = document.getElementById('groupAvatarInput');
  const avatarFile = avatarInput ? avatarInput.files[0] : null;
  
  if (!newName) return Toast.show('Nama grup tidak boleh kosong', 'error');

  const btn = document.getElementById('saveGroupProfileBtn');
  btn.disabled = true;
  btn.innerHTML = 'Menyimpan...';

  try {
    let avatarBase64 = null;
    if (avatarFile) {
      if (avatarFile.size > 2 * 1024 * 1024) { // 2MB limit
          throw new Error('Ukuran avatar terlalu besar (maks 2MB)');
      }
      avatarBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    const res = await fetch(`${API_URL}/groups/${selectedGroup._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nama: newName, avatar: avatarBase64, userId: currentUser.id })
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Gagal menyimpan');
    
    Toast.show('Info grup berhasil diperbarui', 'success');
    closeGroupProfileModal();
    // UI update is handled by the 'group_updated' socket event
  } catch (err) {
    Toast.show(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-feather="check" style="width: 18px; height: 18px; margin-right: 8px; vertical-align: -4px;"></i> Simpan';
    if(typeof feather !== 'undefined') feather.replace();
  }
}

socket.on('message_deleted', (payload) => {
    const { messageId, groupId, from, to, newLastMessage } = payload;

    // 1. Update the message in the chat window if it's open
    updateUIMessageAsDeleted(messageId);

    // 2. Tentukan ID obrolan (pengguna lain atau grup)
    const chatId = groupId ? groupId : (from === currentUser.username ? to : from);
    
    // 3. Periksa apakah pesan yang dihapus adalah yang ditampilkan di sidebar.
    // Ini untuk mencegah penimpaan jika pesan yang lebih baru sudah tiba.
    const currentLastMessage = groupId ? getLastMessageForGroup(chatId) : getLastMessageForUser(chatId);

    if (currentLastMessage && currentLastMessage.id === messageId) {
        let newSummaryText;
        let newTimestamp;
        let newId;

        // Pesan yang dihapus memang yang terakhir. Perbarui sidebar dengan info baru dari server.
        if (newLastMessage) {
            // Ada pesan sebelumnya yang sekarang menjadi yang terakhir.
            newSummaryText = newLastMessage.message || 
                                (newLastMessage.file?.name ? `📎 ${newLastMessage.file.name}` : 'Pesan media');
            newTimestamp = newLastMessage.timestamp;
            newId = newLastMessage._id;

            if (groupId) {
                saveLastMessageGroup(chatId, newSummaryText, newTimestamp, newId);
            } else {
                saveLastMessage(chatId, newSummaryText, newTimestamp, newId);
            }
        } else {
            // Tidak ada pesan sebelumnya. Tampilkan "Pesan dihapus" sebagai pesan terakhir.
            newSummaryText = 'Pesan ini telah dihapus';
            newTimestamp = new Date(payload.timestamp); // Gunakan timestamp dari pesan yang dihapus
            newId = messageId;

            if (groupId) {
                saveLastMessageGroup(chatId, newSummaryText, newTimestamp, newId);
            } else {
                saveLastMessage(chatId, newSummaryText, newTimestamp, newId);
            }
        }

        // Perbarui juga state di memori (chatHistory) untuk konsistensi
        if (chatHistory[chatId]) {
            chatHistory[chatId].lastMessage = newSummaryText;
            chatHistory[chatId].timestamp = new Date(newTimestamp);
        }

        // Re-render the recent chats to show the change
        updateRecentChatsDisplay();
    }
});

socket.on('receive_message', (msg) => {
  const summaryText = msg.message 
    || (msg.file && msg.file.type && msg.file.type.startsWith('image/') ? '📷 Foto' : '')
    || (msg.file && msg.file.type && msg.file.type.startsWith('audio/') ? '🎤 Voice note' : '')
    || (msg.file && msg.file.name ? `📎 ${msg.file.name}` : '');

  if (msg.groupId) {
    const group = (allGroups || []).find(g => g._id === msg.groupId);
    addToChatHistory(msg.groupId, group?.nama || 'Group', summaryText, true, msg._id, msg.timestamp);
    
    // Group message
    if (selectedGroup && msg.groupId === selectedGroup._id) {
      addGroupMessageToUI(msg);
    } else {
      incrementUnread(msg.groupId);
    }
  } else {
    const sender = (window.allUsers || []).find(u => u.username === msg.from);
    addToChatHistory(msg.from, sender?.nama || msg.from, summaryText, false, msg._id, msg.timestamp);
    
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

// Helper function to perform the UI update for a deleted message
function updateUIMessageAsDeleted(messageId) {
    const messageEl = document.getElementById(`message-${messageId}`);
    if (messageEl) {
        // Check if it's already deleted to avoid re-processing
        if (messageEl.classList.contains('deleted-message')) return;

        const isGroup = messageEl.classList.contains('group-message');
        const isMe = messageEl.classList.contains('outgoing');
        const timeEl = messageEl.querySelector('.msg-time');
        const timeHTML = timeEl ? timeEl.outerHTML : `<span class="msg-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`;

        let deletedContent = '';

        // Preserve sender name for incoming group messages
        if (isGroup && !isMe) {
            const senderNameEl = messageEl.querySelector('small[style*="color: var(--primary)"]');
            if (senderNameEl) {
                deletedContent += senderNameEl.outerHTML;
            }
        }

        deletedContent += `<p style="margin:0; font-style:italic; opacity:0.7;">Pesan ini telah dihapus</p>`;
        
        messageEl.innerHTML = deletedContent + timeHTML;
        
        // Reset classes and add the deleted-message marker
        messageEl.className = `message ${isMe ? 'outgoing' : 'incoming'} ${isGroup ? 'group-message' : ''} deleted-message`;
    }
}

// --- DELETE FUNCTIONS ---
// Fungsi ini mengirim permintaan ke server untuk menghapus pesan bagi semua orang.
// Server akan mengganti konten pesan dan menyiarkannya ke semua klien.
function deleteMessageForEveryone() {
  if (!selectedMessageElement) return;
  const messageId = selectedMessageElement.dataset.messageId;
  if (!messageId || messageId.startsWith('temp-')) {
    return Toast.show('Tidak bisa menghapus pesan ini.', 'error');
  }
  // Optimistic UI Update for the sender
  updateUIMessageAsDeleted(messageId);
  socket.emit('delete_message_for_everyone', { messageId });
  document.getElementById('messageContextMenu').classList.add('hidden');
  selectedMessageElement = null;
}

// Fungsi ini HANYA menyembunyikan pesan di sisi klien (browser Anda).
// Tidak ada perubahan yang dikirim ke server.
function deleteMessageForMe() {
  if (!selectedMessageElement) return;
  selectedMessageElement.style.display = 'none';
  Toast.show(`Pesan dihapus (hanya untuk Anda).`, 'info');
  document.getElementById('messageContextMenu').classList.add('hidden');
  selectedMessageElement = null;
}

// --- REPLY FUNCTIONS ---

function startReply() {
  if (!selectedMessageElement) return;

  const messageId = selectedMessageElement.dataset.messageId;
  const senderName = selectedMessageElement.dataset.senderName;
  let content = selectedMessageElement.querySelector('p')?.textContent;
  
  // Handle file messages for content preview
  if (!content) {
    if (selectedMessageElement.querySelector('.msg-img')) {
      content = '📷 Gambar';
    } else if (selectedMessageElement.querySelector('.audio-player')) {
      content = '🎤 Voice note';
    } else if (selectedMessageElement.querySelector('.file-bubble')) {
      content = `📎 ${selectedMessageElement.querySelector('.file-bubble-text span')?.textContent || 'File'}`;
    } else {
      content = 'Pesan media';
    }
  }

  if (!messageId || !senderName) {
    Toast.show("Tidak bisa membalas pesan ini", "error");
    return;
  }

  currentReplyContext = { messageId, senderName, content };
  showReplyPreview(currentReplyContext);

  // Hide context menu
  document.getElementById('messageContextMenu').classList.add('hidden');
  selectedMessageElement = null;
}

function showReplyPreview(context) {
  const preview = document.getElementById('replyPreview');
  document.getElementById('replyPreviewName').textContent = context.senderName;
  document.getElementById('replyPreviewText').textContent = context.content;
  preview.classList.remove('hidden');
  document.getElementById('messageInput').focus();
}

function cancelReply() {
  currentReplyContext = null;
  const preview = document.getElementById('replyPreview');
  preview.classList.add('hidden');
  document.getElementById('replyPreviewName').textContent = '';
  document.getElementById('replyPreviewText').textContent = '';
}

function scrollToMessage(event, messageId) {
  event.preventDefault();
  const targetMessage = document.getElementById(`message-${messageId}`);
  if (targetMessage) {
    targetMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Add a temporary highlight effect
    targetMessage.classList.add('highlight');
    setTimeout(() => {
      targetMessage.classList.remove('highlight');
    }, 1500);
  } else {
    Toast.show("Pesan asli tidak ditemukan di chat ini.", "info");
  }
}

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
function saveLastMessage(username, message, timestamp, messageId) {
  try {
    const lastMsg = { message, timestamp, id: messageId };
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
      <div class="avatar small" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
        ${call.name.charAt(0).toUpperCase()}
      </div>
      <div class="call-item-info">
        <h4>${call.name}</h4>
      </div>
      <div class="call-item-time">
        ${statusBadge}
        <small>${formatCallDate(callDate)}</small>
      </div>
      <button onclick="initiateCallFromHistory(event, '${call.username}', '${call.type}', '${call.name.replace(/'/g, "\\'")}')" class="icon-btn" title="${callButtonText}">
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

// --- GEMINI AI FUNCTIONS ---

let geminiHistory = []; // Menyimpan konteks percakapan sesi ini

async function sendGeminiMessage() {
  const input = document.getElementById('geminiInput');
  const text = input.value.trim();
  if (!text) return;

  // 1. Add User Message
  addGeminiBubble(text, true);
  input.value = '';
  input.disabled = true; // Disable input saat loading

  // 2. Simulate Loading
  const chatList = document.getElementById('geminiChatList');
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'gemini-message ai loading-bubble';
  loadingDiv.innerHTML = `
    <div class="typing-indicator">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>`;
  chatList.appendChild(loadingDiv);
  chatList.scrollTop = chatList.scrollHeight;

  try {
    // 3. Call Real Backend API
    const res = await fetch(`${API_URL}/gemini`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        message: text,
        history: geminiHistory 
      })
    });

    const data = await res.json();
    loadingDiv.remove();

    if (data.success) {
      // Tampilkan balasan
      addGeminiBubble(data.reply, false);
      
      // Update history untuk konteks selanjutnya
      // Format history sesuai SDK Google Generative AI
      geminiHistory.push({ role: "user", parts: [{ text: text }] });
      geminiHistory.push({ role: "model", parts: [{ text: data.reply }] });
    } else {
      addGeminiBubble(data.error || "Gagal terhubung ke Gemini.", false);
    }
  } catch (err) {
    loadingDiv.remove();
    addGeminiBubble("Terjadi kesalahan jaringan.", false);
  } finally {
    input.disabled = false;
    input.focus();
  }
}

// Helper untuk format teks sederhana (Bold & Code)
function formatGeminiText(text) {
  // 1. Escape HTML dasar untuk keamanan
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // 2. Code Blocks (```...```)
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

  // 3. Inline Code (`...`)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 4. Bold (**...**)
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  return html;
}

function addGeminiBubble(text, isUser) {
  const container = document.getElementById('geminiChatList');
  // Sembunyikan intro jika ada
  const intro = container.querySelector('.gemini-intro');
  if (intro) intro.style.display = 'none';

  const div = document.createElement('div');
  div.className = `gemini-message ${isUser ? 'user' : 'ai'}`;
  
  if (isUser) {
    div.innerText = text;
  } else {
    // Gunakan formatter untuk AI agar bisa render bold/code
    div.innerHTML = formatGeminiText(text);
  }
  
  div.style.whiteSpace = 'pre-wrap'; 

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}