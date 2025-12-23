#!/usr/bin/env node
/**
 * Script to set a user as admin
 * Usage: node set-admin.js <username>
 * 
 * Example:
 *   node set-admin.js jihan
 *   node set-admin.js admin@example.com
 */

require("dotenv").config();
const mongoose = require("mongoose");

const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/chatapp";


const userSchema = new mongoose.Schema({
  username: String,
  nama: String,
  email: String,
  role: { type: String, enum: ["user", "admin"], default: "user" },
});

const User = mongoose.model("User", userSchema);

async function setAdmin(identifier) {
  try {
    console.log(`Connecting to MongoDB: ${mongoUri}`);
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB");

    
    const user = await User.findOne({
      $or: [{ username: identifier }, { email: identifier }],
    });

    if (!user) {
      console.error(`\n❌ User not found: ${identifier}`);
      console.log("\nAvailable users:");
      const allUsers = await User.find({}, "username email role").limit(10);
      allUsers.forEach((u) => {
        console.log(`  - ${u.username} (${u.email}) [${u.role || "user"}]`);
      });
      return;
    }

    if (user.role === "admin") {
      console.log(`\n✅ User "${user.username}" is already an admin!`);
      return;
    }

    
    user.role = "admin";
    await user.save();

    console.log(`\n✅ Success! User "${user.username}" is now an admin.`);
    console.log(`   Name: ${user.nama}`);
    console.log(`   Email: ${user.email}`);
    console.log(`\n💡 You can now login with this account to access the admin panel.`);
  } catch (error) {
    console.error("Error:", error.message);
  } finally {
    await mongoose.disconnect();
    console.log("\nDisconnected from MongoDB");
  }
}


const identifier = process.argv[2];

if (!identifier) {
  console.log("FluxChat Admin Setup Script");
  console.log("============================");
  console.log("\nUsage: node set-admin.js <username or email>");
  console.log("\nExamples:");
  console.log("  node set-admin.js jihan");
  console.log("  node set-admin.js admin@example.com");
  console.log("");
  process.exit(1);
}

setAdmin(identifier);
