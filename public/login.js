const API_URL = window.location.origin;

function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

function validatePassword(password) {
  return password.length >= 6;
}

function validateUsername(username) {
  return username.trim() && !/\s/.test(username);
}

function validateOTP(otp) {
  return /^\d{6}$/.test(otp);
}

function setMode(mode) {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const otpForm = document.getElementById('otpForm');
  const authCard = document.querySelector('.auth-card');
  const authTabs = document.querySelector('.auth-tabs');
  const tabButtons = document.querySelectorAll('.tab-btn');

  tabButtons.forEach(btn => btn.classList.remove('active'));

  // Function untuk update card height
  const updateCardHeight = (form) => {
    // Hitung height dari form yang akan ditampilkan
    setTimeout(() => {
      const height = form.scrollHeight + 150; // 150px untuk header dan padding
      authCard.style.minHeight = height + 'px';
    }, 0);
  };

  if (mode === 'login') {
    tabButtons[0].classList.add('active');
    authTabs.classList.remove('tab-daftar');
    registerForm.classList.add('hidden');
    otpForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
    updateCardHeight(loginForm);
  } else if (mode === 'register') {
    tabButtons[1].classList.add('active');
    authTabs.classList.add('tab-daftar');
    loginForm.classList.add('hidden');
    otpForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
    updateCardHeight(registerForm);
  } else if (mode === 'otp') {
    tabButtons.forEach(btn => btn.classList.remove('active'));
    authTabs.classList.remove('tab-daftar');
    loginForm.classList.add('hidden');
    registerForm.classList.add('hidden');
    otpForm.classList.remove('hidden');
    updateCardHeight(otpForm);
  }
}

window.setMode = setMode;

// --- LOGIKA TOAST TERBARU ---
function showNotification(message, type = 'info') {
  const toastBox = document.getElementById('toastBox');
  if (!toastBox) return;

  const toast = document.createElement('div');
  toast.classList.add('toast', type);

  // Icon SVG based on type - Inline untuk performa lebih baik
  let iconHtml = '';
  if (type === 'success') {
    iconHtml = `<span style="color: #4ade80; font-size: 1.2rem;">✓</span>`;
  } else if (type === 'error') {
    iconHtml = `<span style="color: #f87171; font-size: 1.2rem;">✕</span>`;
  } else {
    iconHtml = `<span style="color: #60a5fa; font-size: 1.2rem;">ℹ</span>`;
  }

  toast.innerHTML = `
    <div class="toast-icon">${iconHtml}</div>
    <div class="toast-msg">${message}</div>
  `;

  toastBox.appendChild(toast);

  // Auto remove after 3.5s
  setTimeout(() => {
    toast.classList.add('hide');
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 3500);
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value.trim();

  if (!email || !password) {
    showNotification('Masukkan email dan password!', 'error');
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Memproses...';

  try {
    const res = await fetch(`${API_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (data.success) {
      localStorage.setItem('currentUser', JSON.stringify(data.user));
      showNotification('Login sukses! Mengalihkan...', 'success');
      setTimeout(() => window.location.href = 'index.html', 800);
    }
    else {
      showNotification(data.error || 'Login gagal', 'error');
    }
  } catch (error) {
    showNotification('Error jaringan: ' + error.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Masuk Sekarang';
  }
});

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('regUsername').value.trim();
  const nama = document.getElementById('regNama').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value.trim();

  if (!username || !nama || !email || !password) {
    showNotification('Isi semua kolom!', 'error');
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Memproses...';

  try {
    const res = await fetch(`${API_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, nama, email, password })
    });
    const data = await res.json();

    if (data.success) {
      showNotification('Registrasi sukses! Cek OTP di email.', 'success');
      document.getElementById('otpEmailHidden').value = email;
      document.getElementById('otpType').value = 'register';
      setTimeout(() => setMode('otp'), 500);
    } else {
      showNotification(data.error || 'Gagal daftar', 'error');
    }
  } catch (error) {
    showNotification('Error jaringan: ' + error.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Buat Akun';
  }
});

document.getElementById('otpForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('otpEmailHidden').value.trim();
  const otp = document.getElementById('otpCode').value.trim();
  const otpType = document.getElementById('otpType').value;

  if (!validateOTP(otp)) {
    showNotification('Kode OTP harus 6 digit angka.', 'error');
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Memverifikasi...';

  try {
    const endpoint = otpType === 'login' ? '/api/verify-login-otp' : '/api/verify-otp';
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp })
    });
    const data = await res.json();

    if (data.success) {
      if (otpType === 'login') {
        localStorage.setItem('currentUser', JSON.stringify(data.user));
        showNotification('Login berhasil! Mengalihkan...', 'success');
        setTimeout(() => window.location.href = 'index.html', 1000);
      } else {
        showNotification('Verifikasi berhasil! Silakan login.', 'success');
        document.getElementById('otpCode').value = '';
        setTimeout(() => setMode('login'), 1000);
      }
    } else {
      showNotification(data.error || 'OTP Salah', 'error');
    }
  } catch (error) {
    showNotification('Error jaringan: ' + error.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Verifikasi';
  }
});

if (localStorage.getItem('currentUser')) {
  window.location.href = 'index.html';
}

// Set initial card height saat halaman dimuat
document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');
  const authCard = document.querySelector('.auth-card');
  const initialHeight = loginForm.scrollHeight + 150;
  authCard.style.minHeight = initialHeight + 'px';
});