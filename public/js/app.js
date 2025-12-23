const socket = io({
  extraHeaders: {
    "ngrok-skip-browser-warning": "true",
  },
});

socket.on("connect", () => {
  if (currentUser && currentUser.username) {
    socket.emit("join", { username: currentUser.username });
    socket.emit("get_online_users");
  }
});

const API_URL = `${window.location.origin}/api`;

const originalFetch = window.fetch;
window.fetch = function (url, options = {}) {
  const newOptions = { ...options };
  newOptions.headers = newOptions.headers || {};
  if (newOptions.headers.constructor === Object) {
    newOptions.headers["ngrok-skip-browser-warning"] = "true";
  }
  return originalFetch(url, newOptions);
};

let currentUser = JSON.parse(localStorage.getItem("currentUser"));
let selectedUser = null;
let selectedGroup = null;
let peerConnection;
let localStream;
let searchTimeout = null;
let callTimer = null;
let callDuration = 0;
let isVideo = false;
let currentReplyContext = null;
let selectedMessageElement = null;
const config = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

let chatHistory = {};
let typingUsers = {};
let callHistory = [];
let recentChats = [];
let currentTab = "chats";
window.userStatusMap = {};
const FILE_MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_FILE_TYPES = [
  "image/",
  "video/",
  "audio/",
  "application/pdf",
  "text/plain",
];
let voiceRecorder = {
  recorder: null,
  chunks: [],
  stream: null,
  timer: null,
  startTime: null,
  interval: null,
};
let chatSearchTimeout = null;
let callStartTime = null;

let currentStatuses = {};
let statusQueue = [];
let currentStatusIndex = 0;
let statusTimer = null;
let statusUserOrder = [];
let currentViewedUserId = null;

let statusImageBase64 = null;
let statusNavLock = false;

const Toast = {
  container: null,
  init() {
    this.container = document.createElement("div");
    this.container.className = "toast-container";
    document.body.appendChild(this.container);
  },
  show(message, type = "info") {
    if (!this.container) this.init();

    const icons = {
      success: "check-circle",
      error: "alert-octagon",
      info: "info",
      warning: "alert-triangle",
    };
    const iconName = icons[type] || "info";

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <div class="toast-icon"><i data-feather="${iconName}"></i></div>
      <div class="toast-content">${message}</div>
    `;

    this.container.appendChild(toast);
    if (typeof feather !== "undefined") feather.replace();

    requestAnimationFrame(() => toast.classList.add("show"));

    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 400);
    }, 3000);
  },
};

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  if (!bytes) return "";
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}

function getFileIcon(type) {
  if (!type) return "paperclip";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "music";
  if (type === "application/pdf") return "file-text";
  return "paperclip";
}

function isFileTypeAllowed(mime) {
  if (!mime) return false;
  return ALLOWED_FILE_TYPES.some((type) =>
    type.endsWith("/") ? mime.startsWith(type) : mime === type
  );
}

function formatRelativeTime(date) {
  if (!date) return "";
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "baru saja";
  if (minutes < 60) return `${minutes}m lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}j lalu`;
  const days = Math.floor(hours / 24);
  return `${days}h lalu`;
}

function getUserStatusText(user) {
  if (!user) return "Offline";
  const statusMap = window.userStatusMap || {};
  if (statusMap[user.username] === "online") return "Online";
  if (user.lastSeen) {
    const last = new Date(user.lastSeen);
    return `Terakhir dilihat ${formatRelativeTime(last)}`;
  }
  return "Offline";
}

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
  const statusEl = document.getElementById("chatStatus");
  if (statusEl) statusEl.textContent = getUserStatusText(selectedUser);
}

function toggleChatSearchPanel(forceHide = false) {
  const panel = document.getElementById("chatSearchPanel");
  const input = document.getElementById("chatSearchInput");
  const results = document.getElementById("chatSearchResults");
  if (!panel) return;

  if (forceHide) {
    panel.classList.add("hidden");
    return;
  }

  panel.classList.toggle("hidden");
  if (!panel.classList.contains("hidden")) {
    if (results)
      results.innerHTML =
        '<div class="empty-state">Ketik untuk mencari pesan</div>';
    if (input) {
      input.value = "";
      input.focus();
    }
  }
}

function renderChatSearchResults(items) {
  const container = document.getElementById("chatSearchResults");
  if (!container) return;

  if (!items || items.length === 0) {
    container.innerHTML =
      '<div class="empty-state">Tidak ada hasil ditemukan di chat ini.</div>';
    return;
  }

  container.innerHTML = "";
  items.forEach((item) => {
    const div = document.createElement("div");
    div.className = "chat-search-result-item";
    const ts = new Date(item.timestamp).toLocaleString("id-ID", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    const snippet =
      item.message ||
      (item.file && item.file.name ? `📎 ${item.file.name}` : "Pesan media");
    const senderName = escapeHtml(
      item.sender
        ? item.sender.username === currentUser.username
          ? "Anda"
          : item.sender.nama
        : item.from
    );

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
  const results = document.getElementById("chatSearchResults");

  if (chatSearchTimeout) clearTimeout(chatSearchTimeout);

  if (!q) {
    if (results)
      results.innerHTML =
        '<div class="empty-state">Ketik untuk mencari pesan di chat ini</div>';
    return;
  }

  if (!selectedUser && !selectedGroup) {
    if (results)
      results.innerHTML =
        '<div class="empty-state">Pilih sebuah chat terlebih dahulu</div>';
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
        if (results)
          results.innerHTML =
            '<div class="empty-state">Gagal mencari pesan</div>';
      }
    } catch (err) {
      if (results)
        results.innerHTML = '<div class="empty-state">Error jaringan</div>';
    }
  }, 300);
}

async function toggleVoiceRecording() {
  if (!selectedUser && !selectedGroup) {
    Toast.show("Pilih chat dulu sebelum merekam suara", "warning");
    return;
  }

  if (voiceRecorder.recorder && voiceRecorder.recorder.state === "recording") {
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
      const blob = new Blob(voiceRecorder.chunks, {
        type: recorder.mimeType || "audio/webm",
      });
      cleanupVoiceRecording();

      if (blob.size === 0) return;

      if (blob.size > FILE_MAX_BYTES) {
        Toast.show("Voice note terlalu besar (>10MB)", "error");
        return;
      }

      sendVoiceNoteBlob(blob);
    };

    recorder.start();
    updateVoiceButtonState(true);

    showRecordingIndicator();

    voiceRecorder.startTime = Date.now();
    updateRecordingTimer();
    voiceRecorder.interval = setInterval(() => {
      updateRecordingTimer();
    }, 100);

    voiceRecorder.timer = setTimeout(() => stopVoiceRecording(), 120000);
  } catch (err) {
    Toast.show("Gagal mengakses mikrofon: " + err.message, "error");
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

  if (voiceRecorder.recorder && voiceRecorder.recorder.state === "recording") {
    voiceRecorder.recorder.stop();
  }
  updateVoiceButtonState(false);
  hideRecordingIndicator();
}

function cleanupVoiceRecording() {
  if (voiceRecorder.stream) {
    voiceRecorder.stream.getTracks().forEach((track) => track.stop());
  }

  if (voiceRecorder.interval) {
    clearInterval(voiceRecorder.interval);
  }

  voiceRecorder = {
    recorder: null,
    chunks: [],
    stream: null,
    timer: null,
    startTime: null,
    interval: null,
  };
}

function sendVoiceNoteBlob(blob) {
  const reader = new FileReader();
  reader.onload = () => {
    const filePayload = {
      name: `Voice-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`,
      type: blob.type || "audio/webm",
      size: blob.size,
      data: reader.result,
    };

    const tempId = `temp-${Date.now()}-${Math.random()}`;

    if (selectedGroup) {
      const payload = {
        from: currentUser.username,
        to: selectedGroup._id,
        message: "",
        file: filePayload,
        groupId: selectedGroup._id,
        tempId,
      };
      socket.emit("send_message", payload);
      addGroupMessageToUI({
        ...payload,
        timestamp: new Date().toISOString(),
        _id: tempId,
      });
      saveLastMessageGroup(
        selectedGroup._id,
        "🎤 Voice note",
        new Date(),
        tempId
      );
    } else if (selectedUser) {
      const payload = {
        from: currentUser.username,
        to: selectedUser.username,
        message: "",
        file: filePayload,
        tempId,
      };
      socket.emit("send_message", payload);
      addMessageToUI({
        ...payload,
        timestamp: new Date().toISOString(),
        _id: tempId,
      });
      saveLastMessage(selectedUser._id, "🎤 Voice note", new Date(), tempId);
    }
  };
  reader.readAsDataURL(blob);
}

function updateVoiceButtonState(isRecording) {
  const btn = document.getElementById("voiceNoteBtn");
  if (!btn) return;
  btn.classList.toggle("recording", isRecording);
  const icon = btn.querySelector("i");
  if (icon) {
    icon.setAttribute("data-feather", isRecording ? "square" : "mic");
    if (typeof feather !== "undefined") feather.replace();
  }
}

function showRecordingIndicator() {
  const messageInput = document.getElementById("messageInput");
  const recordingIndicator = document.getElementById("recordingIndicator");
  const voiceNoteBtn = document.getElementById("voiceNoteBtn");
  const sendBtn = document.querySelector(".send-btn");

  if (messageInput && recordingIndicator && voiceNoteBtn && sendBtn) {
    messageInput.style.display = "none";
    recordingIndicator.classList.remove("hidden");
    voiceNoteBtn.style.display = "flex";
    sendBtn.style.display = "none";
  }
}

function hideRecordingIndicator() {
  const messageInput = document.getElementById("messageInput");
  const recordingIndicator = document.getElementById("recordingIndicator");
  const voiceNoteBtn = document.getElementById("voiceNoteBtn");
  const sendBtn = document.querySelector(".send-btn");

  if (messageInput && recordingIndicator && voiceNoteBtn && sendBtn) {
    messageInput.style.display = "";
    recordingIndicator.classList.add("hidden");

    const hasText = messageInput.value.trim().length > 0;
    if (hasText) {
      voiceNoteBtn.style.display = "none";
      sendBtn.style.display = "flex";
    } else {
      voiceNoteBtn.style.display = "flex";
      sendBtn.style.display = "none";
    }
  }
}

const wavesurferInstances = {};

function toggleAudioPlayback(audioId, audioSrc) {
  const wavesurfer = wavesurferInstances[audioId];

  if (!wavesurfer) return;

  if (wavesurfer.isPlaying()) {
    wavesurfer.pause();
  } else {
    Object.keys(wavesurferInstances).forEach((key) => {
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

  timeDisplay.textContent = `${currentMinutes}:${currentSeconds
    .toString()
    .padStart(2, "0")} / ${durationMinutes}:${durationSeconds
    .toString()
    .padStart(2, "0")}`;
}

function initializeWaveform(audioId, audioSrc) {
  const waveformContainer = document.getElementById(`waveform-${audioId}`);

  if (wavesurferInstances[audioId]) return;

  const wavesurfer = WaveSurfer.create({
    container: waveformContainer,
    waveColor: "rgba(90, 138, 140, 0.3)",
    progressColor: getComputedStyle(document.documentElement)
      .getPropertyValue("--primary")
      .trim(),
    cursorColor: getComputedStyle(document.documentElement)
      .getPropertyValue("--primary")
      .trim(),
    barWidth: 2,
    barRadius: 2,
    barGap: 1,
    height: 32,
    responsive: true,
    normalize: true,
  });

  wavesurfer.load(audioSrc);
  wavesurferInstances[audioId] = wavesurfer;

  wavesurfer.on("ready", () => {
    const duration = wavesurfer.getDuration();
    const timeDisplay = document.querySelector(`#${audioId} .audio-time`);
    if (timeDisplay) {
      updateTimeDisplay(0, duration, timeDisplay);
    }
  });

  wavesurfer.on("audioprocess", () => {
    const currentTime = wavesurfer.getCurrentTime();
    const duration = wavesurfer.getDuration();
    const timeDisplay = document.querySelector(`#${audioId} .audio-time`);
    if (timeDisplay) {
      updateTimeDisplay(currentTime, duration, timeDisplay);
    }
  });

  wavesurfer.on("play", () => {
    const playIcon = document.querySelector(`#${audioId} .play-icon`);
    const pauseIcon = document.querySelector(`#${audioId} .pause-icon`);
    if (playIcon) playIcon.style.display = "none";
    if (pauseIcon) pauseIcon.style.display = "block";
  });

  wavesurfer.on("pause", () => {
    const playIcon = document.querySelector(`#${audioId} .play-icon`);
    const pauseIcon = document.querySelector(`#${audioId} .pause-icon`);
    if (playIcon) playIcon.style.display = "block";
    if (pauseIcon) pauseIcon.style.display = "none";
  });

  wavesurfer.on("finish", () => {
    const playIcon = document.querySelector(`#${audioId} .play-icon`);
    const pauseIcon = document.querySelector(`#${audioId} .pause-icon`);
    if (playIcon) playIcon.style.display = "block";
    if (pauseIcon) pauseIcon.style.display = "none";
  });

  const waveformParent = waveformContainer.parentElement;
  waveformParent.addEventListener("click", (e) => {
    if (e.target.closest(".audio-play-pause")) return;

    const rect = waveformParent.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    wavesurfer.seekTo(pos);
  });
}

function updateRecordingTimer() {
  const timerElement = document.getElementById("recordingTimer");
  if (!timerElement || !voiceRecorder.startTime) return;

  const elapsed = Date.now() - voiceRecorder.startTime;
  const seconds = Math.floor(elapsed / 1000) % 60;
  const minutes = Math.floor(elapsed / 60000);

  timerElement.textContent = `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function setupAttachmentDropdown() {
  const fileInput = document.getElementById("fileInput");

  if (!fileInput) {
    console.warn(
      "Gagal menyiapkan dropdown lampiran: elemen #fileInput tidak ditemukan."
    );
    return;
  }

  const originalLabel = document.querySelector('label[for="fileInput"]');
  if (originalLabel) {
    originalLabel.style.display = "none";
  }

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

  fileInput.insertAdjacentHTML("beforebegin", dropdownHTML);
  if (typeof feather !== "undefined") feather.replace();

  const menu = document.getElementById("attachmentMenu");
  const btn = document.getElementById("attachmentDropdownBtn");

  if (!menu) return;

  if (btn) {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.classList.toggle("active");
    });

    document.addEventListener("click", (e) => {
      if (!menu.contains(e.target) && !btn.contains(e.target)) {
        menu.classList.remove("active");
      }
    });
  }

  menu.addEventListener("click", (e) => {
    e.preventDefault();
    const target = e.target.closest("a");
    if (target) {
      const fileType = target.dataset.type;

      if (fileType === "*") {
        fileInput.removeAttribute("accept");
      } else {
        fileInput.setAttribute("accept", fileType);
      }

      fileInput.click();
      menu.classList.remove("active");
    }
  });
}

const ContactsModal = {
  isOpen: false,
  currentUsers: [],

  init() {
    if (document.getElementById("contactsModal")) return;

    const modalHtml = `
      <div id="contactsModal" class="modal hidden">
        <div class="contacts-modal-content glass-panel">
          <button class="close-modal"><i data-feather="x"></i></button>
          <div class="contacts-modal-header">
            <h2>Kontak Baru</h2>
            <p class="contacts-modal-subtitle">Temukan teman di FluxChat</p>
          </div>
          <div class="contacts-search-bar">
            <i data-feather="search" class="search-icon"></i>
            <input type="text" class="contacts-search-input" placeholder="Cari username atau email..." id="contactsSearchInput">
          </div>
          <div class="contacts-list-container" id="contactsList">
            <div class="loading-state"><div class="spinner"></div><p>Memuat kontak...</p></div>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML("beforeend", modalHtml);

    const modal = document.getElementById("contactsModal");
    const closeBtn = modal.querySelector(".close-modal");
    const searchInput = document.getElementById("contactsSearchInput");

    closeBtn.onclick = () => this.close();
    modal.onclick = (e) => {
      if (e.target === modal) this.close();
    };

    searchInput.oninput = (e) => {
      const query = e.target.value.trim();
      if (query) {
        this.search(query);
      } else {
        this.renderFullList();
      }
    };
  },

  open() {
    this.init();
    const modal = document.getElementById("contactsModal");
    const content = modal.querySelector(".contacts-modal-content");
    const searchInput = document.getElementById("contactsSearchInput");

    this.isOpen = true;
    modal.classList.remove("hidden");
    modal.classList.add("active");

    content.classList.remove("fade-scale-out");
    content.classList.add("fade-scale-in");

    if (searchInput) {
      searchInput.value = "";
      searchInput.focus();
    }

    this.renderFullList();
    if (typeof feather !== "undefined") feather.replace();
  },

  close() {
    const modal = document.getElementById("contactsModal");
    const content = modal.querySelector(".contacts-modal-content");

    this.isOpen = false;

    content.classList.remove("fade-scale-in");
    content.classList.add("fade-scale-out");

    setTimeout(() => {
      if (!this.isOpen) {
        modal.classList.add("hidden");
        modal.classList.remove("active");
        content.classList.remove("fade-scale-out");
      }
    }, 250);
  },

  async renderFullList(container = null) {
    const list = container || document.getElementById("contactsList");
    if (!list) return;

    if (window.allRequests && window.allRequests.length > 0) {
      list.innerHTML = `
        <div class="requests-section">
          <h3 style="padding: 15px 15px 10px; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1.2px; color: var(--primary); font-weight: 800; display: flex; align-items: center; gap: 8px; opacity: 0.8;">
            <i data-feather="user-plus" style="width: 14px; height: 14px;"></i> Permintaan Masuk
          </h3>
        </div>`;
      const section = list.querySelector(".requests-section");

      window.allRequests.forEach((req) => {
        const user = req.from;
        const div = document.createElement("div");
        div.className = "contact-item request-item";
        div.style.margin = "4px 12px 8px";
        div.style.padding = "12px";
        div.style.background = "var(--glass-bg)";
        div.style.borderRadius = "16px";
        div.style.border = "1px solid var(--border-color)";
        div.style.boxShadow = "0 4px 12px rgba(0,0,0,0.05)";

        div.innerHTML = `
            <div class="contact-avatar">
                ${createAvatarHTML(user, "avatar small", false)}
            </div>
            <div class="contact-info">
                <h4 class="contact-name" style="font-size: 0.95rem; margin-bottom: 2px;">${
                  user.nama
                }</h4>
                <p class="contact-username" style="font-size: 0.8rem; opacity: 0.6;">@${
                  user.username
                }</p>
            </div>
            <div class="contact-action" style="display: flex; gap: 6px;">
                <button class="contact-action-btn accept-btn" onclick="respondFriend('${
                  user._id
                }', 'accept')" title="Terima" style="background: var(--primary); color: white; border: none; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer;">
                  <i data-feather="check" style="width: 18px; height: 18px;"></i>
                </button>
                <button class="contact-action-btn reject-btn" onclick="respondFriend('${
                  user._id
                }', 'reject')" title="Tolak" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer;">
                  <i data-feather="x" style="width: 18px; height: 18px;"></i>
                </button>
            </div>
        `;
        section.appendChild(div);
      });
      const spacer = document.createElement("div");
      spacer.style.height = "10px";
      list.appendChild(spacer);
    } else {
      list.innerHTML = "";
    }

    list.innerHTML += `
      <div class="empty-state">
        <i data-feather="users"></i>
        <p>Ketik username untuk mencari teman baru</p>
      </div>
    `;
    if (typeof feather !== "undefined") feather.replace();
  },

  async search(query) {
    const list = document.getElementById("contactsList");
    list.innerHTML =
      '<div class="loading-state"><div class="spinner"></div><p>Mencari...</p></div>';

    try {
      const res = await fetch(
        `${API_URL}/users/search?query=${encodeURIComponent(
          query
        )}&currentUserId=${currentUser.id}`
      );
      const data = await res.json();

      if (data.success) {
        this.renderUserList(data.users);
      } else {
        list.innerHTML = '<div class="error-state"><p>Gagal mencari</p></div>';
      }
    } catch (e) {
      list.innerHTML = '<div class="error-state"><p>Error koneksi</p></div>';
    }
  },

  renderUserList(users) {
    const list = document.getElementById("contactsList");
    list.innerHTML = "";
    this.currentUsers = users;

    if (!users || users.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>Tidak ditemukan</p></div>';
      return;
    }

    users.forEach((user) => {
      const div = document.createElement("div");
      div.className = "contact-item";

      const isOnline =
        window.userStatusMap &&
        window.userStatusMap[user.username] === "online";

      let actionBtn = "";
      if (user.isFriend) {
        actionBtn = `<button class="contact-action-btn chat-btn" onclick="selectUser({username: '${user.username}', nama: '${user.nama}', _id: '${user._id}', avatar: '${user.avatar}'}); ContactsModal.close();"><i data-feather="message-square"></i></button>`;
      } else if (user.isPending) {
        actionBtn = `<button class="contact-action-btn pending-btn" disabled><i data-feather="clock"></i></button>`;
      } else {
        actionBtn = `<button class="contact-action-btn add-btn" onclick="sendFriendRequest(event, '${user._id}')"><i data-feather="user-plus"></i></button>`;
      }

      div.innerHTML = `
            <div class="contact-avatar">
                ${createAvatarHTML(user, "avatar small", isOnline)}
            </div>
            <div class="contact-info">
                <h4 class="contact-name">${user.nama}</h4>
                <p class="contact-username">@${user.username}</p>
            </div>
            <div class="contact-action">
                ${actionBtn}
            </div>
        `;
      list.appendChild(div);
    });
    if (typeof feather !== "undefined") feather.replace();
  },
};

window.ContactsModal = ContactsModal;

if (!currentUser) window.location.href = "login.html";


let profileCompletionPhotoBase64 = null;

function showProfileCompletionModal() {
  const modal = document.getElementById("profileCompletionModal");
  if (!modal) return;

  const authProvider = currentUser.authProvider || "local";
  const nameField = document.getElementById("profileCompletionNameField");
  const titleEl = document.getElementById("profileCompletionTitle");
  const subtitleEl = document.getElementById("profileCompletionSubtitle");
  const namaInput = document.getElementById("profileCompletionNama");

  
  if (authProvider === "google") {
    titleEl.textContent = "Lengkapi Profil Anda";
    subtitleEl.textContent = "Tambahkan foto dan nama lengkap untuk memulai";
    nameField.classList.remove("hidden");
    if (namaInput) namaInput.value = currentUser.nama || "";
  } else {
    titleEl.textContent = "Tambahkan Foto Profil";
    subtitleEl.textContent = "Personalisasi akun Anda dengan foto profil";
    nameField.classList.add("hidden");
  }

  
  const avatarPreview = document.getElementById("profileCompletionAvatar");
  if (currentUser.avatar && currentUser.avatar.startsWith("http")) {
    avatarPreview.innerHTML = `<img src="${currentUser.avatar}" alt="Avatar">`;
  } else {
    avatarPreview.innerHTML = '<i data-feather="user"></i>';
  }
  profileCompletionPhotoBase64 = null;

  modal.classList.remove("hidden");
  modal.classList.add("active");
  if (typeof feather !== "undefined") feather.replace();
}

function handleProfileCompletionPhoto(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    Toast.show("Pilih file gambar yang valid", "error");
    return;
  }

  compressImage(file, (base64) => {
    profileCompletionPhotoBase64 = base64;
    const avatarPreview = document.getElementById("profileCompletionAvatar");
    avatarPreview.innerHTML = `<img src="${base64}" alt="Avatar">`;
  }, 400, 400);
}

