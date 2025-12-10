require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const { OAuth2Client } = require('google-auth-library');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 50 * 1024 * 1024 // 50MB
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/chatapp';

mongoose.connect(mongoUri)
  .then(() => {
    console.info(`[MongoDB] Connected: ${mongoUri}`);
  })
  .catch(err => {
    console.error('[MongoDB] Connection error:', err.message);
  });


const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  nama: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  lastSeen: { type: Date, default: Date.now },
  avatar: { type: String, default: 'default' },
  
  // --- TAMBAHAN PENTING (YANG HILANG) ---
  otpHash: { type: String },   // <--- Tambahkan ini
  otpExpires: { type: Date },  // <--- Tambahkan ini

  // --- TAMBAHAN BARU ---
  friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  friendRequests: [{
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
  }],
  blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
});

const messageSchema = new mongoose.Schema({
  from: { type: String, required: true },
  to: { type: String, required: true },
  message: { type: String, default: '' },
  file: {
    name: { type: String, default: null },
    size: { type: Number, default: null },
    type: { type: String, default: null },
    data: { type: String, default: null }
  },
  timestamp: { type: Date, default: Date.now },
  read: { type: Boolean, default: false },
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'GroupChat' }
});

// Validate: Pesan atau file harus ada minimal satu
messageSchema.pre('save', function(next) {
  const hasMessage = this.message && this.message.trim() !== '';
  const hasFile = this.file && this.file.data;
  
  if (!hasMessage && !hasFile) {
    return next(new Error('Pesan atau file harus ada minimal satu'));
  }
  next();
});

const groupChatSchema = new mongoose.Schema({
  nama: { type: String, required: true },
  avatar: { type: String, default: 'G' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  createdAt: { type: Date, default: Date.now },
  lastMessage: { type: String },
  lastMessageTime: { type: Date }
});

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);
const GroupChat = mongoose.model('GroupChat', groupChatSchema);

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'cracked655@gmail.com',
    pass: process.env.EMAIL_PASS || 'vwpn mhfq evii wrrd'
  }
});

// Google OAuth (Login Sosial)
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClient = googleClientId ? new OAuth2Client(googleClientId) : null;

// File validation
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50MB
const ALLOWED_FILE_TYPES = [
  'image/',
  'video/',
  'audio/',
  'application/pdf',
  'text/plain'
];

function getFileSizeFromBase64(base64Data) {
  try {
    if (!base64Data) return 0;
    const stripped = base64Data.split(';base64,').pop() || '';
    return Math.floor((stripped.length * 3) / 4);
  } catch {
    return 0;
  }
}

function isFileTypeAllowed(mime) {
  if (!mime) return false;
  return ALLOWED_FILE_TYPES.some(type => {
    if (type.endsWith('/')) return mime.startsWith(type);
    return mime === type;
  });
}

