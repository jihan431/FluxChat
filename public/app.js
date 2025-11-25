const socket = io();
const API_URL = window.location.origin + '/api';
let currentUser = JSON.parse(localStorage.getItem('currentUser'));
let selectedUser = null;
let peerConnection;
let localStream;
const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// --- INITIALIZATION ---
if (!currentUser) window.location.href = 'login.html';

document.addEventListener('DOMContentLoaded', () => {
  feather.replace();
  document.getElementById('myUsername').textContent = currentUser.nama;
  document.getElementById('myAvatar').textContent = currentUser.nama.charAt(0).toUpperCase();
  
  // Socket Join
  socket.emit('join', currentUser.username);
  
  // Load Users
  loadUsers();
});

// --- UI FUNCTIONS ---
function logout() {
  localStorage.removeItem('currentUser');
  window.location.href = 'login.html';
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.remove('hidden');
  document.getElementById('chatArea').classList.remove('active');
}

async function loadUsers() {
  try {
    const res = await fetch(`${API_URL}/users`);
    const data = await res.json();
    const list = document.getElementById('usersList');
    list.innerHTML = '';

    data.users.forEach(user => {
      if (user.username === currentUser.username) return;
      
      const div = document.createElement('div');
      div.className = 'user-item';
      div.onclick = () => selectUser(user);
      div.innerHTML = `
        <div class="avatar">${user.nama.charAt(0).toUpperCase()}</div>
        <div class="info">
          <h4>${user.nama}</h4>
          <div class="user-status offline" id="status-${user.username}"></div>
        </div>
      `;
      list.appendChild(div);
    });
  } catch (err) { console.error(err); }
}

async function selectUser(user) {
  selectedUser = user;
  
  // UI Update for Mobile
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.add('hidden');
    document.getElementById('chatArea').classList.add('active');
  }

  document.getElementById('welcomeScreen').classList.add('hidden');
  document.getElementById('chatRoom').classList.remove('hidden');
  document.getElementById('chatName').textContent = user.nama;
  document.getElementById('chatAvatar').textContent = user.nama.charAt(0).toUpperCase();

  // Load History
  const res = await fetch(`${API_URL}/messages/${currentUser.username}/${user.username}`);
  const data = await res.json();
  const container = document.getElementById('messagesContainer');
  container.innerHTML = '';
  data.messages.forEach(addMessageToUI);
  scrollToBottom();
}

// --- MESSAGING ---
function sendMessage() {
  const input = document.getElementById('messageInput');
  const msg = input.value.trim();
  const fileInput = document.getElementById('fileInput');
  const file = fileInput.files[0];

  if (!msg && !file) return;

  if (file) {
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
  const isMe = msg.from === currentUser.username;
  const div = document.createElement('div');
  div.className = `message ${isMe ? 'outgoing' : 'incoming'}`;
  
  let content = '';
  if (msg.file) {
    if (msg.file.type.startsWith('image/')) {
      content += `<img src="${msg.file.data}" class="msg-img">`;
    } else {
      content += `<div class="file-att"><a href="${msg.file.data}" download="${msg.file.name}">📎 ${msg.file.name}</a></div>`;
    }
  }
  if (msg.message) content += `<p>${msg.message}</p>`;
  
  content += `<span class="msg-time">${new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>`;
  
  div.innerHTML = content;
  document.getElementById('messagesContainer').appendChild(div);
  scrollToBottom();
}

function scrollToBottom() {
  const container = document.getElementById('messagesContainer');
  container.scrollTop = container.scrollHeight;
}

// --- SOCKET EVENTS ---
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
  if (statusEl) {
    statusEl.className = `user-status ${data.status}`;
  }
  if (selectedUser && selectedUser.username === data.username) {
    document.getElementById('chatStatus').textContent = data.status === 'online' ? 'Online' : 'Offline';
  }
});

// --- WEBRTC (CALLING) ---
let isVideo = false;

async function startCall(type) {
  if (!selectedUser) return;
  isVideo = type === 'video';
  
  document.getElementById('callModal').classList.remove('hidden');
  document.getElementById('callStatus').textContent = `Memanggil ${selectedUser.nama}...`;
  document.getElementById('incomingActions').classList.add('hidden');
  document.getElementById('activeCallActions').classList.remove('hidden');
  
  if (isVideo) document.getElementById('videoContainer').classList.remove('hidden');

  await setupMedia();
  createPeerConnection();
  
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  
  socket.emit('call_offer', { 
    offer, 
    to: selectedUser.username, 
    from: currentUser.username,
    type 
  });
}

socket.on('call_offer', async (data) => {
  if (data.to !== currentUser.username) return;
  
  // Show Incoming Call UI
  document.getElementById('callModal').classList.remove('hidden');
  document.getElementById('callStatus').textContent = `Panggilan ${data.type} dari ${data.from}`;
  document.getElementById('callTargetName').textContent = data.from;
  document.getElementById('incomingActions').classList.remove('hidden');
  document.getElementById('activeCallActions').classList.add('hidden');
  
  isVideo = data.type === 'video';
  selectedUser = { username: data.from }; // Set context temporary
  
  // Store offer to handle after accept
  window.pendingOffer = data.offer;
});

async function answerCall() {
  document.getElementById('incomingActions').classList.add('hidden');
  document.getElementById('activeCallActions').classList.remove('hidden');
  if (isVideo) document.getElementById('videoContainer').classList.remove('hidden');

  await setupMedia();
  createPeerConnection();
  
  await peerConnection.setRemoteDescription(new RTCSessionDescription(window.pendingOffer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  
  socket.emit('call_answer', { answer, to: selectedUser.username, from: currentUser.username });
}

socket.on('call_answer', async (data) => {
  await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on('ice_candidate', async (data) => {
  if (peerConnection) {
    await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
  }
});

socket.on('call_ended', () => {
  closeCall();
});

function endCall() {
  socket.emit('end_call', { to: selectedUser.username });
  closeCall();
}

function closeCall() {
  if (peerConnection) peerConnection.close();
  if (localStream) localStream.getTracks().forEach(track => track.stop());
  document.getElementById('callModal').classList.add('hidden');
  document.getElementById('videoContainer').classList.add('hidden');
}

async function setupMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
    document.getElementById('localVideo').srcObject = localStream;
  } catch (e) {
    console.error('Media error', e);
    alert('Gagal mengakses kamera/mikrofon');
  }
}

function createPeerConnection() {
  peerConnection = new RTCPeerConnection(config);
  
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
  
  peerConnection.ontrack = (event) => {
    document.getElementById('remoteVideo').srcObject = event.streams[0];
  };
  
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice_candidate', { 
        candidate: event.candidate, 
        to: selectedUser.username, 
        from: currentUser.username 
      });
    }
  };
}

// Helpers
document.getElementById('fileInput').addEventListener('change', function() {
  if(this.files[0]) {
    document.getElementById('filePreview').classList.remove('hidden');
    document.getElementById('fileName').textContent = this.files[0].name;
  }
});

function clearFile() {
  document.getElementById('fileInput').value = '';
  document.getElementById('filePreview').classList.add('hidden');
}