function skipProfileCompletion() {
  const modal = document.getElementById("profileCompletionModal");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("active");
  }
  
  currentUser.profileCompleted = true;
  localStorage.setItem("currentUser", JSON.stringify(currentUser));
  
  
  fetch(`${API_URL}/users/${currentUser.id}/complete-profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({  }),
  }).catch(() => {});
}

async function saveProfileCompletion() {
  const btn = document.getElementById("profileCompletionSave");
  const namaInput = document.getElementById("profileCompletionNama");
  const authProvider = currentUser.authProvider || "local";
  
  btn.disabled = true;
  btn.innerHTML = '<i data-feather="loader" class="spinner-animation"></i> Menyimpan...';
  if (typeof feather !== "undefined") feather.replace();

  try {
    const payload = {};
    
    if (authProvider === "google" && namaInput && namaInput.value.trim()) {
      payload.nama = namaInput.value.trim();
    }
    
    if (profileCompletionPhotoBase64) {
      payload.avatar = profileCompletionPhotoBase64;
    }

    const res = await fetch(`${API_URL}/users/${currentUser.id}/complete-profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    
    if (data.success) {
      currentUser = { ...currentUser, ...data.user };
      localStorage.setItem("currentUser", JSON.stringify(currentUser));
      
      const modal = document.getElementById("profileCompletionModal");
      if (modal) {
        modal.classList.add("hidden");
        modal.classList.remove("active");
      }
      
      Toast.show("Profil berhasil dilengkapi!", "success");
    } else {
      Toast.show(data.error || "Gagal menyimpan profil", "error");
    }
  } catch (err) {
    Toast.show("Terjadi kesalahan koneksi", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-feather="check"></i><span>Simpan</span>';
    if (typeof feather !== "undefined") feather.replace();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (typeof feather !== "undefined") feather.replace();
  setTimeout(() => {
    document.body.classList.remove("preload");
  }, 100);
  
  if (currentUser && currentUser.profileCompleted === false) {
    setTimeout(() => {
      showProfileCompletionModal();
    }, 500);
  }
  
  
  const profileCompletionPhotoInput = document.getElementById("profileCompletionPhotoInput");
  if (profileCompletionPhotoInput) {
    profileCompletionPhotoInput.addEventListener("change", handleProfileCompletionPhoto);
  }

  const uiStyle = document.createElement("style");
  uiStyle.textContent = `
    #callModal.desktop-embedded .glass-panel, 
    #callModal.desktop-embedded .call-modal-content {
        display: flex !important;
        flex-direction: column !important;
        height: 100% !important;
        box-sizing: border-box !important;
    }
    #callModal.desktop-embedded #videoContainer {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1.5rem;
      width: 100%;
      height: 100%;
      padding: 1rem;
    }
    #callModal.desktop-embedded #videoContainer video {
        width: 100% !important;
        height: 100%;
        aspect-ratio: unset;
        object-fit: cover !important; 
        border-radius: 16px !important; 
        background-color: #000 !important;
    }
  `;
  document.head.appendChild(uiStyle);

  if (typeof WaveSurfer === "undefined") {
    console.warn("Wavesurfer.js not loaded");
  }

  setupAttachmentDropdown();

  const statusTypeToggle = document.querySelector(".status-type-toggle");
  if (statusTypeToggle) {
    statusTypeToggle.addEventListener("click", (e) => {
      const btn = e.target.closest(".toggle-btn");
      if (btn) {
        switchStatusType(btn.dataset.type);
      }
    });
  }

  const statusImageInput = document.getElementById("statusImageInput");
  if (statusImageInput) {
    statusImageInput.addEventListener("change", handleStatusImageSelect);
  }

  const postStatusBtn = document.getElementById("postStatusBtn");
  if (postStatusBtn) {
    postStatusBtn.addEventListener("click", postStatus);
  }

  const colorPalette = document.querySelector(".color-palette");
  if (colorPalette) {
    colorPalette.addEventListener("click", (e) => {
      const dot = e.target.closest(".color-dot");
      if (dot) {
        const color = dot.dataset.color;
        document.getElementById("statusTextInput").style.backgroundColor =
          color;
        document
          .querySelectorAll(".color-dot")
          .forEach((d) => d.classList.remove("active"));
        dot.classList.add("active");
      }
    });
  }

  document.getElementById("callModal").classList.add("hidden");
  document.getElementById("profileModal").classList.remove("active");

  loadUnreadCounts();

  loadFriendsAndRequests();

  loadGroups();

  loadCallHistory();

  displayStatusUpdates();

  checkScreenSize();

  window.addEventListener("resize", checkScreenSize);

  setupSidebarResizer();

  const chatSearchToggle = document.getElementById("chatSearchToggle");
  const chatSearchInput = document.getElementById("chatSearchInput");
  if (chatSearchToggle) {
    chatSearchToggle.addEventListener("click", () => toggleChatSearchPanel());
  }
  if (chatSearchInput) {
    chatSearchInput.addEventListener("input", handleChatSearchInput);
  }

  const geminiInput = document.getElementById("geminiInput");
  if (geminiInput) {
    geminiInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") sendGeminiMessage();
    });
  }

  document.addEventListener("click", (e) => {
    const panel = document.getElementById("chatSearchPanel");
    const toggle = document.getElementById("chatSearchToggle");
    if (panel && !panel.classList.contains("hidden")) {
      if (
        !panel.contains(e.target) &&
        (!toggle || !toggle.contains(e.target))
      ) {
        toggleChatSearchPanel(true);
      }
    }
  });

  const voiceBtn = document.getElementById("voiceNoteBtn");
  if (voiceBtn) {
    voiceBtn.addEventListener("click", toggleVoiceRecording);
  }

  const messageInput = document.getElementById("messageInput");
  const sendBtn = document.querySelector(".send-btn");

  updateSendButtonVisibility();

  messageInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendMessage();
  });

  messageInput.addEventListener("input", () => {
    updateSendButtonVisibility();

    if (!selectedUser) return;

    socket.emit("typing", {
      to: selectedUser.username,
      from: currentUser.username,
    });

    clearTimeout(typingTimeout);

    typingTimeout = setTimeout(() => {
      if (!selectedUser) return;
      socket.emit("stop_typing", {
        to: selectedUser.username,
        from: currentUser.username,
      });
    }, 1000);
  });

  let typingTimeout;

  document.addEventListener("click", (e) => {
    const closeStatusBtn = e.target.closest(".close-status-viewer");
    if (closeStatusBtn) {
      e.preventDefault();
      e.stopPropagation();
      closeStatusViewer();
      return;
    }

    const dropdown = document.getElementById("userDropdown");
    const userMenu = document.getElementById("userMenu");
    if (dropdown && !dropdown.contains(e.target)) {
      userMenu.classList.add("hidden");
    }
  });

  const backBtn = document.getElementById("backToSidebar");
  if (backBtn) backBtn.addEventListener("click", closeChat);

  const closeModalBtns = document.querySelectorAll(".close-modal");
  closeModalBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".modal").forEach((m) => {
        m.classList.remove("active");
        m.classList.add("hidden");
      });
    });
  });

  const createStatusModal = document.getElementById("createStatusModal");
  if (createStatusModal) {
    const closeBtn = createStatusModal.querySelector(".close-modal");
    if (closeBtn) {
      closeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeCreateStatusModal();
      });
    }
  }

  const saveProfileBtn = document.getElementById("saveProfile");
  if (saveProfileBtn) {
    saveProfileBtn.addEventListener("click", saveProfile);
  }

  const profilePhotoInput = document.getElementById("profilePhotoInput");
  const profilePhotoPreview = document.getElementById("profilePhotoPreview");

  if (profilePhotoInput) {
    profilePhotoInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          const avatarDisplay = document.getElementById("profileAvatarDisplay");
          avatarDisplay.style.backgroundImage = `url('${evt.target.result}')`;
          avatarDisplay.textContent = "";
        };
        reader.readAsDataURL(file);
      }
    });
  }

  if (profilePhotoPreview) {
    profilePhotoPreview.addEventListener("click", () => {
      if (profilePhotoInput) profilePhotoInput.click();
    });
  }

  const createGroupBtn = document.getElementById("createGroupBtn");
  if (createGroupBtn) {
    createGroupBtn.addEventListener("click", createGroup);
  }

  const messagesContainer = document.getElementById("messagesContainer");
  messagesContainer.addEventListener("contextmenu", function (e) {
    const messageEl = e.target.closest(".message, .message-img");

    if (messageEl && !messageEl.classList.contains("deleted-message")) {
      e.preventDefault();
      selectedMessageElement = messageEl;

      const menu = document.getElementById("messageContextMenu");
      const deleteForMeBtn = document.getElementById("deleteForMeBtn");
      const deleteForEveryoneBtn = document.getElementById(
        "deleteForEveryoneBtn"
      );
      const isMyMessage = messageEl.classList.contains("outgoing");

      if (deleteForMeBtn) deleteForMeBtn.style.display = "flex";
      if (deleteForEveryoneBtn)
        deleteForEveryoneBtn.style.display = isMyMessage ? "flex" : "none";

      menu.style.visibility = "hidden";
      menu.classList.remove("hidden");
      const menuWidth = menu.offsetWidth;
      menu.classList.add("hidden");
      menu.style.visibility = "";

      let leftPosition = e.clientX;

      if (isMyMessage) {
        leftPosition = e.clientX - menuWidth;
      }

      menu.style.top = `${e.clientY}px`;
      menu.style.left = `${leftPosition}px`;
      menu.classList.remove("hidden");
    }
  });
  let longPressTimer = null;
  let longPressTarget = null;
  
  messagesContainer.addEventListener("touchstart", function(e) {
    const messageEl = e.target.closest(".message, .message-img");
    if (messageEl && !messageEl.classList.contains("deleted-message")) {
      longPressTarget = messageEl;
      longPressTimer = setTimeout(() => {
        e.preventDefault();
        selectedMessageElement = messageEl;
        
        const menu = document.getElementById("messageContextMenu");
        const deleteForMeBtn = document.getElementById("deleteForMeBtn");
        const deleteForEveryoneBtn = document.getElementById("deleteForEveryoneBtn");
        const isMyMessage = messageEl.classList.contains("outgoing");
        
        if (deleteForMeBtn) deleteForMeBtn.style.display = "flex";
        if (deleteForEveryoneBtn)
          deleteForEveryoneBtn.style.display = isMyMessage ? "flex" : "none";
        const touch = e.touches[0];
        const rect = messageEl.getBoundingClientRect();
        
        menu.style.visibility = "hidden";
        menu.classList.remove("hidden");
        const menuWidth = menu.offsetWidth;
        const menuHeight = menu.offsetHeight;
        menu.classList.add("hidden");
        menu.style.visibility = "";
        
        let leftPosition = touch.clientX;
        let topPosition = touch.clientY;
        if (isMyMessage) {
          leftPosition = touch.clientX - menuWidth;
        }
        if (leftPosition < 10) leftPosition = 10;
        if (leftPosition + menuWidth > window.innerWidth - 10) {
          leftPosition = window.innerWidth - menuWidth - 10;
        }
        if (topPosition + menuHeight > window.innerHeight - 10) {
          topPosition = window.innerHeight - menuHeight - 10;
        }
        
        menu.style.top = `${topPosition}px`;
        menu.style.left = `${leftPosition}px`;
        menu.classList.remove("hidden");
        if (navigator.vibrate) {
          navigator.vibrate(50);
        }
        
        longPressTarget = null;
      }, 500); // 500ms long press
    }
  }, { passive: false });
  
  messagesContainer.addEventListener("touchend", function() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    longPressTarget = null;
  });
  
  messagesContainer.addEventListener("touchmove", function() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  });

  document.addEventListener("click", function (e) {
    const menu = document.getElementById("messageContextMenu");
    if (
      menu &&
      !menu.classList.contains("hidden") &&
      !menu.contains(e.target)
    ) {
      menu.classList.add("hidden");
      selectedMessageElement = null;
    }
  });

  const saveGroupBtn = document.getElementById("saveGroupProfileBtn");
  if (saveGroupBtn) {
    saveGroupBtn.addEventListener("click", saveGroupProfile);
  }

  const groupAvatarPreview = document.getElementById("groupAvatarPreview");
  const groupAvatarInput = document.getElementById("groupAvatarInput");
  if (groupAvatarPreview && groupAvatarInput) {
    groupAvatarPreview.addEventListener("click", () =>
      groupAvatarInput.click()
    );
    groupAvatarInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          groupAvatarPreview.style.backgroundImage = `url('${evt.target.result}')`;
          groupAvatarPreview.textContent = "";
        };
        reader.readAsDataURL(file);
      }
    });
  }
});

function checkScreenSize() {
  const isMobile = window.innerWidth <= 768;
  const sidebar = document.getElementById("sidebar");
  const chatArea = document.getElementById("chatArea");
  const chatRoom = document.getElementById("chatRoom");
  const welcomeScreen = document.getElementById("welcomeScreen");

  if (isMobile) {
    if (selectedUser || selectedGroup) {
      sidebar.classList.add("hidden-mobile");
      chatArea.classList.add("active");
    } else {
      sidebar.classList.remove("hidden-mobile");
      chatArea.classList.remove("active");
    }

    sidebar.style.width = "";
  } else {
    sidebar.classList.remove("hidden-mobile");
    chatArea.classList.remove("active");

    const isStatusOpen =
      (document.getElementById("viewStatusModal") &&
        !document
          .getElementById("viewStatusModal")
          .classList.contains("hidden")) ||
      (document.getElementById("createStatusModal") &&
        !document
          .getElementById("createStatusModal")
          .classList.contains("hidden"));

    if (!selectedUser && !selectedGroup && !isStatusOpen) {
      sidebar.style.width = "50%";
    } else if (sidebar.style.width === "" || sidebar.style.width === "50%") {
      sidebar.style.width = "380px";
    }
  }

  const statusModal = document.getElementById("viewStatusModal");
  if (statusModal && !statusModal.classList.contains("hidden")) {
    if (isMobile) {
      if (statusModal.parentNode !== document.body) {
        document.body.appendChild(statusModal);
        statusModal.classList.remove("desktop-embedded");
      }
    } else {
      const chatArea = document.getElementById("chatArea");
      if (statusModal.parentNode !== chatArea) {
        chatArea.appendChild(statusModal);
        statusModal.classList.add("desktop-embedded");
        document.getElementById("welcomeScreen").classList.add("hidden");
        document.getElementById("chatRoom").classList.add("hidden");
      }
    }
  }

  const createStatusModal = document.getElementById("createStatusModal");
  if (createStatusModal && !createStatusModal.classList.contains("hidden")) {
    if (isMobile) {
      if (createStatusModal.parentNode !== document.body) {
        document.body.appendChild(createStatusModal);
        createStatusModal.classList.remove("desktop-embedded");
      }
    } else {
      const chatArea = document.getElementById("chatArea");
      if (createStatusModal.parentNode !== chatArea) {
        chatArea.appendChild(createStatusModal);
        createStatusModal.classList.add("desktop-embedded");
        document.getElementById("welcomeScreen").classList.add("hidden");
        document.getElementById("chatRoom").classList.add("hidden");
      }
    }
  }

  const callModal = document.getElementById("callModal");
  if (callModal && !callModal.classList.contains("hidden")) {
    if (isMobile) {
      if (callModal.parentNode !== document.body) {
        document.body.appendChild(callModal);
        callModal.classList.remove("desktop-embedded");
      }
      document.querySelector(".app-layout").classList.remove("call-mode");
    } else {
      const chatArea = document.getElementById("chatArea");
      if (callModal.parentNode !== chatArea) {
        chatArea.appendChild(callModal);
        callModal.classList.add("desktop-embedded");
        document.getElementById("welcomeScreen").classList.add("hidden");
        document.getElementById("chatRoom").classList.add("hidden");
      }
      document.querySelector(".app-layout").classList.add("call-mode");
    }
  }
}

function updateSidebarUserAvatar() {
  const sidebarAvatar = document.getElementById("sidebarUserAvatar");
  if (!sidebarAvatar) return;

  if (currentUser.avatar) {
    sidebarAvatar.style.backgroundImage = `url('${currentUser.avatar}')`;
    sidebarAvatar.style.backgroundSize = "cover";
    sidebarAvatar.style.backgroundPosition = "center";
    sidebarAvatar.style.background = "";
    sidebarAvatar.textContent = "";
  } else {
    const initial = (currentUser.nama || "U").charAt(0).toUpperCase();
    const gradient = getAvatarGradient(currentUser.nama || "User");
    sidebarAvatar.style.backgroundImage = "none";
    sidebarAvatar.style.background = gradient;
    sidebarAvatar.style.display = "flex";
    sidebarAvatar.style.alignItems = "center";
    sidebarAvatar.style.justifyContent = "center";
    sidebarAvatar.style.color = "white";
    sidebarAvatar.style.fontWeight = "600";
    sidebarAvatar.style.fontSize = "1rem";
    sidebarAvatar.textContent = initial;
  }
}

function updateSendButtonVisibility() {
  const messageInput = document.getElementById("messageInput");
  const voiceBtn = document.getElementById("voiceNoteBtn");
  const sendBtn = document.querySelector(".send-btn");
  const recordingIndicator = document.getElementById("recordingIndicator");
  const fileInput = document.getElementById("fileInput");

  if (messageInput && voiceBtn && sendBtn) {
    if (
      recordingIndicator &&
      !recordingIndicator.classList.contains("hidden")
    ) {
      return;
    }

    const hasText = messageInput.value.trim().length > 0;
    const hasFile = fileInput && fileInput.files && fileInput.files.length > 0;

    if (hasText || hasFile) {
      voiceBtn.style.display = "none";
      sendBtn.style.display = "flex";
    } else {
      voiceBtn.style.display = "flex";
      sendBtn.style.display = "none";
    }
  }
}

function switchTab(tabName) {
  const tabOrder = ['gemini', 'groups', 'chats', 'status', 'calls'];
  const prevIndex = tabOrder.indexOf(currentTab);
  const newIndex = tabOrder.indexOf(tabName);
  const slideDirection = newIndex > prevIndex ? 'slide-right' : 'slide-left';

  document.querySelectorAll(".tab-content").forEach((tab) => {
    tab.classList.remove("active", "slide-left", "slide-right");
    tab.classList.add("hidden");
  });

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.remove("active");
  });

  const selectedTab = document.getElementById(`${tabName}-tab`);
  if (selectedTab) {
    selectedTab.classList.remove("hidden");
    selectedTab.classList.add("active", slideDirection);
  }

  const activeBtn = document.querySelector(`[data-tab="${tabName}"]`);
  if (activeBtn) {
    activeBtn.classList.add("active");
  }

  currentTab = tabName;

  
  if (tabName === "calls") {
    markMissedCallsAsSeen();
  }

  const appLayout = document.querySelector(".app-layout");
  const resizer = document.getElementById("sidebarResizer");

  if (tabName === "gemini") {
    if (appLayout) appLayout.classList.add("gemini-mode");
    if (resizer) resizer.classList.add("hidden");
  } else {
    if (appLayout) appLayout.classList.remove("gemini-mode");
    if (resizer) resizer.classList.remove("hidden");

    checkScreenSize();
  }
}


function toggleSearchBar() {
  if (typeof ContactsModal !== "undefined") {
    ContactsModal.open();
  }
}

function toggleUserMenu() {
  const userMenu = document.getElementById("userMenu");
  userMenu.classList.toggle("hidden");
}

function openProfile(e) {
  e.preventDefault();
  document.getElementById("userMenu").classList.add("hidden");

  const nameInput = document.getElementById("editNama");
  if (nameInput) nameInput.value = currentUser.nama;

  const passInput = document.getElementById("editPassword");
  if (passInput) passInput.value = "";

  const emailInput = document.getElementById("editEmail");
  if (emailInput)
    emailInput.textContent = currentUser.email || "user@example.com";

  const usernameDisplay = document.getElementById("profileUsernameDisplay");
  if (usernameDisplay)
    usernameDisplay.textContent = currentUser.username || "user";

  const avatarDisplay = document.getElementById("profileAvatarDisplay");
  const cameraIcon = document.getElementById("profilePhotoPreview");

  if (avatarDisplay && avatarDisplay.parentElement) {
    const container = avatarDisplay.parentElement;
    container.style.display = "flex";
    container.style.justifyContent = "center";
    container.style.alignItems = "center";
    container.style.position = "relative";
    container.style.width = "fit-content";
    container.style.margin = "0 auto";
  }

  if (cameraIcon) {
    cameraIcon.style.position = "absolute";
    cameraIcon.style.bottom = "5px";
    cameraIcon.style.right = "5px";
    cameraIcon.style.zIndex = "10";
  }

  if (
    currentUser.avatar &&
    currentUser.avatar !== "default" &&
    (currentUser.avatar.startsWith("data:") ||
      currentUser.avatar.startsWith("http"))
  ) {
    avatarDisplay.style = `
      background-image: url("${currentUser.avatar}") !important;
      background-size: cover !important;
      background-position: center !important;
      background-color: transparent !important;
      display: flex !important;
      margin: 0 auto !important;
    `;
    avatarDisplay.textContent = "";
  } else {
    const initial = currentUser.nama.charAt(0).toUpperCase();
    const gradient = getAvatarGradient(currentUser.nama || "User");
    avatarDisplay.style = `
      background: ${gradient} !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      color: white !important;
      font-weight: 600 !important;
      font-size: 1.5rem !important;
      margin: 0 auto !important;
    `;
    avatarDisplay.textContent = initial;
  }

  const modal = document.getElementById("profileModal");
  modal.classList.remove("hidden");
  
  
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      modal.classList.add("active");
    });
  });
}

function closeProfileModal() {
  const modal = document.getElementById("profileModal");
  modal.classList.add("hidden");
  modal.classList.remove("active");
}

async function saveProfile() {
  const newNama = document.getElementById("editNama").value;
  const newPass = document.getElementById("editPassword").value;
  const photoInput = document.getElementById("profilePhotoInput");
  const photoFile = photoInput ? photoInput.files[0] : null;
  const btn = document.getElementById("saveProfile");

  if (!newNama) return Toast.show("Nama tidak boleh kosong", "error");

  btn.disabled = true;
  btn.innerHTML =
    '<i data-feather="loader" class="spinner-animation"></i> Menyimpan...';

  try {
    let photoBase64 = null;

    if (photoFile) {
      photoBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(photoFile);
      });
    }

    const payload = {
      id: currentUser.id,
      nama: newNama,
    };

    if (newPass && newPass.trim() !== "") {
      payload.password = newPass;
    }

    if (photoBase64) {
      payload.avatar = photoBase64;
    }

    const res = await fetch(`${API_URL}/profile`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (data.success) {
      Toast.show("Profil berhasil disimpan", "success");
      currentUser = { ...currentUser, ...data.user };
      localStorage.setItem("currentUser", JSON.stringify(currentUser));

      if (photoInput) photoInput.value = "";

      closeProfileModal();
    } else {
      Toast.show(data.error || "Gagal menyimpan profil", "error");
    }
  } catch (err) {
    Toast.show("Terjadi kesalahan koneksi", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML =
      '<i data-feather="check" style="width: 18px; height: 18px; margin-right: 8px; vertical-align: -4px;"></i> Simpan';
    if (typeof feather !== "undefined") feather.replace();
  }
}

function logout(e) {
  if (e) e.preventDefault();
  localStorage.clear();
  window.location.href = "login.html";
}

function getAvatarGradient(name) {
  return "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";
}

function createGroupAvatarHTML(group, cssClass = "avatar small group-avatar") {
  const hasValidAvatar =
    group.avatar &&
    group.avatar !== "default" &&
    (group.avatar.startsWith("data:") || group.avatar.startsWith("http"));

  if (hasValidAvatar) {
    return `<div class="${cssClass}" style="position: relative; padding: 0; flex-shrink: 0; background: transparent !important; overflow: hidden !important;">
      <img src="${group.avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;" onerror="this.parentElement.innerHTML='<i data-feather=\\'users\\'></i>'; if(typeof feather !== 'undefined') feather.replace();">
    </div>`;
  } else {
    const gradient = getAvatarGradient(group.nama || "Group");
    return `<div class="${cssClass}" style="background: ${gradient} !important; display: flex !important; align-items: center !important; justify-content: center !important; color: white !important; flex-shrink: 0;"><i data-feather="users" style="width: 50%; height: 50%;"></i></div>`;
  }
}

function createAvatarHTML(user, cssClass = "avatar small", isOnline = false) {
  const onlineClass = isOnline ? "online" : "";
  const hasValidAvatar =
    user.avatar &&
    user.avatar !== "default" &&
    (user.avatar.startsWith("data:") || user.avatar.startsWith("http"));

  if (hasValidAvatar) {
    const initial = (user.nama || user.name || "U").charAt(0).toUpperCase();
    const gradient = getAvatarGradient(user.nama || user.name || "User");

    return `<div class="${cssClass} ${onlineClass}" style="position: relative; padding: 0; flex-shrink: 0; background: transparent !important; overflow: visible !important;">
      <div style="width: 100%; height: 100%; border-radius: 50%; overflow: hidden; position: relative;">
        <div style="width: 100%; height: 100%; position: absolute; top: 0; left: 0; background: ${gradient}; display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 1.2rem;">${initial}</div>
        <img src="${user.avatar}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'">
      </div>
    </div>`;
  } else {
    const initial = (user.nama || user.name || "U").charAt(0).toUpperCase();
    const gradient = getAvatarGradient(user.nama || user.name || "User");
    return `<div class="${cssClass} ${onlineClass}" style="background: ${gradient} !important; display: flex !important; align-items: center !important; justify-content: center !important; color: white !important; font-weight: 600 !important; flex-shrink: 0;">${initial}</div>`;
  }
}

const FRIENDS_CACHE_TTL = 2 * 60 * 1000;
let friendsFetchPromise = null;

function applyFriendsPayload(payload) {
  if (!payload) return;
  const { friends = [], requests = [] } = payload;
  window.allUsers = friends;
  window.allRequests = requests;

  updateContactBadge();

  if (window.ContactsModal && window.ContactsModal.isOpen) {
    const listContainer = document.getElementById("contactsList");
    if (listContainer) {
      window.ContactsModal.renderFullList(listContainer);
    }
  } else if (requests.length > 0) {
  }

  loadUnreadCounts();
  updateRecentChatsDisplay();
}

