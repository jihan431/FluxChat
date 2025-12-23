require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/chatapp';


const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  nama: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  lastSeen: { type: Date, default: Date.now },
  avatar: { type: String, default: 'default' },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
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
    
    
    const collections = await mongoose.connection.db.collections();
    
    for (let collection of collections) {
      
      await collection.deleteMany({});
      console.log(`   ✨ Koleksi '${collection.collectionName}' berhasil dibersihkan.`);
    }

    console.log('👤 Membuat user admin...');

    
    const hashedPassword = await bcrypt.hash('password123', 10);
    
    await User.create({
      username: 'admin',
      nama: 'Admin FluxChat',
      email: 'admin@fluxchat.com',
      password: hashedPassword,
      role: 'admin'
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