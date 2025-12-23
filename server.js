require("dotenv").config();
const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");
const { OAuth2Client } = require("google-auth-library");
const crypto = require("crypto");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { exec } = require("child_process");

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  maxHttpBufferSize: 15 * 1024 * 1024,
});

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(express.static("public"));

const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/chatapp";

mongoose
  .connect(mongoUri)
  .then(() => {
    console.info(`[MongoDB] Connected: ${mongoUri} 🔆`);
  })
  .catch((err) => {
    console.error("[MongoDB] Connection error:", err.message);
  });

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  nama: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  lastSeen: { type: Date, default: Date.now },
  avatar: { type: String, default: "default" },
  profileCompleted: { type: Boolean, default: false },
  authProvider: { type: String, enum: ["local", "google"], default: "local" },
  role: { type: String, enum: ["user", "admin"], default: "user" },

  otpHash: { type: String },
  otpExpires: { type: Date },

  friends: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  friendRequests: [
    {
      from: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      createdAt: { type: Date, default: Date.now },
    },
  ],
  blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
});

const messageSchema = new mongoose.Schema({
  from: { type: String, required: true },
  to: { type: String, required: true },
  message: { type: String, default: "" },
  file: {
    name: { type: String, default: null },
    size: { type: Number, default: null },
    type: { type: String, default: null },
    data: { type: String, default: null },
  },
  timestamp: { type: Date, default: Date.now },
  read: { type: Boolean, default: false },
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: "GroupChat" },
  replyTo: {
    messageId: String,
    senderName: String,
    content: String,
    mediaUrl: String,
    type: { type: String },
    userId: String,
  },
  isDeleted: { type: Boolean, default: false },
  hiddenFor: [{ type: String }],
});

messageSchema.pre("save", function (next) {
  const hasMessage = this.message && this.message.trim() !== "";
  const hasFile = this.file && this.file.data;

  if (!hasMessage && !hasFile) {
    return next(new Error("Pesan atau file harus ada minimal satu"));
  }
  next();
});

messageSchema.index({ from: 1, to: 1, timestamp: -1 });
messageSchema.index({ groupId: 1, timestamp: -1 });

const groupChatSchema = new mongoose.Schema({
  nama: { type: String, required: true },
  avatar: { type: String, default: "G" },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  createdAt: { type: Date, default: Date.now },
  lastMessage: { type: String },
  lastMessageTime: { type: Date },
});

const statusSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  type: { type: String, enum: ["text", "image"], required: true },
  content: { type: String, required: true },
  caption: { type: String },
  backgroundColor: { type: String },
  viewers: [
    {
      user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      viewedAt: { type: Date, default: Date.now },
    },
  ],
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
});

statusSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const User = mongoose.model("User", userSchema);
const Message = mongoose.model("Message", messageSchema);
const GroupChat = mongoose.model("GroupChat", groupChatSchema);
const Status = mongoose.model("Status", statusSchema);

const validateObjectId = (req, res, next) => {
  const id =
    req.params.userId || req.body.userId || req.query.userId || req.params.id;
  if (id && !mongoose.Types.ObjectId.isValid(id)) {
    return res
      .status(400)
      .json({ success: false, error: "Format ID tidak valid" });
  }
  next();
};
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER || "cracked655@gmail.com",
    pass: process.env.EMAIL_PASS,
  },
});

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClient = googleClientId ? new OAuth2Client(googleClientId) : null;

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_FILE_TYPES = [
  "image/",
  "video/",
  "audio/",
  "application/pdf",
  "text/plain",
];

function getFileSizeFromBase64(base64Data) {
  try {
    if (!base64Data) return 0;
    const stripped = base64Data.split(";base64,").pop() || "";
    return Math.floor((stripped.length * 3) / 4);
  } catch {
    return 0;
  }
}

function isFileTypeAllowed(mime) {
  if (!mime) return false;
  return ALLOWED_FILE_TYPES.some((type) => {
    if (type.endsWith("/")) return mime.startsWith(type);
    return mime === type;
  });
}