function updateContactBadge() {
  const badge = document.getElementById("contactsBadge");
  if (!badge) return;

  const count = window.allRequests ? window.allRequests.length : 0;
  if (count > 0) {
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

async function loadFriendsAndRequests(forceRefresh = false) {
  const cacheKey = `friends-cache-${currentUser.id}`;

  try {
    const cached = localStorage.getItem(cacheKey);
    if (!forceRefresh && cached) {
      const parsed = JSON.parse(cached);
      if (parsed.ts && Date.now() - parsed.ts < FRIENDS_CACHE_TTL) {
        applyFriendsPayload(parsed.data);
      }
    }
  } catch (err) {}

  if (friendsFetchPromise && !forceRefresh) {
    return friendsFetchPromise;
  }

  friendsFetchPromise = (async () => {
    try {
      const res = await fetch(`${API_URL}/friends/list/${currentUser.id}`);
      const data = await res.json();

      if (data.success) {
        applyFriendsPayload({ friends: data.friends, requests: data.requests });
        try {
          localStorage.setItem(
            cacheKey,
            JSON.stringify({
              ts: Date.now(),
              data: { friends: data.friends, requests: data.requests },
            })
          );
        } catch (err) {}
      }
    } catch (err) {
      Toast.show("Gagal memuat data teman", "error");
    } finally {
      friendsFetchPromise = null;
    }
  })();

  return friendsFetchPromise;
}

function setupSidebarResizer() {
  const sidebar = document.getElementById("sidebar");
  const resizer = document.getElementById("sidebarResizer");
  if (!sidebar || !resizer) return;

  const MIN = 300;
  const MAX = window.innerWidth * 0.8;
  let startX = 0;
  let startWidth = 0;
  let dragging = false;

  const applyWidth = (w) => {
    const clamped = Math.min(MAX, Math.max(MIN, w));
    sidebar.style.width = `${clamped}px`;
  };

  resizer.addEventListener("mousedown", (e) => {
    dragging = true;
    startX = e.clientX;
    startWidth = sidebar.getBoundingClientRect().width;
    document.body.style.userSelect = "none";
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const delta = e.clientX - startX;
    applyWidth(startWidth + delta);
  });

  window.addEventListener("mouseup", () => {
    if (dragging) {
      dragging = false;
      document.body.style.userSelect = "";
    }
  });
}

function searchUsers(query) {
  if (!query) {
    if (currentTab === "chats") {
      updateRecentChatsDisplay();
    } else if (currentTab === "groups") {
      displayGroups();
    } else if (currentTab === "status") {
      displayStatusUpdates();
    } else if (currentTab === "calls") {
      displayCallHistory();
    }
    return;
  }

  if (searchTimeout) clearTimeout(searchTimeout);

  searchTimeout = setTimeout(async () => {
    try {
      const listId =
        currentTab === "chats"
          ? "recentChatsList"
          : currentTab === "groups"
          ? "groupsList"
          : "recentChatsList";
      const list = document.getElementById(listId);

      if (list) {
        list.innerHTML = '<div class="search-center-padding">Mencari...</div>';
      }

      const res = await fetch(
        `${API_URL}/users/search?query=${query}&currentUserId=${currentUser.id}`
      );
      const data = await res.json();

      if (data.success) {
        if (currentTab === "chats" || currentTab === "groups") {
          displaySearchResultsInTab(data.users, currentTab);
        }
      }
    } catch (err) {
      console.error("Search error:", err);
    }
  }, 300);
}

function displaySearchResultsInTab(users, tab) {
  const listId = tab === "chats" ? "recentChatsList" : "groupsList";
  const list = document.getElementById(listId);

  if (!list) return;

  list.innerHTML = "";

  if (!users || users.length === 0) {
    list.innerHTML =
      '<div class="search-not-found">Pengguna tidak ditemukan</div>';
    return;
  }

  users.forEach((user) => {
    const div = document.createElement("div");
    div.className = "list-item chat-item";
    div.id = `search-user-${user.username}`;

    const isOnline =
      window.userStatusMap && window.userStatusMap[user.username] === "online";
    const onlineClass = isOnline ? "online" : "";

    let lastMessageText = "";
    let lastMessageTime = "";
    if (user.isFriend) {
      const lastMsg = getLastMessageForUser(user._id);
      lastMessageText = lastMsg ? lastMsg.message : "Tap to start chatting";
      lastMessageTime = lastMsg ? formatMessageTime(lastMsg.timestamp) : "";
    }

    let actionButton = "";
    if (user.isFriend) {
      actionButton = ``;
    } else if (user.isPending) {
      actionButton = `<button class="icon-btn search-user-pending">Pending ⏳</button>`;
    } else {
      actionButton = `<button onclick="sendFriendRequest(event, '${user._id}')" class="icon-btn search-add-button">
                        <i data-feather="user-plus"></i>
                      </button>`;
    }

    div.innerHTML = `
      ${createAvatarHTML(user, "avatar small", isOnline)}
      <div class="chat-item-info">
        <h4>${user.nama}</h4>
        <small class="search-username-small">@${user.username}</small>
        <small>${lastMessageText}</small>
      </div>
      <div class="search-last-message">${lastMessageTime}</div>
      ${actionButton}
    `;

    if (user.isFriend) {
      div.onclick = () => selectUser(user);
    }

    list.appendChild(div);
  });

  if (typeof feather !== "undefined") feather.replace();
}

async function sendFriendRequest(e, targetId) {
  e.stopPropagation();

  const btn = e.currentTarget;
  const originalContent = btn.innerHTML;
  btn.innerHTML = "⏳";

  try {
    const res = await fetch(`${API_URL}/friends/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromId: currentUser._id || currentUser.id,
        toId: targetId,
      }),
    });

    const data = await res.json();

    if (data.success) {
      Toast.show("Permintaan terkirim!", "success");
      btn.innerHTML = "Pending ⏳";
      btn.disabled = true;
      btn.style.cursor = "default";
      btn.classList.add("disabled");

      const userItem = document.querySelector(
        `#search-user-${data.targetUsername}`
      );
      if (userItem) {
        const btnContainer = userItem.querySelector("button");
        if (btnContainer) {
          btnContainer.innerHTML = "Pending ⏳";
          btnContainer.disabled = true;
          btnContainer.classList.add("disabled");
        }
      }
    } else {
      Toast.show(data.error || "Gagal mengirim request", "error");
      btn.innerHTML = originalContent;
      if (typeof feather !== "undefined") feather.replace();
    }
  } catch (err) {
    console.error("Send friend request error:", err);
    Toast.show("Gagal mengirim request (Koneksi)", "error");
    btn.innerHTML = originalContent;
    if (typeof feather !== "undefined") feather.replace();
  }
}

async function respondFriend(requesterId, action) {
  const endpoint = action === "accept" ? "/friends/accept" : "/friends/reject";

  const prevRequests = window.allRequests ? [...window.allRequests] : [];
  const prevFriends = window.allUsers ? [...window.allUsers] : [];

  try {
    if (window.event && window.event.target) {
      const btn = window.event.target.closest(".contact-action-btn");
      if (btn) {
        const item = btn.closest(".contact-item");
        if (item) item.style.display = "none";
      }
    }
  } catch (e) {}

  try {
    let newRequests = [...prevRequests];
    let newFriends = [...prevFriends];

    const reqIndex = newRequests.findIndex((req) => {
      const fromId = req.from && (req.from._id || req.from);
      return fromId && fromId.toString() === requesterId.toString();
    });

    if (reqIndex !== -1) {
      const request = newRequests[reqIndex];
      newRequests.splice(reqIndex, 1);

      if (action === "accept") {
        const friendData = request.from;
        const newFriend = { ...friendData, isFriend: true, isPending: false };

        if (
          !newFriends.find((u) => u._id.toString() === newFriend._id.toString())
        ) {
          newFriends.push(newFriend);
        }
      }
    }

    applyFriendsPayload({ friends: newFriends, requests: newRequests });

    const res = await fetch(`${API_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: currentUser.id, requesterId }),
    });

    const data = await res.json();
    if (data.success) {
      setTimeout(() => loadFriendsAndRequests(true), 500);
    } else {
      throw new Error(data.error);
    }
  } catch (err) {
    applyFriendsPayload({ friends: prevFriends, requests: prevRequests });
    Toast.show("Gagal memproses permintaan", "error");
  }
}

window.respondFriend = respondFriend;

function selectUser(user) {
  selectedUser = user;
  selectedGroup = null;

  if (
    document.getElementById("viewStatusModal") &&
    !document.getElementById("viewStatusModal").classList.contains("hidden")
  ) {
    closeStatusViewer();
  }
  if (
    document.getElementById("createStatusModal") &&
    !document.getElementById("createStatusModal").classList.contains("hidden")
  ) {
    closeCreateStatusModal();
  }

  clearUnread(user.username);

  if (window.innerWidth > 768) {
    const sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.style.width = "380px";
  }

  const isMobile = window.innerWidth <= 768;

  if (isMobile) {
    document.getElementById("sidebar").classList.add("hidden-mobile");
    document.getElementById("chatArea").classList.add("active");
  }

  document.getElementById("welcomeScreen").classList.add("hidden");
  document.getElementById("chatRoom").classList.remove("hidden");

  document.getElementById("chatName").textContent = user.nama;

  const chatAvatarEl = document.getElementById("chatAvatar");
  const hasValidAvatar =
    user.avatar &&
    user.avatar !== "default" &&
    (user.avatar.startsWith("data:") || user.avatar.startsWith("http"));

  if (hasValidAvatar) {
    chatAvatarEl.setAttribute(
      "style",
      `
      background-image: url("${user.avatar}") !important;
      background-size: cover !important;
      background-position: center !important;
      background-color: transparent !important;
      display: block !important;
      flex-shrink: 0;
    `
    );
    chatAvatarEl.textContent = "";
  } else {
    const initial = user.nama.charAt(0).toUpperCase();
    const gradient = getAvatarGradient(user.nama || "User");
    chatAvatarEl.style.backgroundImage = "none";
    chatAvatarEl.style.background = gradient;
    chatAvatarEl.style.display = "flex";
    chatAvatarEl.style.alignItems = "center";
    chatAvatarEl.style.justifyContent = "center";
    chatAvatarEl.style.color = "white";
    chatAvatarEl.style.fontWeight = "600";
    chatAvatarEl.style.fontSize = "1.2rem";
    chatAvatarEl.textContent = initial;
    chatAvatarEl.style.flexShrink = "0";
  }

  updateChatStatusHeader();

  document
    .querySelectorAll(".user-item")
    .forEach((el) => el.classList.remove("active"));
  document
    .querySelectorAll(".chat-item")
    .forEach((el) => el.classList.remove("active"));
  document
    .querySelectorAll(".group-item")
    .forEach((el) => el.classList.remove("active"));

  const activeItem = document.getElementById(`user-item-${user.username}`);
  if (activeItem) activeItem.classList.add("active");

  const activeChatItem = document.getElementById(`chat-item-${user.username}`);
  if (activeChatItem) activeChatItem.classList.add("active");

  document
    .getElementById("menuOpenProfile")
    ?.style.setProperty("display", "flex", "important");
  document
    .getElementById("menuGroupSettings")
    ?.style.setProperty("display", "none", "important");

  const chatInfoEl = document.querySelector("#chatRoom .chat-info");
  if (chatInfoEl) {
    chatInfoEl.onclick = () => showUserProfilePopup(user);
  }

  loadMessages(user.username);
}

function closeChat() {
  selectedUser = null;
  selectedGroup = null;

  if (window.innerWidth > 768) {
    const sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.style.width = "50%";
  }

  const isMobile = window.innerWidth <= 768;

  if (isMobile) {
    document.getElementById("sidebar").classList.remove("hidden-mobile");
    document.getElementById("chatArea").classList.remove("active");
  }

  document.getElementById("welcomeScreen").classList.remove("hidden");
  document.getElementById("chatRoom").classList.add("hidden");

  document
    .querySelectorAll(".user-item")
    .forEach((el) => el.classList.remove("active"));
  document
    .querySelectorAll(".chat-item")
    .forEach((el) => el.classList.remove("active"));
  document
    .querySelectorAll(".group-item")
    .forEach((el) => el.classList.remove("active"));
}

async function loadMessages(otherUser) {
  const container = document.getElementById("messagesContainer");
  container.innerHTML = '<div class="loading-messages">Memuat pesan...</div>';

  try {
    const res = await fetch(
      `${API_URL}/messages/${currentUser.username}/${otherUser}`
    );
    const data = await res.json();
    container.innerHTML = "";

    if (data.messages.length === 0) {
      container.innerHTML =
        '<div class="empty-chat-message">Belum ada pesan. Sapa dia! 👋</div>';

      const cacheKey = `lastMsg-${currentUser.id}-${selectedUser._id}`;
      if (localStorage.getItem(cacheKey)) {
        localStorage.removeItem(cacheKey);
        updateRecentChatsDisplay();
      }
    } else {
      data.messages.forEach(addMessageToUI);
    }
    scrollToBottom();
  } catch (err) {
    container.innerHTML =
      '<div style="text-align:center; padding:20px; color:#ef4444;">Gagal memuat pesan.</div>';
  }
}

function sendMessage() {
  if (selectedGroup) {
    sendGroupMessage();
  } else if (selectedUser) {
    sendPrivateMessage();
  }

  const messageInput = document.getElementById("messageInput");
  if (messageInput) {
    updateSendButtonVisibility();
  }
}

function sendPrivateMessage() {
  const input = document.getElementById("messageInput");
  const msg = input.value.trim();
  const fileInput = document.getElementById("fileInput");
  const file = fileInput.files[0];

  const tempId = `temp-${Date.now()}-${Math.random()}`;

  if ((!msg && !file) || !selectedUser) return;

  if (file) {
    if (!isFileTypeAllowed(file.type)) {
      Toast.show("Tipe file tidak diizinkan", "error");
      clearFile();
      return;
    }

    if (file.size > FILE_MAX_BYTES) {
      Toast.show("File terlalu besar (Maks 10MB)", "error");
      clearFile();
      return;
    }

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const payload = {
        from: currentUser.username,
        to: selectedUser.username,
        message: msg,
        file: {
          name: file.name,
          type: file.type,
          size: file.size,
          data: reader.result,
        },
      };
      payload.tempId = tempId;
      if (currentReplyContext) {
        payload.replyTo = currentReplyContext;
      }
      socket.emit("send_message", payload);

      addMessageToUI({
        ...payload,
        timestamp: new Date().toISOString(),
        _id: tempId,
      });

      const displayMsg = msg || `📎 ${file.name}`;
      saveLastMessage(selectedUser._id, displayMsg, new Date(), tempId);
      input.value = "";
      clearFile();
      if (currentReplyContext) cancelReply();
    };
  } else {
    const payload = {
      from: currentUser.username,
      to: selectedUser.username,
      message: msg,
    };
    payload.tempId = tempId;
    if (currentReplyContext) {
      payload.replyTo = currentReplyContext;
    }
    socket.emit("send_message", payload);

    addMessageToUI({
      ...payload,
      timestamp: new Date().toISOString(),
      _id: tempId,
    });

    saveLastMessage(selectedUser._id, msg, new Date(), tempId);
    input.value = "";

    if (currentReplyContext) cancelReply();
    updateSendButtonVisibility();
  }
}

function compressImage(file, callback, maxWidth = 800, maxHeight = 800) {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = (event) => {
    const img = new Image();
    img.src = event.target.result;
    img.onload = () => {
      const canvas = document.createElement("canvas");
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
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      let compressedBase64 = canvas.toDataURL("image/jpeg", 0.4);

      if (compressedBase64.length > 300000) {
        compressedBase64 = canvas.toDataURL("image/jpeg", 0.2);
      }

      if (compressedBase64.length > 200000) {
        compressedBase64 = canvas.toDataURL("image/jpeg", 0.1);
      }

      callback(compressedBase64);
    };
  };
}

function addMessageToUI(msg) {
  const container = document.getElementById("messagesContainer");

  if (msg.isDeleted) {
    const isMe = msg.from === currentUser.username;
    const div = document.createElement("div");
    div.id = `message-${msg._id}`;
    div.className = `message ${isMe ? "outgoing" : "incoming"}`;

    let deletedContent = `<p class="deleted-message">${
      msg.message || "Pesan ini telah dihapus"
    }</p>`;
    deletedContent += `<span class="msg-time">${new Date(
      msg.timestamp
    ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>`;

    div.innerHTML = deletedContent;
    container.appendChild(div);
    scrollToBottom();

    if (selectedUser) {
      saveLastMessage(
        selectedUser._id,
        "Pesan ini telah dihapus",
        msg.timestamp,
        msg._id
      );
    }
    return;
  }

  if (
    container.innerText.includes("Belum ada pesan") ||
    container.innerText.includes("Memuat") ||
    container.innerText.includes("Gagal")
  ) {
    container.innerHTML = "";
  }

  if (!msg._id) {
    msg._id = `${msg.from}-${msg.timestamp}`;
  }

  const isMe = msg.from === currentUser.username;
  const div = document.createElement("div");
  div.id = `message-${msg._id}`;
  div.dataset.messageId = msg._id;

  let senderDisplayName = "";
  if (isMe) {
    senderDisplayName = currentUser.nama;
  } else if (selectedUser) {
    senderDisplayName = selectedUser.nama;
  } else {
    senderDisplayName = msg.from;
  }
  div.dataset.senderName = senderDisplayName;

  const hasImage =
    msg.file &&
    msg.file.data &&
    msg.file.type &&
    msg.file.type.startsWith("image/");
  const fileOnly = msg.file && msg.file.data && !msg.message && !hasImage;

  if (hasImage && !msg.message) {
    div.className = `message-img ${isMe ? "outgoing" : "incoming"}`;
  } else {
    div.className = `message ${isMe ? "outgoing" : "incoming"}${
      fileOnly ? " file-only" : ""
    }`;
  }

  let content = "";

  if (msg.replyTo) {
    const isStatus =
      msg.replyTo.messageId && msg.replyTo.messageId.startsWith("status-");

    const clickAction =
      isStatus && msg.replyTo.userId
        ? `viewStatus('${msg.replyTo.userId}', '${msg.replyTo.messageId.replace(
            "status-",
            ""
          )}')`
        : `scrollToMessage(event, '${msg.replyTo.messageId}')`;

    let mediaHtml = "";
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
    if (msg.file.type && msg.file.type.startsWith("audio/")) {
      const audioId = `audio-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;
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
    } else if (msg.file.type && msg.file.type.startsWith("image/")) {
      content += `<img src="${msg.file.data}" class="msg-img" onclick="openImagePreview(this.src)" style="cursor: pointer;">`;
    } else {
      content += `<div class="file-bubble">
                    <a href="${msg.file.data}" download="${
        msg.file.name || "file"
      }" class="file-bubble-link">
                      <i data-feather="${getFileIcon(msg.file.type)}"></i> 
                      <span class="file-bubble-text">
                        <span>${msg.file.name || "Download File"}</span>
                        <small>${
                          msg.file.size ? formatBytes(msg.file.size) : ""
                        } ${msg.file.type ? "• " + msg.file.type : ""}</small>
                      </span>
                    </a>
                  </div>`;
    }
  }

  if (msg.message) {
    content += `<p style="margin:0;">${escapeHtml(msg.message)}</p>`;
  }
  content += `<span class="msg-time">${new Date(
    msg.timestamp
  ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>`;

  div.innerHTML = content;
  container.appendChild(div);

  if (
    msg.file &&
    msg.file.data &&
    msg.file.type &&
    msg.file.type.startsWith("audio/")
  ) {
    const audioElements = div.querySelectorAll('[id^="audio-"]');
    if (audioElements.length > 0) {
      const audioId = audioElements[0].id.replace("audio-element-", "");
      initializeWaveform(audioId, msg.file.data);
    }
  }

  if (typeof feather !== "undefined") feather.replace();
  scrollToBottom();

  if (selectedUser) {
    const messageText =
      msg.message ||
      (msg.file && msg.file.type && msg.file.type.startsWith("audio/")
        ? "🎤 Voice note"
        : "") ||
      (msg.file && msg.file.name ? `📎 ${msg.file.name}` : "");
    saveLastMessage(selectedUser._id, messageText, msg.timestamp, msg._id);
  }
}

function scrollToBottom() {
  const container = document.getElementById("messagesContainer");
  container.scrollTop = container.scrollHeight;
}

const fileInput = document.getElementById("fileInput");
if (fileInput) {
  fileInput.addEventListener("change", function () {
    if (this.files[0]) {
      const file = this.files[0];
      if (!isFileTypeAllowed(file.type)) {
        Toast.show("Tipe file tidak diizinkan", "error");
        clearFile();
        return;
      }

      if (file.size > FILE_MAX_BYTES) {
        Toast.show("File terlalu besar (Maks 10MB)", "error");
        clearFile();
        return;
      }

      const preview = document.getElementById("filePreview");
      const nameEl = document.getElementById("fileName");
      const metaEl = document.getElementById("fileMeta");
      const iconEl = document.querySelector("#filePreview i");

      if (preview) preview.classList.remove("hidden");
      if (nameEl) nameEl.textContent = file.name;
      if (metaEl)
        metaEl.textContent = `${formatBytes(file.size)} • ${
          file.type || "file"
        }`;
      if (iconEl) {
        iconEl.setAttribute("data-feather", getFileIcon(file.type));
        if (typeof feather !== "undefined") feather.replace();
      }

      updateSendButtonVisibility();
    }
  });
}

function clearFile() {
  const fi = document.getElementById("fileInput");
  if (fi) {
    fi.value = "";
    fi.files = null;
  }
  const preview = document.getElementById("filePreview");
  if (preview) {
    preview.classList.add("hidden");
    document.getElementById("fileName").textContent = "";
    const metaEl = document.getElementById("fileMeta");
    if (metaEl) metaEl.textContent = "";
  }

  updateSendButtonVisibility();
}

function addToChatHistory(id, name, message, isGroup, messageId, timestamp, senderDisplayName) {
  const truncated =
    message.length > 50 ? message.substring(0, 50) + "..." : message;

  if (!chatHistory[id]) {
    chatHistory[id] = {
      name: name,
      lastMessage: truncated,
      timestamp: timestamp || new Date(),
      unreadCount: 0,
      isGroup: isGroup,
    };
  } else {
    chatHistory[id].lastMessage = truncated;
    chatHistory[id].timestamp = new Date(timestamp);
  }

  if (isGroup) {
    saveLastMessageGroup(id, truncated, timestamp || new Date(), messageId, senderDisplayName);
  } else {
    const user = window.allUsers
      ? window.allUsers.find((u) => u.username === id)
      : null;
    const targetId = user ? user._id : id;
    saveLastMessage(targetId, truncated, timestamp || new Date(), messageId);
  }

  updateRecentChatsDisplay();
}

function incrementUnread(id, isExplicitGroup = null) {
  
  const isGroupId = isExplicitGroup !== null ? isExplicitGroup : (allGroups && allGroups.some(g => g._id === id));
  
  if (chatHistory[id]) {
    chatHistory[id].unreadCount = (chatHistory[id].unreadCount || 0) + 1;
    if (isExplicitGroup !== null || chatHistory[id].isGroup === undefined) {
      chatHistory[id].isGroup = isGroupId;
    }
  } else {
    
    chatHistory[id] = {
      unreadCount: 1,
      isGroup: isGroupId
    };
  }

  saveUnreadCount(id, chatHistory[id]?.unreadCount || 0);
  updateTotalUnreadBadge();
  updateGroupsBadge();
  updateRecentChatsDisplay();
  displayGroupsDebounced(); // Ensure group list updates to show badge (debounced)
}


function clearUnread(id) {
  if (chatHistory[id]) {
    chatHistory[id].unreadCount = 0;
  }

  saveUnreadCount(id, 0);
  updateTotalUnreadBadge();
  updateGroupsBadge();
  updateRecentChatsDisplay();
  displayGroupsDebounced(); // Force refresh group list to remove badge (debounced)
}

function saveUnreadCount(id, count) {
  try {
    const unreadMap = JSON.parse(localStorage.getItem("unreadCounts") || "{}");
    unreadMap[id] = count;
    localStorage.setItem("unreadCounts", JSON.stringify(unreadMap));
  } catch (err) {
    console.error("Error saving unread count:", err);
  }
}

function loadUnreadCounts() {
  try {
    const unreadMap = JSON.parse(localStorage.getItem("unreadCounts") || "{}");

    Object.keys(unreadMap).forEach((id) => {
      
      const isGroupId = allGroups && allGroups.some(g => g._id === id);
      
      if (!chatHistory[id]) {
        chatHistory[id] = {
          unreadCount: unreadMap[id] || 0,
          isGroup: isGroupId
        };
      } else {
        chatHistory[id].unreadCount = unreadMap[id];
        
        if (chatHistory[id].isGroup === undefined) {
          chatHistory[id].isGroup = isGroupId;
        }
      }
    });
    updateTotalUnreadBadge();
    updateGroupsBadge();
    updateCallsBadge();
    console.log("Loaded unread counts from localStorage:", unreadMap);
  } catch (err) {
    console.error("Error loading unread counts:", err);
  }
}



function updateTotalUnreadBadge() {
  let totalUnread = 0;
  if (chatHistory) {
    Object.values(chatHistory).forEach((chat) => {
      
      if (chat.unreadCount && !chat.isGroup) {
        totalUnread += chat.unreadCount;
      }
    });
  }

  const chatsTabBtn = document.querySelector('.tab-btn[data-tab="chats"]');
  if (!chatsTabBtn) return;

  const existingBadge = chatsTabBtn.querySelector(".tab-badge");
  if (existingBadge) existingBadge.remove();

  if (totalUnread > 0) {
    const badge = document.createElement("span");
    badge.className = "tab-badge";
    badge.textContent = totalUnread > 99 ? "99+" : totalUnread;
    chatsTabBtn.appendChild(badge);
  }
}



function updateGroupsBadge() {
  let totalUnreadGroups = 0;
  
  if (chatHistory) {
    Object.entries(chatHistory).forEach(([id, chat]) => {
      if (chat.isGroup && chat.unreadCount) {
        totalUnreadGroups += chat.unreadCount;
      }
    });
  }

  const groupsTabBtn = document.querySelector('.tab-btn[data-tab="groups"]');
  if (!groupsTabBtn) return;

  const existingBadge = groupsTabBtn.querySelector(".tab-badge");
  if (existingBadge) existingBadge.remove();

  if (totalUnreadGroups > 0) {
    const badge = document.createElement("span");
    badge.className = "tab-badge";
    badge.textContent = totalUnreadGroups > 99 ? "99+" : totalUnreadGroups;
    groupsTabBtn.appendChild(badge);
  }
}


function updateCallsBadge() {
  let missedCallsCount = 0;
  
  try {
    const stored = JSON.parse(
      localStorage.getItem(`callHistory-${currentUser?.username}`) || "[]"
    );
    
    
    const unviewedMissedCalls = localStorage.getItem(`missedCallsSeen-${currentUser?.username}`);
    const seenTimestamp = unviewedMissedCalls ? parseInt(unviewedMissedCalls) : 0;
    
    stored.forEach((call) => {
      if (call.status === "missed" && call.direction === "incoming") {
        const callTime = new Date(call.timestamp).getTime();
        if (callTime > seenTimestamp) {
          missedCallsCount++;
        }
      }
    });
  } catch (err) {
    console.error("Error counting missed calls:", err);
  }

  const callsTabBtn = document.querySelector('.tab-btn[data-tab="calls"]');
  if (!callsTabBtn) return;

  const existingBadge = callsTabBtn.querySelector(".tab-badge");
  if (existingBadge) existingBadge.remove();

  if (missedCallsCount > 0) {
    const badge = document.createElement("span");
    badge.className = "tab-badge";
    badge.textContent = missedCallsCount > 99 ? "99+" : missedCallsCount;
    callsTabBtn.appendChild(badge);
  }
}


function markMissedCallsAsSeen() {
  if (currentUser?.username) {
    localStorage.setItem(`missedCallsSeen-${currentUser.username}`, Date.now().toString());
    updateCallsBadge();
  }
}

function buildRecentChatsFromStorage() {
  recentChats = [];

  if (window.allUsers) {
    window.allUsers.forEach((user) => {
      const lastMsg = getLastMessageForUser(user._id);

      recentChats.push({
        id: user.username,
        name: user.nama,
        lastMessage: lastMsg ? lastMsg.message : "Ketuk untuk memulai chat",
        timestamp: lastMsg ? new Date(lastMsg.timestamp) : new Date(0),
        isGroup: false,
        user: user,
      });
    });
  }

  if (window.allGroups) {
    window.allGroups.forEach((group) => {
      const lastMsg = getLastMessageForGroup(group._id);
      if (lastMsg) {
        recentChats.push({
          id: group._id,
          name: group.nama,
          lastMessage: lastMsg.message,
          timestamp: new Date(lastMsg.timestamp),
          isGroup: true,
          group: group,
        });
      }
    });
  }

  recentChats.sort((a, b) => b.timestamp - a.timestamp);
}

function getLastMessageForGroup(groupId) {
  try {
    const storage = localStorage.getItem(
      `lastMsg-${currentUser.id}-group-${groupId}`
    );
    if (storage) return JSON.parse(storage);
  } catch (err) {}
  return null;
}

function saveLastMessageGroup(groupId, message, timestamp, messageId, senderName) {
  try {
    const lastMsg = { message, timestamp, id: messageId, senderName };
    localStorage.setItem(
      `lastMsg-${currentUser.id}-group-${groupId}`,
      JSON.stringify(lastMsg)
    );
  } catch (err) {}
}

function updateRecentChatsDisplay() {
  const list = document.getElementById("recentChatsList");
  if (!list) return;

  buildRecentChatsFromStorage();

  list.innerHTML = "";

  if (recentChats.length === 0) {
    list.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center; color: var(--text-secondary);">
        <i data-feather="message-square" style="width: 48px; height: 48px; margin-bottom: 12px; opacity: 0.5;"></i>
        <p>Belum ada chat. Mulai percakapan!</p>
      </div>`;
    if (typeof feather !== "undefined") feather.replace();
    return;
  }

  recentChats.forEach((chat) => {
    const div = document.createElement("div");
    div.className = "list-item chat-item";
    div.id = `chat-item-${chat.id}`;

    const isActive =
      (selectedUser && selectedUser.username === chat.id) ||
      (selectedGroup && selectedGroup._id === chat.id);

    if (isActive) div.classList.add("active");

    const timeText =
      chat.timestamp.getTime() > 0 ? formatMessageTime(chat.timestamp) : "";

    const isOnline =
      !chat.isGroup &&
      window.userStatusMap &&
      window.userStatusMap[chat.id] === "online";

    let avatarHTML;
    let avatarContent;
    if (chat.isGroup) {
      if (chat.group) {
        avatarContent = createGroupAvatarHTML(chat.group, `avatar small ${isOnline ? "online" : ""} group-avatar`);
      } else {
        avatarContent = `<div class="avatar small ${isOnline ? "online" : ""} group-avatar" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important; display: flex !important; align-items: center !important; justify-content: center !important; color: white !important; flex-shrink: 0;"><i data-feather="users" style="width: 50%; height: 50%;"></i></div>`;
      }
    } else {
      if (chat.user) {
        avatarContent = createAvatarHTML(chat.user, "avatar small", isOnline);
      } else {
        avatarContent = `<div class="avatar small ${
          isOnline ? "online" : ""
        }">${chat.name.charAt(0).toUpperCase()}</div>`;
      }
    }

    if (
      !chat.isGroup &&
      chat.user &&
      currentStatuses &&
      currentStatuses[chat.user._id]
    ) {
      avatarHTML = `<div class="avatar-container-ring" onclick="event.stopPropagation(); viewStatus('${chat.user._id}')">
          <div class="status-ring"></div>
          ${avatarContent}
      </div>`;
    } else {
      avatarHTML = `<div class="chat-avatar-wrapper">${avatarContent}</div>`;
    }

    const unreadCount = chatHistory[chat.id]?.unreadCount || 0;
    const badgeHTML =
      unreadCount > 0
        ? `<span class="unread-badge">${
            unreadCount > 99 ? "99+" : unreadCount
          }</span>`
        : "";

    div.innerHTML = `
      ${avatarHTML}
      <div class="chat-item-info">
        <h4>${chat.name}</h4>
        <small class="last-message-small" ${
          chat.lastMessage === "Pesan ini telah dihapus"
            ? 'style="font-style: italic; opacity: 0.7;"'
            : ""
        }>${chat.lastMessage}</small>
      </div>
      <div class="last-message-time">
        <span>${timeText}</span>
        ${badgeHTML}
      </div>
    `;

    if (!chat.isGroup && isOnline) {
      const avatar = div.querySelector(".avatar.small");
      if (avatar && !avatar.classList.contains("online")) {
        avatar.classList.add("online");
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

  if (typeof feather !== "undefined") feather.replace();
}

socket.on("message_sent", (msg) => {
  if (msg.tempId) {
    const tempElement = document.getElementById(`message-${msg.tempId}`);
    if (tempElement) {
      tempElement.id = `message-${msg._id}`;
      tempElement.dataset.messageId = msg._id;
    }
  }

  const summaryText =
    msg.message ||
    (msg.file && msg.file.name ? `📎 ${msg.file.name}` : "Pesan media");
  if (msg.groupId) {
    addToChatHistory(
      msg.groupId,
      selectedGroup?.nama || "Group",
      summaryText,
      true,
      msg._id,
      msg.timestamp
    );
  } else {
    addToChatHistory(
      msg.to,
      selectedUser?.nama || msg.to,
      summaryText,
      false,
      msg._id,
      msg.timestamp
    );
  }
});

socket.on("message_error", (payload) => {
  const message = payload?.error || "Gagal mengirim pesan";
  Toast.show(message, "error");
});

socket.on("connect", () => {
  socket.emit("get_online_users");
});

socket.on("online_users_list", (users) => {
  window.userStatusMap = window.userStatusMap || {};

  if (window.allUsers) {
    window.allUsers.forEach((user) => {
      window.userStatusMap[user.username] = "offline";
    });
  }

  users.forEach((username) => {
    window.userStatusMap[username] = "online";
  });

  users.forEach((username) => {
    const chatItem = document.getElementById(`chat-item-${username}`);
    if (chatItem) {
      const avatar = chatItem.querySelector(".avatar.small");
      if (avatar) avatar.classList.add("online");
    }

    const userItem = document.getElementById(`user-item-${username}`);
    if (userItem) {
      const avatar = userItem.querySelector(".avatar.small");
      if (avatar) avatar.classList.add("online");
    }
  });

  if (window.allUsers) {
    window.allUsers.forEach((user) => {
      if (!users.includes(user.username)) {
        const chatItem = document.getElementById(`chat-item-${user.username}`);
        if (chatItem) {
          const avatar = chatItem.querySelector(".avatar.small");
          if (avatar) avatar.classList.remove("online");
        }

        const userItem = document.getElementById(`user-item-${user.username}`);
        if (userItem) {
          const avatar = userItem.querySelector(".avatar.small");
          if (avatar) avatar.classList.remove("online");
        }
      }
    });
  }

  updateRecentChatsDisplay();

  if (window.ContactsModal && window.ContactsModal.currentUsers) {
    window.ContactsModal.renderUserList(window.ContactsModal.currentUsers);
  }
});

socket.on("user_status_change", (data) => {
  const statusEl = document.getElementById(`status-${data.username}`);
  if (statusEl) statusEl.className = `user-status ${data.status}`;

  window.userStatusMap = window.userStatusMap || {};
  window.userStatusMap[data.username] = data.status;

  if (selectedUser && selectedUser.username === data.username) {
    if (data.status === "offline") {
      selectedUser.lastSeen = new Date();
    }
    updateChatStatusHeader();
  }

  const chatItem = document.getElementById(`chat-item-${data.username}`);
  if (chatItem) {
    const avatar = chatItem.querySelector(".avatar.small");
    if (avatar) {
      if (data.status === "online") {
        avatar.classList.add("online");
      } else {
        avatar.classList.remove("online");
      }
    }
  }

  const userItem = document.getElementById(`user-item-${data.username}`);
  if (userItem) {
    const avatar = userItem.querySelector(".avatar.small");
    if (avatar) {
      if (data.status === "online") {
        avatar.classList.add("online");
      } else {
        avatar.classList.remove("online");
      }
    }
  }

  if (window.ContactsModal && window.ContactsModal.currentUsers) {
    window.ContactsModal.renderUserList(window.ContactsModal.currentUsers);
  }

  setTimeout(() => {
    updateRecentChatsDisplay();
  }, 50);
});

socket.on("new_friend_request", (data) => {
  loadFriendsAndRequests(true);
});

socket.on("friend_request_accepted", (data) => {
  Toast.show(`${data.user.nama} menerima permintaan pertemanan!`, "success");
  loadFriendsAndRequests(true);
});


socket.on("user_updated_by_admin", (data) => {
  if (data.passwordReset) {
    Toast.show("Password Anda telah direset oleh admin. Silakan login kembali.", "warning");
    setTimeout(() => {
      localStorage.removeItem("currentUser");
      window.location.href = "/login.html";
    }, 2000);
  } else if (data.email) {
    
    const user = JSON.parse(localStorage.getItem("currentUser"));
    if (user) {
      user.email = data.email;
      localStorage.setItem("currentUser", JSON.stringify(user));
    }
  }
});

socket.on("user_typing", (data) => {
  if (selectedUser && selectedUser.username === data.from) {
    document.getElementById("chatStatus").innerHTML =
      '<em class="typing-indicator">sedang mengetik...</em>';

    if (window.typingTimeout) clearTimeout(window.typingTimeout);
    window.typingTimeout = setTimeout(() => {
      updateChatStatusHeader();
    }, 3000);
  }

  const chatItem = document.getElementById(`chat-item-${data.from}`);
  if (chatItem) {
    const msg = chatItem.querySelector("small");
    if (msg) {
      msg.innerHTML = `<i class="typing-indicator-icon"></i> sedang mengetik...`;
      if (typeof feather !== "undefined") feather.replace();
    }
  }
});

socket.on("stop_typing", (data) => {
  if (chatHistory[data.from]) {
    const chatItem = document.getElementById(`chat-item-${data.from}`);
    if (chatItem) {
      const msg = chatItem.querySelector("small");
      if (msg) {
        msg.textContent = chatHistory[data.from].lastMessage;
      }
    }
  }
  if (selectedUser && selectedUser.username === data.from) {
    updateChatStatusHeader();
  }
});

socket.on("status_deleted", (data) => {
  const { statusId, userId } = data;

  if (currentStatuses && currentStatuses[userId]) {
    currentStatuses[userId].statuses = currentStatuses[userId].statuses.filter(
      (s) => s._id !== statusId
    );

    if (currentStatuses[userId].statuses.length === 0) {
      delete currentStatuses[userId];
    }
  }

  displayStatusUpdates();

  const viewerModal = document.getElementById("viewStatusModal");
  if (viewerModal && !viewerModal.classList.contains("hidden")) {
    if (currentViewedUserId === userId) {
      const deletedIndex = statusQueue.findIndex((s) => s._id === statusId);

      if (deletedIndex !== -1) {
        statusQueue.splice(deletedIndex, 1);

        if (statusQueue.length === 0) {
          closeStatusViewer();
          Toast.show("Status telah dihapus", "info");
        } else {
          if (currentStatusIndex >= statusQueue.length) {
            currentStatusIndex = Math.max(0, statusQueue.length - 1);
          }
          renderStatus();
        }
      }
    }
  }
});

async function initiateCallFromHistory(event, username, callType, name = "") {
  event.stopPropagation();

  let user = window.allUsers
    ? window.allUsers.find((u) => u.username === username)
    : null;

  if (!user) {
    if (name) {
      user = {
        username: username,
        nama: name,
        avatar: "default",
        _id: username,
      };
    } else {
      Toast.show("User tidak ditemukan", "error");
      return;
    }
  }

  selectUser(user);

  setTimeout(() => {
    startCall(callType);
  }, 100);
}

function startCallTimer() {
  callDuration = 0;
  callStartTime = Date.now();
  if (callTimer) clearInterval(callTimer);
  
  
  const headerTimer = document.getElementById("callHeaderTimer");
  if (headerTimer) {
    headerTimer.classList.remove("hidden");
    headerTimer.textContent = "00:00";
  }
  
  callTimer = setInterval(() => {
    callDuration++;
    const minutes = Math.floor(callDuration / 60);
    const seconds = callDuration % 60;
    const timeString = `${String(minutes).padStart(2, "0")}:${String(
      seconds
    ).padStart(2, "0")}`;
    
    
    const callStatus = document.getElementById("callStatus");
    if (callStatus) callStatus.textContent = timeString;
    
    
    if (headerTimer) headerTimer.textContent = timeString;
    
    
    if (window.isCallMinimized) {
      const pipTimer = document.getElementById("callPipTimer");
      if (pipTimer) pipTimer.textContent = timeString;
    }
  }, 1000);
}


function stopCallTimer() {
  if (callTimer) {
    clearInterval(callTimer);
    callTimer = null;
  }
  
  
  const headerTimer = document.getElementById("callHeaderTimer");
  if (headerTimer) {
    headerTimer.classList.add("hidden");
    headerTimer.textContent = "";
  }
}

async function startCall(type) {
  console.log("FluxChat: startCall", type);
  if (!selectedUser && !selectedGroup) return;

  if (selectedGroup) {
    Toast.show("Group video call sedang dalam pengembangan", "info");
    return;
  }

  isVideo = type === "video";

  const modal = document.getElementById("callModal");
  modal.classList.remove("hidden");
  modal.classList.add("active");

  if (window.innerWidth > 768) {
    const chatArea = document.getElementById("chatArea");
    if (modal.parentNode !== chatArea) {
      chatArea.appendChild(modal);
    }
    modal.classList.add("desktop-embedded");
    document.getElementById("welcomeScreen").classList.add("hidden");
    document.getElementById("chatRoom").classList.add("hidden");
    document.querySelector(".app-layout").classList.add("call-mode");
  }

  document.getElementById("callTargetName").textContent = selectedUser.nama;
  document.getElementById("callStatus").textContent = "";
  document.getElementById("incomingActions").classList.add("hidden");
  document.getElementById("activeCallActions").classList.remove("hidden");

  document
    .getElementById("videoContainer")
    .classList.toggle("hidden", !isVideo);

  const avatarContainer = document.getElementById("callAvatarContainer");
  avatarContainer.innerHTML = createAvatarHTML(selectedUser, "avatar", false);
  avatarContainer.classList.remove("pulse");

  
  if (isVideo) {
    const localOverlay = document.getElementById("localVideoOverlay");
    const localOverlayAvatar = document.getElementById("localOverlayAvatar");
    const localOverlayName = document.getElementById("localOverlayName");
    
    if (localOverlay) {
      localOverlay.classList.remove("hidden");
    }
    if (localOverlayAvatar && currentUser) {
      if (currentUser.avatar && currentUser.avatar !== "default") {
        localOverlayAvatar.style.backgroundImage = `url(${currentUser.avatar})`;
        localOverlayAvatar.textContent = "";
      } else {
        localOverlayAvatar.style.backgroundImage = "";
        localOverlayAvatar.textContent = currentUser.nama ? currentUser.nama.charAt(0).toUpperCase() : "U";
      }
    }
    if (localOverlayName && currentUser) {
      localOverlayName.textContent = "Anda";
    }
    
    
    const remoteOverlay = document.getElementById("remoteVideoOverlay");
    const remoteOverlayAvatar = document.getElementById("remoteOverlayAvatar");
    const remoteOverlayName = document.getElementById("remoteOverlayName");
    const remoteOverlayStatus = document.getElementById("remoteOverlayStatus");
    
    if (remoteOverlay) {
      remoteOverlay.classList.remove("hidden");
    }
    if (remoteOverlayAvatar && selectedUser) {
      if (selectedUser.avatar && selectedUser.avatar !== "default") {
        remoteOverlayAvatar.style.backgroundImage = `url(${selectedUser.avatar})`;
        remoteOverlayAvatar.textContent = "";
      } else {
        remoteOverlayAvatar.style.backgroundImage = "";
        remoteOverlayAvatar.textContent = selectedUser.nama ? selectedUser.nama.charAt(0).toUpperCase() : "U";
      }
    }
    if (remoteOverlayName && selectedUser) {
      remoteOverlayName.textContent = selectedUser.nama;
    }
    if (remoteOverlayStatus) {
      remoteOverlayStatus.textContent = "Memanggil...";
    }
    
    
    document.querySelector(".call-info-container").classList.add("hidden");
  } else {
    
    document.querySelector(".call-info-container").classList.remove("hidden");
    document.getElementById("callStatus").textContent = "Memanggil...";
  }

  await setupMedia();
  createPeerConnection();

  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit("call_offer", {
      offer,
      to: selectedUser.username,
      from: currentUser.username,
      type,
    });
  } catch (e) {
    endCall();
  }
}

socket.on("call_offer", (data) => {
  console.log("FluxChat: Received call_offer from", data.from);
  const modal = document.getElementById("callModal");
  modal.classList.remove("hidden");
  modal.classList.add("active");

  if (window.innerWidth > 768) {
    const chatArea = document.getElementById("chatArea");
    if (modal.parentNode !== chatArea) {
      chatArea.appendChild(modal);
    }
    modal.classList.add("desktop-embedded");
    document.getElementById("welcomeScreen").classList.add("hidden");
    document.getElementById("chatRoom").classList.add("hidden");
    document.querySelector(".app-layout").classList.add("call-mode");
  }

  let caller = window.allUsers
    ? window.allUsers.find((u) => u.username === data.from)
    : null;
  if (!caller) {
    caller = { username: data.from, nama: data.from, avatar: "default" };
  }

  document.getElementById("callTargetName").textContent = caller.nama;
  document.getElementById("callStatus").textContent = "";
  document.getElementById("incomingActions").classList.remove("hidden");
  document.getElementById("activeCallActions").classList.add("hidden");
  document.getElementById("videoContainer").classList.add("hidden");
  document.querySelector(".call-info-container").classList.remove("hidden");

  const avatarContainer = document.getElementById("callAvatarContainer");
  avatarContainer.innerHTML = createAvatarHTML(caller, "avatar", false);
  const avatarEl = avatarContainer.querySelector(".avatar");
  if (avatarEl) avatarEl.classList.add("pulse");

  isVideo = data.type === "video";
  window.pendingOffer = data.offer;
  window.callerUsername = data.from;
  window.callerName = caller.nama; 

  window.missedCallTimer = setTimeout(() => {
    if (window.callerUsername && !window.callAnswered) {
      saveCallToHistoryWithStatus(
        data.from,
        window.callerName || data.from, 
        data.type,
        0,
        "missed",
        "incoming"
      );
      Toast.show("Panggilan tidak terjawab", "info");

      socket.emit("end_call", { to: data.from, reason: "missed" });
      closeCallUI();
    }
  }, 30000);
});

async function answerCall() {
  console.log("FluxChat: answerCall");
  if (window.missedCallTimer) clearTimeout(window.missedCallTimer);
  window.callAnswered = true;

  document.getElementById("incomingActions").classList.add("hidden");
  document.getElementById("activeCallActions").classList.remove("hidden");
  if (isVideo) {
    document.getElementById("videoContainer").classList.remove("hidden");
    
    
    const localOverlay = document.getElementById("localVideoOverlay");
    const localOverlayAvatar = document.getElementById("localOverlayAvatar");
    const localOverlayName = document.getElementById("localOverlayName");
    
    if (localOverlay) {
      localOverlay.classList.remove("hidden");
    }
    if (localOverlayAvatar && currentUser) {
      if (currentUser.avatar && currentUser.avatar !== "default") {
        localOverlayAvatar.style.backgroundImage = `url(${currentUser.avatar})`;
        localOverlayAvatar.textContent = "";
      } else {
        localOverlayAvatar.style.backgroundImage = "";
        localOverlayAvatar.textContent = currentUser.nama ? currentUser.nama.charAt(0).toUpperCase() : "U";
      }
    }
    if (localOverlayName) {
      localOverlayName.textContent = "Anda";
    }
    
    
    const remoteOverlay = document.getElementById("remoteVideoOverlay");
    const remoteOverlayAvatar = document.getElementById("remoteOverlayAvatar");
    const remoteOverlayName = document.getElementById("remoteOverlayName");
    const remoteOverlayStatus = document.getElementById("remoteOverlayStatus");
    
    
    let caller = window.allUsers ? window.allUsers.find(u => u.username === window.callerUsername) : null;
    if (!caller) {
      caller = { nama: window.callerName || window.callerUsername, avatar: "default" };
    }
    
    if (remoteOverlay) {
      remoteOverlay.classList.remove("hidden");
    }
    if (remoteOverlayAvatar && caller) {
      if (caller.avatar && caller.avatar !== "default") {
        remoteOverlayAvatar.style.backgroundImage = `url(${caller.avatar})`;
        remoteOverlayAvatar.textContent = "";
      } else {
        remoteOverlayAvatar.style.backgroundImage = "";
        remoteOverlayAvatar.textContent = caller.nama ? caller.nama.charAt(0).toUpperCase() : "U";
      }
    }
    if (remoteOverlayName && caller) {
      remoteOverlayName.textContent = caller.nama;
    }
    if (remoteOverlayStatus) {
      remoteOverlayStatus.textContent = "Menghubungkan...";
    }
    
    
    document.querySelector(".call-info-container").classList.add("hidden");
  }

  await setupMedia();
  createPeerConnection();
  await peerConnection.setRemoteDescription(
    new RTCSessionDescription(window.pendingOffer)
  );
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  socket.emit("call_answer", {
    answer,
    to: window.callerUsername,
    from: currentUser.username,
  });

  startCallTimer();
}

function endCall() {
  const target = selectedUser ? selectedUser.username : window.callerUsername;
  const targetName = selectedUser ? selectedUser.nama : window.callerUsername;

  if (selectedUser) {
    saveCallToHistoryWithStatus(
      target,
      targetName,
      isVideo ? "video" : "voice",
      callDuration,
      "completed"
    );
  } else if (window.callerUsername) {
    saveCallToHistoryWithStatus(
      window.callerUsername,
      window.callerName || window.callerUsername, 
      isVideo ? "video" : "voice",
      callDuration,
      "completed"
    );
  }

  if (target) socket.emit("end_call", { to: target });
  closeCallUI();
}

function rejectCall() {
  if (window.callerUsername) {
    saveCallToHistoryWithStatus(
      window.callerUsername,
      window.callerName || window.callerUsername, 
      isVideo ? "video" : "voice",
      0,
      "rejected",
      "incoming"
    );
  }
  if (window.callerUsername)
    socket.emit("end_call", { to: window.callerUsername, reason: "rejected" });
  closeCallUI();
}

function closeCallUI() {
  stopCallTimer();
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  
  
  const callPip = document.getElementById("callPip");
  if (callPip) callPip.classList.add("hidden");
  window.isCallMinimized = false;
  
  const modal = document.getElementById("callModal");

  if (window.innerWidth > 768) {
    selectedUser = null;
    selectedGroup = null;
    document.getElementById("chatRoom").classList.add("hidden");
    document.getElementById("welcomeScreen").classList.remove("hidden");
    document
      .querySelectorAll(".user-item, .chat-item, .group-item")
      .forEach((el) => el.classList.remove("active"));

    const sidebar = document.getElementById("sidebar");
    if (sidebar) {
      sidebar.style.width = "50%";
    }
    document.querySelector(".app-layout").classList.remove("call-mode");

    modal.classList.add("closing");

    setTimeout(() => {
      modal.classList.remove("closing");
      modal.classList.add("hidden");
      modal.classList.remove("active");
      modal.classList.remove("desktop-embedded");

      if (modal.parentNode !== document.body) {
        document.body.appendChild(modal);
      }

      document.querySelector(".call-info-container").classList.remove("hidden");
      window.pendingOffer = null;
      window.callerUsername = null;
      window.callerName = null;
      callStartTime = null;
      isVideo = false;
    }, 500);
  } else {
    modal.classList.add("hidden");
    modal.classList.remove("active");
    modal.classList.remove("desktop-embedded");

    if (modal.parentNode !== document.body) {
      document.body.appendChild(modal);
    }

    document.querySelector(".call-info-container").classList.remove("hidden");
    window.pendingOffer = null;
    window.callerUsername = null;
    window.callerName = null;
    callStartTime = null;
    isVideo = false;
  }
}

socket.on("call_ended", (data) => {
  Toast.show("Panggilan diakhiri", "info");

  if (window.callerUsername) {
    if (callStartTime) {
      const duration = Math.floor((Date.now() - callStartTime) / 1000);
      saveCallToHistoryWithStatus(
        window.callerUsername,
        window.callerName || window.callerUsername, 
        isVideo ? "video" : "voice",
        duration,
        "completed",
        "incoming"
      );
    } else {
      saveCallToHistoryWithStatus(
        window.callerUsername,
        window.callerName || window.callerUsername, 
        isVideo ? "video" : "voice",
        0,
        "missed",
        "incoming"
      );
    }
  } else if (selectedUser) {
    if (callStartTime) {
      const duration = Math.floor((Date.now() - callStartTime) / 1000);
      saveCallToHistoryWithStatus(
        selectedUser.username,
        selectedUser.nama,
        isVideo ? "video" : "voice",
        duration,
        "completed",
        "outgoing"
      );
    } else {
      const reason = data && data.reason ? data.reason : "missed";
      const isRejected = reason === "rejected";
      const status = isRejected ? "rejected" : "missed";

      saveCallToHistoryWithStatus(
        selectedUser.username,
        selectedUser.nama,
        isVideo ? "video" : "voice",
        0,
        status,
        "outgoing"
      );
    }
  }

  displayCallHistory();
  closeCallUI();
});

socket.on("call_answer", async (data) => {
  await peerConnection.setRemoteDescription(
    new RTCSessionDescription(data.answer)
  );
});

socket.on("ice_candidate", async (data) => {
  console.log("FluxChat: Received ice_candidate from", data.from);
  if (peerConnection)
    await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
});

async function setupMedia() {
  console.log("FluxChat: setupMedia isVideo=", isVideo);
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: isVideo,
      audio: true,
    });
    const localVideo = document.getElementById("localVideo");
    localVideo.srcObject = localStream;
    localVideo.onloadedmetadata = () => {
      localVideo.play().catch(console.error);
    };
    
    
    const overlay = document.getElementById("localVideoOverlay");
    if (overlay && isVideo) {
      overlay.classList.add("hidden");
    }
  } catch (e) {
    Toast.show("Gagal akses kamera/mic", "error");
    closeCallUI();
  }
}

function createPeerConnection() {
  console.log("FluxChat: createPeerConnection");
  peerConnection = new RTCPeerConnection(config);
  if (localStream)
    localStream
      .getTracks()
      .forEach((t) => peerConnection.addTrack(t, localStream));

  peerConnection.oniceconnectionstatechange = () => {
    if (peerConnection.iceConnectionState === "failed" || peerConnection.iceConnectionState === "disconnected") {
      Toast.show("Koneksi P2P gagal (ICE Failed). Cek jaringan.", "error");
    }
  };

  peerConnection.ontrack = (e) => {
    console.log("FluxChat: ontrack fired");
    
    
    const existingRemote = document.getElementById("remoteVideo");
    if (existingRemote && existingRemote.srcObject === e.streams[0]) {
       return;
    }

    
    const wrapper = document.querySelector(".remote-video-wrapper");
    if (wrapper) {
       const oldVideo = document.getElementById("remoteVideo");
       if (oldVideo) oldVideo.remove();
       
       const remoteVideo = document.createElement("video");
       remoteVideo.id = "remoteVideo";
       remoteVideo.autoplay = true;
       remoteVideo.playsInline = true;
       
       wrapper.insertBefore(remoteVideo, wrapper.firstChild);
       
       remoteVideo.srcObject = e.streams[0];
       remoteVideo.play().catch(e => console.error("FluxChat: Play error:", e));
    }

    startCallTimer();
    
    
    const remoteOverlay = document.getElementById("remoteVideoOverlay");
    if (remoteOverlay) {
      remoteOverlay.classList.add("hidden");
    }
    
    const callInfo = document.querySelector(".call-info-container");
    if (callInfo && isVideo) {
      callInfo.classList.add("hidden");
    }
  };
  peerConnection.onicecandidate = (e) => {
    if (e.candidate) {
      const target = selectedUser
        ? selectedUser.username
        : window.callerUsername;
      socket.emit("ice_candidate", {
        candidate: e.candidate,
        to: target,
        from: currentUser.username,
      });
    }
  };
}

function toggleMute() {
  if (!localStream) return;
  const track = localStream.getAudioTracks()[0];
  track.enabled = !track.enabled;
  document.getElementById("muteBtn").style.backgroundColor = track.enabled
    ? "#475569"
    : "#ef4444";
}

function toggleCamera() {
  if (!localStream) return;
  const track = localStream.getVideoTracks()[0];
  track.enabled = !track.enabled;
  document.getElementById("camBtn").style.backgroundColor = track.enabled
    ? "#475569"
    : "#ef4444";
  
  
  const pipMuteBtn = document.getElementById("callPipMuteBtn");
  if (pipMuteBtn && window.isCallMinimized) {
    pipMuteBtn.classList.toggle("muted", !localStream.getAudioTracks()[0]?.enabled);
  }
}


window.isCallMinimized = false;

function minimizeCall() {
  const callModal = document.getElementById("callModal");
  const callPip = document.getElementById("callPip");
  const pipRemoteVideo = document.getElementById("pipRemoteVideo");
  const pipLocalVideo = document.getElementById("pipLocalVideoSmall");
  const pipName = document.getElementById("callPipName");
  const pipTimer = document.getElementById("callPipTimer");
  const pipMuteBtn = document.getElementById("callPipMuteBtn");

  if (!callModal || !callPip) return;

  
  const remoteVideo = document.getElementById("remoteVideo");
  const localVideo = document.getElementById("localVideo");
  
  if (remoteVideo && remoteVideo.srcObject && pipRemoteVideo) {
    pipRemoteVideo.srcObject = remoteVideo.srcObject;
  }
  if (localVideo && localVideo.srcObject && pipLocalVideo) {
    pipLocalVideo.srcObject = localVideo.srcObject;
  }

  
  const targetName = selectedUser ? selectedUser.nama : (window.callerUsername || "User");
  if (pipName) pipName.textContent = targetName;

  
  const callStatus = document.getElementById("callStatus");
  if (callStatus && pipTimer) {
    pipTimer.textContent = callStatus.textContent;
  }

  
  if (pipMuteBtn && localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    pipMuteBtn.classList.toggle("muted", audioTrack && !audioTrack.enabled);
    const icon = pipMuteBtn.querySelector("i");
    if (icon) {
      icon.setAttribute("data-feather", audioTrack && !audioTrack.enabled ? "mic-off" : "mic");
    }
  }

  
  callModal.classList.add("hidden");
  callModal.classList.remove("active");
  if (window.innerWidth > 768) {
    callModal.classList.remove("desktop-embedded");
    document.querySelector(".app-layout")?.classList.remove("call-mode");
    document.getElementById("chatRoom")?.classList.remove("hidden");
    document.getElementById("welcomeScreen")?.classList.add("hidden");
  }
  
  callPip.classList.remove("hidden");
  window.isCallMinimized = true;

  if (typeof feather !== "undefined") feather.replace();
  Toast.show("Panggilan diminimalkan", "info");
}

function expandCall() {
  const callModal = document.getElementById("callModal");
  const callPip = document.getElementById("callPip");

  if (!callModal || !callPip) return;

  
  callPip.classList.add("hidden");
  window.isCallMinimized = false;

  
  callModal.classList.remove("hidden");
  callModal.classList.add("active");

  if (window.innerWidth > 768) {
    const chatArea = document.getElementById("chatArea");
    if (callModal.parentNode !== chatArea) {
      chatArea.appendChild(callModal);
    }
    callModal.classList.add("desktop-embedded");
    document.getElementById("welcomeScreen")?.classList.add("hidden");
    document.getElementById("chatRoom")?.classList.add("hidden");
    document.querySelector(".app-layout")?.classList.add("call-mode");
  }

  
  const remoteVideo = document.getElementById("remoteVideo");
  const localVideo = document.getElementById("localVideo");
  const pipRemoteVideo = document.getElementById("pipRemoteVideo");
  const pipLocalVideo = document.getElementById("pipLocalVideoSmall");

  if (pipRemoteVideo && pipRemoteVideo.srcObject && remoteVideo) {
    remoteVideo.srcObject = pipRemoteVideo.srcObject;
  }
  if (pipLocalVideo && pipLocalVideo.srcObject && localVideo) {
    localVideo.srcObject = pipLocalVideo.srcObject;
  }

  if (typeof feather !== "undefined") feather.replace();
}


document.addEventListener("DOMContentLoaded", () => {
  const callPip = document.getElementById("callPip");
  if (!callPip) return;

  let isDragging = false;
  let startX, startY, initialX, initialY;

  callPip.addEventListener("mousedown", (e) => {
    if (e.target.closest(".pip-btn")) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = callPip.getBoundingClientRect();
    initialX = rect.left;
    initialY = rect.top;
    callPip.style.cursor = "grabbing";
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    callPip.style.left = `${initialX + dx}px`;
    callPip.style.top = `${initialY + dy}px`;
    callPip.style.right = "auto";
    callPip.style.bottom = "auto";
  });

  document.addEventListener("mouseup", () => {
    isDragging = false;
    if (callPip) callPip.style.cursor = "move";
  });
});


let allGroups = [];
let displayGroupsTimeout = null;

function displayGroupsDebounced() {
  if (displayGroupsTimeout) {
    clearTimeout(displayGroupsTimeout);
  }
  displayGroupsTimeout = setTimeout(() => {
    displayGroups();
    displayGroupsTimeout = null;
  }, 50); // 50ms debounce
}

async function loadGroups() {
  try {
    const res = await fetch(`${API_URL}/groups/${currentUser.id}`);
    const data = await res.json();

    if (data.success) {
      allGroups = data.groups || [];
      displayGroups();

      allGroups.forEach((group) => {
        if (!chatHistory[group._id]) {
          chatHistory[group._id] = {
            id: group._id,
            name: group.nama,
            lastMessage: "Mulai chat...",
            timestamp: new Date(),
            unreadCount: 0,
            isGroup: true,
          };
        }
      });
      updateRecentChatsDisplay();

      socket.emit("get_online_users");

      socket.emit("join", { username: currentUser.username });
    }
  } catch (err) {
    socket.emit("get_online_users");
    socket.emit("join", currentUser.username);
  }
}

function displayGroups() {
  const list = document.getElementById("groupsList");
  if (!list) return;

  list.innerHTML = "";

  if (!allGroups || allGroups.length === 0) {
    list.innerHTML = `
      <div class="no-groups-message" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center; color: var(--text-secondary);">
        <i data-feather="users" style="width: 48px; height: 48px; margin-bottom: 12px; opacity: 0.5;"></i>
        <span>Belum ada group</span>
      </div>`;
    if (typeof feather !== "undefined") feather.replace();
    return;
  }

  const sortedGroups = [...allGroups].sort((a, b) => {
    const timeA = chatHistory[a._id]?.timestamp 
      ? new Date(chatHistory[a._id].timestamp) 
      : (getLastMessageForGroup(a._id) ? new Date(getLastMessageForGroup(a._id).timestamp) : new Date(0));
    const timeB = chatHistory[b._id]?.timestamp 
      ? new Date(chatHistory[b._id].timestamp) 
      : (getLastMessageForGroup(b._id) ? new Date(getLastMessageForGroup(b._id).timestamp) : new Date(0));
    return timeB - timeA;
  });

  sortedGroups.forEach((group) => {
    const div = document.createElement("div");
    div.className = "list-item chat-item";
    div.id = `group-item-${group._id}`;

    const isActive = selectedGroup && selectedGroup._id === group._id;
    if (isActive) div.classList.add("active");

    const lastMsg = getLastMessageForGroup(group._id);
    const timeText = lastMsg
      ? formatMessageTime(new Date(lastMsg.timestamp))
      : "";

    const unreadCount = chatHistory[group._id]?.unreadCount || 0;
    const badgeHTML = unreadCount > 0 
      ? `<span class="unread-badge">${unreadCount > 99 ? "99+" : unreadCount}</span>` 
      : "";

    div.innerHTML = `
      ${createGroupAvatarHTML(group)}
      <div class="chat-item-info">
        <h4>${group.nama}</h4>
        <small>${
          lastMsg 
            ? (lastMsg.senderName ? `${lastMsg.senderName.split(' ')[0]}: ${lastMsg.message}` : lastMsg.message) 
            : `${group.members.length} anggota`
        }</small>
      </div>
      <div class="last-message-time">
        <span>${timeText}</span>
        ${badgeHTML}
      </div>
    `;

    div.onclick = () => selectGroup(group._id);

    list.appendChild(div);
  });

  if (typeof feather !== "undefined") feather.replace();
}

async function displayStatusUpdates() {
  const list = document.getElementById("statusList");
  if (!list) return;

  const skeletonHTML = Array(5)
    .fill(0)
    .map(
      () => `
    <div class="status-skeleton-item">
      <div class="skeleton-avatar"></div>
      <div class="skeleton-info">
        <div class="skeleton-text title"></div>
        <div class="skeleton-text subtitle"></div>
      </div>
    </div>
  `
    )
    .join("");
  list.innerHTML = skeletonHTML;

  try {
    const res = await fetch(`${API_URL}/statuses?userId=${currentUser.id}`);
    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || "Gagal memuat status");
    }

    list.innerHTML = "";

    const groupedStatuses = data.statuses.reduce((acc, status) => {
      const userIdStr = status.user._id.toString();
      if (!acc[userIdStr]) {
        acc[userIdStr] = {
          user: status.user,
          statuses: [],
        };
      }
      acc[userIdStr].statuses.push(status);
      return acc;
    }, {});

    currentStatuses = groupedStatuses;

    updateRecentChatsDisplay();

    const myStatusData = groupedStatuses[currentUser.id];
    const myStatusItem = document.createElement("div");
    myStatusItem.className = "status-item";
    const myLastStatus = myStatusData ? myStatusData.statuses[0] : null;
    const myLastStatusIcon =
      myLastStatus && myLastStatus.type === "image"
        ? '<i data-feather="camera" style="width:12px; height:12px; margin-right:4px;"></i>'
        : "";

    const itemClickAction = myStatusData
      ? `viewStatus('${currentUser.id}')`
      : "openCreateStatusModal()";

    myStatusItem.innerHTML = `
      <div class="avatar-container" onclick="${itemClickAction}">
        ${myStatusData ? '<div class="avatar-ring"></div>' : ""}
        ${createAvatarHTML(currentUser, "avatar", false)}
        <div class="add-status-icon" onclick="event.stopPropagation(); openCreateStatusModal()">+</div>
      </div>
      <div class="status-item-info" onclick="${itemClickAction}">
        <h4>Status Saya</h4>
        <small>${
          myStatusData
            ? `${myLastStatusIcon}${myStatusData.statuses.length} pembaruan`
            : "Ketuk untuk menambahkan"
        }</small>
      </div>
    `;
    list.appendChild(myStatusItem);

    const friendStatuses = Object.values(groupedStatuses).filter(
      (s) => s.user._id !== currentUser.id
    );

    statusUserOrder = friendStatuses.map((s) => s.user._id);

    if (friendStatuses.length === 0) {
      list.innerHTML += `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: calc(100% - 85px); text-align: center; color: var(--text-secondary);">
          <p>Belum ada status dari teman Anda.</p>
        </div>`;
    } else {
      const divider = document.createElement("div");
      divider.innerHTML = `<small style="padding: 8px 16px; display: block; color: var(--text-secondary);text-align:center;">Pembaruan terkini</small>`;
      list.appendChild(divider);

      friendStatuses.forEach((statusGroup) => {
        const friendItem = document.createElement("div");
        const lastStatus = statusGroup.statuses[0];
        const lastStatusIcon =
          lastStatus.type === "image"
            ? '<i data-feather="camera" style="width:12px; height:12px; margin-right:4px;"></i>'
            : "";
        friendItem.className = "status-item";
        friendItem.innerHTML = `
          <div class="avatar-container">
            <div class="avatar-ring"></div>
            ${createAvatarHTML(statusGroup.user, "avatar", false)}
          </div>
          <div class="status-item-info">
            <h4>${statusGroup.user.nama}</h4>
            <small>${lastStatusIcon}${
          statusGroup.statuses.length
        } pembaruan • ${formatRelativeTime(
          new Date(lastStatus.createdAt)
        )}</small>
          </div>
        `;
        friendItem.onclick = () => viewStatus(statusGroup.user._id);
        list.appendChild(friendItem);
      });
    }
  } catch (err) {
    list.innerHTML = `<div class="status-placeholder"><i data-feather="alert-circle"></i><p>${err.message}</p></div>`;
  } finally {
    if (typeof feather !== "undefined") feather.replace();
  }
}

async function viewStatus(userId, startStatusId = null) {
  currentViewedUserId = userId;

  if (!currentStatuses[userId]) {
    await displayStatusUpdates();
  }

  const data = currentStatuses[userId];
  if (!data || !data.statuses.length) {
    return Toast.show("Status tidak tersedia atau sudah kadaluarsa", "info");
  }

  statusQueue = [...data.statuses].reverse();

  if (startStatusId) {
    const index = statusQueue.findIndex((s) => s._id === startStatusId);
    currentStatusIndex = index !== -1 ? index : 0;
  } else {
    currentStatusIndex = 0;
  }

  const modal = document.getElementById("viewStatusModal");

  const isDesktop = window.innerWidth > 768;
  if (isDesktop) {
    const chatArea = document.getElementById("chatArea");
    if (modal.parentNode !== chatArea) {
      chatArea.appendChild(modal);
    }
    document.getElementById("welcomeScreen").classList.add("hidden");
    document.getElementById("chatRoom").classList.add("hidden");
    modal.classList.add("desktop-embedded");

    const sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.style.width = "380px";
  } else {
    if (modal.parentNode !== document.body) {
      document.body.appendChild(modal);
    }
    modal.classList.remove("desktop-embedded");
  }

  modal.classList.remove("hidden");
  modal.classList.add("active");

  renderStatus();
}

function closeStatusViewer() {
  const modal = document.getElementById("viewStatusModal");
  modal.classList.add("hidden");
  modal.classList.remove("active");
  modal.classList.remove("desktop-embedded");

  if (window.innerWidth > 768) {
    if (selectedUser || selectedGroup) {
      document.getElementById("welcomeScreen").classList.add("hidden");
      document.getElementById("chatRoom").classList.remove("hidden");
    } else {
      document.getElementById("chatRoom").classList.add("hidden");
      document.getElementById("welcomeScreen").classList.remove("hidden");

      const sidebar = document.getElementById("sidebar");
      if (sidebar) sidebar.style.width = "50%";
    }
  }

  if (statusTimer) clearTimeout(statusTimer);
  statusQueue = [];
  currentStatusIndex = 0;
  closeViewersPanel();
}

function renderStatus() {
  const status = statusQueue[currentStatusIndex];
  if (!status) return closeStatusViewer();

  const body = document.getElementById("statusViewerBody");
  const name = document.getElementById("statusViewerName");
  const time = document.getElementById("statusViewerTime");
  const avatarContainer = document.getElementById("statusViewerAvatar");
  const footer = document.getElementById("statusFooter");

  name.textContent = status.user.nama;
  time.textContent = formatRelativeTime(new Date(status.createdAt));
  avatarContainer.innerHTML = createAvatarHTML(
    status.user,
    "avatar small",
    false
  );

  const headerInfo = document.querySelector(
    "#viewStatusModal .status-user-info"
  );
  const closeBtn = headerInfo.querySelector(".close-status-viewer");
  const existingDelete = headerInfo.querySelector(".delete-status-btn");
  if (existingDelete) existingDelete.remove();

  closeBtn.style.marginLeft = "auto";

  if (status.user._id === currentUser.id) {
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "icon-btn delete-status-btn";
    deleteBtn.innerHTML = '<i data-feather="trash-2"></i>';
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      deleteStatus(status._id);
    };

    deleteBtn.style.marginLeft = "auto";
    closeBtn.style.marginLeft = "0";
    headerInfo.insertBefore(deleteBtn, closeBtn);
  }

  body.innerHTML = "";
  if (status.type === "text") {
    const div = document.createElement("div");
    div.className = "status-text-content";
    div.style.backgroundColor = status.backgroundColor || "#31363F";
    div.textContent = status.content;
    body.appendChild(div);
  } else if (status.type === "image") {
    const img = document.createElement("img");
    img.src = status.content;
    img.className = "status-image-content";
    body.appendChild(img);

    if (status.caption) {
      const captionDiv = document.createElement("div");
      captionDiv.className = "status-caption-display";
      captionDiv.textContent = status.caption;
      body.appendChild(captionDiv);
    }
  }

  body.onclick = (e) => {
    if (
      e.target.closest("button") ||
      e.target.closest("input") ||
      e.target.closest("a")
    )
      return;

    const rect = body.getBoundingClientRect();
    const x = e.clientX - rect.left;

    if (x < rect.width * 0.3) prevStatus();
    else nextStatus();
  };

  footer.innerHTML = "";
  const isMyStatus = status.user._id === currentUser.id;

  if (isMyStatus) {
    const viewerCount = status.viewers ? status.viewers.length : 0;
    const trigger = document.createElement("div");
    trigger.className = "status-viewers-trigger";
    trigger.innerHTML = `
      <i data-feather="eye"></i>
      <span>${viewerCount}</span>
    `;
    trigger.onclick = () => openViewersPanel(status.viewers);
    footer.appendChild(trigger);
  } else {
    const replyContainer = document.createElement("div");
    replyContainer.className = "status-reply-container";
    replyContainer.innerHTML = `
      <input type="text" class="status-reply-input" placeholder="Balas..." id="statusReplyInput">
      <button class="status-reply-btn" onclick="sendStatusReply('${status._id}')">
        <i data-feather="send" style="width: 18px; height: 18px;"></i>
      </button>
    `;
    footer.appendChild(replyContainer);

    const input = replyContainer.querySelector("input");

    input.addEventListener("focus", () => {
      if (statusTimer) clearTimeout(statusTimer);

      const bars = document.querySelectorAll(".status-progress-fill");
      if (bars[currentStatusIndex]) {
        const bar = bars[currentStatusIndex];
        const computedStyle = window.getComputedStyle(bar);
        const currentWidth = computedStyle.getPropertyValue("width");
        bar.style.width = currentWidth;
        bar.style.transition = "none";
      }
    });

    input.addEventListener("blur", () => {
      if (statusTimer) clearTimeout(statusTimer);
      if (
        !document.getElementById("viewStatusModal").classList.contains("hidden")
      ) {
        const bars = document.querySelectorAll(".status-progress-fill");
        if (bars[currentStatusIndex]) {
          const bar = bars[currentStatusIndex];
          bar.style.transition = "width 3s linear";
          bar.style.width = "100%";
        }
        statusTimer = setTimeout(nextStatus, 3000);
      }
    });

    input.addEventListener("keypress", (e) => {
      if (e.key === "Enter") sendStatusReply(status._id);
    });

    markStatusViewed(status._id);
  }
  if (typeof feather !== "undefined") feather.replace();
  if (typeof feather !== "undefined") feather.replace();

  const duration = status.type === "image" ? 10000 : 5000;
  updateStatusProgressBars(duration);

  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(nextStatus, duration);
}

async function deleteStatus(statusId) {
  if (!confirm("Apakah Anda yakin ingin menghapus status ini?")) return;

  try {
    const res = await fetch(`${API_URL}/statuses/${statusId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: currentUser.id }),
    });

    const data = await res.json();
    if (data.success) {
      Toast.show("Menghapus status...", "info");
    } else {
      Toast.show(data.error || "Gagal menghapus status", "error");
    }
  } catch (err) {
    console.error("Delete status error:", err);
    Toast.show("Terjadi kesalahan koneksi", "error");
  }
}

async function markStatusViewed(statusId) {
  try {
    await fetch(`${API_URL}/statuses/${statusId}/view`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: currentUser.id }),
    });
  } catch (e) {
    console.error("Failed to mark status viewed", e);
  }
}

function sendStatusReply(statusId) {
  const input = document.getElementById("statusReplyInput");
  const text = input.value.trim();
  if (!text) return;

  const status = statusQueue.find((s) => s._id === statusId);
  if (!status) return;

  const replyTo = {
    messageId: `status-${status._id}`,
    senderName: status.user.nama,
    content:
      status.type === "text" ? status.content : status.caption || "Status",
    mediaUrl: status.type === "image" ? status.content : null,
    type: "status",
    userId: status.user._id,
  };

  const payload = {
    from: currentUser.username,
    to: status.user.username,
    message: text,
    replyTo: replyTo,
    tempId: `temp-${Date.now()}`,
  };

  socket.emit("send_message", payload);

  input.value = "";
  Toast.show("Balasan terkirim", "success");
}

function openViewersPanel(viewers) {
  const panel = document.getElementById("statusViewersPanel");
  const list = document.getElementById("viewersList");
  const count = document.getElementById("viewersCount");

  if (statusTimer) clearTimeout(statusTimer);

  count.textContent = viewers ? viewers.length : 0;
  list.innerHTML = "";

  if (!viewers || viewers.length === 0) {
    list.innerHTML =
      '<div class="status-placeholder"><p>Belum ada yang melihat</p></div>';
  } else {
    [...viewers].reverse().forEach((v) => {
      const item = document.createElement("div");
      item.className = "viewer-item";
      item.innerHTML = `
        ${createAvatarHTML(v.user, "avatar small", false)}
        <div class="viewer-info">
          <h5>${v.user.nama}</h5>
          <small>${formatRelativeTime(new Date(v.viewedAt))}</small>
        </div>
      `;
      list.appendChild(item);
    });
  }

  panel.classList.add("active");
}

function closeViewersPanel() {
  const panel = document.getElementById("statusViewersPanel");
  if (panel) panel.classList.remove("active");

  if (
    !document.getElementById("viewStatusModal").classList.contains("hidden")
  ) {
    if (statusQueue.length > 0) {
      if (statusTimer) clearTimeout(statusTimer);
      const currentStatus = statusQueue[currentStatusIndex];
      const duration =
        currentStatus && currentStatus.type === "image" ? 10000 : 5000;
      statusTimer = setTimeout(nextStatus, duration);
    }
  }
}

function updateStatusProgressBars(duration = 5000) {
  const container = document.getElementById("statusProgressBarContainer");
  container.innerHTML = "";

  statusQueue.forEach((_, idx) => {
    const bar = document.createElement("div");
    bar.className = "status-progress-bar";
    const fill = document.createElement("div");
    fill.className = "status-progress-fill";

    if (idx < currentStatusIndex) {
      fill.classList.add("filled");
    } else if (idx === currentStatusIndex) {
      setTimeout(() => {
        fill.style.transition = `width ${duration}ms linear`;
        fill.style.width = "100%";
      }, 50);
    }

    bar.appendChild(fill);
    container.appendChild(bar);
  });
}

function nextStatus() {
  if (statusNavLock) return;
  statusNavLock = true;
  setTimeout(() => (statusNavLock = false), 300);

  if (currentStatusIndex < statusQueue.length - 1) {
    currentStatusIndex++;
    renderStatus();
  } else {
    const currentUserIdx = statusUserOrder.indexOf(currentViewedUserId);
    if (currentUserIdx !== -1 && currentUserIdx < statusUserOrder.length - 1) {
      const nextUserId = statusUserOrder[currentUserIdx + 1];
      viewStatus(nextUserId);
    } else if (
      currentUserIdx === -1 &&
      currentViewedUserId === currentUser.id &&
      statusUserOrder.length > 0
    ) {
      viewStatus(statusUserOrder[0]);
    } else {
      closeStatusViewer();
    }
  }
}

function prevStatus() {
  if (statusNavLock) return;
  statusNavLock = true;
  setTimeout(() => (statusNavLock = false), 300);

  if (currentStatusIndex > 0) {
    currentStatusIndex--;
    renderStatus();
  } else {
    const currentUserIdx = statusUserOrder.indexOf(currentViewedUserId);
    if (currentUserIdx > 0) {
      const prevUserId = statusUserOrder[currentUserIdx - 1];
      viewStatus(prevUserId);
    } else if (currentUserIdx === 0 && currentStatuses[currentUser.id]) {
      viewStatus(currentUser.id);
    } else {
      closeStatusViewer();
    }
  }
}

window.nextStatus = nextStatus;
window.prevStatus = prevStatus;
window.closeStatusViewer = closeStatusViewer;

function openCreateStatusModal() {
  const modal = document.getElementById("createStatusModal");
  if (modal) {
    const isDesktop = window.innerWidth > 768;
    if (isDesktop) {
      const chatArea = document.getElementById("chatArea");
      if (modal.parentNode !== chatArea) {
        chatArea.appendChild(modal);
      }
      document.getElementById("welcomeScreen").classList.add("hidden");
      document.getElementById("chatRoom").classList.add("hidden");
      modal.classList.add("desktop-embedded");

      const sidebar = document.getElementById("sidebar");
      if (sidebar) sidebar.style.width = "380px";
    } else {
      if (modal.parentNode !== document.body) {
        document.body.appendChild(modal);
      }
      modal.classList.remove("desktop-embedded");
    }

    modal.classList.remove("hidden");
    modal.classList.add("active");

    const textInput = document.getElementById("statusTextInput");
    textInput.value = "";
    textInput.style.backgroundColor = "#31363F";
    document
      .querySelectorAll(".color-dot")
      .forEach((dot) => dot.classList.remove("active"));
    const defaultColorDot = document.querySelector(
      '.color-dot[data-color="#31363F"]'
    );
    if (defaultColorDot) defaultColorDot.classList.add("active");

    statusImageBase64 = null;
    const imageInput = document.getElementById("statusImageInput");
    if (imageInput) imageInput.value = "";
    document.getElementById("imagePreviewWrapper").classList.add("hidden");
    const captionInput = document.getElementById("statusImageCaption");
    if (captionInput) captionInput.value = "";

    document
      .querySelector(".image-upload-placeholder")
      .classList.remove("hidden");

    switchStatusType("text");
  }
}

function closeCreateStatusModal() {
  const modal = document.getElementById("createStatusModal");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("active");
    modal.classList.remove("desktop-embedded");

    if (window.innerWidth > 768) {
      if (selectedUser || selectedGroup) {
        document.getElementById("welcomeScreen").classList.add("hidden");
        document.getElementById("chatRoom").classList.remove("hidden");
      } else {
        document.getElementById("chatRoom").classList.add("hidden");
        document.getElementById("welcomeScreen").classList.remove("hidden");

        const sidebar = document.getElementById("sidebar");
        if (sidebar) sidebar.style.width = "50%";
      }
    }
  }
}

window.closeCreateStatusModal = closeCreateStatusModal;

async function postStatus() {
  const activeType = document.querySelector(
    ".status-type-toggle .toggle-btn.active"
  ).dataset.type;

  let payloadBody;

  if (activeType === "text") {
    const content = document.getElementById("statusTextInput").value.trim();
    const backgroundColor =
      document.getElementById("statusTextInput").style.backgroundColor ||
      "#31363F";
    if (!content) return Toast.show("Status tidak boleh kosong", "error");
    payloadBody = {
      userId: currentUser.id,
      type: "text",
      content,
      backgroundColor,
    };
  } else {
    if (!statusImageBase64)
      return Toast.show("Pilih gambar terlebih dahulu", "error");
    const caption = document.getElementById("statusImageCaption").value.trim();
    payloadBody = {
      userId: currentUser.id,
      type: "image",
      content: statusImageBase64,
      caption,
    };
  }
  const btn = document.getElementById("postStatusBtn");
  btn.disabled = true;
  btn.innerHTML =
    '<i data-feather="loader" class="spinner-animation" style="margin-right: 0;"></i>';
  if (typeof feather !== "undefined") feather.replace();

  try {
    const res = await fetch(`${API_URL}/statuses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadBody),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Gagal memposting status");

    Toast.show("Status berhasil diposting!", "success");
    closeCreateStatusModal();
    displayStatusUpdates();
  } catch (err) {
    Toast.show(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-feather="send"></i>';
    if (typeof feather !== "undefined") feather.replace();
    statusImageBase64 = null;
  }
}

function switchStatusType(type) {
  const textCreator = document.getElementById("textStatusCreator");
  const imageCreator = document.getElementById("imageStatusCreator");
  const textBtn = document.querySelector('.toggle-btn[data-type="text"]');
  const imageBtn = document.querySelector('.toggle-btn[data-type="image"]');

  if (type === "image") {
    textCreator.classList.add("hidden");
    textCreator.classList.remove("slide-in-left");

    imageCreator.classList.remove("hidden");
    imageCreator.classList.remove("slide-in-right");
    void imageCreator.offsetWidth;
    imageCreator.classList.add("slide-in-right");

    textBtn.classList.remove("active");
    imageBtn.classList.add("active");
  } else {
    imageCreator.classList.add("hidden");
    imageCreator.classList.remove("slide-in-right");

    textCreator.classList.remove("hidden");
    textCreator.classList.remove("slide-in-left");
    void textCreator.offsetWidth;
    textCreator.classList.add("slide-in-left");

    textBtn.classList.add("active");
    imageBtn.classList.remove("active");
  }
}

function handleStatusImageSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    Toast.show("Hanya file gambar yang diizinkan", "error");
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    Toast.show("Ukuran gambar terlalu besar (Maks 5MB)", "error");
    return;
  }

  const reader = new FileReader();
  reader.onload = (event) => {
    statusImageBase64 = event.target.result;
    const preview = document.getElementById("statusImagePreview");
    const placeholder = document.querySelector(".image-upload-placeholder");
    const wrapper = document.getElementById("imagePreviewWrapper");
    preview.src = statusImageBase64;
    wrapper.classList.remove("hidden");
    placeholder.classList.add("hidden");
  };
  reader.readAsDataURL(file);
}

function openCreateGroupModal() {
  const modal = document.getElementById("createGroupModal");
  modal.classList.remove("hidden");
  modal.classList.add("active");

  populateMembersCheckbox();

  document.getElementById("groupNameInput").value = "";
  document
    .querySelectorAll('input[name="groupMembers"]')
    .forEach((cb) => (cb.checked = false));

  const searchInput = document.getElementById("groupMemberSearch");
  if (searchInput) {
    searchInput.value = "";
    searchInput.oninput = (e) => filterGroupMembers(e.target.value);
  }

  if (typeof feather !== "undefined") feather.replace();
}

async function populateMembersCheckbox() {
  const container = document.getElementById("membersListContainer");

  if (!window.allUsers || window.allUsers.length === 0) {
    container.innerHTML =
      '<div class="no-friends-message">Tidak ada teman</div>';
    return;
  }

  container.innerHTML = "";

  window.allUsers.forEach((user) => {
    const div = document.createElement("div");
    div.className = "member-checkbox";

    const id = `member-${user._id}`;

    let avatarHtml = "";
    if (user.avatar) {
      avatarHtml = `<div class="user-avatar-small user-avatar-small-bg" style="background-image: url('${user.avatar}');"></div>`;
    } else {
      const avatarText = user.nama
        ? user.nama.charAt(0).toUpperCase()
        : user.username.charAt(0).toUpperCase();
      avatarHtml = `<div class="user-avatar-small">${avatarText}</div>`;
    }

    div.innerHTML = `
      ${avatarHtml}
      <label for="${id}" class="member-name">${
      user.nama || user.username
    }</label>
      <input type="checkbox" id="${id}" name="groupMembers" value="${user._id}">
    `;

    div.onclick = (e) => {
      if (e.target.type !== "checkbox" && e.target.tagName !== "LABEL") {
        const checkbox = div.querySelector('input[type="checkbox"]');
        checkbox.checked = !checkbox.checked;

        checkbox.dispatchEvent(new Event("change"));
      }
    };

    const checkbox = div.querySelector('input[type="checkbox"]');
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        div.classList.add("selected");
      } else {
        div.classList.remove("selected");
      }
    });

    container.appendChild(div);
  });
}

