// server.js - Enhanced Backend dengan Socket.IO dan MongoDB
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 10e6 // 10MB for file uploads
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static('public'));

// Simple in-memory rate limiter
const rateLimitStore = {};
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 5; // max requests per window

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();

  if (!rateLimitStore[ip]) {
    rateLimitStore[ip] = { count: 1, resetTime: now + RATE_LIMIT_WINDOW };
  } else {
    if (now > rateLimitStore[ip].resetTime) {
      rateLimitStore[ip] = { count: 1, resetTime: now + RATE_LIMIT_WINDOW };
    } else {
      rateLimitStore[ip].count++;
      if (rateLimitStore[ip].count > RATE_LIMIT_MAX) {
        return res.status(429).json({ success: false, error: 'Terlalu banyak permintaan. Coba lagi nanti.' });
      }
    }
  }
  next();
}

// MongoDB Connection
mongoose.connect('mongodb://localhost:27017/chatapp').then(() => {
  console.log('Connected to MongoDB');
}).catch(err => {
  console.error('MongoDB connection error:', err);
});

// User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  nama: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now },
  password: { type: String, required: true },
  otpHash: { type: String },
  otpExpires: { type: Date },
});

// Message Schema (Enhanced)
const messageSchema = new mongoose.Schema({
  from: { type: String, required: true },
  to: { type: String, required: true },
  message: { type: String, default: '' },
  timestamp: { type: Date, default: Date.now },
  delivered: { type: Boolean, default: false },
  read: { type: Boolean, default: false },
  file: {
    name: String,
    size: Number,
    type: String,
    data: String
  }
});

// Group Schema
const groupSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  members: [{ type: String }],
  admin: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  avatar: { type: String }
});

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);
const Group = mongoose.model('Group', groupSchema);

// Konfigurasi Nodemailer untuk mengirim email
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'cracked655@gmail.com', // Email Anda
    pass: 'vwpn mhfq evii wrrd', // Sandi aplikasi
  },
});

// REST API Endpoints

// Register user baru
app.post('/api/register', rateLimit, async (req, res) => {
  try {
    const { username, nama, email, password } = req.body;

    if (!username || !nama || !email || !password) {
      return res.status(400).json({ success: false, error: 'Semua field harus diisi' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'Username atau email sudah terdaftar' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // OTP berlaku 10 menit

    // Simpan user dengan OTP hash sementara
    const user = new User({ username, nama, email, password: hashedPassword, otpHash, otpExpires });
    await user.save();

    // Kirim email dengan OTP
    await transporter.sendMail({
      from: 'your-email@gmail.com',
      to: email,
      subject: 'Kode OTP Anda',
      text: `Kode OTP Anda adalah: ${otp}`,
    });

    res.json({ success: true, message: 'Kode OTP telah dikirim ke email Anda' });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan server. Coba lagi nanti.' });
  }
});

// Endpoint untuk verifikasi OTP
app.post('/api/verify-otp', rateLimit, async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, error: 'Email dan kode OTP harus diisi' });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ success: false, error: 'User tidak ditemukan' });
    }

    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

    if (!user.otpHash || user.otpHash !== otpHash || user.otpExpires < Date.now()) {
      return res.status(400).json({ success: false, error: 'Kode OTP tidak valid atau telah kedaluwarsa' });
    }

    // Hapus OTP setelah verifikasi
    user.otpHash = undefined;
    user.otpExpires = undefined;
    await user.save();

    res.json({ success: true, message: 'Verifikasi berhasil' });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan server. Coba lagi nanti.' });
  }
});

// Login (cek username exists)
app.post('/api/login', rateLimit, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email dan password harus diisi' });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ success: false, error: 'User tidak ditemukan' });
    }

    // Periksa password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ success: false, error: 'Password salah' });
    }

    // Update last seen
    user.lastSeen = new Date();
    await user.save();

    res.json({ success: true, user: { username: user.username, nama: user.nama, email: user.email } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan server. Coba lagi nanti.' });
  }
});

// Get semua users
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find({}, 'username nama email lastSeen');
    res.json({ success: true, users });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Get chat history antara 2 user
