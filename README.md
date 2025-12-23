<div align="center">

  <h1>FluxChat</h1>
  
  <p>
    <strong>Hubungkan Dunia, Satu Pesan pada Satu Waktu</strong>
  </p>

  <p>
    <img src="https://img.shields.io/badge/node.js-339933?style=for-the-badge&logo=Node.js&logoColor=white" alt="Node.js" />
    <img src="https://img.shields.io/badge/express.js-%23404d59.svg?style=for-the-badge&logo=express&logoColor=%2361DAFB" alt="Express.js" />
    <img src="https://img.shields.io/badge/Socket.io-black?style=for-the-badge&logo=socket.io&badgeColor=010101" alt="Socket.io" />
    <img src="https://img.shields.io/badge/MongoDB-%234ea94b.svg?style=for-the-badge&logo=mongodb&logoColor=white" alt="MongoDB" />
    <img src="https://img.shields.io/badge/Google%20Gemini-8E75B2?style=for-the-badge&logo=google%20gemini&logoColor=white" alt="Google Gemini" />
  </p>

  <br />

  <img src="./public/assets/Screenshot_20251212_095000.png" alt="FluxChat Screenshot" width="800" style="border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);" />

  <br />
  <br />

  <p>
    FluxChat adalah aplikasi pesan real-time modern yang dibangun untuk komunikasi tanpa batas. Dengan fitur panggilan suara/video, status update, dan integrasi AI, FluxChat membawa pengalaman chatting ke level berikutnya.
  </p>
</div>

<hr />

## 🚀 Fitur Unggulan

FluxChat dirancang dengan fitur-fitur kekinian untuk memenuhi kebutuhan komunikasi Anda:

| Fitur | Deskripsi |
| :--- | :--- |
| **💬 Real-time Messaging** | Chat pribadi dan grup instan dengan Socket.IO. |
| **📎 Multimedia Support** | Kirim gambar, video, audio, PDF, dan file lainnya dengan mudah. |
| **🎤 Voice Notes** | Rekam dan kirim pesan suara langsung dari antarmuka chat. |
| **📞 Voice & Video Calls** | Panggilan peer-to-peer berkualitas tinggi menggunakan WebRTC. |
| **⭕ Status Updates** | Bagikan cerita (story) teks atau gambar yang hilang setelah 24 jam. |
| **🤖 AI Assistant** | Ngobrol cerdas dengan integrasi Google Gemini AI. |
| **🔐 Aman & Privat** | Autentikasi aman dengan OAuth Google dan verifikasi email. |

## 🛠️ Teknologi

Dibangun dengan stack teknologi yang handal dan modern:

- **Backend:** Node.js, Express.js
- **Database:** MongoDB (Mongoose)
- **Real-time Engine:** Socket.IO
- **Frontend:** HTML5, CSS3, Vanilla JavaScript
- **AI:** Google Generative AI (Gemini)

## ⚙️ Instalasi

Ikuti langkah-langkah berikut untuk menjalankan FluxChat di mesin lokal Anda:

### 1. Clone Repository

```bash
git clone https://github.com/jihan431/fluxchat.git
cd fluxchat
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Konfigurasi Environment

Buat file `.env` di root direktori dan tambahkan konfigurasi berikut:

```env
# Server Configuration
PORT=3000

# Database
MONGO_URI=mongodb://localhost:27017/chatapp

# Email Configuration (Untuk OTP & Recovery)
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password

# Google OAuth (Opsional)
GOOGLE_CLIENT_ID=your_google_client_id

# Google Gemini AI (Opsional)
GEMINI_API_KEY=your_gemini_api_key
```

> **Catatan:** Jika menggunakan Gmail, pastikan Anda menggunakan **App Password** jika 2FA aktif.

### 4. Jalankan Server

**Mode Development:**
```bash
npm run dev
```

**Mode Production:**
```bash
npm start
```

### 5. Buka Aplikasi

Kunjungi `http://localhost:3000` di browser favorit Anda.

## 🤝 Kontribusi

Kontribusi sangat diterima! Jika Anda ingin meningkatkan FluxChat:

1. Fork repository ini.
2. Buat branch fitur baru (`git checkout -b fitur-keren`).
3. Commit perubahan Anda (`git commit -m 'Menambahkan fitur keren'`).
4. Push ke branch (`git push origin fitur-keren`).
5. Buat Pull Request.

## 📄 Lisensi

Proyek ini dilisensikan di bawah [MIT License](LICENSE).

---