function filterGroupMembers(query) {
  const container = document.getElementById("membersListContainer");
  const items = container.querySelectorAll(".member-checkbox");
  const lowerQuery = query.toLowerCase();

  items.forEach((item) => {
    const name = item.querySelector(".member-name").textContent.toLowerCase();
    if (name.includes(lowerQuery)) {
      item.style.display = "flex";
    } else {
      item.style.display = "none";
    }
  });
}

async function createGroup() {
  const groupName = document.getElementById("groupNameInput").value.trim();

  if (!groupName) {
    Toast.show("Nama group tidak boleh kosong", "error");
    return;
  }

  if (groupName.length > 50) {
    Toast.show("Nama group terlalu panjang (max 50 karakter)", "error");
    return;
  }

  const selectedMembers = Array.from(
    document.querySelectorAll('input[name="groupMembers"]:checked')
  ).map((cb) => cb.value);

  if (selectedMembers.length === 0) {
    Toast.show("Pilih minimal 1 anggota", "error");
    return;
  }

  const btn = document.getElementById("createGroupBtn");
  const originalText = btn.innerText;
  btn.disabled = true;
  btn.innerText = "Membuat...";

  try {
    const res = await fetch(`${API_URL}/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nama: groupName,
        createdBy: currentUser.id || currentUser._id,
        members: selectedMembers,
      }),
    });

    const data = await res.json();

    if (data.success) {
      Toast.show("Group berhasil dibuat!", "success");

      allGroups.unshift(data.group);
      displayGroups();

      chatHistory[data.group._id] = {
        id: data.group._id,
        name: data.group.nama,
        lastMessage: "Mulai chat...",
        timestamp: new Date(),
        unreadCount: 0,
        isGroup: true,
      };
      updateRecentChatsDisplay();

      document.getElementById("createGroupModal").classList.remove("active");
      document.getElementById("createGroupModal").classList.add("hidden");

      setTimeout(() => selectGroup(data.group._id), 300);
    } else {
      Toast.show(data.error || "Gagal membuat group", "error");
    }
  } catch (err) {
    Toast.show("Terjadi kesalahan saat membuat group", "error");
  } finally {
    btn.disabled = false;
    btn.innerText = originalText;
  }
}

socket.on("group_updated", ({ group }) => {
  if (!group) return;

  const groupIndex = allGroups.findIndex((g) => g._id === group._id);
  if (groupIndex > -1) {
    allGroups[groupIndex] = group;
  } else {
    allGroups.push(group);
  }

  if (selectedGroup && selectedGroup._id === group._id) {
    selectedGroup = group;

    document.getElementById("chatName").textContent = group.nama;
    
    const chatAvatarEl = document.getElementById("chatAvatar");
    if (group.avatar && (group.avatar.startsWith("data:") || group.avatar.startsWith("http"))) {
        chatAvatarEl.style.cssText = 'padding: 0; overflow: hidden;';
        chatAvatarEl.innerHTML = `<img src="${group.avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
    } else {
        chatAvatarEl.style.cssText = 'display: flex; align-items: center; justify-content: center;';
        chatAvatarEl.innerHTML = '<i data-feather="users" style="width: 50%; height: 50%;"></i>';
        if (typeof feather !== "undefined") feather.replace();
    }
    
    document.getElementById(
      "chatStatus"
    ).textContent = `${group.members.length} anggota`;
  }

  displayGroups();
  updateRecentChatsDisplay();

  Toast.show(`Info grup "${group.nama}" telah diperbarui.`, "info");
});

