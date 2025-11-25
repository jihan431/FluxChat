const socket = io();
const API_URL = `${window.location.origin}/api`;
let currentUser = JSON.parse(localStorage.getItem('currentUser'));
let selectedUser = null;
let peerConnection;
let localStream;
const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

if (!currentUser) window.location.href = 'login.html';

function toggleSearchBar() {
  const searchBar = document.getElementById('searchBar');
  searchBar.classList.toggle('hidden');
  if (!searchBar.classList.contains('hidden')) {
    document.getElementById('searchInput').focus();
  }
}

function toggleUserMenu() {
  const userMenu = document.getElementById('userMenu');
  userMenu.classList.toggle('hidden');
}

// Tutup dropdown saat klik di luar
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('userDropdown');
  const userMenu = document.getElementById('userMenu');
  if (dropdown && !dropdown.contains(e.target)) {
    userMenu.classList.add('hidden');
  }
});

function openProfile(e) {
  e.preventDefault();
  document.getElementById('userMenu').classList.add('hidden');
  alert('Profile feature coming soon!');
}

function openBlockedUsers(e) {
  e.preventDefault();
  document.getElementById('userMenu').classList.add('hidden');
  alert('Blocked users feature coming soon!');
}

function logout(e) {
  e.preventDefault();
  localStorage.removeItem('currentUser');
  window.location.href = 'login.html';
}

function openAddUserModal() {
  document.getElementById('addUserModal').classList.remove('hidden');
  document.getElementById('userMenu').classList.add('hidden');
}

function closeAddUserModal() {
  document.getElementById('addUserModal').classList.add('hidden');
  document.getElementById('addUserForm').reset();
}

document.addEventListener('DOMContentLoaded', () => {
  feather.replace();

  document.getElementById('callModal').classList.add('hidden');
  document.getElementById('addUserModal').classList.add('hidden');

  socket.emit('join', currentUser.username);
  loadUsers();

  document.getElementById('messageInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  document.getElementById('searchInput').addEventListener('input', (e) => {
    searchUsers(e.target.value);
  });

  document.getElementById('addUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('addUsername').value.trim();

    if (!username) {
      alert('Username harus diisi');
      return;
    }

    try {
      // Cari user di database berdasarkan username saja
      const res = await fetch(`${API_URL}/users`);
      const data = await res.json();
      const user = data.users.find(u => u.username === username);

      if (user) {
        // User ditemukan, tambahkan ke daftar kontak
        if (window.allUsers.some(u => u.username === username)) {
          alert('User sudah ada dalam daftar kontak');
        } else {
          alert('User berhasil ditambahkan!');
          displayUsers(window.allUsers);
        }
        closeAddUserModal();
      } else {
        alert('User tidak ditemukan');
      }
    } catch (err) {
      console.error(err);
      alert('Gagal menambah user');
    }
  });

  const backBtn = document.getElementById('backToSidebar');
  if (backBtn) backBtn.addEventListener('click', closeChat);
});

function logout() {
  localStorage.removeItem('currentUser');
  window.location.href = 'login.html';
}

function selectUser(user) {
  selectedUser = user;

  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.add('hidden-mobile');
    document.getElementById('chatArea').classList.add('active');
  }

  document.getElementById('welcomeScreen').classList.add('hidden');
  document.getElementById('chatRoom').classList.remove('hidden');

  document.getElementById('chatName').textContent = user.nama;
  document.getElementById('chatAvatar').textContent = user.nama.charAt(0).toUpperCase();

  const userStatus = window.userStatusMap && window.userStatusMap[user.username] ? window.userStatusMap[user.username] : 'offline';
  document.getElementById('chatStatus').textContent = userStatus === 'online' ? 'Online' : 'Offline';

  document.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'));
  const activeItem = document.getElementById(`user-item-${user.username}`);
  if (activeItem) activeItem.classList.add('active');

  loadMessages(user.username);
}

function closeChat() {
  selectedUser = null;
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.remove('hidden-mobile');
    document.getElementById('chatArea').classList.remove('active');
  }
  document.getElementById('welcomeScreen').classList.remove('hidden');
  document.getElementById('chatRoom').classList.add('hidden');
}

async function loadUsers() {
  try {
    const res = await fetch(`${API_URL}/users`);
    const data = await res.json();
    window.allUsers = data.users.filter(user => user.username !== currentUser.username);
    displayUsers(window.allUsers);
  } catch (err) {
    console.error(err);
  }
}

function displayUsers(usersToDisplay) {
  const list = document.getElementById('usersList');
  list.innerHTML = '';

  if (usersToDisplay.length === 0) {
    list.innerHTML = '<div style="padding:20px; text-align:center; color:#94a3b8;">Tidak ada pengguna</div>';
    return;
  }

  usersToDisplay.forEach(user => {
    const div = document.createElement('div');
    div.className = 'user-item';
    div.id = `user-item-${user.username}`;
    div.onclick = () => selectUser(user);
    div.innerHTML = `
      <div class="avatar">${user.nama.charAt(0).toUpperCase()}</div>
      <div style="flex:1">
        <div style="display:flex; justify-content:space-between;">
          <h4 style="font-size:0.95rem; margin:0;">${user.nama}</h4>
          <div class="user-status ${user.status}" id="status-${user.username}"></div>
        </div>
        <small style="color:#94a3b8; font-size:0.8rem;">Klik untuk chat</small>
      </div>
    `;
    list.appendChild(div);
    window.userStatusMap = window.userStatusMap || {};
    window.userStatusMap[user.username] = user.status;
  });
}

