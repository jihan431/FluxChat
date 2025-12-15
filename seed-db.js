require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/chatapp';

// Definisi Schema User (Hanya yang diperlukan untuk pembuatan user)
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  nama: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  lastSeen: { type: Date, default: Date.now },
  avatar: { type: String, default: 'default' },
  otpHash: { type: String },
  otpExpires: { type: Date },
  friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  friendRequests: [{
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
  }],
  blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
});

const User = mongoose.models.User || mongoose.model('User', userSchema);

const seedDB = async () => {
  try {
    await mongoose.connect(mongoUri);
    console.log('🔌 MongoDB Connected.');

    console.log('🧹 Membersihkan seluruh database...');
    
    // Ambil semua koleksi (tables) yang ada di database secara dinamis
    const collections = await mongoose.connection.db.collections();
    
    for (let collection of collections) {
      // Hapus semua dokumen di setiap koleksi (Users, Messages, Groups, Statuses, dll)
      await collection.deleteMany({});
      console.log(`   ✨ Koleksi '${collection.collectionName}' berhasil dibersihkan.`);
    }

    console.log('👤 Membuat user admin...');

    // Buat 1 User Admin
    const hashedPassword = await bcrypt.hash('password123', 10);
    
    await User.create({
      username: 'admin',
      nama: 'Admin FluxChat',
      email: 'admin@fluxchat.com',
      password: hashedPassword
    });

    console.log('✅ Database Reset Selesai!');
    console.log('👉 Login: admin@fluxchat.com / password123');
    process.exit(0);
  } catch (err) {
    console.error('❌ Gagal seeding:', err);
    process.exit(1);
  }
};

seedDB();