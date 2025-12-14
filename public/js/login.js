const API_URL = window.location.origin;
let googleInitTried = false;

// Deteksi perangkat
function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

async function initGoogleLogin() {
  const btn = document.getElementById('googleLoginBtn');
  if (!btn || googleInitTried) return;
  googleInitTried = true;

  const setBtnState = (text, disabled = false) => {
    const span = btn.querySelector('span');
    if (span) span.textContent = text;
    btn.disabled = disabled;
  };

  try {
    const res = await fetch(`${API_URL}/api/config`);
    if (!res.ok) {
      setBtnState('Google tidak tersedia', true);
      return;
    }
    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      setBtnState('Google tidak tersedia', true);
      return;
    }
    const clientId = data.googleClientId;

    if (!clientId) {
      setBtnState('Google login belum diaktifkan', true);
      return;
    }

    const startInit = () => {
      if (typeof google === 'undefined' || !google.accounts?.id) {
        setBtnState('Google tidak tersedia', true);
        return;
      }

      const isMobile = isMobileDevice();
      
      // Konfigurasi berbeda untuk mobile dan desktop
      const config = {
        client_id: clientId,
        callback: handleGoogleCredential
      };

      if (isMobile) {
        // Mobile: gunakan redirect
        config.ux_mode = 'redirect';
        config.redirect_uri = `${window.location.origin}/login.html`;
      } else {
        // Desktop: gunakan popup
        config.ux_mode = 'popup';
      }

      google.accounts.id.initialize(config);

      // Untuk desktop, buat button tersembunyi
      if (!isMobile) {
        const googleBtnContainer = document.createElement('div');
        googleBtnContainer.id = 'googleBtnContainer';
        googleBtnContainer.style.position = 'absolute';
        googleBtnContainer.style.left = '-9999px';
        googleBtnContainer.style.top = '-9999px';
        googleBtnContainer.style.width = btn.offsetWidth + 'px';
        googleBtnContainer.style.height = '40px';
        document.body.appendChild(googleBtnContainer);

        google.accounts.id.renderButton(googleBtnContainer, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          width: btn.offsetWidth || 300
        });

        // Custom button click trigger Google button tersembunyi
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          setTimeout(() => {
            const googleBtn = googleBtnContainer.querySelector('div[role="button"]');
            if (googleBtn) {
              googleBtn.click();
            } else {
              setTimeout(() => {
                const retryBtn = googleBtnContainer.querySelector('div[role="button"]');
                if (retryBtn) {
                  retryBtn.click();
                } else {
                  showNotification('Gagal memuat Google login', 'error');
                }
              }, 500);
            }
          }, 100);
        });
      } else {
        // Mobile: button langsung trigger Google login
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          google.accounts.id.prompt();
        });
      }

      setBtnState('Masuk dengan Google', false);
    };

    if (typeof google !== 'undefined' && google.accounts?.id) {
      startInit();
    } else {
      let attempts = 0;
      const iv = setInterval(() => {
        attempts += 1;
        if (typeof google !== 'undefined' && google.accounts?.id) {
          clearInterval(iv);
          startInit();
        } else if (attempts > 20) {
          clearInterval(iv);
          setBtnState('Google tidak tersedia', true);
        }
      }, 250);
    }
  } catch (error) {
    console.error('Google init error', error);
    setBtnState('Google tidak tersedia', true);
  }
}

