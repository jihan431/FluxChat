const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

mongoose.connect('mongodb://localhost:27017/chatapp')
  .then(() => {})
  .catch(err => {});

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  nama: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  lastSeen: { type: Date, default: Date.now },
  otpHash: { type: String },
  otpExpires: { type: Date },
  avatar: { type: String, default: 'default' },
  friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  friendRequests: [{
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
  }]
});

const User = mongoose.model('User', userSchema);

async function seedDatabase() {
  try {
    await User.deleteMany({});

    const hashedPassword = await bcrypt.hash('testpass123', 10);

    // Buat 3 user test
    const user1 = new User({
      username: 'user1',
      nama: 'Jihan Nugraha',
      email: 'test@example.com',
      password: hashedPassword,
      lastSeen: new Date(),
    });

    const user2 = new User({
      username: 'user2',
      nama: 'Jihan tidak nugraha',
      email: 'test2@example.com',
      password: hashedPassword,
      lastSeen: new Date(),
    });

    const user3 = new User({
      username: 'user3',
      nama: 'Nugraha',
      email: 'test3@example.com',
      password: hashedPassword,
      lastSeen: new Date(),
    });

    await user1.save();
    await user2.save();
    await user3.save();

    // Set user1 dan user2 sebagai teman
    user1.friends.push(user2._id, user3._id);
    user2.friends.push(user1._id, user3._id);
    user3.friends.push(user1._id, user2._id);

    await user1.save();
    await user2.save();
    await user3.save();

    process.exit(0);
  } catch (error) {
    process.exit(1);
  }
}

seedDatabase();