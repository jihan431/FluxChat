#!/usr/bin/env node

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// Simple encryption/decryption utility for sensitive files
class FileSecurityManager {
  constructor(password) {
    this.password = password;
    this.algorithm = 'aes-256-cbc';
    // List of sensitive files in the project
    this.sensitiveFiles = [
      '.env',
      'docker-compose.yml',
      'seed-db.js'
    ];
  }

  // Generate key and iv from password
  getKeyAndIV() {
    // Use PBKDF2 to derive key from password
    const key = crypto.pbkdf2Sync(this.password, 'salt', 10000, 32, 'sha256');
    const iv = Buffer.alloc(16, 0); // Simple IV for demo - use random in production
    return { key, iv };
  }

  // Encrypt a file in-place
  encryptFile(filePath) {
    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        console.log(`Warning: File ${filePath} not found, skipping...`);
        return Promise.resolve();
      }

      // Read the original file
      const data = fs.readFileSync(filePath);
      
      // Create backup of original file
      fs.writeFileSync(filePath + '.backup', data);
      console.log(`✓ Backup created: ${filePath}.backup`);
      
      // Encrypt the data
      const { key, iv } = this.getKeyAndIV();
      const cipher = crypto.createCipheriv(this.algorithm, key, iv);
      const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
      
      // Write encrypted data back to the original file
      fs.writeFileSync(filePath, encrypted);
      console.log(`✓ Encrypted: ${filePath}`);
      
      return Promise.resolve();
    } catch (error) {
      console.error(`✗ Error encrypting ${filePath}:`, error.message);
      return Promise.reject(error);
    }
  }

  // Decrypt a file in-place
  decryptFile(filePath) {
    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        console.log(`Warning: File ${filePath} not found, skipping...`);
        return Promise.resolve();
      }

      // Read the encrypted file
      const data = fs.readFileSync(filePath);
      
      // Decrypt the data
      const { key, iv } = this.getKeyAndIV();
      const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
      const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
      
      // Write decrypted data back to the original file
      fs.writeFileSync(filePath, decrypted);
      console.log(`✓ Decrypted: ${filePath}`);
      
      return Promise.resolve();
    } catch (error) {
      console.error(`✗ Error decrypting ${filePath}:`, error.message);
      return Promise.reject(error);
    }
  }

  // Encrypt all sensitive files
  async encryptAll() {
    console.log('Encrypting all sensitive files...');
    for (const file of this.sensitiveFiles) {
      await this.encryptFile(file);
    }
    console.log('All sensitive files encrypted successfully!');
  }

  // Decrypt all sensitive files
  async decryptAll() {
    console.log('Decrypting all sensitive files...');
    for (const file of this.sensitiveFiles) {
      await this.decryptFile(file);
    }
    console.log('All sensitive files decrypted successfully!');
  }

  // Delete all backup files
  deleteBackups() {
    console.log('Deleting backup files...');
    let count = 0;
    for (const file of this.sensitiveFiles) {
      const backupFile = file + '.backup';
      if (fs.existsSync(backupFile)) {
        fs.unlinkSync(backupFile);
        console.log(`✓ Deleted: ${backupFile}`);
        count++;
      }
    }
    console.log(`Deleted ${count} backup files.`);
  }

  // Restore from backups (decrypt from backups)
  restoreFromBackups() {
    console.log('Restoring from backups...');
    let count = 0;
    for (const file of this.sensitiveFiles) {
      const backupFile = file + '.backup';
      if (fs.existsSync(backupFile)) {
        fs.copyFileSync(backupFile, file);
        console.log(`✓ Restored: ${file} from ${backupFile}`);
        count++;
      }
    }
    console.log(`Restored ${count} files from backups.`);
  }
}

// Command line interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log(`
Secure Files Manager - Encrypt/Decrypt sensitive files in-place

Usage:
  node secure-files.js <password> <action> [file]

Actions:
  encrypt <file>     - Encrypt a specific file
  decrypt <file>     - Decrypt a specific file
  encrypt-all        - Encrypt all sensitive files
  decrypt-all        - Decrypt all sensitive files
  delete-backups     - Delete all backup files
  restore            - Restore files from backups

Examples:
  node secure-files.js mypassword encrypt .env
  node secure-files.js mypassword decrypt .env
  node secure-files.js mypassword encrypt-all
  node secure-files.js mypassword decrypt-all
  node secure-files.js mypassword delete-backups
  node secure-files.js mypassword restore
    `);
    process.exit(1);
  }

  const password = args[0];
  const action = args[1];
  const file = args[2];

  const manager = new FileSecurityManager(password);

  try {
    switch (action) {
      case 'encrypt':
        if (!file) {
          console.error('Error: File path required for encrypt action');
          process.exit(1);
        }
        await manager.encryptFile(file);
        console.log('Encryption completed successfully!');
        break;
        
      case 'decrypt':
        if (!file) {
          console.error('Error: File path required for decrypt action');
          process.exit(1);
        }
        await manager.decryptFile(file);
        console.log('Decryption completed successfully!');
        break;
        
      case 'encrypt-all':
        await manager.encryptAll();
        break;
        
      case 'decrypt-all':
        await manager.decryptAll();
        break;
        
      case 'delete-backups':
        manager.deleteBackups();
        break;
        
      case 'restore':
        manager.restoreFromBackups();
        break;
        
      default:
        console.error(`Error: Invalid action '${action}'. Use encrypt, decrypt, encrypt-all, decrypt-all, delete-backups, or restore`);
        process.exit(1);
    }
  } catch (error) {
    console.error('Operation failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = FileSecurityManager;
