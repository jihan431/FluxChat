require('dotenv').config();
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
    origin: '*',
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 10e6
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static('public'));

mongoose.connect('mongodb://localhost:27017/chatapp')
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB error:', err));

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  nama: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  lastSeen: { type: Date, default: Date.now },
  otpHash: { type: String },
  otpExpires: { type: Date },
  avatar: { type: String, default: 'default' }
});

const messageSchema = new mongoose.Schema({
  from: { type: String, required: true },
  to: { type: String, required: true },
  message: { type: String, default: '' },
  file: { name: String, size: Number, type: String, data: String },
  timestamp: { type: Date, default: Date.now },
  read: { type: Boolean, default: false }
});

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'cracked655@gmail.com',
    pass: process.env.EMAIL_PASS || 'vwpn mhfq evii wrrd'
  }
});

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
      console.error('Email error:', emailErr);
    }

    res.json({ success: true, message: 'OTP terkirim' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server Error' });
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

const onlineUsers = new Map();

io.on('connection', (socket) => {
  socket.on('join', (username) => {
    onlineUsers.set(socket.id, username);
    socket.join(username);
    io.emit('user_status_change', { username, status: 'online' });
    console.log(`🟢 ${username} online`);
  });

  socket.on('send_message', async (data) => {
    const { from, to, message, file } = data;

    const newMsg = new Message({ from, to, message, file });
    await newMsg.save();

    io.to(to).emit('receive_message', newMsg);
    socket.emit('message_sent', newMsg);
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
      console.log(`🔴 ${username} offline`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));