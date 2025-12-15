# FluxChat

FluxChat is a modern, real-time messaging application built with Node.js, Express, Socket.IO, and MongoDB. It features a responsive UI, voice/video calls, status updates, and AI integration.

## 🚀 Features

*   **Real-time Messaging:** Instant private and group chats using Socket.IO.
*   **Multimedia Support:** Send images, videos, audio, PDFs, and text files.
*   **Voice Notes:** Record and send voice messages directly from the chat interface.
*   **Voice & Video Calls:** Peer-to-peer calling using WebRTC.
*   **Status Updates:** Share text or image stories (like WhatsApp/Instagram) that expire after 24 hours.
*   **AI Assistant:** Integrated Google Gemini AI for chatting and assistance.
*   **Friend System:** Send friend requests, accept/reject, and block users.
*   **Authentication:**
    *   Email/Password registration with OTP verification.
    *   Google OAuth login.
    *   Password recovery via email.
*   **UI/UX:**
    *   Responsive design (Mobile & Desktop).
    *   Dark/Light theme toggle.
    *   Message replies and context menus (Delete for me/everyone).
    *   Typing indicators and online status.
    *   Read receipts and unread counters.

## 🛠️ Tech Stack

*   **Backend:** Node.js, Express.js
*   **Database:** MongoDB (Mongoose)
*   **Real-time Engine:** Socket.IO
*   **Frontend:** HTML5, CSS3, Vanilla JavaScript
*   **AI:** Google Generative AI (Gemini)
*   **Authentication:** Google Auth Library, Bcrypt, Nodemailer

## ⚙️ Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/yourusername/fluxchat.git
    cd fluxchat
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Configure Environment Variables:**
    Create a `.env` file in the root directory and add the following:

    ```env
    # Server Configuration
    PORT=3000
    
    # Database
    MONGO_URI=mongodb://localhost:27017/chatapp
    
    # Email Configuration (for OTP & Recovery)
    EMAIL_USER=your_email@gmail.com
    EMAIL_PASS=your_app_password
    
    # Google OAuth (Optional)
    GOOGLE_CLIENT_ID=your_google_client_id
    
    # Google Gemini AI (Optional)
    GEMINI_API_KEY=your_gemini_api_key
    ```

    > **Note:** For Gmail, use an App Password if 2FA is enabled.

4.  **Start the Server:**
    
    For development (with nodemon):
    ```bash
    npm run dev
    ```

    For production:
    ```bash
    npm start
    ```

5.  **Access the App:**
    Open your browser and navigate to `http://localhost:3000`.

## 📁 Project Structure

```
FluxChat/
├── public/             # Static frontend files
│   ├── css/            # Stylesheets
│   ├── js/             # Client-side logic
│   ├── index.html      # Main application view
│   ├── login.html      # Login view
│   └── ...
├── server.js           # Main backend server entry point
├── package.json        # Project dependencies and scripts
└── .env                # Environment variables
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License.