function searchUsers(query) {
  if (!window.allUsers) return;
  
  const filtered = window.allUsers.filter(user => 
    user.nama.toLowerCase().includes(query.toLowerCase()) ||
    user.username.toLowerCase().includes(query.toLowerCase())
  );
  
  displayUsers(filtered);
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
    console.error(err);
  }
}

function sendMessage() {
  const input = document.getElementById('messageInput');
  const msg = input.value.trim();
  const fileInput = document.getElementById('fileInput');
  const file = fileInput.files[0];

  if ((!msg && !file) || !selectedUser) return;

  if (file) {
    if (file.size > 5 * 1024 * 1024) {
      alert('File terlalu besar (Maks 5MB)');
      return;
    }
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const payload = {
        from: currentUser.username,
        to: selectedUser.username,
        message: msg,
        file: { name: file.name, type: file.type, data: reader.result }
      };
      socket.emit('send_message', payload);
      clearFile();
    };
  } else {
    socket.emit('send_message', {
      from: currentUser.username,
      to: selectedUser.username,
      message: msg
    });
  }
  input.value = '';
}

function addMessageToUI(msg) {
  const container = document.getElementById('messagesContainer');
  if (container.innerText.includes('Belum ada pesan') || container.innerText.includes('Memuat')) {
    container.innerHTML = '';
  }

  const isMe = msg.from === currentUser.username;
  const div = document.createElement('div');
  div.className = `message ${isMe ? 'outgoing' : 'incoming'}`;

  let content = '';
  if (msg.file) {
    if (msg.file.type.startsWith('image/')) {
      content += `<img src="${msg.file.data}" class="msg-img" onclick="window.open(this.src)">`;
    } else {
      content += `<div style="background:rgba(0,0,0,0.2); padding:8px; border-radius:8px; margin-bottom:5px;">
                    <a href="${msg.file.data}" download="${msg.file.name}" style="color:white; text-decoration:none; display:flex; align-items:center; gap:5px;">
                      <i data-feather="download"></i> ${msg.file.name}
                    </a>
                  </div>`;
    }
  }
  if (msg.message) content += `<p style="margin:0;">${msg.message}</p>`;
  content += `<span class="msg-time">${new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`;

  div.innerHTML = content;
  container.appendChild(div);
  feather.replace();
  scrollToBottom();
}

function scrollToBottom() {
  const container = document.getElementById('messagesContainer');
  container.scrollTop = container.scrollHeight;
}

document.getElementById('fileInput').addEventListener('change', function() {
  if (this.files[0]) {
    document.getElementById('filePreview').classList.remove('hidden');
    document.getElementById('fileName').textContent = this.files[0].name;
  }
});

function clearFile() {
  document.getElementById('fileInput').value = '';
  document.getElementById('filePreview').classList.add('hidden');
}

socket.on('receive_message', (msg) => {
  if (selectedUser && (msg.from === selectedUser.username || msg.to === selectedUser.username)) {
    addMessageToUI(msg);
  }
});

socket.on('message_sent', (msg) => {
  if (selectedUser && msg.to === selectedUser.username) {
    addMessageToUI(msg);
  }
});

socket.on('user_status_change', (data) => {
  const statusEl = document.getElementById(`status-${data.username}`);
  if (statusEl) statusEl.className = `user-status ${data.status}`;

  if (selectedUser && selectedUser.username === data.username) {
    document.getElementById('chatStatus').textContent = data.status === 'online' ? 'Online' : 'Offline';
  }
});

let isVideo = false;
let callDuration = 0;
let callTimer = null;

function startCallTimer() {
  callDuration = 0;
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
  if (!selectedUser) return;
  isVideo = type === 'video';

  document.getElementById('callModal').classList.remove('hidden');
  document.getElementById('callTargetName').textContent = selectedUser.nama;
  document.getElementById('callStatus').textContent = 'Memanggil...';
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
  document.getElementById('callModal').classList.remove('hidden');
  document.getElementById('callTargetName').textContent = data.from;
  document.getElementById('callStatus').textContent = `Panggilan ${data.type} Masuk...`;
  document.getElementById('incomingActions').classList.remove('hidden');
  document.getElementById('activeCallActions').classList.add('hidden');
  document.getElementById('videoContainer').classList.add('hidden');

  isVideo = data.type === 'video';
  window.pendingOffer = data.offer;
  window.callerUsername = data.from;
});

async function answerCall() {
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
}

function endCall() {
  const target = selectedUser ? selectedUser.username : window.callerUsername;
  if (target) socket.emit('end_call', { to: target });
  closeCallUI();
}

function rejectCall() {
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
  document.getElementById('callModal').classList.add('hidden');
  document.getElementById('callAvatar').classList.remove('hidden');
  document.getElementById('callTargetName').classList.remove('hidden');
  window.pendingOffer = null;
  window.callerUsername = null;
  isVideo = false;
}

socket.on('call_ended', closeCallUI);
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
    alert('Gagal akses kamera/mic');
    closeCallUI();
  }
}

function createPeerConnection() {
  peerConnection = new RTCPeerConnection(config);
  if (localStream) localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
  peerConnection.ontrack = (e) => {
    document.getElementById('remoteVideo').srcObject = e.streams[0];
    // Mulai counter detik saat panggilan sudah terhubung
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
  const track = localStream.getAudioTracks()[0];
  track.enabled = !track.enabled;
  document.getElementById('muteBtn').style.backgroundColor = track.enabled ? '#475569' : '#ef4444';
}

function toggleCamera() {
  const track = localStream.getVideoTracks()[0];
  track.enabled = !track.enabled;
  document.getElementById('camBtn').style.backgroundColor = track.enabled ? '#475569' : '#ef4444';
}