function selectGroupById(groupId) {
  if (!Array.isArray(allGroups)) return false;
  const found = allGroups.find((g) => g._id === groupId);
  if (!found) return false;
  selectGroup(groupId);
  return true;
}

function selectGroup(groupId) {
  selectedGroup = allGroups.find((g) => g._id === groupId);
  selectedUser = null;

  if (!selectedGroup) return;

  if (
    document.getElementById("viewStatusModal") &&
    !document.getElementById("viewStatusModal").classList.contains("hidden")
  ) {
    closeStatusViewer();
  }
  if (
    document.getElementById("createStatusModal") &&
    !document.getElementById("createStatusModal").classList.contains("hidden")
  ) {
    closeCreateStatusModal();
  }

  clearUnread(groupId);

  if (window.innerWidth > 768) {
    const sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.style.width = "380px";
  }

  const isMobile = window.innerWidth <= 768;

  if (isMobile) {
    document.getElementById("sidebar").classList.add("hidden-mobile");
    document.getElementById("chatArea").classList.add("active");
  }

  document.getElementById("welcomeScreen").classList.add("hidden");
  document.getElementById("chatRoom").classList.remove("hidden");

  document.getElementById("chatName").textContent = selectedGroup.nama;
  const chatAvatarEl = document.getElementById("chatAvatar");
  if (selectedGroup.avatar && (selectedGroup.avatar.startsWith("data:") || selectedGroup.avatar.startsWith("http"))) {
    chatAvatarEl.style.cssText = 'padding: 0; overflow: hidden;';
    chatAvatarEl.innerHTML = `<img src="${selectedGroup.avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
  } else {
    chatAvatarEl.style.cssText = 'display: flex; align-items: center; justify-content: center;';
    chatAvatarEl.innerHTML = '<i data-feather="users" style="width: 50%; height: 50%;"></i>';
    if (typeof feather !== "undefined") feather.replace();
  }
  
  document.getElementById(
    "chatStatus"
  ).textContent = `${selectedGroup.members.length} anggota`;

  document
    .querySelectorAll(".group-item")
    .forEach((el) => el.classList.remove("active"));
  document
    .querySelectorAll(".user-item")
    .forEach((el) => el.classList.remove("active"));
  document
    .querySelectorAll(".chat-item")
    .forEach((el) => el.classList.remove("active"));

  const activeGroup = document.getElementById(`group-item-${groupId}`);
  if (activeGroup) activeGroup.classList.add("active");

  const activeChatItem = document.getElementById(`chat-item-${groupId}`);
  if (activeChatItem) activeChatItem.classList.add("active");

  document
    .getElementById("menuOpenProfile")
    ?.style.setProperty("display", "none", "important");
  const menuGroupSettings = document.getElementById("menuGroupSettings");
  if (menuGroupSettings) {
    const createdById = selectedGroup.createdBy._id || selectedGroup.createdBy;
    const isCreator = createdById === currentUser.id;
    menuGroupSettings.style.display = isCreator ? "flex" : "none";
  }

  const chatInfoEl = document.querySelector("#chatRoom .chat-info");
  if (chatInfoEl) {
    chatInfoEl.onclick = () => openGroupProfileModal();
  }

  loadGroupMessages(groupId);
}

async function loadGroupMessages(groupId) {
  const container = document.getElementById("messagesContainer");
  container.innerHTML =
    '<div style="text-align:center; padding:20px; color:#666;">Memuat pesan...</div>';

  try {
    const res = await fetch(`${API_URL}/groups/${groupId}/messages`);
    const data = await res.json();
    container.innerHTML = "";

    if (data.messages.length === 0) {
      container.innerHTML =
        '<div style="text-align:center; padding:20px; color:#666;">Belum ada pesan. Mulai percakapan! 💬</div>';

      const cacheKey = `lastMsg-${currentUser.username}-group-${groupId}`;
      if (localStorage.getItem(cacheKey)) {
        localStorage.removeItem(cacheKey);
        updateRecentChatsDisplay();
      }
    } else {
      data.messages.forEach((msg) => addGroupMessageToUI(msg));
    }
    scrollToBottom();
  } catch (err) {
    container.innerHTML =
      '<div style="text-align:center; padding:20px; color:#ef4444;">Gagal memuat pesan.</div>';
  }
}

function addGroupMessageToUI(msg) {
  const container = document.getElementById("messagesContainer");

  if (msg.isDeleted) {
    const isMe = msg.from === currentUser.username;
    const div = document.createElement("div");
    div.id = `message-${msg._id}`;
    div.className = `message ${isMe ? "outgoing" : "incoming"} group-message`;

    let deletedContent = "";
    if (!isMe) {
      const senderUser = (window.allUsers || []).find(
        (u) => u.username === msg.from
      );
      const senderDisplayName = senderUser ? senderUser.nama : msg.from;
      deletedContent += `<small style="color: var(--primary); font-weight: 600; display: block; margin-bottom: 4px;">${senderDisplayName}</small>`;
    }

    deletedContent += `<p style="margin:0; font-style:italic; opacity:0.7;">${
      msg.message || "Pesan ini telah dihapus"
    }</p>`;
    deletedContent += `<span class="msg-time">${new Date(
      msg.timestamp
    ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>`;

    div.innerHTML = deletedContent;
    container.appendChild(div);
    scrollToBottom();

    if (selectedGroup) {
      saveLastMessageGroup(
        selectedGroup._id,
        "Pesan ini telah dihapus",
        msg.timestamp,
        msg._id
      );
    }
    return;
  }

  if (
    container.innerText.includes("Belum ada pesan") ||
    container.innerText.includes("Memuat") ||
    container.innerText.includes("Gagal")
  ) {
    container.innerHTML = "";
  }

  if (!msg._id) {
    msg._id = `${msg.from}-${msg.timestamp}`;
  }

  const isMe = msg.from === currentUser.username;

  const hasImage =
    msg.file &&
    msg.file.data &&
    msg.file.type &&
    msg.file.type.startsWith("image/");

  const div = document.createElement("div");
  div.id = `message-${msg._id}`;
  div.dataset.messageId = msg._id;

  let senderDisplayName = "";
  if (isMe) {
    senderDisplayName = currentUser.nama;
  } else {
    const senderUser = (window.allUsers || []).find(
      (u) => u.username === msg.from
    );
    senderDisplayName = senderUser ? senderUser.nama : msg.from;
  }
  div.dataset.senderName = senderDisplayName;

  const fileOnly = msg.file && msg.file.data && !msg.message && !hasImage;
  if (hasImage && !msg.message) {
    div.className = `message-img ${
      isMe ? "outgoing" : "incoming group-message"
    }`;
  } else {
    div.className = `message ${isMe ? "outgoing" : "incoming group-message"}${
      fileOnly ? " file-only" : ""
    }`;
  }

  let content = "";

  if (msg.replyTo) {
    const isStatus =
      msg.replyTo.messageId && msg.replyTo.messageId.startsWith("status-");
    const clickAction =
      isStatus && msg.replyTo.userId
        ? `viewStatus('${msg.replyTo.userId}', '${msg.replyTo.messageId.replace(
            "status-",
            ""
          )}')`
        : `scrollToMessage(event, '${msg.replyTo.messageId}')`;

    let mediaHtml = "";
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
    if (msg.file.type && msg.file.type.startsWith("audio/")) {
      const audioId = `audio-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;
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
    } else if (msg.file.type && msg.file.type.startsWith("image/")) {
      content += `<img src="${msg.file.data}" class="msg-img" onclick="openImagePreview(this.src)" style="cursor: pointer;">`;
    } else {
      content += `<div class="file-bubble">
                    <a href="${msg.file.data}" download="${
        msg.file.name || "file"
      }" class="file-bubble-link">
                      <i data-feather="${getFileIcon(msg.file.type)}"></i> 
                      <span class="file-bubble-text">
                        <span>${msg.file.name || "Download File"}</span>
                        <small>${
                          msg.file.size ? formatBytes(msg.file.size) : ""
                        } ${msg.file.type ? "• " + msg.file.type : ""}</small>
                      </span>
                    </a>
                  </div>`;
    }
  }
  if (msg.message)
    content += `<p style="margin:0;">${escapeHtml(msg.message)}</p>`;
  content += `<span class="msg-time">${new Date(
    msg.timestamp
  ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>`;

  div.innerHTML = content;
  container.appendChild(div);

  if (
    msg.file &&
    msg.file.data &&
    msg.file.type &&
    msg.file.type.startsWith("audio/")
  ) {
    const audioElements = div.querySelectorAll('[id^="audio-"]');
    if (audioElements.length > 0) {
      const audioId = audioElements[0].id.replace("audio-element-", "");
      initializeWaveform(audioId, msg.file.data);
    }
  }

  if (typeof feather !== "undefined") feather.replace();
  scrollToBottom();

  if (selectedGroup) {
    const messageText =
      msg.message ||
      (msg.file && msg.file.type && msg.file.type.startsWith("audio/")
        ? "🎤 Voice note"
        : "") ||
      (msg.file && msg.file.name ? `📎 ${msg.file.name}` : "");
    saveLastMessageGroup(
      selectedGroup._id,
      messageText,
      msg.timestamp,
      msg._id
    );
  }
}

function sendGroupMessage() {
  if (!selectedGroup) return;

  const input = document.getElementById("messageInput");
  const msg = input.value.trim();
  const fileInput = document.getElementById("fileInput");
  const file = fileInput.files[0];

  const tempId = `temp-${Date.now()}-${Math.random()}`;

  if (!msg && !file) return;

  if (file) {
    if (!isFileTypeAllowed(file.type)) {
      Toast.show("Tipe file tidak diizinkan", "error");
      clearFile();
      return;
    }

    if (file.size > FILE_MAX_BYTES) {
      Toast.show("File terlalu besar (Maks 10MB)", "error");
      clearFile();
      return;
    }

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const payload = {
        from: currentUser.username,
        to: selectedGroup._id,
        message: msg,
        file: {
          name: file.name,
          type: file.type,
          size: file.size,
          data: reader.result,
        },
        groupId: selectedGroup._id,
      };
      payload.tempId = tempId;
      if (currentReplyContext) {
        payload.replyTo = currentReplyContext;
      }
      socket.emit("send_message", payload);

      addGroupMessageToUI({
        ...payload,
        timestamp: new Date().toISOString(),
        _id: tempId,
      });
      const displayMsg = msg || `📎 ${file.name}`; // Define displayMsg before usage
      addToChatHistory(
        selectedGroup._id,
        selectedGroup.nama,
        displayMsg,
        true,
        tempId,
        new Date(),
        "Anda"
      );
      saveLastMessageGroup(selectedGroup._id, displayMsg, new Date(), tempId, "Anda");
      displayGroupsDebounced();

      input.value = "";
      clearFile();

      updateSendButtonVisibility();
      if (currentReplyContext) cancelReply();
    };
  } else {
    const payload = {
      from: currentUser.username,
      to: selectedGroup._id,
      message: msg,
      groupId: selectedGroup._id,
    };
    payload.tempId = tempId;
    if (currentReplyContext) {
      payload.replyTo = currentReplyContext;
    }
    socket.emit("send_message", payload);

    addGroupMessageToUI({
      ...payload,
      timestamp: new Date().toISOString(),
      _id: tempId,
    });
    addToChatHistory(
      selectedGroup._id,
      selectedGroup.nama,
      msg,
      true,
      tempId,
      new Date(),
      "Anda"
    );
    saveLastMessageGroup(selectedGroup._id, msg, new Date(), tempId, "Anda");
    displayGroupsDebounced();

    input.value = "";

    updateSendButtonVisibility();
    if (currentReplyContext) cancelReply();
  }
}

function openGroupProfileModal() {
  try {
    if (!selectedGroup) return;

    const modal = document.getElementById("groupProfileModal");
    if (!modal) return;

    document.getElementById("editGroupName").value = selectedGroup.nama;

    const avatarPreview = document.getElementById("groupAvatarPreview");
    if (
      selectedGroup.avatar &&
      (selectedGroup.avatar.startsWith("data:") ||
        selectedGroup.avatar.startsWith("http"))
    ) {
      avatarPreview.style.backgroundImage = `url('${selectedGroup.avatar}')`;
      avatarPreview.textContent = "";
    } else {
      avatarPreview.style.backgroundImage = "none";
      avatarPreview.style.background =
        "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";
      avatarPreview.innerHTML = '<i data-feather="users" style="width: 50%; height: 50%;"></i>';
    }

    const membersListContainer = document.getElementById("groupMembersList");
    membersListContainer.innerHTML = "<h4>Anggota</h4>";
    
    if (selectedGroup.members && selectedGroup.members.length > 0) {
      selectedGroup.members.forEach((member) => {
        const createdById = selectedGroup.createdBy._id || selectedGroup.createdBy;
        const isMemberCreator = member._id === createdById;
        const memberDiv = document.createElement("div");
        memberDiv.className = "group-member-item";
        memberDiv.innerHTML = `
            ${createAvatarHTML(
              member,
              "avatar small",
              window.userStatusMap && window.userStatusMap[member.username] === "online"
            )}
            <span>${member.nama} ${isMemberCreator ? "(Admin)" : ""}</span>
        `;
        membersListContainer.appendChild(memberDiv);
      });
    }

    const createdById = selectedGroup.createdBy._id || selectedGroup.createdBy;
    const isCreator = createdById === currentUser.id;

    document.getElementById("editGroupName").readOnly = !isCreator;
    const avatarPreviewEl = document.getElementById("groupAvatarPreview");
    if (avatarPreviewEl) {
      avatarPreviewEl.style.pointerEvents = isCreator ? "auto" : "none";
    }
    
    const modalFooter = document.querySelector("#groupProfileModal .modal-footer");
    if (modalFooter) {
      modalFooter.style.display = isCreator ? "flex" : "none";
    }

    modal.classList.remove("hidden");
    modal.classList.add("active");
    const avatarInput = document.getElementById("groupAvatarInput");
    if (avatarInput) {
      avatarInput.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
          if (file.size > 2 * 1024 * 1024) {
            Toast.show("Ukuran foto terlalu besar (maks 2MB)", "error");
            avatarInput.value = "";
            return;
          }
          const reader = new FileReader();
          reader.onload = (event) => {
            const preview = document.getElementById("groupAvatarPreview");
            preview.style.backgroundImage = `url('${event.target.result}')`;
            preview.style.backgroundSize = "cover";
            preview.style.backgroundPosition = "center";
            preview.textContent = "";
          };
          reader.readAsDataURL(file);
        }
      };
    }
    const cameraBtn = document.querySelector("#groupProfileModal .camera-upload-btn");
    if (cameraBtn) {
      cameraBtn.style.display = isCreator ? "flex" : "none";
    }
    
    if (typeof feather !== "undefined") feather.replace();
  } catch (error) {
    console.error("Error opening group profile modal:", error);
    Toast.show("Gagal membuka profil grup", "error");
  }
}

function closeGroupProfileModal() {
  const modal = document.getElementById("groupProfileModal");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("active");
  }
  closeGroupActionsMenu();
}
function toggleGroupActionsMenu(event) {
  event.stopPropagation();
  const menu = document.getElementById("groupActionsMenu");
  const btn = document.getElementById("groupActionsBtn");
  
  if (!menu || !btn) return;
  
  const isOpen = menu.classList.contains("active");
  
  if (isOpen) {
    closeGroupActionsMenu();
  } else {
    menu.classList.remove("hidden");
    requestAnimationFrame(() => {
      menu.classList.add("active");
      btn.classList.add("active");
    });
    setTimeout(() => {
      document.addEventListener("click", handleGroupActionsOutsideClick);
    }, 0);
  }
  
  if (typeof feather !== "undefined") feather.replace();
}

function closeGroupActionsMenu() {
  const menu = document.getElementById("groupActionsMenu");
  const btn = document.getElementById("groupActionsBtn");
  
  if (menu) {
    menu.classList.remove("active");
    setTimeout(() => {
      if (!menu.classList.contains("active")) {
        menu.classList.add("hidden");
      }
    }, 200);
  }
  if (btn) btn.classList.remove("active");
  
  document.removeEventListener("click", handleGroupActionsOutsideClick);
}

function handleGroupActionsOutsideClick(e) {
  const container = document.getElementById("groupActionsContainer");
  if (container && !container.contains(e.target)) {
    closeGroupActionsMenu();
  }
}
function toggleChatMenu(event) {
  event.stopPropagation();
  const menu = document.getElementById("chatMenu");
  const btn = document.getElementById("chatMenuBtn");
  
  if (!menu || !btn) return;
  
  const isOpen = menu.classList.contains("active");
  
  if (isOpen) {
    closeChatMenu();
  } else {
    updateChatMenuOptions();
    
    menu.classList.remove("hidden");
    requestAnimationFrame(() => {
      menu.classList.add("active");
    });
    setTimeout(() => {
      document.addEventListener("click", handleChatMenuOutsideClick);
    }, 0);
  }
  
  if (typeof feather !== "undefined") feather.replace();
}

function closeChatMenu() {
  const menu = document.getElementById("chatMenu");
  
  if (menu) {
    menu.classList.remove("active");
    setTimeout(() => {
      if (!menu.classList.contains("active")) {
        menu.classList.add("hidden");
      }
    }, 200);
  }
  
  document.removeEventListener("click", handleChatMenuOutsideClick);
}

function handleChatMenuOutsideClick(e) {
  const container = document.getElementById("chatMenuContainer");
  if (container && !container.contains(e.target)) {
    closeChatMenu();
  }
}

function updateChatMenuOptions() {
  const groupOnlyOptions = document.getElementById("groupOnlyOptions");
  const menuDivider = document.querySelector("#chatMenu .menu-divider");
  const addMemberBtn = document.getElementById("menuAddMembersBtn");
  
  if (groupOnlyOptions) {
    groupOnlyOptions.style.display = selectedGroup ? "block" : "none";
    if (menuDivider) menuDivider.style.display = selectedGroup ? "block" : "none";
    if (selectedGroup && addMemberBtn) {
      const createdById = selectedGroup.createdBy._id || selectedGroup.createdBy;
      const isCreator = createdById === currentUser.id;
      addMemberBtn.style.display = isCreator ? "flex" : "none";
    }
  }
}

function toggleChatSearchPanelFromMenu() {
  closeChatMenu();
  toggleChatSearchPanel();
}
function showGroupConfirmModal(title, message, iconName = "alert-circle") {
  return new Promise((resolve) => {
    const modalId = "groupActionConfirmModal";
    let modal = document.getElementById(modalId);
    
    const iconColors = {
      "trash-2": { bg: "rgba(239, 68, 68, 0.1)", color: "#ef4444" },
      "log-out": { bg: "rgba(249, 115, 22, 0.1)", color: "#f97316" },
      "user-plus": { bg: "rgba(34, 197, 94, 0.1)", color: "#22c55e" },
      "alert-circle": { bg: "rgba(59, 130, 246, 0.1)", color: "#3b82f6" }
    };
    const colors = iconColors[iconName] || iconColors["alert-circle"];
    
    if (!modal) {
      const html = `
        <div id="${modalId}" class="modal hidden" style="z-index: 10001; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center;">
          <div class="glass-panel confirm-modal-content fade-scale-in" style="max-width: 350px; padding: 30px; text-align: center; border: 1px solid rgba(255,255,255,0.1); position: relative;">
            <div id="groupConfirmIcon" style="width: 64px; height: 64px; border-radius: 20px; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">
              <i data-feather="${iconName}" style="width: 32px; height: 32px;"></i>
            </div>
            <h3 id="groupConfirmTitle" style="margin-bottom: 10px; font-size: 1.25rem; font-weight: 700;">${title}</h3>
            <p id="groupConfirmMessage" style="color: var(--text-secondary); margin-bottom: 25px; line-height: 1.6; font-size: 0.95rem;">${message}</p>
            <div style="display: flex; gap: 12px;">
              <button id="groupConfirmCancelBtn" style="flex: 1; background: var(--glass-bg); color: var(--text-primary); border: 1px solid var(--border-color); padding: 12px; border-radius: 12px; cursor: pointer; font-weight: 600; font-size: 0.9rem; transition: all 0.2s;">Batal</button>
              <button id="groupConfirmOkBtn" style="flex: 1; background: ${colors.color}; color: white; border: none; padding: 12px; border-radius: 12px; cursor: pointer; font-weight: 600; font-size: 0.9rem; transition: all 0.2s; box-shadow: 0 4px 12px ${colors.color}33;">Ya, Lanjutkan</button>
            </div>
          </div>
        </div>
      `;
      document.body.insertAdjacentHTML("beforeend", html);
      modal = document.getElementById(modalId);
    } else {
      const iconDiv = document.getElementById("groupConfirmIcon");
      iconDiv.style.background = colors.bg;
      iconDiv.style.color = colors.color;
      iconDiv.innerHTML = `<i data-feather="${iconName}" style="width: 32px; height: 32px;"></i>`;
      
      document.getElementById("groupConfirmTitle").textContent = title;
      document.getElementById("groupConfirmMessage").innerHTML = message;
      
      const okBtn = document.getElementById("groupConfirmOkBtn");
      okBtn.style.background = colors.color;
      okBtn.style.boxShadow = `0 4px 12px ${colors.color}33`;
    }
    
    modal.classList.remove("hidden");
    modal.classList.add("active");
    if (typeof feather !== "undefined") feather.replace();
    
    const okBtn = document.getElementById("groupConfirmOkBtn");
    const cancelBtn = document.getElementById("groupConfirmCancelBtn");
    
    const handleAction = (result) => {
      modal.classList.add("hidden");
      modal.classList.remove("active");
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      resolve({ confirmed: result });
    };
    
    okBtn.onclick = () => handleAction(true);
    cancelBtn.onclick = () => handleAction(false);
    modal.onclick = (e) => {
      if (e.target === modal) handleAction(false);
    };
  });
}
async function clearGroupChatData(groupId, groupName) {
  try {
    closeChatMenu();
    const chatMessages = document.getElementById("chatMessages");
    if (chatMessages) {
      chatMessages.innerHTML = "";
    }
    localStorage.removeItem(`lastMsg-${currentUser.id}-group-${groupId}`);
    
    if (chatHistory[groupId]) {
      delete chatHistory[groupId];
    }
    
    const unreadMap = JSON.parse(localStorage.getItem("unreadCounts") || "{}");
    if (unreadMap[groupId]) {
      delete unreadMap[groupId];
      localStorage.setItem("unreadCounts", JSON.stringify(unreadMap));
    }
    
    const recentChatsKey = `recentChats-${currentUser.id}`;
    const storedChats = localStorage.getItem(recentChatsKey);
    if (storedChats) {
      try {
        let chats = JSON.parse(storedChats);
        chats = chats.filter(chat => chat.id !== groupId);
        localStorage.setItem(recentChatsKey, JSON.stringify(chats));
      } catch (e) {}
    }
    closeGroupProfileModal();
    selectedGroup = null;
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      document.getElementById("sidebar").classList.remove("hidden-mobile");
      document.getElementById("chatArea").classList.remove("active");
    }
    document.getElementById("chatRoom").classList.add("hidden");
    document.getElementById("welcomeScreen").classList.remove("hidden");
    updateRecentChatsDisplay();
    displayGroupsDebounced();
    updateGroupsBadge();
  } catch (error) {
    console.error("Error clearing group chat data:", error);
  }
}

async function deleteGroupChatForMe() {
  if (!selectedGroup) return;
  
  const groupId = selectedGroup._id;
  const groupName = selectedGroup.nama;
  const { confirmed } = await showGroupConfirmModal(
    "Hapus Chat",
    `Hapus semua chat dengan <strong>"${escapeHtml(groupName)}"</strong>?<br><br>` +
    `<span style="font-size: 0.85rem; opacity: 0.8;">Pesan akan dihapus dari perangkat Anda saja. ` +
    `Anggota lain masih bisa melihat pesan. Anda tetap akan menjadi anggota grup.</span>`,
    "trash-2"
  );
  
  if (!confirmed) return;
  
  try {
    closeChatMenu();
    const chatMessages = document.getElementById("chatMessages");
    if (chatMessages) {
      chatMessages.innerHTML = "";
    }
    localStorage.removeItem(`lastMsg-${currentUser.id}-group-${groupId}`);
    if (chatHistory[groupId]) {
      delete chatHistory[groupId];
    }
    const unreadMap = JSON.parse(localStorage.getItem("unreadCounts") || "{}");
    if (unreadMap[groupId]) {
      delete unreadMap[groupId];
      localStorage.setItem("unreadCounts", JSON.stringify(unreadMap));
    }
    const recentChatsKey = `recentChats-${currentUser.id}`;
    const storedChats = localStorage.getItem(recentChatsKey);
    if (storedChats) {
      try {
        let chats = JSON.parse(storedChats);
        chats = chats.filter(chat => chat.id !== groupId);
        localStorage.setItem(recentChatsKey, JSON.stringify(chats));
      } catch (e) {}
    }
    closeGroupProfileModal();
    if (selectedGroup && selectedGroup._id === groupId) {
      selectedGroup = null;
      const isMobile = window.innerWidth <= 768;
      if (isMobile) {
        document.getElementById("sidebar").classList.remove("hidden-mobile");
        document.getElementById("chatArea").classList.remove("active");
      }
      
      document.getElementById("chatRoom").classList.add("hidden");
      document.getElementById("welcomeScreen").classList.remove("hidden");
    }
    updateRecentChatsDisplay();
    displayGroupsDebounced();
    updateGroupsBadge();
    
    Toast.show(`Chat "${groupName}" berhasil dihapus dari perangkat Anda`, "success");
  } catch (error) {
    console.error("Error deleting group chat:", error);
    Toast.show("Gagal menghapus chat", "error");
  }
}

async function leaveGroup() {
  if (!selectedGroup) return;
  
  const groupId = selectedGroup._id;
  const groupName = selectedGroup.nama;
  const { confirmed } = await showGroupConfirmModal(
    "Keluar dari Grup",
    `Keluar dari grup <strong>"${escapeHtml(groupName)}"</strong>?<br><br>` +
    `<span style="font-size: 0.85rem; opacity: 0.8;">Anda akan dihapus dari daftar anggota. ` +
    `Untuk bergabung kembali, admin harus mengundang Anda.</span>`,
    "log-out"
  );
  
  if (!confirmed) return;
  
  try {
    const res = await fetch(`${API_URL}/groups/${groupId}/members/${currentUser.id}`, {
      method: "DELETE",
    });
    
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Gagal keluar dari grup");
    allGroups = allGroups.filter(g => g._id !== groupId);
    await clearGroupChatData(groupId, groupName);
    
    Toast.show(`Anda telah keluar dari grup "${groupName}"`, "success");
  } catch (error) {
    console.error("Error leaving group:", error);
    Toast.show(error.message || "Gagal keluar dari grup", "error");
  }
}

async function openAddMembersModal() {
  if (!selectedGroup || !window.allUsers) return;
  const memberIds = selectedGroup.members.map(m => typeof m === 'object' ? m._id : m);
  const availableFriends = window.allUsers.filter(user => 
    !memberIds.includes(user._id) && 
    user._id !== currentUser.id
  );
  
  if (availableFriends.length === 0) {
    Toast.show("Semua teman sudah menjadi anggota grup", "info");
    return;
  }
  closeGroupProfileModal();
  const selectedFriend = await showFriendSelectionModal(availableFriends, selectedGroup.nama);
  
  if (!selectedFriend) {
    setTimeout(() => openGroupProfileModal(), 100);
    return;
  }
  
  try {
    const res = await fetch(`${API_URL}/groups/${selectedGroup._id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: selectedFriend._id }),
    });
    
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Gagal menambahkan anggota");
    selectedGroup.members = data.group.members;
    const groupIndex = allGroups.findIndex(g => g._id === selectedGroup._id);
    if (groupIndex !== -1) {
      allGroups[groupIndex].members = data.group.members;
    }
    
    Toast.show(`${selectedFriend.nama} berhasil ditambahkan ke grup`, "success");
    setTimeout(() => openGroupProfileModal(), 300);
  } catch (error) {
    console.error("Error adding member:", error);
    Toast.show(error.message || "Gagal menambahkan anggota", "error");
  }
}
function showFriendSelectionModal(friends, groupName) {
  return new Promise((resolve) => {
    const modalId = "friendSelectionModal";
    let modal = document.getElementById(modalId);
    const friendsListHtml = friends.map(friend => `
      <div class="friend-select-item" data-user-id="${friend._id}" style="
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        border-radius: 12px;
        cursor: pointer;
        transition: all 0.2s;
        border: 1px solid transparent;
      ">
        ${createAvatarHTML(friend, "avatar small", window.userStatusMap && window.userStatusMap[friend.username] === "online")}
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(friend.nama)}</div>
          <div style="font-size: 0.8rem; color: var(--text-secondary);">@${escapeHtml(friend.username)}</div>
        </div>
      </div>
    `).join("");
    
    if (!modal) {
      const html = `
        <div id="${modalId}" class="modal hidden" style="z-index: 10001; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center;">
          <div class="glass-panel" style="max-width: 400px; width: 90%; max-height: 80vh; position: relative; border: 1px solid rgba(255,255,255,0.1); overflow: hidden; border-radius: 20px;">
            <div style="padding: 20px 20px 16px; border-bottom: 1px solid var(--border-color);">
              <button id="friendSelectCloseBtn" style="position: absolute; top: 16px; right: 16px; background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 4px;">
                <i data-feather="x" style="width: 20px; height: 20px;"></i>
              </button>
              <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 4px;">
                <div style="background: rgba(34, 197, 94, 0.1); color: #22c55e; width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                  <i data-feather="user-plus" style="width: 20px; height: 20px;"></i>
                </div>
                <div>
                  <h3 style="font-size: 1.1rem; font-weight: 700; margin: 0;">Tambah Anggota</h3>
                  <p id="friendSelectGroupName" style="font-size: 0.8rem; color: var(--text-secondary); margin: 0;">${escapeHtml(groupName)}</p>
                </div>
              </div>
            </div>
            <div id="friendSelectList" style="padding: 12px; max-height: 300px; overflow-y: auto;">
              ${friendsListHtml}
            </div>
          </div>
        </div>
      `;
      document.body.insertAdjacentHTML("beforeend", html);
      modal = document.getElementById(modalId);
    } else {
      document.getElementById("friendSelectGroupName").textContent = groupName;
      document.getElementById("friendSelectList").innerHTML = friendsListHtml;
    }
    
    modal.classList.remove("hidden");
    modal.classList.add("active");
    if (typeof feather !== "undefined") feather.replace();
    
    const closeBtn = document.getElementById("friendSelectCloseBtn");
    const listContainer = document.getElementById("friendSelectList");
    
    const cleanup = () => {
      modal.classList.add("hidden");
      modal.classList.remove("active");
      closeBtn.onclick = null;
      listContainer.onclick = null;
      modal.onclick = null;
    };
    
    closeBtn.onclick = () => {
      cleanup();
      resolve(null);
    };
    
    modal.onclick = (e) => {
      if (e.target === modal) {
        cleanup();
        resolve(null);
      }
    };
    
    listContainer.onclick = (e) => {
      const item = e.target.closest(".friend-select-item");
      if (item) {
        const userId = item.dataset.userId;
        const selectedFriend = friends.find(f => f._id === userId);
        cleanup();
        resolve(selectedFriend);
      }
    };
    listContainer.querySelectorAll(".friend-select-item").forEach(item => {
      item.onmouseenter = () => {
        item.style.background = "rgba(90, 138, 140, 0.1)";
        item.style.borderColor = "var(--primary)";
      };
      item.onmouseleave = () => {
        item.style.background = "transparent";
        item.style.borderColor = "transparent";
      };
    });
  });
}