const isAdmin = async (req, res, next) => {
  try {
    const adminId = req.body.adminId || req.query.adminId || req.headers["x-admin-id"];
    if (!adminId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    if (!mongoose.Types.ObjectId.isValid(adminId)) {
      return res.status(400).json({ success: false, error: "Invalid admin ID" });
    }

    const admin = await User.findById(adminId);
    if (!admin || admin.role !== "admin") {
      return res.status(403).json({ success: false, error: "Akses ditolak. Hanya admin yang diizinkan." });
    }

    req.admin = admin;
    next();
  } catch (error) {
    res.status(500).json({ success: false, error: "Server error" });
  }
};




app.get("/api/admin/stats", isAdmin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalMessages = await Message.countDocuments();
    const totalGroups = await GroupChat.countDocuments();
    const totalStatuses = await Status.countDocuments();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const newUsersToday = await User.countDocuments({ 
      _id: { $gte: mongoose.Types.ObjectId.createFromTime(today.getTime() / 1000) }
    });

    res.json({
      success: true,
      stats: {
        totalUsers,
        totalMessages,
        totalGroups,
        totalStatuses,
        newUsersToday
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


app.get("/api/admin/users", isAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20, search = "", sortBy = "createdAt", order = "desc" } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    let query = {};
    if (search) {
      query = {
        $or: [
          { username: { $regex: search, $options: "i" } },
          { nama: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } }
        ]
      };
    }

    const sortOrder = order === "asc" ? 1 : -1;
    const sortField = ["username", "nama", "email", "lastSeen", "role"].includes(sortBy) ? sortBy : "_id";

    const users = await User.find(query)
      .select("username nama email avatar lastSeen role authProvider profileCompleted friends")
      .sort({ [sortField]: sortOrder })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await User.countDocuments(query);

    res.json({
      success: true,
      users: users.map(u => ({
        ...u.toObject(),
        friendsCount: u.friends?.length || 0
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


app.get("/api/admin/users/:id", isAdmin, validateObjectId, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select("-password -otpHash -otpExpires")
      .populate("friends", "username nama avatar");

    if (!user) {
      return res.status(404).json({ success: false, error: "User tidak ditemukan" });
    }

    const messageCount = await Message.countDocuments({ from: user.username });

    res.json({
      success: true,
      user: {
        ...user.toObject(),
        messageCount
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


app.put("/api/admin/users/:id", isAdmin, validateObjectId, async (req, res) => {
  try {
    const { email, resetPassword } = req.body;
    const userId = req.params.id;

    
    if (userId === req.admin._id.toString()) {
      return res.status(400).json({ success: false, error: "Tidak dapat mengedit akun sendiri" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: "User tidak ditemukan" });
    }

    
    if (user.role === "admin") {
      return res.status(400).json({ success: false, error: "Tidak dapat mengedit admin lain" });
    }

    
    if (email && email !== user.email) {
      const emailExists = await User.findOne({ email, _id: { $ne: userId } });
      if (emailExists) {
        return res.status(400).json({ success: false, error: "Email sudah digunakan user lain" });
      }
    }

    const updateData = {};
    
    if (email) updateData.email = email;

    
    if (resetPassword) {
      const tempPassword = crypto.randomBytes(6).toString("hex");
      updateData.password = await bcrypt.hash(tempPassword, 10);
      
      
      try {
        await transporter.sendMail({
          from: "FluxChat Admin",
          to: user.email,
          subject: "Password Reset oleh Admin",
          html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #5a8a8c;">FluxChat</h2>
            <p>Password Anda telah direset oleh administrator.</p>
            <p>Password baru Anda: <strong>${tempPassword}</strong></p>
            <p>Silakan login dan segera ubah password Anda.</p>
          </div>`
        });
      } catch (emailErr) {
        console.error("[Admin] Failed to send password reset email:", emailErr);
      }
    }

    const updatedUser = await User.findByIdAndUpdate(userId, updateData, { new: true })
      .select("-password -otpHash -otpExpires");

    
    io.to(user.username).emit("user_updated_by_admin", {
      email: updateData.email,
      passwordReset: !!resetPassword
    });

    res.json({
      success: true,
      message: resetPassword ? "Password berhasil direset" : "User berhasil diperbarui",
      user: updatedUser
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


app.delete("/api/admin/users/:id", isAdmin, validateObjectId, async (req, res) => {
  try {
    const userId = req.params.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: "User tidak ditemukan" });
    }

    
    if (userId === req.admin._id.toString()) {
      return res.status(400).json({ success: false, error: "Tidak dapat menghapus akun sendiri" });
    }

    
    await User.updateMany(
      { friends: userId },
      { $pull: { friends: userId } }
    );

    
    await User.updateMany(
      { "friendRequests.from": userId },
      { $pull: { friendRequests: { from: userId } } }
    );

    
    await Message.deleteMany({ from: user.username });

    
    await GroupChat.updateMany(
      { members: userId },
      { $pull: { members: userId } }
    );

    
    await GroupChat.deleteMany({ createdBy: userId, members: { $size: 1 } });

    
    await Status.deleteMany({ user: userId });

    
    await User.findByIdAndDelete(userId);

    res.json({ success: true, message: "User berhasil dihapus" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


app.get("/api/admin/groups", isAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const groups = await GroupChat.find()
      .populate("createdBy", "username nama")
      .populate("members", "username nama avatar")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await GroupChat.countDocuments();

    res.json({
      success: true,
      groups,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


app.delete("/api/admin/groups/:id", isAdmin, validateObjectId, async (req, res) => {
  try {
    const groupId = req.params.id;

    const group = await GroupChat.findById(groupId);
    if (!group) {
      return res.status(404).json({ success: false, error: "Grup tidak ditemukan" });
    }

    
    await Message.deleteMany({ groupId });

    
    await GroupChat.findByIdAndDelete(groupId);

    res.json({ success: true, message: "Grup berhasil dihapus" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});



app.post("/api/register", async (req, res) => {
  try {
    const { username, nama, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: "Data tidak lengkap" });
    }

    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res
        .status(400)
        .json({ error: "Username atau Email sudah digunakan" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    const user = new User({
      username,
      nama,
      email,
      password: hashedPassword,
      otpHash,
      otpExpires,
      authProvider: "local",
      profileCompleted: false,
    });

    await user.save();

    try {
      await transporter.sendMail({
        from: "FluxChat Security",
        to: email,
        subject: "Kode Verifikasi FluxChat",
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa; border-radius: 10px;">
          <div style="text-align: center; padding: 20px 0;">
            <h2 style="color: #4361ee;">FluxChat</h2>
            <p style="color: #6c757d;">Verifikasi Akun Anda</p>
          </div>
          
          <div style="background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center;">
            <div style="margin-bottom: 20px;">
              <h3 style="color: #343a40;">Kode Verifikasi Anda</h3>
              <p style="color: #6c757d;">Masukkan kode berikut untuk memverifikasi akun FluxChat Anda:</p>
            </div>
            
            <div style="background-color: #e9ecef; padding: 15px; border-radius: 6px; margin: 20px 0; display: inline-block;">
              <span style="font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #4361ee;">${otp}</span>
            </div>
            
            <p style="color: #6c757d; font-size: 14px;">
              Kode ini berlaku selama <strong>10 menit</strong>. Jangan bagikan kode ini kepada siapa pun.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 20px; padding: 15px; color: #6c757d; font-size: 12px;">
            <p>Jika Anda tidak meminta kode ini, abaikan email ini.</p>
            <p>&copy; 2025 FluxChat. Hak Cipta Dilindungi.</p>
          </div>
        </div>`,
      });
    } catch (emailErr) {
      console.error("[Email] Failed to send OTP:", emailErr);
    }

    res.json({ success: true, message: "OTP terkirim" });
  } catch (error) {
    res.status(500).json({ error: "Server Error" });
  }
});

app.get("/api/config", (req, res) => {
  res.json({
    googleClientId: googleClientId || null,
  });
});


app.post("/login.html", async (req, res) => {
  try {
    const { credential, g_csrf_token } = req.body;

    if (!credential) {
      return res.redirect("/login.html?error=no_credential");
    }

    if (!googleClientId || !googleClient) {
      return res.redirect("/login.html?error=google_not_configured");
    }

    
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: googleClientId,
    });
    const payload = ticket.getPayload();

    const email = payload?.email;
    if (!email) {
      return res.redirect("/login.html?error=no_email");
    }

    const displayName = payload.name || email.split("@")[0];
    const avatar = payload.picture || "default";
    const googleSub = payload.sub;

    let user = await User.findOne({ email });

    if (!user) {
      const baseUsername =
        (email.split("@")[0] || "user")
          .replace(/[^a-zA-Z0-9_]/g, "")
          .slice(0, 18) || "user";
      let usernameCandidate = baseUsername;
      let attempt = 0;
      while (await User.findOne({ username: usernameCandidate })) {
        attempt += 1;
        usernameCandidate = `${baseUsername}${Math.floor(
          100 + Math.random() * 900
        )}`;
        if (attempt > 5) {
          usernameCandidate = `${baseUsername}${Date.now()
            .toString()
            .slice(-4)}`;
          break;
        }
      }

      const randomPass = crypto.randomBytes(12).toString("hex");
      const hashedPassword = await bcrypt.hash(randomPass, 10);

      user = new User({
        username: usernameCandidate,
        nama: displayName,
        email,
        password: hashedPassword,
        avatar,
        otpHash: undefined,
        otpExpires: undefined,
        lastSeen: new Date(),
        authProvider: "google",
        profileCompleted: false,
      });

      await user.save();
    } else {
      user.otpHash = undefined;
      user.otpExpires = undefined;
      user.avatar = avatar || user.avatar;
      user.lastSeen = new Date();
      await user.save();
    }

    
    const userData = {
      username: user.username,
      nama: user.nama,
      email: user.email,
      id: user._id,
      avatar: user.avatar,
      provider: "google",
      authProvider: user.authProvider || "google",
      profileCompleted: user.profileCompleted || false,
      role: user.role || "user",
      googleSub,
    };

    
    const userDataEncoded = encodeURIComponent(JSON.stringify(userData));
    res.redirect(`/login.html?google_user=${userDataEncoded}`);
  } catch (error) {
    console.error("[Google Redirect] Error:", error);
    res.redirect(`/login.html?error=${encodeURIComponent(error.message)}`);
  }
});

app.post("/api/auth/google", async (req, res) => {
  try {
    const { token } = req.body;

    if (!googleClientId || !googleClient) {
      return res
        .status(500)
        .json({ error: "Google login belum dikonfigurasi" });
    }

    if (!token) {
      return res.status(400).json({ error: "Token tidak ditemukan" });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: googleClientId,
    });
    const payload = ticket.getPayload();

    const email = payload?.email;
    if (!email)
      return res
        .status(400)
        .json({ error: "Email tidak tersedia dari Google" });

    const displayName = payload.name || email.split("@")[0];
    const avatar = payload.picture || "default";
    const googleSub = payload.sub;

    let user = await User.findOne({ email });

    if (!user) {
      const baseUsername =
        (email.split("@")[0] || "user")
          .replace(/[^a-zA-Z0-9_]/g, "")
          .slice(0, 18) || "user";
      let usernameCandidate = baseUsername;
      let attempt = 0;
      while (await User.findOne({ username: usernameCandidate })) {
        attempt += 1;
        usernameCandidate = `${baseUsername}${Math.floor(
          100 + Math.random() * 900
        )}`;
        if (attempt > 5) {
          usernameCandidate = `${baseUsername}${Date.now()
            .toString()
            .slice(-4)}`;
          break;
        }
      }

      const randomPass = crypto.randomBytes(12).toString("hex");
      const hashedPassword = await bcrypt.hash(randomPass, 10);

      user = new User({
        username: usernameCandidate,
        nama: displayName,
        email,
        password: hashedPassword,
        avatar,
        otpHash: undefined,
        otpExpires: undefined,
        lastSeen: new Date(),
        authProvider: "google",
        profileCompleted: false,
      });

      await user.save();
    } else {
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
        provider: "google",
        authProvider: user.authProvider || "google",
        profileCompleted: user.profileCompleted || false,
        role: user.role || "user",
        googleSub,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Login Google gagal" });
  }
});

app.post("/api/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({ email });

    if (!user) return res.status(404).json({ error: "User tidak ditemukan" });

    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");

    if (user.otpHash !== otpHash || user.otpExpires < Date.now()) {
      return res.status(400).json({ error: "OTP salah atau kadaluarsa" });
    }

    user.otpHash = undefined;
    user.otpExpires = undefined;
    await user.save();

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/recovery/send-code", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) return res.status(404).json({ error: "Email tidak terdaftar" });

    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    user.otpHash = otpHash;
    user.otpExpires = otpExpires;
    await user.save();

    try {
      await transporter.sendMail({
        from: "FluxChat Security",
        to: email,
        subject: "Reset Password FluxChat",
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa; border-radius: 10px;">
          <div style="text-align: center; padding: 20px 0;">
            <h2 style="color: #4361ee;">FluxChat</h2>
            <p style="color: #6c757d;">Permintaan Reset Password</p>
          </div>
          <div style="background-color: white; padding: 30px; border-radius: 8px; text-align: center;">
            <p>Gunakan kode berikut untuk melanjutkan proses reset password:</p>
            <div style="background-color: #e9ecef; padding: 15px; border-radius: 6px; margin: 20px 0; display: inline-block;">
              <span style="font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #4361ee;">${otp}</span>
            </div>
            <p style="font-size: 12px; color: #999;">Kode berlaku selama 10 menit.</p>
          </div>
        </div>`,
      });
    } catch (emailErr) {
      console.error("[Email] Failed to send Recovery OTP:", emailErr);
      return res.status(500).json({ error: "Gagal mengirim email" });
    }

    res.json({ success: true, message: "Kode dikirim ke email" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/recovery/reset", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    const user = await User.findOne({ email });

    if (!user) return res.status(404).json({ error: "User tidak ditemukan" });

    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");

    if (user.otpHash !== otpHash || user.otpExpires < Date.now()) {
      return res.status(400).json({ error: "Kode OTP salah atau kadaluarsa" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    user.otpHash = undefined;
    user.otpExpires = undefined;
    await user.save();

    res.json({ success: true, message: "Password berhasil diubah" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user) return res.status(404).json({ error: "Akun tidak ditemukan" });

    if (user.otpHash)
      return res
        .status(403)
        .json({ error: "Akun belum diverifikasi. Silakan cek email." });

    const validPass = await bcrypt.compare(password, user.password);
    if (!validPass) return res.status(400).json({ error: "Password salah" });

    user.lastSeen = new Date();
    await user.save();

    return res.json({
      success: true,
      user: {
        username: user.username,
        nama: user.nama,
        email: user.email,
        id: user._id,
        avatar: user.avatar,
        authProvider: user.authProvider || "local",
        profileCompleted: user.profileCompleted || false,
        role: user.role || "user",
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/profile", async (req, res) => {
  try {
    const { id, nama, password, avatar } = req.body;

    if (!id)
      return res.status(400).json({ success: false, error: "ID tidak valid" });
    if (!nama || nama.trim() === "")
      return res
        .status(400)
        .json({ success: false, error: "Nama tidak boleh kosong" });

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res
        .status(400)
        .json({ success: false, error: "Format ID tidak valid" });
    }

    const updateData = { nama };

    if (password && password.trim() !== "") {
      updateData.password = await bcrypt.hash(password, 10);
    }

    if (avatar) {
      updateData.avatar = avatar;
    }

    const user = await User.findByIdAndUpdate(id, updateData, { new: true });

    if (!user) {
      return res
        .status(404)
        .json({ success: false, error: "User tidak ditemukan" });
    }
    io.emit("user_profile_updated", {
      userId: user._id,
      nama: user.nama,
      avatar: user.avatar,
      username: user.username,
    });

    res.json({
      success: true,
      message: "Profil berhasil diperbarui",
      user: {
        username: user.username,
        nama: user.nama,
        email: user.email,
        id: user._id,
        avatar: user.avatar,
        authProvider: user.authProvider,
        profileCompleted: user.profileCompleted,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


app.put("/api/users/:id/complete-profile", validateObjectId, async (req, res) => {
  try {
    const { id } = req.params;
    const { nama, avatar } = req.body;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ success: false, error: "Format ID tidak valid" });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, error: "User tidak ditemukan" });
    }

    const updateData = { profileCompleted: true };

    if (nama && nama.trim() !== "") {
      updateData.nama = nama.trim();
    }

    if (avatar && avatar.startsWith("data:")) {
      updateData.avatar = avatar;
    }

    const updatedUser = await User.findByIdAndUpdate(id, updateData, { new: true });
    io.emit("user_profile_updated", {
      userId: updatedUser._id,
      nama: updatedUser.nama,
      avatar: updatedUser.avatar,
      username: updatedUser.username,
    });

    res.json({
      success: true,
      message: "Profil berhasil dilengkapi",
      user: {
        username: updatedUser.username,
        nama: updatedUser.nama,
        email: updatedUser.email,
        id: updatedUser._id,
        avatar: updatedUser.avatar,
        authProvider: updatedUser.authProvider,
        profileCompleted: updatedUser.profileCompleted,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/statuses", validateObjectId, async (req, res) => {
  try {
    const { userId, type, content, backgroundColor, caption } = req.body;
    if (!userId || !type || !content) {
      return res
        .status(400)
        .json({ success: false, error: "Data tidak lengkap" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, error: "User tidak ditemukan" });
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const newStatus = new Status({
      user: userId,
      type,
      content,
      caption,
      backgroundColor,
      expiresAt,
    });

    await newStatus.save();
    res.status(201).json({ success: true, status: newStatus });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/statuses/:id/view", validateObjectId, async (req, res) => {
  try {
    const { userId } = req.body;
    const statusId = req.params.id;

    await Status.updateOne(
      { _id: statusId, "viewers.user": { $ne: userId } },
      {
        $push: { viewers: { user: userId, viewedAt: new Date() } },
      }
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete("/api/statuses/:id", validateObjectId, async (req, res) => {
  try {
    const statusId = req.params.id;
    const { userId } = req.body;

    if (!userId)
      return res
        .status(400)
        .json({ success: false, error: "User ID diperlukan" });

    const status = await Status.findById(statusId);
    if (!status)
      return res
        .status(404)
        .json({ success: false, error: "Status tidak ditemukan" });

    if (status.user.toString() !== userId) {
      return res
        .status(403)
        .json({
          success: false,
          error: "Anda tidak berhak menghapus status ini",
        });
    }

    const user = await User.findById(userId).populate("friends", "username");

    await Status.findByIdAndDelete(statusId);

    if (user) {
      const recipients = [
        user.username,
        ...user.friends.map((f) => f.username),
      ];
      recipients.forEach((username) => {
        io.to(username).emit("status_deleted", { statusId, userId });
      });
    }

    res.json({ success: true, message: "Status berhasil dihapus" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/statuses", validateObjectId, async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res
        .status(400)
        .json({ success: false, error: "User ID diperlukan" });
    }

    const user = await User.findById(userId).select("friends");
    if (!user) {
      return res
        .status(404)
        .json({ success: false, error: "User tidak ditemukan" });
    }

    const userAndFriendIds = [userId, ...user.friends];

    const statuses = await Status.find({
      user: { $in: userAndFriendIds },
      expiresAt: { $gt: new Date() },
    })
      .populate("user", "username nama avatar")
      .populate("viewers.user", "username nama avatar")
      .sort({ "user.id": 1, createdAt: -1 });

    res.json({ success: true, statuses });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/users", async (req, res) => {
  try {
    const { currentUserId } = req.query;
    const users = await User.find(
      {},
      "username nama lastSeen avatar friends friendRequests"
    );

    const usersWithStatus = users.map((user) => {
      const isOnline = onlineUsers
        .values()
        .toArray()
        .some((u) => u === user.username);

      let isFriend = false;
      let isPending = false;

      if (currentUserId) {
        isFriend = user.friends.includes(currentUserId);
        isPending = user.friendRequests.some(
          (req) => req.from.toString() === currentUserId
        );
      }

      return {
        ...user.toObject(),
        status: isOnline ? "online" : "offline",
        isFriend,
        isPending,
      };
    });

    res.json({ success: true, users: usersWithStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/messages/:user1/:user2", async (req, res) => {
  const { user1, user2 } = req.params;
  const limit = parseInt(req.query.limit) || 50;

  const messages = await Message.find({
    $or: [
      { from: user1, to: user2 },
      { from: user2, to: user1 },
    ],
    hiddenFor: { $ne: user1 },
  })
    .sort({ timestamp: -1 })
    .limit(limit);

  res.json({ success: true, messages: messages.reverse() });
});

app.get("/api/messages/search", async (req, res) => {
  try {
    const { userId, q, chatId, isGroup, limit = 50, skip = 0 } = req.query;
    if (!q || !userId) return res.json({ success: true, results: [] });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: "User tidak ditemukan" });

    const regex = new RegExp(q, "i");
    const queryConditions = {
      $and: [
        { $or: [{ message: regex }, { "file.name": regex }] },
        { isDeleted: { $ne: true } },
        { hiddenFor: { $ne: user.username } },
      ],
    };

    if (!chatId) {
      return res.json({ success: true, results: [] });
    }

    if (isGroup === "true") {
      queryConditions.$and.push({ groupId: chatId });

      const group = await GroupChat.findOne({ _id: chatId, members: userId });
      if (!group) {
        return res.status(403).json({ error: "Akses ditolak ke grup ini" });
      }
    } else {
      queryConditions.$and.push({ groupId: { $exists: false } });
      queryConditions.$and.push({
        $or: [
          { from: user.username, to: chatId },
          { from: chatId, to: user.username },
        ],
      });
    }

    const messages = await Message.find(queryConditions)
      .sort({ timestamp: -1 })
      .skip(parseInt(skip) || 0)
      .limit(Math.min(parseInt(limit) || 50, 100));

    const senderUsernames = [...new Set(messages.map((m) => m.from))];
    const senders = await User.find({
      username: { $in: senderUsernames },
    }).select("username nama");
    const senderMap = new Map(senders.map((s) => [s.username, s]));

    const results = messages.map((m) => {
      const sender = senderMap.get(m.from);
      return {
        id: m._id,
        from: m.from,
        sender: {
          username: sender?.username || m.from,
          nama: sender?.nama || m.from,
        },
        message: m.message,
        file: m.file,
        timestamp: m.timestamp,
      };
    });

    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const onlineUsers = new Map();

app.get("/api/users/search", async (req, res) => {
  try {
    const { query, currentUserId } = req.query;

    if (!query) return res.json({ success: true, users: [] });

    const users = await User.find({
      $and: [
        { _id: { $ne: currentUserId } },
        { role: { $ne: "admin" } }, 
        {
          $or: [
            { username: { $regex: query, $options: "i" } },
            { nama: { $regex: query, $options: "i" } },
            { email: { $regex: query, $options: "i" } },
          ],
        },
      ],
    }).select("username nama avatar friends friendRequests");

    const results = users.map((u) => {
      const isFriend = u.friends.includes(currentUserId);
      const isPending = u.friendRequests.some(
        (req) => req.from.toString() === currentUserId
      );
      const isIncoming = false;

      return {
        _id: u._id,
        username: u.username,
        nama: u.nama,
        avatar: u.avatar,
        isFriend,
        isPending,
      };
    });

    res.json({ success: true, users: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/friends/list/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .populate("friends", "username nama avatar lastSeen _id")
      .populate("friendRequests.from", "username nama avatar");

    if (!user) return res.status(404).json({ error: "User not found" });

    const friendsWithFlag = user.friends.map((friend) => {
      const friendObj = friend.toObject ? friend.toObject() : friend;
      const isPending = user.friendRequests.some(
        (req) => req.from._id.toString() === friendObj._id.toString()
      );

      return {
        ...friendObj,
        isFriend: true,
        isPending: isPending,
      };
    });

    res.json({
      success: true,
      friends: friendsWithFlag,
      requests: user.friendRequests,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/friends/request", async (req, res) => {
  try {
    const { fromId, toId } = req.body;

    if (fromId === toId)
      return res.status(400).json({ error: "Tidak bisa add diri sendiri" });

    const targetUser = await User.findById(toId);
    const senderUser = await User.findById(fromId);

    if (!targetUser || !senderUser)
      return res.status(404).json({ error: "User tidak ditemukan" });

    
    if (targetUser.role === "admin") {
      return res.status(400).json({ error: "Tidak dapat menambahkan admin sebagai teman" });
    }

    if (targetUser.friends.includes(fromId)) {
      return res.status(400).json({ error: "Kalian sudah berteman" });
    }

    const alreadyRequested = targetUser.friendRequests.some(
      (req) => req.from.toString() === fromId
    );
    if (alreadyRequested) {
      return res
        .status(400)
        .json({ error: "Permintaan pertemanan sudah terkirim sebelumnya" });
    }

    const reverseRequest = senderUser.friendRequests.find(
      (req) => req.from.toString() === toId
    );
    if (reverseRequest) {
      senderUser.friends.push(toId);
      targetUser.friends.push(fromId);
      senderUser.friendRequests = senderUser.friendRequests.filter(
        (req) => req.from.toString() !== toId
      );

      await senderUser.save();
      await targetUser.save();
      return res.json({
        success: true,
        message: "Otomatis berteman karena dia juga add kamu!",
        status: "accepted",
      });
    }

    targetUser.friendRequests.push({ from: fromId });
    await targetUser.save();

    io.to(targetUser.username).emit("new_friend_request", {
      from: { username: senderUser.username, nama: senderUser.nama },
    });

    res.json({ success: true, message: "Permintaan pertemanan dikirim" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/friends/accept", async (req, res) => {
  try {
    const { userId, requesterId } = req.body;

    const user = await User.findById(userId);
    const requester = await User.findById(requesterId);

    if (!user || !requester)
      return res.status(404).json({ error: "User not found" });

    const reqIndex = user.friendRequests.findIndex(
      (r) => r.from.toString() === requesterId
    );
    if (reqIndex === -1)
      return res.status(400).json({ error: "Request tidak ditemukan" });

    user.friendRequests.splice(reqIndex, 1);

    if (!user.friends.includes(requesterId)) user.friends.push(requesterId);
    if (!requester.friends.includes(userId)) requester.friends.push(userId);

    await user.save();
    await requester.save();

    io.to(requester.username).emit("friend_request_accepted", {
      user: {
        _id: user._id,
        username: user.username,
        nama: user.nama,
        avatar: user.avatar,
      },
    });

    res.json({ success: true, message: "Pertemanan diterima!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/friends/reject", async (req, res) => {
  try {
    const { userId, requesterId } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.friendRequests = user.friendRequests.filter(
      (r) => r.from.toString() !== requesterId
    );
    await user.save();

    res.json({ success: true, message: "Permintaan ditolak" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/friends/:friendId", async (req, res) => {
  try {
    const { userId } = req.body;
    const friendId = req.params.friendId;

    if (!userId || !friendId) {
      return res.status(400).json({ success: false, error: "ID tidak valid" });
    }

    await User.findByIdAndUpdate(userId, { $pull: { friends: friendId } });
    await User.findByIdAndUpdate(friendId, { $pull: { friends: userId } });

    res.json({ success: true, message: "Pertemanan berhasil dihapus" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete("/api/messages/all", async (req, res) => {
  try {
    const { from, to, forEveryone } = req.body;

    const query = {
      $or: [
        { from: from, to: to },
        { from: to, to: from },
      ],
      groupId: { $exists: false },
    };

    if (forEveryone) {
      await Message.deleteMany(query);
      io.to(from).emit("chat_cleared", { with: to });
      io.to(to).emit("chat_cleared", { with: from });
    } else {
      await Message.updateMany(query, { $addToSet: { hiddenFor: from } });
      io.to(from).emit("chat_cleared", { with: to });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/groups/:userId", async (req, res) => {
  try {
    const groups = await GroupChat.find({ members: req.params.userId })
      .populate("createdBy", "username nama avatar")
      .populate("members", "username nama avatar")
      .sort({ lastMessageTime: -1 });

    res.json({ success: true, groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/groups", async (req, res) => {
  try {
    const { nama, createdBy, members } = req.body;

    if (!nama || !createdBy) {
      return res.status(400).json({ error: "Nama dan createdBy diperlukan" });
    }

    const allMembers = [createdBy, ...members];
    const uniqueMembers = [...new Set(allMembers)];

    const group = new GroupChat({
      nama,
      avatar: nama.charAt(0).toUpperCase(),
      createdBy,
      members: uniqueMembers,
    });

    await group.save();
    await group.populate("createdBy", "username nama avatar");
    await group.populate("members", "username nama avatar");

    res.json({ success: true, group });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/groups/:groupId/messages", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const messages = await Message.find({ groupId: req.params.groupId })
      .sort({ timestamp: -1 })
      .limit(limit);
    res.json({ success: true, messages: messages.reverse() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/groups/:groupId/members", async (req, res) => {
  try {
    const { userId } = req.body;
    const group = await GroupChat.findByIdAndUpdate(
      req.params.groupId,
      { $addToSet: { members: userId } },
      { new: true }
    ).populate("members", "username nama avatar");

    res.json({ success: true, group });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/groups/:groupId", async (req, res) => {
  try {
    const { groupId } = req.params;
    const { nama, avatar, userId } = req.body;

    if (!nama || !userId) {
      return res
        .status(400)
        .json({ success: false, error: "Nama grup dan ID user diperlukan" });
    }

    const group = await GroupChat.findById(groupId);
    if (!group) {
      return res
        .status(404)
        .json({ success: false, error: "Grup tidak ditemukan" });
    }

    if (group.createdBy.toString() !== userId) {
      return res
        .status(403)
        .json({
          success: false,
          error: "Hanya pembuat grup yang dapat mengedit",
        });
    }

    group.nama = nama;
    if (avatar) {
      group.avatar = avatar;
    } else if (!group.avatar || !group.avatar.startsWith("data:")) {
      group.avatar = nama.charAt(0).toUpperCase();
    }

    await group.save();
    const updatedGroup = await GroupChat.findById(groupId).populate(
      "members",
      "username nama avatar"
    );

    io.to(groupId).emit("group_updated", { group: updatedGroup });

    res.json({ success: true, group: updatedGroup });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete("/api/groups/:groupId/members/:userId", async (req, res) => {
  try {
    const group = await GroupChat.findByIdAndUpdate(
      req.params.groupId,
      { $pull: { members: req.params.userId } },
      { new: true }
    ).populate("members", "username nama avatar");

    res.json({ success: true, group });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/groups/:groupId", async (req, res) => {
  try {
    const group = await GroupChat.findByIdAndDelete(req.params.groupId);
    await Message.deleteMany({ groupId: req.params.groupId });
    res.json({ success: true, message: "Group dihapus" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/users/block/:userIdToBlock", async (req, res) => {
  try {
    const { blockerId } = req.body;
    const userIdToBlock = req.params.userIdToBlock;

    if (!blockerId || !userIdToBlock) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid request" });
    }

    const blocker = await User.findById(blockerId);
    if (!blocker) {
      return res
        .status(404)
        .json({ success: false, message: "Blocker not found" });
    }

    if (blocker.blockedUsers.includes(userIdToBlock)) {
      return res
        .status(400)
        .json({ success: false, message: "User sudah di-block" });
    }

    blocker.blockedUsers.push(userIdToBlock);
    await blocker.save();

    blocker.friends = blocker.friends.filter(
      (f) => f.toString() !== userIdToBlock
    );
    await blocker.save();

    res.json({ success: true, message: "User berhasil di-block" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/users/blocked-list", async (req, res) => {
  try {
    const { userId } = req.query;
    const user = await User.findById(userId).populate(
      "blockedUsers",
      "username nama email"
    );

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    res.json({ success: true, blockedUsers: user.blockedUsers || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/gemini", async (req, res) => {
  try {
    if (!genAI) {
      return res
        .status(503)
        .json({
          success: false,
          error: "Server belum dikonfigurasi dengan GEMINI_API_KEY",
        });
    }

    const { message, history } = req.body;

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction:
        "kamu adalah seorang manusia,dapat mengerti perasaan manunsia dan seorang programer senior jenius lulusan s3 oxford serta gaul dan kamu adalah seorang gen z",
    });

    const chat = model.startChat({
      history: history || [],
      generationConfig: {
        maxOutputTokens: 4096,
      },
    });

    const result = await chat.sendMessage(message);
    const response = await result.response;
    const text = response.text();

    res.json({ success: true, reply: text });
  } catch (error) {
    console.error("[Gemini] Error:", error);

    let errorMessage = error.message || "Maaf, Gemini sedang sibuk.";

    if (errorMessage.includes("429") || errorMessage.includes("Quota")) {
      errorMessage =
        "Kuota Gemini sedang penuh. Mohon tunggu sebentar sebelum mencoba lagi.";
    } else if (
      errorMessage.includes("404") ||
      errorMessage.includes("Not Found")
    ) {
      errorMessage =
        'Gagal: Pastikan "Google Generative AI API" sudah diaktifkan di Google Cloud Console.';
    }

    res.status(500).json({ success: false, error: errorMessage });
  }
});

io.on("connection", (socket) => {
  socket.on("join", async (data) => {
    const username = typeof data === "string" ? data : data.username;

    onlineUsers.set(socket.id, username);
    socket.join(username);

    try {
      const user = await User.findOne({ username });
      if (user) {
        const groups = await GroupChat.find({ members: user._id });
        groups.forEach((group) => socket.join(group._id.toString()));
      }
    } catch (err) {
      console.error("[Socket] Error joining groups:", err);
    }

    io.emit("user_status_change", { username, status: "online" });

    const onlineUsersList = Array.from(new Set(onlineUsers.values()));
    io.emit("online_users_list", onlineUsersList);
  });

  socket.on("get_online_users", () => {
    const onlineUsersList = Array.from(new Set(onlineUsers.values()));
    socket.emit("online_users_list", onlineUsersList);
  });

  socket.on("send_message", async (data) => {
    const { from, to, message, file, groupId, replyTo, tempId } = data;

    let sanitizedFile = null;
    if (file && file.data) {
      const fileSize = file.size || getFileSizeFromBase64(file.data);

      if (fileSize > MAX_FILE_BYTES) {
        socket.emit("message_error", {
          error: "File terlalu besar (maks 10MB)",
        });
        return;
      }

      if (file.type && !isFileTypeAllowed(file.type)) {
        socket.emit("message_error", { error: "Tipe file tidak diizinkan" });
        return;
      }

      sanitizedFile = {
        name: file.name || "file",
        size: fileSize,
        type: file.type || "application/octet-stream",
        data: file.data,
      };
    }

    if (groupId) {
      const newMsg = new Message({
        from,
        to: groupId,
        message,
        file: sanitizedFile,
        groupId,
        replyTo,
      });
      const savedMessage = await newMsg.save();

      socket.broadcast.to(groupId).emit("receive_message", savedMessage);

      const savedMessageObject = savedMessage.toObject();
      if (tempId) {
        savedMessageObject.tempId = tempId;
      }
      socket.emit("message_sent", savedMessageObject);
    } else {
      const newMsg = new Message({
        from,
        to,
        message,
        file: sanitizedFile,
        replyTo,
      });
      const savedMessage = await newMsg.save();

      const savedMessageObject = savedMessage.toObject();
      if (tempId) {
        savedMessageObject.tempId = tempId;
      }

      io.to(to).emit("receive_message", savedMessage);

      socket.emit("message_sent", savedMessageObject);
    }
  });

  socket.on("typing", (data) => {
    io.to(data.to).emit("user_typing", { from: data.from });
  });

  socket.on("stop_typing", (data) => {
    io.to(data.to).emit("stop_typing", { from: data.from });
  });

  socket.on("delete_message_for_everyone", async (data) => {
    try {
      const { messageId } = data;
      const username = onlineUsers.get(socket.id);

      if (!username) {
        return socket.emit("message_error", {
          error: "Autentikasi gagal untuk menghapus pesan.",
        });
      }

      const message = await Message.findById(messageId);

      if (!message) {
        return socket.emit("message_error", {
          error: "Pesan tidak ditemukan.",
        });
      }

      if (message.from !== username) {
        return socket.emit("message_error", {
          error: "Anda tidak bisa menghapus pesan orang lain.",
        });
      }

      await Message.findByIdAndUpdate(messageId, {
        $set: {
          isDeleted: true,
          message: "",
          file: { name: null, size: null, type: null, data: null },
          replyTo: null,
        },
      });

      let newLastMessage = null;
      const query = {};

      if (message.groupId) {
        query.groupId = message.groupId;
      } else {
        query.groupId = { $exists: false };
        query.$or = [
          { from: message.from, to: message.to },
          { from: message.to, to: message.from },
        ];
      }

      newLastMessage = await Message.findOne(query).sort({ timestamp: -1 });

      const payload = {
        messageId: message._id.toString(),
        groupId: message.groupId ? message.groupId.toString() : null,
        timestamp: message.timestamp,
        from: message.from,
        to: message.to,
        newLastMessage: newLastMessage,
      };

      if (message.groupId) {
        io.to(message.groupId.toString()).emit("message_deleted", payload);
      } else {
        io.to(message.to).emit("message_deleted", payload);
        io.to(message.from).emit("message_deleted", payload);
      }
    } catch (error) {
      socket.emit("message_error", {
        error: "Gagal menghapus pesan di server.",
      });
    }
  });

  socket.on("delete_message_for_me", async (data) => {
    try {
      const { messageId } = data;
      const username = onlineUsers.get(socket.id);

      if (!username) {
        return socket.emit("message_error", {
          error: "Autentikasi gagal untuk menghapus pesan.",
        });
      }

      const message = await Message.findById(messageId);

      if (!message) {
        return socket.emit("message_error", {
          error: "Pesan tidak ditemukan.",
        });
      }

      await Message.findByIdAndUpdate(messageId, {
        $addToSet: { hiddenFor: username },
      });
      let newLastMessage = null;
      const query = { hiddenFor: { $ne: username } };

      if (message.groupId) {
        query.groupId = message.groupId;
      } else {
        query.groupId = { $exists: false };
        query.$or = [
          { from: message.from, to: message.to },
          { from: message.to, to: message.from },
        ];
      }

      newLastMessage = await Message.findOne(query).sort({ timestamp: -1 });

      socket.emit("message_hidden", {
        messageId: message._id.toString(),
        groupId: message.groupId ? message.groupId.toString() : null,
        from: message.from,
        to: message.to,
        newLastMessage: newLastMessage,
      });
    } catch (error) {
      console.error("Error delete_message_for_me:", error);
      socket.emit("message_error", {
        error: "Gagal menyembunyikan pesan.",
      });
    }
  });

  socket.on("call_offer", (data) => {
    io.to(data.to).emit("call_offer", {
      offer: data.offer,
      from: data.from,
      type: data.type,
    });
  });

  socket.on("call_answer", (data) => {
    io.to(data.to).emit("call_answer", {
      answer: data.answer,
      from: data.from,
    });
  });

  socket.on("ice_candidate", (data) => {
    io.to(data.to).emit("ice_candidate", {
      candidate: data.candidate,
      from: data.from,
    });
  });

  socket.on("end_call", (data) => {
    io.to(data.to).emit("call_ended", { reason: data.reason });
  });

  
  
  
  if (!global.activeGroupCalls) {
    global.activeGroupCalls = new Map();
  }

  
  socket.on("group_call_start", async (data) => {
    const { groupId, callType, from } = data;
    
    try {
      const group = await GroupChat.findById(groupId).populate("members", "username");
      if (!group) return;

      
      global.activeGroupCalls.set(groupId, {
        participants: new Set([from]),
        callType,
        startTime: Date.now(),
        initiator: from
      });

      
      group.members.forEach((member) => {
        if (member.username !== from) {
          io.to(member.username).emit("group_call_incoming", {
            groupId,
            groupName: group.nama,
            callType,
            initiator: from
          });
        }
      });

      
      socket.emit("group_call_started", { groupId, callType });
    } catch (error) {
      socket.emit("group_call_error", { error: "Gagal memulai panggilan grup" });
    }
  });

  
  socket.on("group_call_join", (data) => {
    const { groupId, username } = data;
    const call = global.activeGroupCalls.get(groupId);
    
    if (!call) {
      socket.emit("group_call_error", { error: "Panggilan tidak ditemukan" });
      return;
    }

    
    const existingParticipants = Array.from(call.participants);
    
    
    call.participants.add(username);
    
    
    socket.emit("group_call_participants", {
      groupId,
      participants: existingParticipants,
      callType: call.callType
    });

    
    existingParticipants.forEach((participant) => {
      io.to(participant).emit("group_call_participant_joined", {
        groupId,
        username,
        participantCount: call.participants.size
      });
    });
  });

  
  socket.on("group_call_offer", (data) => {
    const { groupId, to, from, offer } = data;
    io.to(to).emit("group_call_offer", {
      groupId,
      from,
      offer
    });
  });

  
  socket.on("group_call_answer", (data) => {
    const { groupId, to, from, answer } = data;
    io.to(to).emit("group_call_answer", {
      groupId,
      from,
      answer
    });
  });

  
  socket.on("group_call_ice", (data) => {
    const { groupId, to, from, candidate } = data;
    io.to(to).emit("group_call_ice", {
      groupId,
      from,
      candidate
    });
  });

  
  socket.on("group_call_leave", (data) => {
    const { groupId, username } = data;
    const call = global.activeGroupCalls.get(groupId);
    
    if (call) {
      call.participants.delete(username);
      
      
      call.participants.forEach((participant) => {
        io.to(participant).emit("group_call_participant_left", {
          groupId,
          username,
          participantCount: call.participants.size
        });
      });

      
      if (call.participants.size === 0) {
        global.activeGroupCalls.delete(groupId);
      }
    }
  });

  
  socket.on("group_call_end", async (data) => {
    const { groupId, username } = data;
    const call = global.activeGroupCalls.get(groupId);
    
    if (call) {
      
      call.participants.forEach((participant) => {
        io.to(participant).emit("group_call_ended", { groupId });
      });

      
      try {
        const group = await GroupChat.findById(groupId).populate("members", "username");
        if (group) {
          group.members.forEach((member) => {
            if (!call.participants.has(member.username)) {
              io.to(member.username).emit("group_call_ended", { groupId });
            }
          });
        }
      } catch (e) {
        
      }

      global.activeGroupCalls.delete(groupId);
    }
  });

  
  socket.on("group_call_reject", (data) => {
    const { groupId, username } = data;
    
    socket.emit("group_call_rejected", { groupId });
  });

  
  socket.on("group_call_mute_toggle", (data) => {
    const { groupId, username, isMuted } = data;
    const call = global.activeGroupCalls.get(groupId);
    
    if (call) {
      call.participants.forEach((participant) => {
        if (participant !== username) {
          io.to(participant).emit("group_call_participant_muted", {
            groupId,
            username,
            isMuted
          });
        }
      });
    }
  });

  
  
  socket.on("group_call_camera_toggle", (data) => {
    const { groupId, username, isCameraOff } = data;
    const call = global.activeGroupCalls.get(groupId);
    
    if (call) {
      call.participants.forEach((participant) => {
        if (participant !== username) {
          io.to(participant).emit("group_call_participant_camera", {
            groupId,
            username,
            isCameraOff
          });
        }
      });
    }
  });

  socket.on("disconnect", () => {
    const username = onlineUsers.get(socket.id);
    if (username) {
      User.findOneAndUpdate({ username }, { lastSeen: new Date() }).exec();
      io.emit("user_status_change", { username, status: "offline" });
      onlineUsers.delete(socket.id);

      const onlineUsersList = Array.from(new Set(onlineUsers.values()));
      io.emit("online_users_list", onlineUsersList);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.info(`[Server] Listening on port ${PORT} 🔆`);
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn("[Email] Gmail Login 🔆");
  }
});
