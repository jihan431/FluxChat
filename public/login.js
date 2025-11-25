const API_URL = window.location.origin;

// Validation functions
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

function switchTab(tab) {
  const tabs = document.querySelectorAll('.tab');
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const otpForm = document.getElementById('otpForm');

  tabs.forEach(t => t.classList.remove('active'));

  if (tab === 'login') {
    tabs[0].classList.add('active');
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
    otpForm.classList.add('hidden');
  } else {
    tabs[1].classList.add('active');
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
    otpForm.classList.add('hidden');
  }
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value.trim();

  if (!email || !password) {
    showNotification('Masukkan email dan password!', 'error');
    return;
  }

  if (!validateEmail(email)) {
    showNotification('Format email tidak valid!', 'error');
    return;
  }

  if (!validatePassword(password)) {
    showNotification('Password minimal 6 karakter!', 'error');
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Loading...';

  try {
    const res = await fetch(`${API_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (data.success) {
      localStorage.setItem('currentUser', JSON.stringify(data.user));
      showNotification('Login berhasil!', 'success');
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 1000);
    } else {
      showNotification('Error: ' + data.error, 'error');
    }
  } catch (error) {
    showNotification('Network error: ' + error.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Login';
  }
});

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('regUsername').value.trim();
  const nama = document.getElementById('regNama').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value.trim();

  if (!username || !nama || !email || !password) {
    showNotification('Isi semua field!', 'error');
    return;
  }

  if (!validateUsername(username)) {
    showNotification('Username harus unik dan tanpa spasi!', 'error');
    return;
  }

  if (!validateEmail(email)) {
    showNotification('Format email tidak valid!', 'error');
    return;
  }

  if (!validatePassword(password)) {
    showNotification('Password minimal 6 karakter!', 'error');
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Loading...';

  try {
    const res = await fetch(`${API_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, nama, email, password })
    });
    const data = await res.json();

    if (data.success) {
      showNotification('Kode OTP telah dikirim ke email Anda!', 'success');
      document.getElementById('otpEmail').value = email;
      switchTab('otp');
    } else {
      showNotification('Error: ' + data.error, 'error');
    }
  } catch (error) {
    showNotification('Network error: ' + error.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Daftar';
  }
});

document.getElementById('otpForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('otpEmail').value.trim();
  const otp = document.getElementById('otpCode').value.trim();

  if (!email || !otp) {
    showNotification('Masukkan email dan kode OTP!', 'error');
    return;
  }

  if (!validateOTP(otp)) {
    showNotification('Kode OTP harus 6 digit angka!', 'error');
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Loading...';

  try {
    const res = await fetch(`${API_URL}/api/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp })
    });
    const data = await res.json();

    if (data.success) {
      showNotification('Verifikasi berhasil! Silakan login.', 'success');
      switchTab('login');
    } else {
      showNotification('Error: ' + data.error, 'error');
    }
  } catch (error) {
    showNotification('Network error: ' + error.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Verifikasi';
  }
});

function showNotification(message, type) {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.classList.add('show');
  }, 100);

  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 4000); // Increased timeout for better visibility
}

// Forgot password placeholder
document.querySelector('.forgot-password').addEventListener('click', (e) => {
  e.preventDefault();
  showNotification('Fitur lupa password belum tersedia. Hubungi admin.', 'info');
});

// Check if already logged in
if (localStorage.getItem('currentUser')) {
  window.location.href = 'index.html';
}