async function saveGroupProfile() {
  if (!selectedGroup) return;

  const newName = document.getElementById("editGroupName").value.trim();
  const avatarInput = document.getElementById("groupAvatarInput");
  const avatarFile = avatarInput ? avatarInput.files[0] : null;

  if (!newName) return Toast.show("Nama grup tidak boleh kosong", "error");

  const btn = document.getElementById("saveGroupProfileBtn");
  btn.disabled = true;
  btn.innerHTML = "Menyimpan...";

  try {
    let avatarBase64 = null;
    if (avatarFile) {
      if (avatarFile.size > 2 * 1024 * 1024) {
        throw new Error("Ukuran avatar terlalu besar (maks 2MB)");
      }
      avatarBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(avatarFile);
      });
    }

    const res = await fetch(`${API_URL}/groups/${selectedGroup._id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nama: newName,
        avatar: avatarBase64,
        userId: currentUser.id,
      }),
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Gagal menyimpan");

    Toast.show("Info grup berhasil diperbarui", "success");
    selectedGroup.nama = newName;
    if (avatarBase64) {
      selectedGroup.avatar = avatarBase64;
    }
    displayGroupsDebounced();
    const headerName = document.querySelector(".chat-header-info h3");
    if (headerName) headerName.textContent = newName;
    
    closeGroupProfileModal();
  } catch (err) {
    Toast.show(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML =
      '<i data-feather="check" style="width: 18px; height: 18px; margin-right: 8px; vertical-align: -4px;"></i> Simpan';
    if (typeof feather !== "undefined") feather.replace();
  }
}

socket.on("message_deleted", (payload) => {
  const { messageId, groupId, from, to, newLastMessage } = payload;

  updateUIMessageAsDeleted(messageId);

  const chatId = groupId ? groupId : from === currentUser.username ? to : from;

  let targetId = chatId;
  if (!groupId) {
    const user = window.allUsers
      ? window.allUsers.find((u) => u.username === chatId)
      : null;
    if (user) targetId = user._id;
  }

  const currentLastMessage = groupId
    ? getLastMessageForGroup(chatId)
    : getLastMessageForUser(targetId);

  if (currentLastMessage && currentLastMessage.id === messageId) {
    let newSummaryText;
    let newTimestamp;
    let newId;

    if (newLastMessage) {
      if (newLastMessage.isDeleted) {
        newSummaryText = "Pesan ini telah dihapus";
      } else {
        newSummaryText =
          newLastMessage.message ||
          (newLastMessage.file?.name
            ? `📎 ${newLastMessage.file.name}`
            : "Pesan media");
      }
      newTimestamp = newLastMessage.timestamp;
      newId = newLastMessage._id;

      if (groupId) {
        saveLastMessageGroup(chatId, newSummaryText, newTimestamp, newId);
      } else {
        saveLastMessage(targetId, newSummaryText, newTimestamp, newId);
      }
    } else {
      newSummaryText = "Pesan ini telah dihapus";
      newTimestamp = new Date(payload.timestamp);
      newId = messageId;

      if (groupId) {
        saveLastMessageGroup(chatId, newSummaryText, newTimestamp, newId);
      } else {
        saveLastMessage(targetId, newSummaryText, newTimestamp, newId);
      }
    }

    if (chatHistory[chatId]) {
      chatHistory[chatId].lastMessage = newSummaryText;
      chatHistory[chatId].timestamp = new Date(newTimestamp);
    }

    updateRecentChatsDisplay();
  }
});
socket.on("message_hidden", (payload) => {
  const { messageId, groupId, from, to, newLastMessage } = payload;
  const chatId = groupId ? groupId : from === currentUser.username ? to : from;

  let targetId = chatId;
  if (!groupId) {
    const user = window.allUsers
      ? window.allUsers.find((u) => u.username === chatId)
      : null;
    if (user) targetId = user._id;
  }
  const currentLastMessage = groupId
    ? getLastMessageForGroup(chatId)
    : getLastMessageForUser(targetId);

  if (currentLastMessage && currentLastMessage.id === messageId) {
    let newSummaryText;
    let newTimestamp;
    let newId;

    if (newLastMessage) {
      if (newLastMessage.isDeleted) {
        newSummaryText = "Pesan ini telah dihapus";
      } else {
        newSummaryText =
          newLastMessage.message ||
          (newLastMessage.file?.name
            ? `📎 ${newLastMessage.file.name}`
            : "Pesan media");
      }
      newTimestamp = newLastMessage.timestamp;
      newId = newLastMessage._id;
    } else {
      newSummaryText = "Ketuk untuk memulai chat";
      newTimestamp = new Date();
      newId = null;
    }

    if (groupId) {
      if (newId) {
        saveLastMessageGroup(chatId, newSummaryText, newTimestamp, newId);
      } else {
        localStorage.removeItem(`lastMsg-${currentUser.id}-group-${chatId}`);
      }
    } else {
      if (newId) {
        saveLastMessage(targetId, newSummaryText, newTimestamp, newId);
      } else {
        localStorage.removeItem(`lastMsg-${currentUser.id}-${targetId}`);
      }
    }

    if (chatHistory[chatId]) {
      chatHistory[chatId].lastMessage = newSummaryText;
      chatHistory[chatId].timestamp = new Date(newTimestamp);
    }

    updateRecentChatsDisplay();
  }
});

socket.on("receive_message", (msg) => {
  const summaryText =
    msg.message ||
    (msg.file && msg.file.type && msg.file.type.startsWith("image/")
      ? "📷 Foto"
      : "") ||
    (msg.file && msg.file.type && msg.file.type.startsWith("audio/")
      ? "🎤 Voice note"
      : "") ||
    (msg.file && msg.file.name ? `📎 ${msg.file.name}` : "");

  if (msg.groupId) {
    const group = (allGroups || []).find((g) => g._id === msg.groupId);
    const sender = (window.allUsers || []).find((u) => u.username === msg.from);
    const senderName = sender ? sender.nama : (msg.from === currentUser.username ? "Anda" : msg.from);

    addToChatHistory(
      msg.groupId,
      group?.nama || "Group",
      summaryText,
      true,
      msg._id,
      msg.timestamp,
      senderName // Pass actual sender name
    );
    saveLastMessageGroup(msg.groupId, summaryText, msg.timestamp, msg._id, senderName);

    if (selectedGroup && msg.groupId === selectedGroup._id) {
      addGroupMessageToUI(msg);
    } else {
      incrementUnread(msg.groupId, true);
    }
  } else {
    const sender = (window.allUsers || []).find((u) => u.username === msg.from);
    addToChatHistory(
      msg.from,
      sender?.nama || msg.from,
      summaryText,
      false,
      msg._id,
      msg.timestamp
    );
    if (
      selectedUser &&
      (msg.from === selectedUser.username || msg.to === selectedUser.username)
    ) {
      addMessageToUI(msg);
    } else {
      const userItem = document.getElementById(`user-item-${msg.from}`);
      if (userItem) {
        userItem.style.background = "rgba(99, 102, 241, 0.1)";
        setTimeout(() => (userItem.style.background = ""), 3000);
      }
      incrementUnread(msg.from, false);
    }
  }
});
socket.on("group_updated", (data) => {
  const { group } = data;
  const groupIndex = allGroups.findIndex(g => g._id === group._id);
  if (groupIndex !== -1) {
    allGroups[groupIndex] = group;
  }
  if (selectedGroup && selectedGroup._id === group._id) {
    selectedGroup.nama = group.nama;
    selectedGroup.avatar = group.avatar;
    const headerName = document.querySelector(".chat-header-info h3");
    if (headerName) headerName.textContent = group.nama;
  }
  displayGroupsDebounced();
});

socket.on("user_profile_updated", (data) => {
  const { userId, nama, avatar, username } = data;
  if (currentUser && currentUser.id === userId) {
    currentUser.nama = nama;
    currentUser.avatar = avatar;
    localStorage.setItem("currentUser", JSON.stringify(currentUser));
  }
  if (window.allUsers) {
    const u = window.allUsers.find((u) => u._id === userId);
    if (u) {
      u.nama = nama;
      u.avatar = avatar;
      u.username = username;
    }
  }
  const chatItem = document.getElementById(`chat-item-${username}`);
  if (chatItem) {
    const nameEl = chatItem.querySelector(".chat-item-info h4");
    if (nameEl) nameEl.textContent = nama;
    const avatarWrapper = chatItem.querySelector(
      ".chat-avatar-wrapper, .avatar-container-ring"
    );
    if (avatarWrapper) {
      const isOnline =
        window.userStatusMap && window.userStatusMap[username] === "online";
      const userObj = { _id: userId, username, nama, avatar };
      const newAvatarHTML = createAvatarHTML(
        userObj,
        "avatar small",
        isOnline
      );
      if (avatarWrapper.classList.contains("avatar-container-ring")) {
         const oldAvatar = avatarWrapper.querySelector(".avatar");
         if (oldAvatar) {
             oldAvatar.outerHTML = newAvatarHTML;
         }
      } else {
         avatarWrapper.innerHTML = newAvatarHTML;
      }
    }
  }
  if (selectedUser && selectedUser._id === userId) {
    selectedUser.nama = nama;
    selectedUser.avatar = avatar;
    const headerName = document.querySelector(".chat-header-info h3");
    if (headerName) headerName.textContent = nama;
    const headerAvatarContainer = document.querySelector(".chat-header-avatar");
    if (headerAvatarContainer) {
      const isOnline =
        window.userStatusMap && window.userStatusMap[username] === "online";
      const userObj = { _id: userId, username, nama, avatar };
      headerAvatarContainer.innerHTML = createAvatarHTML(
        userObj,
        "avatar",
        isOnline
      );
    }
  }
  if (
    window.ContactsModal &&
    window.ContactsModal.isOpen &&
    window.ContactsModal.currentUsers
  ) {
    const userInList = window.ContactsModal.currentUsers.find(
      (u) => u._id === userId
    );
    if (userInList) {
      userInList.nama = nama;
      userInList.avatar = avatar;
      window.ContactsModal.renderUserList(window.ContactsModal.currentUsers);
    }
  }
});

function updateUIMessageAsDeleted(messageId) {
  const messageEl = document.getElementById(`message-${messageId}`);
  if (messageEl) {
    if (messageEl.classList.contains("deleted-message")) return;

    const isGroup = messageEl.classList.contains("group-message");
    const isMe = messageEl.classList.contains("outgoing");
    const timeEl = messageEl.querySelector(".msg-time");
    const timeHTML = timeEl
      ? timeEl.outerHTML
      : `<span class="msg-time">${new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}</span>`;

    let deletedContent = "";

    if (isGroup && !isMe) {
      const senderNameEl = messageEl.querySelector(
        'small[style*="color: var(--primary)"]'
      );
      if (senderNameEl) {
        deletedContent += senderNameEl.outerHTML;
      }
    }

    deletedContent += `<p style="margin:0; font-style:italic; opacity:0.7;">Pesan ini telah dihapus</p>`;

    messageEl.innerHTML = deletedContent + timeHTML;

    messageEl.className = `message ${isMe ? "outgoing" : "incoming"} ${
      isGroup ? "group-message" : ""
    } deleted-message`;
  }
}

function deleteMessageForEveryone() {
  if (!selectedMessageElement) return;
  const messageId = selectedMessageElement.dataset.messageId;
  if (!messageId || messageId.startsWith("temp-")) {
    return Toast.show("Tidak bisa menghapus pesan ini.", "error");
  }

  updateUIMessageAsDeleted(messageId);
  socket.emit("delete_message_for_everyone", { messageId });
  document.getElementById("messageContextMenu").classList.add("hidden");
  selectedMessageElement = null;
}

function deleteMessageForMe() {
  if (!selectedMessageElement) return;
  
  const messageId = selectedMessageElement.dataset.messageId;
  if (!messageId || messageId.startsWith("temp-")) {
    selectedMessageElement.style.display = "none";
    Toast.show(`Pesan dihapus (hanya untuk Anda).`, "info");
    document.getElementById("messageContextMenu").classList.add("hidden");
    selectedMessageElement = null;
    return;
  }
  socket.emit("delete_message_for_me", { messageId });
  selectedMessageElement.style.display = "none";
  Toast.show(`Pesan dihapus (hanya untuk Anda).`, "info");
  document.getElementById("messageContextMenu").classList.add("hidden");
  selectedMessageElement = null;
}

function startReply() {
  if (!selectedMessageElement) return;

  const messageId = selectedMessageElement.dataset.messageId;
  const senderName = selectedMessageElement.dataset.senderName;
  let content = selectedMessageElement.querySelector("p")?.textContent;

  if (!content) {
    if (selectedMessageElement.querySelector(".msg-img")) {
      content = "📷 Gambar";
    } else if (selectedMessageElement.querySelector(".audio-player")) {
      content = "🎤 Voice note";
    } else if (selectedMessageElement.querySelector(".file-bubble")) {
      content = `📎 ${
        selectedMessageElement.querySelector(".file-bubble-text span")
          ?.textContent || "File"
      }`;
    } else {
      content = "Pesan media";
    }
  }

  if (!messageId || !senderName) {
    Toast.show("Tidak bisa membalas pesan ini", "error");
    return;
  }

  currentReplyContext = { messageId, senderName, content };
  showReplyPreview(currentReplyContext);

  document.getElementById("messageContextMenu").classList.add("hidden");
  selectedMessageElement = null;
}

function showReplyPreview(context) {
  const preview = document.getElementById("replyPreview");
  document.getElementById("replyPreviewName").textContent = context.senderName;
  document.getElementById("replyPreviewText").textContent = context.content;
  preview.classList.remove("hidden");
  document.getElementById("messageInput").focus();
}

function cancelReply() {
  currentReplyContext = null;
  const preview = document.getElementById("replyPreview");
  preview.classList.add("hidden");
  document.getElementById("replyPreviewName").textContent = "";
  document.getElementById("replyPreviewText").textContent = "";
}

function scrollToMessage(event, messageId) {
  event.preventDefault();
  const targetMessage = document.getElementById(`message-${messageId}`);
  if (targetMessage) {
    targetMessage.scrollIntoView({ behavior: "smooth", block: "center" });

    targetMessage.classList.add("highlight");
    setTimeout(() => {
      targetMessage.classList.remove("highlight");
    }, 1500);
  } else {
    Toast.show("Pesan asli tidak ditemukan di chat ini.", "info");
  }
}

function getLastMessageForUser(userId) {
  try {
    const storage = localStorage.getItem(`lastMsg-${currentUser.id}-${userId}`);
    if (storage) return JSON.parse(storage);
  } catch (err) {}
  return null;
}

function saveLastMessage(userId, message, timestamp, messageId) {
  try {
    const lastMsg = { message, timestamp, id: messageId };
    localStorage.setItem(
      `lastMsg-${currentUser.id}-${userId}`,
      JSON.stringify(lastMsg)
    );
  } catch (err) {}
}

function formatMessageTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("id-ID", { month: "short", day: "numeric" });
}

function saveCallToHistoryWithStatus(
  targetUsername,
  targetName,
  type,
  duration,
  status,
  direction
) {
  const call = {
    id: Date.now(),
    username: targetUsername,
    name: targetName,
    type: type,
    duration: duration,
    timestamp: new Date(),
    status: status,
    direction: direction,
  };

  callHistory.unshift(call);

  try {
    const stored = JSON.parse(
      localStorage.getItem(`callHistory-${currentUser.username}`) || "[]"
    );
    stored.unshift(call);
    localStorage.setItem(
      `callHistory-${currentUser.username}`,
      JSON.stringify(stored.slice(0, 50))
    );
  } catch (err) {}

  
  if (status === "missed" && direction === "incoming") {
    updateCallsBadge();
  }
}


function saveCallToHistory(targetUsername, targetName, type, duration) {
  saveCallToHistoryWithStatus(
    targetUsername,
    targetName,
    type,
    duration,
    "completed",
    "outgoing"
  );
}

function loadCallHistory() {
  try {
    const stored = localStorage.getItem(`callHistory-${currentUser.username}`);
    callHistory = stored ? JSON.parse(stored) : [];
    displayCallHistory();
  } catch (err) {
    displayCallHistory();
  }
}

function displayCallHistory() {
  const list = document.getElementById("callsList");

  if (!list) return;

  list.innerHTML = "";

  if (!callHistory || callHistory.length === 0) {
    list.innerHTML = `
      <div class="call-empty" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center; color: var(--text-secondary);">
        <i data-feather="phone" style="width: 48px; height: 48px; opacity: 0.5; margin-bottom: 15px;"></i>
        <p>Belum ada riwayat panggilan</p>
      </div>
    `;
    if (typeof feather !== "undefined") feather.replace();
    return;
  }

  callHistory.forEach((call) => {
    const div = document.createElement("div");
    div.className = "call-item";

    let durationText = "";
    if (call.status === "completed" && call.duration) {
      durationText = formatDuration(call.duration);
    }

    const callDate = new Date(call.timestamp);

    const callButtonIcon = call.type === "video" ? "video" : "phone";
    const callButtonText = call.type === "video" ? "Video Call" : "Voice Call";

    div.innerHTML = `
      <div class="avatar small" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
        ${call.name.charAt(0).toUpperCase()}
      </div>
      <div class="call-item-info">
        <h4>${call.name}</h4>
        <div class="call-status-details">
          <small>${
            call.type === "video" ? "Panggilan video" : "Panggilan suara"
          }</small>
        </div>
      </div>
      <div class="call-item-time">
        <small>${formatCallDate(callDate)}</small>
      </div>
      <button onclick="initiateCallFromHistory(event, '${call.username}', '${
      call.type
    }', '${call.name.replace(
      /'/g,
      "\\'"
    )}')" class="icon-btn" title="${callButtonText}">
        <i data-feather="${callButtonIcon}" style="width:18px; height:18px;"></i>
      </button>
    `;

    list.appendChild(div);
  });

  if (typeof feather !== "undefined") feather.replace();
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

function formatCallDate(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("id-ID", { month: "short", day: "numeric" });
}

let previousInnerHeight = window.innerHeight;

window.addEventListener("resize", () => {
  const currentInnerHeight = window.innerHeight;
  const keyboardHeight = previousInnerHeight - currentInnerHeight;

  if (currentInnerHeight < previousInnerHeight) {
    const messagesContainer = document.getElementById("messagesContainer");
    if (messagesContainer) {
      setTimeout(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }, 100);
    }
  }

  previousInnerHeight = currentInnerHeight;
});

document.addEventListener("focusin", (e) => {
  if (e.target.matches(".input-area input, textarea")) {
    setTimeout(() => {
      const messagesContainer = document.getElementById("messagesContainer");
      if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    }, 100);
  }
});

let currentPreviewImage = null;
let currentPreviewImageName = "image.jpg";

function openImagePreview(imageSrc) {
  currentPreviewImage = imageSrc;
  const modal = document.getElementById("imagePreviewModal");
  const imgElement = document.getElementById("previewImageSrc");

  imgElement.src = imageSrc;
  modal.classList.remove("hidden");
  modal.classList.add("active");

  document.body.style.overflow = "hidden";
}

function closeImagePreview() {
  const modal = document.getElementById("imagePreviewModal");
  modal.classList.add("hidden");
  modal.classList.remove("active");
  currentPreviewImage = null;

  document.body.style.overflow = "auto";
}

function downloadPreviewImage() {
  if (!currentPreviewImage) return;

  const link = document.createElement("a");
  link.href = currentPreviewImage;
  link.download = currentPreviewImageName || "image.jpg";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  Toast.show("Gambar sedang diunduh...", "success");
}

document.addEventListener("click", (e) => {
  const modal = document.getElementById("imagePreviewModal");
  if (modal && modal.classList.contains("active")) {
    if (e.target === modal || e.target.id === "imagePreviewModal") {
      closeImagePreview();
    }
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const modal = document.getElementById("imagePreviewModal");
    if (modal && modal.classList.contains("active")) {
      closeImagePreview();
    }
  }
});

function startGroupCall(type) {
  if (!selectedGroup) return;

  groupCallManager.startCall(selectedGroup, type === "video");
}


const groupCallManager = {
  groupId: null,
  groupName: null,
  isVideo: false,
  localStream: null,
  peerConnections: new Map(), 
  remoteStreams: new Map(), 
  isMuted: false,
  isCameraOff: false,
  callTimer: null,
  callDuration: 0,
  isInCall: false,
  pendingIncomingCall: null,

  config: { 
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" }
    ] 
  },

  
  async startCall(group, isVideo) {
    if (this.isInCall) {
      Toast.show("Anda sedang dalam panggilan", "warning");
      return;
    }

    this.groupId = group._id;
    this.groupName = group.nama;
    this.isVideo = isVideo;
    this.isInCall = true;

    try {
      await this.setupMedia();
      this.showCallModal();
      
      socket.emit("group_call_start", {
        groupId: this.groupId,
        callType: isVideo ? "video" : "voice",
        from: currentUser.username
      });

      this.startTimer();
    } catch (e) {
      Toast.show("Gagal memulai panggilan: " + e.message, "error");
      this.cleanup();
    }
  },

  
  async joinCall(groupId, groupName, isVideo) {
    if (this.isInCall) {
      Toast.show("Anda sedang dalam panggilan", "warning");
      return;
    }

    this.groupId = groupId;
    this.groupName = groupName;
    this.isVideo = isVideo;
    this.isInCall = true;

    try {
      await this.setupMedia();
      this.showCallModal();
      
      socket.emit("group_call_join", {
        groupId: this.groupId,
        username: currentUser.username
      });

      this.startTimer();
    } catch (e) {
      Toast.show("Gagal bergabung panggilan: " + e.message, "error");
      this.cleanup();
    }
  },

  
  async setupMedia() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: this.isVideo,
        audio: true
      });

      const localVideo = document.getElementById("groupLocalVideo");
      if (localVideo) {
        localVideo.srcObject = this.localStream;
      }
      const localAvatarEl = document.getElementById("localParticipantAvatar");
      if (localAvatarEl && currentUser) {
        localAvatarEl.outerHTML = createAvatarHTML(
          currentUser,
          "participant-avatar",
          true // Always show online status for self
        );
        const newAvatar = document.querySelector("#localParticipantTile .participant-avatar");
        if(newAvatar) newAvatar.id = "localParticipantAvatar";
      }
    } catch (e) {
      throw new Error("Tidak dapat mengakses kamera/mikrofon");
    }
  },

  
  createPeerConnection(username) {
    if (this.peerConnections.has(username)) {
      return this.peerConnections.get(username);
    }

    const pc = new RTCPeerConnection(this.config);

    
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    
    pc.ontrack = (event) => {
      this.remoteStreams.set(username, event.streams[0]);
      this.addParticipantTile(username, event.streams[0]);
    };

    
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("group_call_ice", {
          groupId: this.groupId,
          to: username,
          from: currentUser.username,
          candidate: event.candidate
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        this.removeParticipant(username);
      }
    };

    this.peerConnections.set(username, pc);
    return pc;
  },

  
  async sendOffer(username) {
    const pc = this.createPeerConnection(username);
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      socket.emit("group_call_offer", {
        groupId: this.groupId,
        to: username,
        from: currentUser.username,
        offer: offer
      });
    } catch (e) {
      console.error("Error creating offer:", e);
    }
  },

  
  async handleOffer(from, offer) {
    const pc = this.createPeerConnection(from);
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      socket.emit("group_call_answer", {
        groupId: this.groupId,
        to: from,
        from: currentUser.username,
        answer: answer
      });
    } catch (e) {
      console.error("Error handling offer:", e);
    }
  },

  
  async handleAnswer(from, answer) {
    const pc = this.peerConnections.get(from);
    if (pc) {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (e) {
        console.error("Error handling answer:", e);
      }
    }
  },

  
  async handleIceCandidate(from, candidate) {
    const pc = this.peerConnections.get(from);
    if (pc) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.error("Error adding ICE candidate:", e);
      }
    }
  },

  
  addParticipantTile(username, stream) {
    const grid = document.getElementById("participantsGrid");
    if (!grid) return;

    
    if (document.getElementById(`tile-${username}`)) return;

    const user = window.allUsers?.find(u => u.username === username) || { nama: username };
    
    const tile = document.createElement("div");
    tile.className = "participant-tile remote-tile";
    tile.id = `tile-${username}`;
    const isOnline = window.userStatusMap && window.userStatusMap[username] === "online";
    const avatarHTML = createAvatarHTML(
      { username, nama: user.nama || username, avatar: user.avatar, _id: user._id },
      "participant-avatar",
      isOnline
    );

    tile.innerHTML = `
      <video autoplay playsinline></video>
      ${avatarHTML}
      <div class="participant-overlay">
        <span class="participant-name">${escapeHtml(user.nama || username)}</span>
        <div class="participant-status">
          <i data-feather="mic" class="mic-status"></i>
        </div>
      </div>
    `;

    const video = tile.querySelector("video");
    if (video && stream) {
      video.srcObject = stream;
    }

    grid.appendChild(tile);
    this.updateGridLayout();
    
    if (typeof feather !== "undefined") feather.replace();
  },

  
  removeParticipant(username) {
    const pc = this.peerConnections.get(username);
    if (pc) {
      pc.close();
      this.peerConnections.delete(username);
    }

    this.remoteStreams.delete(username);

    const tile = document.getElementById(`tile-${username}`);
    if (tile) {
      tile.remove();
    }

    this.updateGridLayout();
    this.updateParticipantCount();
  },

  
  updateGridLayout() {
    const grid = document.getElementById("participantsGrid");
    if (!grid) return;

    const count = grid.querySelectorAll(".participant-tile").length;
    grid.setAttribute("data-count", Math.min(count, 6));
  },

  
  updateParticipantCount() {
    const countEl = document.getElementById("groupCallParticipantCount");
    if (countEl) {
      const count = this.peerConnections.size + 1; 
      countEl.textContent = `${count} peserta`;
    }
  },

  
  showCallModal() {
    const modal = document.getElementById("groupCallModal");
    const nameEl = document.getElementById("groupCallName");
    
    if (modal) {
      modal.classList.remove("hidden");
      modal.classList.add("active");
    }

    if (nameEl) {
      nameEl.textContent = this.groupName || "Group Call";
    }

    this.updateGridLayout();
    this.updateParticipantCount();
    
    if (typeof feather !== "undefined") feather.replace();
  },

  
  hideCallModal() {
    const modal = document.getElementById("groupCallModal");
    if (modal) {
      modal.classList.add("hidden");
      modal.classList.remove("active");
    }
  },

  
  showIncomingCall(groupId, groupName, callType, initiator) {
    this.pendingIncomingCall = { groupId, groupName, callType, initiator };

    const modal = document.getElementById("groupCallIncoming");
    const nameEl = document.getElementById("groupCallIncomingName");
    const infoEl = document.getElementById("groupCallIncomingInfo");
    const avatarEl = document.getElementById("groupCallIncomingAvatar");

    if (modal) {
      modal.classList.remove("hidden");
      modal.classList.add("active");
    }

    if (nameEl) nameEl.textContent = groupName;
    if (infoEl) infoEl.textContent = `${initiator} memulai ${callType === "video" ? "Video" : "Voice"} Call`;
    if (avatarEl) avatarEl.textContent = groupName.charAt(0).toUpperCase();

    if (typeof feather !== "undefined") feather.replace();
  },

  
  hideIncomingCall() {
    const modal = document.getElementById("groupCallIncoming");
    if (modal) {
      modal.classList.add("hidden");
      modal.classList.remove("active");
    }
    this.pendingIncomingCall = null;
  },

  
  toggleMute() {
    if (!this.localStream) return;

    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      this.isMuted = !audioTrack.enabled;

      const btn = document.getElementById("gcMuteBtn");
      if (btn) {
        btn.classList.toggle("muted", this.isMuted);
        const icon = btn.querySelector("i");
        if (icon) {
          icon.setAttribute("data-feather", this.isMuted ? "mic-off" : "mic");
          if (typeof feather !== "undefined") feather.replace();
        }
      }

      
      const localTile = document.getElementById("localParticipantTile");
      if (localTile) {
        const micIcon = localTile.querySelector(".mic-status");
        if (micIcon) {
          micIcon.classList.toggle("muted", this.isMuted);
        }
      }

      
      socket.emit("group_call_mute_toggle", {
        groupId: this.groupId,
        username: currentUser.username,
        isMuted: this.isMuted
      });
    }
  },

  
  toggleCamera() {
    if (!this.localStream) return;

    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      this.isCameraOff = !videoTrack.enabled;

      const btn = document.getElementById("gcCameraBtn");
      if (btn) {
        btn.classList.toggle("camera-off", this.isCameraOff);
        const icon = btn.querySelector("i");
        if (icon) {
          icon.setAttribute("data-feather", this.isCameraOff ? "video-off" : "video");
          if (typeof feather !== "undefined") feather.replace();
        }
      }

      
      const localTile = document.getElementById("localParticipantTile");
      if (localTile) {
        localTile.classList.toggle("video-off", this.isCameraOff);
      }

      
      socket.emit("group_call_camera_toggle", {
        groupId: this.groupId,
        username: currentUser.username,
        isCameraOff: this.isCameraOff
      });
    }
  },

  
  startTimer() {
    this.callDuration = 0;
    if (this.callTimer) clearInterval(this.callTimer);

    this.callTimer = setInterval(() => {
      this.callDuration++;
      const minutes = Math.floor(this.callDuration / 60);
      const seconds = this.callDuration % 60;
      const timerEl = document.getElementById("groupCallTimer");
      if (timerEl) {
        timerEl.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
      }
    }, 1000);
  },

  
  stopTimer() {
    if (this.callTimer) {
      clearInterval(this.callTimer);
      this.callTimer = null;
    }
  },

  
  endCall() {
    socket.emit("group_call_leave", {
      groupId: this.groupId,
      username: currentUser.username
    });

    this.cleanup();
  },

  
  cleanup() {
    this.stopTimer();

    
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    
    this.peerConnections.forEach(pc => pc.close());
    this.peerConnections.clear();
    this.remoteStreams.clear();

    
    const grid = document.getElementById("participantsGrid");
    if (grid) {
      const remoteTiles = grid.querySelectorAll(".remote-tile");
      remoteTiles.forEach(tile => tile.remove());
    }

    
    this.groupId = null;
    this.groupName = null;
    this.isVideo = false;
    this.isMuted = false;
    this.isCameraOff = false;
    this.isInCall = false;
    this.isMinimized = false;
    this.callDuration = 0;

    
    this.hideCallModal();
    this.hideIncomingCall();
    
    
    const pip = document.getElementById("groupCallPip");
    if (pip) pip.classList.add("hidden");

    
    const muteBtn = document.getElementById("gcMuteBtn");
    const camBtn = document.getElementById("gcCameraBtn");
    if (muteBtn) muteBtn.classList.remove("muted");
    if (camBtn) camBtn.classList.remove("camera-off");

    this.updateGridLayout();
  }
};



socket.on("group_call_started", (data) => {
  
  groupCallManager.updateParticipantCount();
});

socket.on("group_call_incoming", (data) => {
  const { groupId, groupName, callType, initiator } = data;
  
  
  if (groupCallManager.isInCall) return;
  
  groupCallManager.showIncomingCall(groupId, groupName, callType, initiator);
});

socket.on("group_call_participants", (data) => {
  const { participants, callType } = data;
  
  
  participants.forEach(username => {
    groupCallManager.sendOffer(username);
  });
});

socket.on("group_call_participant_joined", (data) => {
  const { username, participantCount } = data;
  
  
  groupCallManager.updateParticipantCount();
  Toast.show(`${username} bergabung ke panggilan`, "info");
});

socket.on("group_call_offer", async (data) => {
  const { from, offer } = data;
  await groupCallManager.handleOffer(from, offer);
});

socket.on("group_call_answer", async (data) => {
  const { from, answer } = data;
  await groupCallManager.handleAnswer(from, answer);
});

socket.on("group_call_ice", async (data) => {
  const { from, candidate } = data;
  await groupCallManager.handleIceCandidate(from, candidate);
});

socket.on("group_call_participant_left", (data) => {
  const { username, participantCount } = data;
  groupCallManager.removeParticipant(username);
  Toast.show(`${username} meninggalkan panggilan`, "info");
});

socket.on("group_call_ended", (data) => {
  Toast.show("Panggilan grup berakhir", "info");
  groupCallManager.cleanup();
});

socket.on("group_call_participant_muted", (data) => {
  const { username, isMuted } = data;
  const tile = document.getElementById(`tile-${username}`);
  if (tile) {
    const micIcon = tile.querySelector(".mic-status");
    if (micIcon) {
      micIcon.classList.toggle("muted", isMuted);
      micIcon.setAttribute("data-feather", isMuted ? "mic-off" : "mic");
      if (typeof feather !== "undefined") feather.replace();
    }
  }
});

socket.on("group_call_participant_camera", (data) => {
  const { username, isCameraOff } = data;
  const tile = document.getElementById(`tile-${username}`);
  if (tile) {
    tile.classList.toggle("video-off", isCameraOff);
  }
});

socket.on("group_call_error", (data) => {
  Toast.show(data.error || "Terjadi kesalahan", "error");
  groupCallManager.cleanup();
});



function toggleGroupCallMute() {
  groupCallManager.toggleMute();
}

function toggleGroupCallCamera() {
  groupCallManager.toggleCamera();
}

function endGroupCall() {
  groupCallManager.endCall();
}

function acceptGroupCall() {
  const call = groupCallManager.pendingIncomingCall;
  if (call) {
    groupCallManager.hideIncomingCall();
    groupCallManager.joinCall(call.groupId, call.groupName, call.callType === "video");
  }
}

function rejectGroupCall() {
  const call = groupCallManager.pendingIncomingCall;
  if (call) {
    socket.emit("group_call_reject", {
      groupId: call.groupId,
      username: currentUser.username
    });
  }
  groupCallManager.hideIncomingCall();
}

function minimizeGroupCall() {
  if (!groupCallManager.isInCall) return;

  const pip = document.getElementById("groupCallPip");
  const pipVideo = document.getElementById("pipLocalVideo");
  const pipTimer = document.getElementById("pipTimer");
  const pipGroupName = document.getElementById("pipGroupName");
  const pipMuteBtn = document.getElementById("pipMuteBtn");

  
  if (groupCallManager.localStream && pipVideo) {
    pipVideo.srcObject = groupCallManager.localStream;
  }

  
  if (pipGroupName) {
    pipGroupName.textContent = groupCallManager.groupName || "Group";
  }

  
  if (pipMuteBtn) {
    pipMuteBtn.classList.toggle("muted", groupCallManager.isMuted);
    const icon = pipMuteBtn.querySelector("i");
    if (icon) {
      icon.setAttribute("data-feather", groupCallManager.isMuted ? "mic-off" : "mic");
    }
  }

  
  groupCallManager.hideCallModal();
  pip.classList.remove("hidden");
  groupCallManager.isMinimized = true;

  
  if (groupCallManager.callTimer) {
    clearInterval(groupCallManager.callTimer);
  }
  groupCallManager.callTimer = setInterval(() => {
    groupCallManager.callDuration++;
    const minutes = Math.floor(groupCallManager.callDuration / 60);
    const seconds = groupCallManager.callDuration % 60;
    const timeStr = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    
    if (pipTimer) pipTimer.textContent = timeStr;
    const mainTimer = document.getElementById("groupCallTimer");
    if (mainTimer) mainTimer.textContent = timeStr;
  }, 1000);

  if (typeof feather !== "undefined") feather.replace();
  Toast.show("Panggilan diminimalkan", "info");
}

function expandGroupCall() {
  if (!groupCallManager.isInCall) return;

  const pip = document.getElementById("groupCallPip");
  
  
  pip.classList.add("hidden");
  groupCallManager.showCallModal();
  groupCallManager.isMinimized = false;

  
  const localVideo = document.getElementById("groupLocalVideo");
  if (groupCallManager.localStream && localVideo) {
    localVideo.srcObject = groupCallManager.localStream;
  }

  if (typeof feather !== "undefined") feather.replace();
}


document.addEventListener("DOMContentLoaded", () => {
  const pip = document.getElementById("groupCallPip");
  if (!pip) return;

  let isDragging = false;
  let startX, startY, initialX, initialY;

  pip.addEventListener("mousedown", (e) => {
    if (e.target.closest(".pip-btn")) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = pip.getBoundingClientRect();
    initialX = rect.left;
    initialY = rect.top;
    pip.style.cursor = "grabbing";
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    pip.style.left = `${initialX + dx}px`;
    pip.style.top = `${initialY + dy}px`;
    pip.style.right = "auto";
    pip.style.bottom = "auto";
  });

  document.addEventListener("mouseup", () => {
    isDragging = false;
    pip.style.cursor = "move";
  });
});


function showUserProfilePopup(user) {
  let modal = document.getElementById("userProfilePopup");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "userProfilePopup";
    modal.className = "modal hidden";
    modal.style.zIndex = "5000";
    modal.innerHTML = `
      <div class="glass-panel profile-modal-content">
        <button class="close-modal" onclick="closeUserProfilePopup()" style="position: absolute; top: 15px; right: 15px; background: transparent; border: none; color: var(--text-secondary); cursor: pointer;"><i data-feather="x"></i></button>
        <div class="profile-modal-body" style="display: flex; flex-direction: column; align-items: center; text-align: center;">
            <div class="user-avatar-container" style="display: flex; justify-content: center; width: 100%; margin-bottom: 15px;">
                <div id="popupProfileAvatar"></div>
            </div>
            <div class="info-section">
                <h2 id="popupProfileName"></h2>
                <p id="popupProfileUsername" class="username-display"></p>
                <span id="popupProfileStatus" class="status-badge"></span>
            </div>
            <div class="action-buttons">
                <div class="main-actions">
                    <button class="action-btn" id="popupOpenChatBtn"><i data-feather="message-square"></i><span>Chat</span></button>
                    <button class="action-btn" id="popupVoiceCallBtn"><i data-feather="phone"></i><span>Panggil</span></button>
                    <button class="action-btn" id="popupVideoCallBtn"><i data-feather="video"></i><span>Video</span></button>
                </div>
                <button class="action-btn delete-friend-btn" id="popupDeleteFriendBtn" style="background: rgba(239, 68, 68, 0.08); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); margin-top: 20px; width: 100%; justify-content: center; padding: 12px; border-radius: 12px; font-weight: 600; font-size: 0.9rem; display: flex; align-items: center; gap: 8px; cursor: pointer;">
                   <i data-feather="user-x" style="width: 18px; height: 18px;"></i> Hapus Pertemanan
                </button>
                <div class="delete-chat-section" style="width: 100%;">
                    <button class="action-btn" id="popupDeleteChatBtn" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); width: 100%; justify-content: center; padding: 12px; border-radius: 10px; font-weight: 600; display: flex; align-items: center; gap: 8px; cursor: pointer;">
                        <i data-feather="trash-2" style="width: 18px; height: 18px;"></i> Hapus Semua Chat
                    </button>
                </div>
            </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const avatarContainer = document.getElementById("popupProfileAvatar");
  const isOnline =
    window.userStatusMap && window.userStatusMap[user.username] === "online";
  avatarContainer.innerHTML = createAvatarHTML(user, "avatar large", isOnline);

  document.getElementById("popupProfileName").textContent = user.nama;
  document.getElementById("popupProfileUsername").textContent =
    "@" + user.username;
  document.getElementById("popupProfileStatus").textContent =
    getUserStatusText(user);

  document.getElementById("popupDeleteFriendBtn").onclick = () =>
    deleteFriend(user._id, user.nama);
  document.getElementById("popupDeleteChatBtn").onclick = () =>
    deleteAllChat(user.username, user.nama, user._id);

  document.getElementById("popupOpenChatBtn").onclick = () => {
    selectUser(user);
    closeUserProfilePopup();
  };
  document.getElementById("popupVoiceCallBtn").onclick = () => {
    selectUser(user);
    closeUserProfilePopup();
    setTimeout(() => startCall("voice"), 50);
  };
  document.getElementById("popupVideoCallBtn").onclick = () => {
    selectUser(user);
    closeUserProfilePopup();
    setTimeout(() => startCall("video"), 50);
  };

  modal.classList.remove("hidden");
  modal.classList.add("active");

  const content = modal.querySelector(".profile-modal-content");
  if (content) {
    content.classList.remove("fade-scale-out");
    content.classList.add("fade-scale-in");
  }

  if (typeof feather !== "undefined") feather.replace();
}