app.get('/api/messages/:user1/:user2', async (req, res) => {
  try {
    const { user1, user2 } = req.params;
    const messages = await Message.find({
      $or: [
        { from: user1, to: user2 },
        { from: user2, to: user1 }
      ]
    }).sort({ timestamp: 1 });
    res.json({ success: true, messages });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Create group
app.post('/api/groups', async (req, res) => {
  try {
    const { name, description, members, admin } = req.body;
    const group = new Group({ name, description, members, admin });
    await group.save();
    res.json({ success: true, group });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Get user's groups
app.get('/api/groups/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const groups = await Group.find({ members: username });
    res.json({ success: true, groups });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Endpoint untuk membersihkan database sepenuhnya
app.delete('/api/clear-database', async (req, res) => {
  try {
    await User.deleteMany({}); // Hapus semua user
    await Message.deleteMany({}); // Hapus semua pesan
    await Group.deleteMany({}); // Hapus semua grup
    res.json({ success: true, message: 'Database berhasil dibersihkan. Tidak ada data yang tersisa.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint untuk menghapus semua user di database
app.delete('/api/clear-users', async (req, res) => {
  try {
    await User.deleteMany({});
    res.json({ success: true, message: 'Semua user berhasil dihapus dari database.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Socket.IO untuk realtime chat
const users = {}; // Track online users: { socketId: username }
const userSockets = {}; // Track user sockets: { username: socketId }

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // User join dengan username
  socket.on('join', (username) => {
    users[socket.id] = username;
    userSockets[username] = socket.id;
    socket.username = username;
    console.log(`${username} joined`);
    
    // Broadcast online users
    io.emit('user_online', Object.values(users));
    
    // Update user last seen
    User.findOneAndUpdate(
      { username },
      { lastSeen: new Date() }
    ).catch(err => console.error('Error updating last seen:', err));
  });

  // Send message (Enhanced with file support and read receipts)
  socket.on('send_message', async (data) => {
    const { from, to, message, file } = data;
    
    try {
      // Save to database
      const newMessage = new Message({ 
        from, 
        to, 
        message: message || '',
        file: file || null,
        delivered: true
      });
      await newMessage.save();
      
      // Broadcast to both sender and receiver
      const messageData = {
        id: newMessage._id,
        from,
        to,
        message: newMessage.message,
        timestamp: newMessage.timestamp,
        delivered: true,
        read: false,
        file: newMessage.file
      };
      
      io.emit('receive_message', messageData);
    } catch (error) {
      console.error('Error saving message:', error);
    }
  });

  // Typing indicator
  socket.on('typing', (data) => {
    const { from, to } = data;
    io.emit('user_typing', { from, to });
  });

  socket.on('stop_typing', (data) => {
    const { from, to } = data;
    io.emit('user_stop_typing', { from, to });
  });

  // Message read receipt
  socket.on('message_read', async (data) => {
    const { messageId, from, to } = data;
    
    try {
      // Update message read status in database
      await Message.findByIdAndUpdate(messageId, { read: true });
      
      // Notify sender
      io.emit('message_read', { messageId, from, to });
    } catch (error) {
      console.error('Error updating message read status:', error);
    }
  });

  // WebRTC Signaling untuk video/voice call
  socket.on('call_user', (data) => {
    // data: { from, to, offer, type: 'video' or 'voice' }
    io.emit('incoming_call', data);
  });

  socket.on('call_accepted', (data) => {
    // data: { from, to, answer }
    io.emit('call_accepted', data);
  });

  socket.on('call_rejected', (data) => {
    io.emit('call_rejected', data);
  });

  socket.on('ice_candidate', (data) => {
    // data: { from, to, candidate }
    io.emit('ice_candidate', data);
  });

  socket.on('end_call', (data) => {
    io.emit('call_ended', data);
  });

  // Group chat
  socket.on('send_group_message', async (data) => {
    const { from, groupId, message, file } = data;
    
    try {
      const group = await Group.findById(groupId);
      if (!group) return;
      
      // Broadcast to all group members
      const messageData = {
        from,
        groupId,
        groupName: group.name,
        message,
        file,
        timestamp: new Date().toISOString()
      };
      
      io.emit('receive_group_message', messageData);
    } catch (error) {
      console.error('Error sending group message:', error);
    }
  });

  // User disconnect
  socket.on('disconnect', () => {
    const username = users[socket.id];
    if (username) {
      delete users[socket.id];
      delete userSockets[username];
      console.log(`${username} disconnected`);
      
      // Update last seen
      User.findOneAndUpdate(
        { username },
        { lastSeen: new Date() }
      ).catch(err => console.error('Error updating last seen:', err));
      
      // Broadcast updated online users
      io.emit('user_online', Object.values(users));
    }
  });
});

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Features enabled:');
  console.log('- Real-time messaging with file attachments');
  console.log('- Online/offline status tracking');
  console.log('- Typing indicators');
  console.log('- Read receipts');
  console.log('- Voice and video calls (WebRTC)');
  console.log('- Group chat support');
});
