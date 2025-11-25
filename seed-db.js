const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/chatapp')
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB error:', err));

// Define User Schema
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

const User = mongoose.model('User', userSchema);

async function seedDatabase() {
  try {
    // Hapus user lama
    await User.deleteMany({});
    console.log('✅ Database dibersihkan');

    // Password: testpass123
    const hashedPassword = await bcrypt.hash('testpass123', 10);

    // Buat test user yang sudah diverifikasi (tanpa otpHash)
    const testUser = new User({
      username: 'testuser',
      nama: 'Test User',
      email: 'testuser@example.com',
      password: hashedPassword,
      lastSeen: new Date()
      // otpHash dan otpExpires tidak diset = user sudah diverifikasi
    });

    await testUser.save();
    console.log('✅ Test user berhasil ditambahkan!');
    console.log('📧 Email: testuser@example.com');
    console.log('🔑 Password: testpass123');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

seedDatabase();