function closeUserProfilePopup() {
  const modal = document.getElementById("userProfilePopup");
  if (modal) {
    const content = modal.querySelector(".profile-modal-content");
    if (content) {
      content.classList.remove("fade-scale-in");
      content.classList.add("fade-scale-out");

      setTimeout(() => {
        modal.classList.add("hidden");
        modal.classList.remove("active");
        content.classList.remove("fade-scale-out");
      }, 250);
    } else {
      modal.classList.add("hidden");
      modal.classList.remove("active");
    }
  }
}

function showConfirmModal(title, message, checkboxLabel = null) {
  return new Promise((resolve) => {
    const modalId = "customConfirmModal";
    let modal = document.getElementById(modalId);

    if (!modal) {
      const html = `
        <div id="${modalId}" class="modal hidden" style="z-index: 10000; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center;">
          <div class="glass-panel confirm-modal-content fade-scale-in" style="max-width: 350px; padding: 30px; text-align: center; border: 1px solid rgba(255,255,255,0.1); position: relative;">
            <div style="background: rgba(239, 68, 68, 0.1); color: #ef4444; width: 64px; height: 64px; border-radius: 20px; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">
              <i data-feather="user-x" style="width: 32px; height: 32px;"></i>
            </div>
            <h3 style="margin-bottom: 10px; font-size: 1.25rem; font-weight: 700;">${title}</h3>
            <p style="color: var(--text-secondary); margin-bottom: 25px; line-height: 1.6; font-size: 0.95rem;">${message}</p>
            ${
              checkboxLabel
                ? `
              <div style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 20px; color: var(--text-secondary); font-size: 0.85rem;">
                <input type="checkbox" id="modalConfirmCheckbox" style="cursor: pointer; width: 16px; height: 16px; accent-color: #ef4444;">
                <label for="modalConfirmCheckbox" style="cursor: pointer;">${checkboxLabel}</label>
              </div>
            `
                : ""
            }
            <div style="display: flex; gap: 12px;">
              <button id="confirmCancelBtn" style="flex: 1; background: var(--glass-bg); color: var(--text-primary); border: 1px solid var(--border-color); padding: 12px; border-radius: 12px; cursor: pointer; font-weight: 600; font-size: 0.9rem; transition: all 0.2s;">Batal</button>
              <button id="confirmOkBtn" style="flex: 1; background: #ef4444; color: white; border: none; padding: 12px; border-radius: 12px; cursor: pointer; font-weight: 600; font-size: 0.9rem; transition: all 0.2s; box-shadow: 0 4px 12px rgba(239, 68, 68, 0.2);">Hapus</button>
            </div>
          </div>
        </div>
      `;
      document.body.insertAdjacentHTML("beforeend", html);
      modal = document.getElementById(modalId);
    } else {
      modal.querySelector("h3").textContent = title;
      modal.querySelector("p").innerHTML = message;
    }

    modal.classList.remove("hidden");
    modal.classList.add("active");
    document.body.appendChild(modal);
    if (typeof feather !== "undefined") feather.replace();

    const okBtn = document.getElementById("confirmOkBtn");
    const cancelBtn = document.getElementById("confirmCancelBtn");

    const handleAction = (result) => {
      const checkbox = document.getElementById("modalConfirmCheckbox");
      const isChecked = checkbox ? checkbox.checked : false;
      modal.classList.add("hidden");
      modal.classList.remove("active");
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      resolve({ confirmed: result, checkboxChecked: isChecked });
    };

    okBtn.onclick = () => handleAction(true);
    cancelBtn.onclick = () => handleAction(false);
    modal.onclick = (e) => {
      if (e.target === modal) handleAction(false);
    };
  });
}