app.post('/api/register', async (req, res) => {
  try {
    const { username, nama, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Data tidak lengkap' });
    }

    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res.status(400).json({ error: 'Username atau Email sudah digunakan' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    const user = new User({
      username,
      nama,
      email,
      password: hashedPassword,
      otpHash,
      otpExpires
    });

    await user.save();

    try {
      await transporter.sendMail({
        from: 'FluxChat Security',
        to: email,
        subject: 'Kode Verifikasi FluxChat',
        html: `<h3>Kode OTP Anda: <b>${otp}</b></h3><p>Kode ini berlaku selama 10 menit.</p>`
      });
    } catch (emailErr) {
    }

    res.json({ success: true, message: 'OTP terkirim' });
  } catch (error) {
    res.status(500).json({ error: 'Server Error' });
  }
});

// --- CONFIG PUBLIC (untuk frontend) ---
app.get('/api/config', (req, res) => {
  res.json({
    googleClientId: googleClientId || null
  });
});

// --- GOOGLE LOGIN (SOSIAL) ---
app.post('/api/auth/google', async (req, res) => {
  try {
    const { token } = req.body;

    if (!googleClientId || !googleClient) {
      return res.status(500).json({ error: 'Google login belum dikonfigurasi' });
    }

    if (!token) {
      return res.status(400).json({ error: 'Token tidak ditemukan' });
    }

    // Verifikasi token dengan Google
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: googleClientId
    });
    const payload = ticket.getPayload();

    const email = payload?.email;
    if (!email) return res.status(400).json({ error: 'Email tidak tersedia dari Google' });

    const displayName = payload.name || email.split('@')[0];
    const avatar = payload.picture || 'default';
    const googleSub = payload.sub;

    // Cek user berdasarkan email
    let user = await User.findOne({ email });

    if (!user) {
      // Generate username unik dari email
      const baseUsername = (email.split('@')[0] || 'user').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 18) || 'user';
      let usernameCandidate = baseUsername;
      let attempt = 0;
      while (await User.findOne({ username: usernameCandidate })) {
        attempt += 1;
        usernameCandidate = `${baseUsername}${Math.floor(100 + Math.random() * 900)}`;
        if (attempt > 5) {
          usernameCandidate = `${baseUsername}${Date.now().toString().slice(-4)}`;
          break;
        }
      }

      const randomPass = crypto.randomBytes(12).toString('hex');
      const hashedPassword = await bcrypt.hash(randomPass, 10);

      user = new User({
        username: usernameCandidate,
        nama: displayName,
        email,
        password: hashedPassword,
        avatar,
        otpHash: undefined,
        otpExpires: undefined,
        lastSeen: new Date()
      });

      await user.save();
    } else {
      // Pastikan akun dianggap terverifikasi
      user.otpHash = undefined;
      user.otpExpires = undefined;
      user.avatar = avatar || user.avatar;
      user.lastSeen = new Date();
      await user.save();
    }

    return res.json({
      success: true,
      user: {
        username: user.username,
        nama: user.nama,
        email: user.email,
        id: user._id,
        avatar: user.avatar,
        provider: 'google',
        googleSub
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Login Google gagal' });
  }
});

app.post('/api/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({ email });

    if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

    if (user.otpHash !== otpHash || user.otpExpires < Date.now()) {
      return res.status(400).json({ error: 'OTP salah atau kadaluarsa' });
    }

    user.otpHash = undefined;
    user.otpExpires = undefined;
    await user.save();

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user) return res.status(404).json({ error: 'Akun tidak ditemukan' });

    // Cek apakah akun sudah diverifikasi lewat OTP register
    if (user.otpHash) 
      return res.status(403).json({ error: 'Akun belum diverifikasi. Silakan cek email.' });

    const validPass = await bcrypt.compare(password, user.password);
    if (!validPass) return res.status(400).json({ error: 'Password salah' });

    // === LOGIN LANGSUNG TANPA OTP ===
    user.lastSeen = new Date();
    await user.save();

    return res.json({
      success: true,
      user: {
        username: user.username,
        nama: user.nama,
        email: user.email,
        id: user._id
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

//
// Tambahkan Endpoint Update Profile
app.put('/api/profile', async (req, res) => {
  try {
    const { id, nama, password, avatar } = req.body;
    
    // Validate required fields
    if (!id) return res.status(400).json({ success: false, error: 'ID tidak valid' });
    if (!nama || nama.trim() === '') return res.status(400).json({ success: false, error: 'Nama tidak boleh kosong' });

    // Check if ID is valid MongoDB ObjectId
    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ success: false, error: 'Format ID tidak valid' });
    }

    const updateData = { nama };
    
    // Only hash and update password if provided
    if (password && password.trim() !== '') {
      updateData.password = await bcrypt.hash(password, 10);
    }

    // Update avatar if provided
    if (avatar) {
      updateData.avatar = avatar;
    }

    const user = await User.findByIdAndUpdate(id, updateData, { new: true });
    
    if (!user) {
      return res.status(404).json({ success: false, error: 'User tidak ditemukan' });
    }

    res.json({
      success: true,
      message: 'Profil berhasil diperbarui',
      user: {
        username: user.username,
        nama: user.nama,
        email: user.email,
        id: user._id,
        avatar: user.avatar
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


app.get('/api/users', async (req, res) => {
  const users = await User.find({}, 'username nama lastSeen avatar');
  const usersWithStatus = users.map(user => ({
    ...user.toObject(),
    status: onlineUsers.values().toArray().some(u => u === user.username) ? 'online' : 'offline'
  }));
  res.json({ success: true, users: usersWithStatus });
});

app.get('/api/messages/:user1/:user2', async (req, res) => {
  const { user1, user2 } = req.params;
  const messages = await Message.find({
    $or: [
      { from: user1, to: user2 },
      { from: user2, to: user1 }
    ]
  }).sort({ timestamp: 1 });
  res.json({ success: true, messages });
});

// Cari pesan (private & group) dengan kata kunci
app.get('/api/messages/search', async (req, res) => {
  try {
    const { userId, q, limit = 20, skip = 0 } = req.query;
    if (!q || !userId) return res.json({ success: true, results: [] });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

    const blockedUsers = await User.find({ _id: { $in: user.blockedUsers || [] } }).select('username');
    const blockedNames = blockedUsers.map(u => u.username);

    const groups = await GroupChat.find({ members: userId }).select('_id nama');
    const groupIds = groups.map(g => g._id);
    const groupNameMap = new Map(groups.map(g => [g._id.toString(), g.nama]));

    const regex = new RegExp(q, 'i');

    const messages = await Message.find({
      $and: [
        { $or: [{ message: regex }, { 'file.name': regex }] },
        {
          $or: [
            { from: user.username, to: { $nin: blockedNames } },
            { to: user.username, from: { $nin: blockedNames } },
            { groupId: { $in: groupIds } }
          ]
        }
      ]
    })
      .sort({ timestamp: -1 })
      .skip(parseInt(skip) || 0)
      .limit(Math.min(parseInt(limit) || 20, 100));

    const results = messages.map(m => {
      const isGroup = !!m.groupId;
      const chatId = isGroup ? m.groupId.toString() : (m.from === user.username ? m.to : m.from);
      const chatName = isGroup ? (groupNameMap.get(m.groupId?.toString()) || 'Group') : chatId;
      return {
        id: m._id,
        chatId,
        chatName,
        isGroup,
        from: m.from,
        to: m.to,
        message: m.message,
        file: m.file,
        timestamp: m.timestamp
      };
    });

    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const onlineUsers = new Map();

//

// --- 1. SEARCH USER (Cari teman berdasarkan username/email) ---
// - Ganti bagian endpoint '/api/users/search' dengan ini:

app.get('/api/users/search', async (req, res) => {
  try {
    const { query, currentUserId } = req.query;
    
    // Jika query kosong, kembalikan array kosong (atau bisa kembalikan list teman saja)
    if (!query) return res.json({ success: true, users: [] });

    // Cari user (case-insensitive) dan jangan sertakan diri sendiri
    const users = await User.find({
      $and: [
        { _id: { $ne: currentUserId } },
        {
          $or: [
            { username: { $regex: query, $options: 'i' } },
            { nama: { $regex: query, $options: 'i' } }, // Tambah cari berdasarkan Nama juga
            { email: { $regex: query, $options: 'i' } }
          ]
        }
      ]
    }).select('username nama avatar friends friendRequests');

    const results = users.map(u => {
      // Cek status hubungan
      const isFriend = u.friends.includes(currentUserId);
      const isPending = u.friendRequests.some(req => req.from.toString() === currentUserId);
      const isIncoming = false; // Bisa ditambahkan logic cek reverse request jika mau

      return {
        _id: u._id,
        username: u.username,
        nama: u.nama,
        avatar: u.avatar,
        isFriend,
        isPending
      };
    });

    res.json({ success: true, users: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- 2. GET FRIEND LIST & REQUESTS (Ambil daftar teman & request) ---
app.get('/api/friends/list/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .populate('friends', 'username nama avatar lastSeen')
      .populate('friendRequests.from', 'username nama avatar');
      
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      success: true,
      friends: user.friends,
      requests: user.friendRequests
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- 3. SEND FRIEND REQUEST (Kirim Permintaan) ---
app.post('/api/friends/request', async (req, res) => {
  try {
    const { fromId, toId } = req.body;

    if (fromId === toId) return res.status(400).json({ error: "Tidak bisa add diri sendiri" });

    const targetUser = await User.findById(toId);
    const senderUser = await User.findById(fromId);

    if (!targetUser || !senderUser) return res.status(404).json({ error: "User tidak ditemukan" });

    // Validasi 1: Sudah berteman?
    if (targetUser.friends.includes(fromId)) {
      return res.status(400).json({ error: "Kalian sudah berteman" });
    }

    // Validasi 2: Request sudah ada (pending)?
    const alreadyRequested = targetUser.friendRequests.some(req => req.from.toString() === fromId);
    if (alreadyRequested) {
      return res.status(400).json({ error: "Permintaan pertemanan sudah terkirim sebelumnya" });
    }

    // Validasi 3: Apakah Target User SUDAH mengirim request ke Kita? (Jika ya, otomatis accept)
    const reverseRequest = senderUser.friendRequests.find(req => req.from.toString() === toId);
    if (reverseRequest) {
      // Lakukan Auto-Accept logic
      senderUser.friends.push(toId);
      targetUser.friends.push(fromId);
      senderUser.friendRequests = senderUser.friendRequests.filter(req => req.from.toString() !== toId);
      
      await senderUser.save();
      await targetUser.save();
      return res.json({ success: true, message: "Otomatis berteman karena dia juga add kamu!", status: 'accepted' });
    }

    // Kirim Request Normal
    targetUser.friendRequests.push({ from: fromId });
    await targetUser.save();

    // (Opsional) Emit Socket notification real-time
    io.to(targetUser.username).emit('new_friend_request', { 
      from: { username: senderUser.username, nama: senderUser.nama } 
    });

    res.json({ success: true, message: "Permintaan pertemanan dikirim" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- 4. ACCEPT FRIEND REQUEST (Terima) ---
app.post('/api/friends/accept', async (req, res) => {
  try {
    const { userId, requesterId } = req.body; // userId = yang menerima, requesterId = yang minta

    const user = await User.findById(userId);
    const requester = await User.findById(requesterId);

    if (!user || !requester) return res.status(404).json({ error: "User not found" });

    // Cek apakah request benar ada
    const reqIndex = user.friendRequests.findIndex(r => r.from.toString() === requesterId);
    if (reqIndex === -1) return res.status(400).json({ error: "Request tidak ditemukan" });

    // Hapus dari list request
    user.friendRequests.splice(reqIndex, 1);

    // Tambahkan ke list friends (dua arah)
    if (!user.friends.includes(requesterId)) user.friends.push(requesterId);
    if (!requester.friends.includes(userId)) requester.friends.push(userId);

    await user.save();
    await requester.save();

    res.json({ success: true, message: "Pertemanan diterima!" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- 5. REJECT FRIEND REQUEST (Tolak) ---
app.post('/api/friends/reject', async (req, res) => {
  try {
    const { userId, requesterId } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Hapus request tanpa menambah teman
    user.friendRequests = user.friendRequests.filter(r => r.from.toString() !== requesterId);
    await user.save();

    res.json({ success: true, message: "Permintaan ditolak" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- GROUP CHAT ENDPOINTS ---

// GET: Daftar semua group yang user ikuti
app.get('/api/groups/:userId', async (req, res) => {
  try {
    const groups = await GroupChat.find({ members: req.params.userId })
      .populate('createdBy', 'username nama avatar')
      .populate('members', 'username nama avatar')
      .sort({ lastMessageTime: -1 });
    
    res.json({ success: true, groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST: Buat group chat baru
app.post('/api/groups', async (req, res) => {
  try {
    const { nama, createdBy, members } = req.body;

    if (!nama || !createdBy) {
      return res.status(400).json({ error: 'Nama dan createdBy diperlukan' });
    }

    // Pastikan createdBy juga termasuk di members
    const allMembers = [createdBy, ...members];
    const uniqueMembers = [...new Set(allMembers)];

    const group = new GroupChat({
      nama,
      avatar: nama.charAt(0).toUpperCase(),
      createdBy,
      members: uniqueMembers
    });

    await group.save();
    await group.populate('createdBy', 'username nama avatar');
    await group.populate('members', 'username nama avatar');

    res.json({ success: true, group });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET: Ambil pesan dalam group
app.get('/api/groups/:groupId/messages', async (req, res) => {
  try {
    const messages = await Message.find({ groupId: req.params.groupId })
      .sort({ timestamp: 1 });
    res.json({ success: true, messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST: Tambah member ke group
app.post('/api/groups/:groupId/members', async (req, res) => {
  try {
    const { userId } = req.body;
    const group = await GroupChat.findByIdAndUpdate(
      req.params.groupId,
      { $addToSet: { members: userId } },
      { new: true }
    ).populate('members', 'username nama avatar');

    res.json({ success: true, group });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE: Hapus member dari group
app.delete('/api/groups/:groupId/members/:userId', async (req, res) => {
  try {
    const group = await GroupChat.findByIdAndUpdate(
      req.params.groupId,
      { $pull: { members: req.params.userId } },
      { new: true }
    ).populate('members', 'username nama avatar');

    res.json({ success: true, group });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE: Hapus group
app.delete('/api/groups/:groupId', async (req, res) => {
  try {
    const group = await GroupChat.findByIdAndDelete(req.params.groupId);
    await Message.deleteMany({ groupId: req.params.groupId });
    res.json({ success: true, message: 'Group dihapus' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST: Block user
app.post('/api/users/block/:userIdToBlock', async (req, res) => {
  try {
    const { blockerId } = req.body;
    const userIdToBlock = req.params.userIdToBlock;

    // Validasi
    if (!blockerId || !userIdToBlock) {
      return res.status(400).json({ success: false, message: 'Invalid request' });
    }

    const blocker = await User.findById(blockerId);
    if (!blocker) {
      return res.status(404).json({ success: false, message: 'Blocker not found' });
    }

    // Cek apakah sudah di-block
    if (blocker.blockedUsers.includes(userIdToBlock)) {
      return res.status(400).json({ success: false, message: 'User sudah di-block' });
    }

    // Tambahkan ke blockedUsers
    blocker.blockedUsers.push(userIdToBlock);
    await blocker.save();

    // Hapus dari friend list jika ada
    blocker.friends = blocker.friends.filter(f => f.toString() !== userIdToBlock);
    await blocker.save();

    res.json({ success: true, message: 'User berhasil di-block' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET: Get blocked users
app.get('/api/users/blocked-list', async (req, res) => {
  try {
    const { userId } = req.query;
    const user = await User.findById(userId).populate('blockedUsers', 'username nama email');
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, blockedUsers: user.blockedUsers || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

io.on('connection', (socket) => {
  socket.on('join', (data) => {
    // Support both old format (string) dan new format (object)
    const username = typeof data === 'string' ? data : data.username;
    const groupIds = typeof data === 'object' ? data.groupIds : [];

    onlineUsers.set(socket.id, username);
    socket.join(username);

    // Join group rooms
    groupIds.forEach(groupId => socket.join(groupId));

    io.emit('user_status_change', { username, status: 'online' });
  });

  socket.on('send_message', async (data) => {
    const { from, to, message, file, groupId } = data;

    let sanitizedFile = null;
    if (file && file.data) {
      const fileSize = file.size || getFileSizeFromBase64(file.data);

      if (fileSize > MAX_FILE_BYTES) {
        socket.emit('message_error', { error: 'File terlalu besar (maks 50MB)' });
        return;
      }

      if (file.type && !isFileTypeAllowed(file.type)) {
        socket.emit('message_error', { error: 'Tipe file tidak diizinkan' });
        return;
      }

      sanitizedFile = {
        name: file.name || 'file',
        size: fileSize,
        type: file.type || 'application/octet-stream',
        data: file.data
      };
    }

    if (groupId) {
      // Pesan ke group
      const newMsg = new Message({ from, to: groupId, message, file: sanitizedFile, groupId });
      await newMsg.save();
      io.to(groupId).emit('receive_message', newMsg);
    } else {
      // Pesan private seperti biasa
      const newMsg = new Message({ from, to, message, file: sanitizedFile });
      await newMsg.save();
      io.to(to).emit('receive_message', newMsg);
      socket.emit('message_sent', newMsg);
    }
  });

  // Typing indicator
  socket.on('typing', (data) => {
    io.to(data.to).emit('user_typing', { from: data.from });
  });

  socket.on('stop_typing', (data) => {
    io.to(data.to).emit('stop_typing', { from: data.from });
  });

  socket.on('call_offer', (data) => {
    io.to(data.to).emit('call_offer', {
      offer: data.offer,
      from: data.from,
      type: data.type
    });
  });

  socket.on('call_answer', (data) => {
    io.to(data.to).emit('call_answer', { answer: data.answer, from: data.from });
  });

  socket.on('ice_candidate', (data) => {
    io.to(data.to).emit('ice_candidate', { candidate: data.candidate, from: data.from });
  });

  socket.on('end_call', (data) => {
    io.to(data.to).emit('call_ended');
  });

  socket.on('disconnect', () => {
    const username = onlineUsers.get(socket.id);
    if (username) {
      User.findOneAndUpdate({ username }, { lastSeen: new Date() }).exec();
      io.emit('user_status_change', { username, status: 'offline' });
      onlineUsers.delete(socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.info(`[Server] Listening on port ${PORT}`);
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('[Email] Using fallback credentials, set EMAIL_USER and EMAIL_PASS in .env');
  }
});