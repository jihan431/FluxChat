<!-- Improved README.md for FluxChat -->
<div align="center">
  <img src="public/assets/images/logo.png" alt="FluxChat Logo" width="120" height="120">
  
  <h1>FluxChat</h1>
  
  <p>
    <strong>A Modern Real-Time Chat Application</strong>
  </p>
  
  <p>
    Experience seamless communication with FluxChat's innovative approach to real-time messaging, 
    combining cutting-edge technologies with an intuitive user interface.
  </p>
  
  <p>
    <a href="#features"><img src="https://img.shields.io/badge/Features-10+-blue.svg" alt="Features"></a>
    <a href="#tech-stack"><img src="https://img.shields.io/badge/Built%20With-Node.js-green.svg" alt="Built With"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License"></a>
    <a href="#"><img src="https://img.shields.io/badge/Version-2.0.0-orange.svg" alt="Version"></a>
  </p>
</div>

## 🌟 Welcome to FluxChat

FluxChat redefines real-time communication by blending modern design principles with powerful functionality. Built for developers and users who demand both performance and aesthetics, FluxChat offers a fresh take on instant messaging platforms.

Unlike typical chat applications, FluxChat focuses on creating a unique user experience with its own distinctive style and features, moving beyond conventional messaging paradigms.

## 🚀 Key Features

### 💬 Advanced Messaging
- **Real-time Communication**: Instant message delivery powered by Socket.IO
- **Rich Media Support**: Send text, images, documents, and files up to 50MB
- **Emoji Integration**: Express yourself with our comprehensive emoji picker
- **Message History**: Never lose conversations with persistent message storage

### 👥 Smart Presence System
- **Live Status Updates**: See who's online with real-time presence indicators
- **Last Seen Information**: Know when your contacts were last active
- **Typing Notifications**: Real-time typing indicators with smooth animations

### 📞 Communication Tools
- **Voice & Video Calls**: Peer-to-peer calling with WebRTC technology
- **Call Controls**: Mute, camera toggle, and call duration tracking
- **Ringing Notifications**: Audio alerts for incoming calls

### 🎨 Modern UI/UX
- **Responsive Design**: Optimized for desktop, tablet, and mobile devices
- **Theme Switching**: Toggle between light and dark modes
- **Smooth Animations**: Polished transitions and interactive elements
- **Intuitive Navigation**: Clean interface with easy access to all features

### 🔐 Security & Authentication
- **Secure Registration**: Protected user signup with email validation
- **Password Encryption**: Industry-standard bcrypt password hashing
- **Session Management**: Secure user sessions with automatic timeout
- **Google Authentication**: Alternative sign-in with Google accounts

## 🛠 Tech Stack

FluxChat leverages modern technologies to deliver a robust and scalable platform:

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Frontend** | HTML5, CSS3, JavaScript | User interface and client-side logic |
| **Backend** | Node.js, Express.js | Server logic and API endpoints |
| **Real-time** | Socket.IO | Bidirectional communication |
| **Database** | MongoDB, Mongoose | Data persistence and modeling |
| **Authentication** | bcrypt, Google Auth | User verification and security |
| **Email Service** | Nodemailer | Account verification and notifications |
| **Media Processing** | Wavesurfer.js, Feather Icons | Audio visualization and icons |

## 🏗 Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Frontend      │    │   WebSocket      │    │   Backend       │
│  (HTML/CSS/JS)  │◄──►│   (Socket.IO)    │◄──►│  (Node.js)      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │                         │
                        ┌─────────────────┐    ┌─────────────────┐
                        │   Database      │    │   Services      │
                        │  (MongoDB)      │    │ (Auth/Email)    │
                        └─────────────────┘    └─────────────────┘
```

## 📁 Project Structure

```
FluxChat/
├── public/                 # Client-side assets
│   ├── assets/             # Images, icons, and media
│   ├── css/                # Stylesheets
│   └── js/                 # Client-side JavaScript
├── security/               # Encryption and security tools
├── server.js              # Main server application
├── package.json           # Dependencies and scripts
└── README.md             # Project documentation
```

## ▶️ Getting Started

### Prerequisites
- Node.js (v14 or higher)
- MongoDB (v4.4 or higher)
- Modern web browser with WebRTC support

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/FluxChat.git
cd FluxChat
```

2. **Install dependencies**
```bash
npm install
```

3. **Start MongoDB**
```bash
# Linux/macOS
sudo systemctl start mongod

# Windows
net start MongoDB
```

4. **Launch the application**
```bash
npm start
```

5. **Access the application**
Open your browser and navigate to `http://localhost:3000`

## 🎯 Usage Guide

### Creating an Account
1. Navigate to the registration page
2. Enter your username, full name, and email
3. Create a secure password
4. Verify your email address

### Starting a Conversation
1. Log in to your account
2. Select a contact from your chat list
3. Type your message in the input field
4. Press Enter or click send

### Making Calls
1. Open a chat with the desired contact
2. Click the phone icon for voice calls
3. Click the video icon for video calls
4. Accept incoming calls from the notification panel

### Customizing Your Experience
1. Toggle between light/dark themes using the sun/moon icon
2. Adjust notification settings in your profile
3. Manage your account information in the profile section

## 🔄 Development

### Available Scripts
- `npm start` - Run the application in production mode
- `npm run dev` - Run the application in development mode with auto-reload

### Environment Variables
Create a `.env` file in the root directory:
```env
MONGO_URI=mongodb://localhost:27017/chatapp
PORT=3000
```

## 🤝 Contributing

We welcome contributions to FluxChat! Here's how you can help:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

Please ensure your code follows our style guidelines and includes appropriate tests.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Socket.IO team for real-time communication tools
- MongoDB community for database solutions
- All contributors who have helped shape FluxChat

---

<div align="center">
  <strong>Built with ❤️ for modern communication</strong><br><br>
  <img src="https://img.shields.io/github/stars/FluxChat?style=social" alt="GitHub Stars">
  <img src="https://img.shields.io/github/forks/FluxChat?style=social" alt="GitHub Forks">
</div>