async function deleteFriend(friendId, friendName) {
  const { confirmed } = await showConfirmModal(
    "Hapus Pertemanan",
    `Apakah Anda yakin ingin menghapus <strong>${friendName}</strong> dari daftar teman?`
  );

  if (!confirmed) return;

  try {
    const res = await fetch(`${API_URL}/friends/${friendId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: currentUser.id }),
    });

    const data = await res.json();

    if (data.success) {
      Toast.show("Teman berhasil dihapus", "success");

      closeUserProfilePopup();
      if (selectedUser && selectedUser._id === friendId) {
        closeChat();
      }

      loadFriendsAndRequests(true);
    } else {
      Toast.show(data.error || "Gagal menghapus teman", "error");
    }
  } catch (err) {
    Toast.show("Kesalahan koneksi", "error");
  }
}

async function deleteAllChat(targetUsername, targetName, targetId) {
  const { confirmed, checkboxChecked: forEveryone } = await showConfirmModal(
    "Hapus Semua Chat",
    `Apakah Anda yakin ingin menghapus semua riwayat chat dengan <strong>${targetName}</strong>?`,
    `Hapus untuk ${targetName} juga`
  );

  if (!confirmed) return;

  try {
    const res = await fetch(`${API_URL}/messages/all`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: currentUser.username,
        to: targetUsername,
        forEveryone,
      }),
    });

    const data = await res.json();
    if (data.success) {
      Toast.show("Chat berhasil dibersihkan", "success");
      closeUserProfilePopup();

      if (selectedUser && selectedUser.username === targetUsername) {
        loadMessages(targetUsername);
      }

      localStorage.removeItem(`lastMsg-${currentUser.id}-${targetId}`);
      updateRecentChatsDisplay();
    }
  } catch (err) {
    Toast.show("Gagal menghapus chat", "error");
  }
}

socket.on("chat_cleared", (data) => {
  if (selectedUser && selectedUser.username === data.with) {
    loadMessages(data.with);
  }

  const user = (window.allUsers || []).find((u) => u.username === data.with);
  if (user) {
    localStorage.removeItem(`lastMsg-${currentUser.id}-${user._id}`);
    updateRecentChatsDisplay();
  }
});

let geminiHistory = [];
function loadGeminiHistory() {
  try {
    const saved = localStorage.getItem('fluxchat-gemini-history');
    if (saved) {
      geminiHistory = JSON.parse(saved);
      restoreGeminiChat();
    }
  } catch (e) {
    console.error('Failed to load Gemini history:', e);
  }
}
function saveGeminiHistory() {
  try {
    localStorage.setItem('fluxchat-gemini-history', JSON.stringify(geminiHistory));
  } catch (e) {
    console.error('Failed to save Gemini history:', e);
  }
}
function restoreGeminiChat() {
  const container = document.getElementById("geminiChatList");
  if (!container || geminiHistory.length === 0) return;
  const intro = container.querySelector(".gemini-intro");
  if (intro) intro.style.display = "none";
  geminiHistory.forEach(msg => {
    const div = document.createElement("div");
    const isUser = msg.role === "user";
    div.className = `gemini-message ${isUser ? "user" : "ai"}`;
    
    const text = msg.parts[0]?.text || "";
    if (isUser) {
      div.innerText = text;
    } else {
      div.innerHTML = formatGeminiText(text);
    }
    
    div.style.whiteSpace = "pre-wrap";
    container.appendChild(div);
  });
  
  container.scrollTop = container.scrollHeight;
}
function clearGeminiHistory() {
  geminiHistory = [];
  localStorage.removeItem('fluxchat-gemini-history');
  
  const container = document.getElementById("geminiChatList");
  if (container) {
    const messages = container.querySelectorAll('.gemini-message');
    messages.forEach(msg => msg.remove());
    const intro = container.querySelector(".gemini-intro");
    if (intro) intro.style.display = "flex";
  }
}
document.addEventListener("DOMContentLoaded", () => {
  loadGeminiHistory();
});

async function sendGeminiMessage() {
  const input = document.getElementById("geminiInput");
  const text = input.value.trim();
  if (!text) return;

  addGeminiBubble(text, true);
  input.value = "";
  input.disabled = true;

  const chatList = document.getElementById("geminiChatList");
  const loadingDiv = document.createElement("div");
  loadingDiv.className = "gemini-message ai loading-bubble";
  loadingDiv.innerHTML = `
    <div class="typing-indicator">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>`;
  chatList.appendChild(loadingDiv);
  chatList.scrollTop = chatList.scrollHeight;

  try {
    const res = await fetch(`${API_URL}/gemini`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        history: geminiHistory,
      }),
    });

    const data = await res.json();
    loadingDiv.remove();

    if (data.success) {
      addGeminiBubble(data.reply, false);

      geminiHistory.push({ role: "user", parts: [{ text: text }] });
      geminiHistory.push({ role: "model", parts: [{ text: data.reply }] });
      saveGeminiHistory();
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

function formatGeminiText(text) {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  html = html.replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>");

  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  return html;
}

function addGeminiBubble(text, isUser) {
  const container = document.getElementById("geminiChatList");

  const intro = container.querySelector(".gemini-intro");
  if (intro) intro.style.display = "none";

  const div = document.createElement("div");
  div.className = `gemini-message ${isUser ? "user" : "ai"}`;

  if (isUser) {
    div.innerText = text;
  } else {
    div.innerHTML = formatGeminiText(text);
  }

  div.style.whiteSpace = "pre-wrap";

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}


let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;
let isSwiping = false;
let swipeTarget = null;

function handleTouchStart(e) {
  
  if (e.touches.length !== 1) return;
  
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  isSwiping = false;
  swipeTarget = e.currentTarget;
}

function handleTouchMove(e) {
  if (!touchStartX || !touchStartY) return;
  
  const touchCurrentX = e.touches[0].clientX;
  const touchCurrentY = e.touches[0].clientY;
  
  const diffX = touchCurrentX - touchStartX;
  const diffY = touchCurrentY - touchStartY;
  
  
  if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 10) {
    isSwiping = true;
    
    
    if (swipeTarget && Math.abs(diffX) < 100) {
      const activeTab = swipeTarget.querySelector('.tab-content.active');
      if (activeTab) {
        activeTab.style.transform = `translateX(${diffX * 0.3}px)`;
        activeTab.style.transition = 'none';
      }
    }
  }
}

function handleTouchEnd(e) {
  if (!touchStartX || !touchStartY) return;
  
  touchEndX = e.changedTouches[0].clientX;
  touchEndY = e.changedTouches[0].clientY;
  
  
  if (swipeTarget) {
    const activeTab = swipeTarget.querySelector('.tab-content.active');
    if (activeTab) {
      activeTab.style.transform = '';
      activeTab.style.transition = '';
    }
  }
  
  if (!isSwiping) {
    resetTouchState();
    return;
  }
  
  const diffX = touchEndX - touchStartX;
  const diffY = touchEndY - touchStartY;
  
  
  const isHorizontalSwipe = Math.abs(diffX) > Math.abs(diffY) * 2;
  const swipeThreshold = 50;
  
  if (isHorizontalSwipe && Math.abs(diffX) > swipeThreshold) {
    const tabOrder = ['gemini', 'groups', 'chats', 'status', 'calls'];
    const currentIndex = tabOrder.indexOf(currentTab);
    
    if (diffX > 0) {
      
      if (currentIndex > 0) {
        switchTab(tabOrder[currentIndex - 1]);
      }
    } else {
      
      if (currentIndex < tabOrder.length - 1) {
        switchTab(tabOrder[currentIndex + 1]);
      }
    }
  }
  
  resetTouchState();
}

function resetTouchState() {
  touchStartX = 0;
  touchStartY = 0;
  touchEndX = 0;
  touchEndY = 0;
  isSwiping = false;
  swipeTarget = null;
}


function initSwipeGesture() {
  const usersListContainer = document.querySelector('.users-list');
  
  if (usersListContainer) {
    usersListContainer.addEventListener('touchstart', handleTouchStart, { passive: true });
    usersListContainer.addEventListener('touchmove', handleTouchMove, { passive: true });
    usersListContainer.addEventListener('touchend', handleTouchEnd, { passive: true });
  }
}


if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSwipeGesture);
} else {
  initSwipeGesture();
}
