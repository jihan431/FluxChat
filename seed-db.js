const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

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

const User = mongoose.model('User', userSchema);

async function seedDatabase() {
  try {
    await User.deleteMany({});
    console.log('✅ Database dibersihkan');

    const hashedPassword = await bcrypt.hash('testpass123', 10);

    const testUser = new User({
      username: 'testuser',
      nama: 'Test User',
      email: 'testuser@example.com',
      password: hashedPassword,
      lastSeen: new Date()
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