async function handleGoogleCredential(response) {
  const btn = document.getElementById('googleLoginBtn');
  const credential = response?.credential;
  if (!credential) {
    showNotification('Token Google tidak valid', 'error');
    return;
  }

  const prevText = btn?.querySelector('span')?.textContent || 'Masuk dengan Google';
  if (btn) {
    btn.disabled = true;
    if (btn.querySelector('span')) btn.querySelector('span').textContent = 'Memproses...';
  }

  try {
    const res = await fetch(`${API_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: credential })
    });
    const data = await res.json();

    if (data.success) {
      localStorage.setItem('currentUser', JSON.stringify(data.user));
      showNotification('Login Google sukses! Mengalihkan...', 'success');
      setTimeout(() => window.location.href = 'index.html', 700);
    } else {
      showNotification(data.error || 'Login Google gagal', 'error');
      if (btn) {
        btn.disabled = false;
        if (btn.querySelector('span')) btn.querySelector('span').textContent = prevText;
      }
    }
  } catch (error) {
    showNotification('Error Google login: ' + error.message, 'error');
    if (btn) {
      btn.disabled = false;
      if (btn.querySelector('span')) btn.querySelector('span').textContent = prevText;
    }
  }
}

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

  const updateCardHeight = (form) => {
    setTimeout(() => {
      const height = form.scrollHeight + 150;
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

function showNotification(message, type = 'info') {
  const toastBox = document.getElementById('toastBox');
  if (!toastBox) return;

  const toast = document.createElement('div');
  toast.classList.add('toast', type);

  let iconHtml = '';
  if (type === 'success') {
    iconHtml = `<span class="toast-success-icon">✓</span>`;
  } else if (type === 'error') {
    iconHtml = `<span class="toast-error-icon">✕</span>`;
  } else {
    iconHtml = `<span class="toast-info-icon">ℹ</span>`;
  }

  toast.innerHTML = `
    <div class="toast-icon">${iconHtml}</div>
    <div class="toast-msg">${message}</div>
  `;

  toastBox.appendChild(toast);

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
        localStorage.setItem('newUser', 'true');
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

function hideLoadingScreen() {
  const loadingScreen = document.getElementById('loadingScreen');
  const authCard = document.querySelector('.auth-card');
  
  if (loadingScreen) {
    loadingScreen.classList.add('hidden');
    setTimeout(() => {
      loadingScreen.remove();
    }, 500);
  }
  
  if (authCard) {
    setTimeout(() => {
      authCard.classList.add('loaded');
    }, 100);
  }
}

function setupPasswordToggle() {
  const loginPasswordInput = document.getElementById('loginPassword');
  const loginToggleButton = document.getElementById('loginPasswordToggle');
  
  if (loginPasswordInput && loginToggleButton) {
    loginToggleButton.addEventListener('click', function() {
      const type = loginPasswordInput.getAttribute('type') === 'password' ? 'text' : 'password';
      loginPasswordInput.setAttribute('type', type);
      const eyeIcons = this.querySelectorAll('svg');
      eyeIcons.forEach(icon => icon.classList.toggle('hidden'));
    });
  }
  
  const regPasswordInput = document.getElementById('regPassword');
  const regToggleButton = document.getElementById('regPasswordToggle');
  
  if (regPasswordInput && regToggleButton) {
    regToggleButton.addEventListener('click', function() {
      const type = regPasswordInput.getAttribute('type') === 'password' ? 'text' : 'password';
      regPasswordInput.setAttribute('type', type);
      const eyeIcons = this.querySelectorAll('svg');
      eyeIcons.forEach(icon => icon.classList.toggle('hidden'));
    });
  }
}

function waitForResources() {
  const resources = [];
  
  const images = document.querySelectorAll('img');
  images.forEach(img => {
    if (!img.complete) {
      resources.push(new Promise(resolve => {
        img.onload = resolve;
        img.onerror = resolve;
      }));
    }
  });
  
  const bgImage = new Image();
  bgImage.src = 'background.jpg';
  resources.push(new Promise(resolve => {
    bgImage.onload = resolve;
    bgImage.onerror = resolve;
  }));
  
  if (document.fonts && document.fonts.ready) {
    resources.push(document.fonts.ready);
  }
  
  const googleScript = document.querySelector('script[src*="accounts.google.com"]');
  if (googleScript && typeof google === 'undefined') {
    resources.push(new Promise(resolve => {
      let attempts = 0;
      const checkGoogle = setInterval(() => {
        attempts++;
        if (typeof google !== 'undefined' || attempts > 20) {
          clearInterval(checkGoogle);
          resolve();
        }
      }, 100);
    }));
  }
  
  const minLoadTime = new Promise(resolve => setTimeout(resolve, 2000));
  resources.push(minLoadTime);
  
  Promise.race([
    Promise.all(resources),
    new Promise(resolve => setTimeout(resolve, 5000))
  ]).then(() => {
    hideLoadingScreen();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');
  const authCard = document.querySelector('.auth-card');
  const initialHeight = loginForm.scrollHeight + 150;
  authCard.style.minHeight = initialHeight + 'px';
  
  setupPasswordToggle();
  
  const allInputs = document.querySelectorAll('input[type="email"], input[type="password"], input[type="text"]');
  
  allInputs.forEach(input => {
    input.addEventListener('focus', () => {
      document.body.classList.add('input-focused');
    });
    
    input.addEventListener('blur', () => {
      document.body.classList.remove('input-focused');
    });
  });
  
  waitForResources();
  
  
  if (localStorage.getItem('newUser') === 'true') {
    showNotification('Selamat datang! Akun Anda telah berhasil dibuat.', 'success');
    localStorage.removeItem('newUser');
  }
  
  // Handle redirect dari Google (untuk mobile)
  const urlParams = new URLSearchParams(window.location.search);
  const credential = urlParams.get('credential');
  const g_csrf_token = urlParams.get('g_csrf_token');
  
  if (credential && g_csrf_token) {
    // Hapus parameter dari URL
    window.history.replaceState({}, document.title, window.location.pathname);
    // Proses credential
    handleGoogleCredential({ credential });
  } else {
    initGoogleLogin();
  }
});