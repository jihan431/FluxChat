const API_URL = window.location.origin;
let googleInitTried = false;


function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

async function initGoogleLogin() {
  const btn = document.getElementById('googleLoginBtn');
  const container = document.getElementById('googleLoginBtnContainer');
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
      
      
      
      const initConfig = {
        client_id: clientId,
        callback: handleGoogleCredential,
        ux_mode: isMobile ? 'redirect' : 'popup'
      };
      
      
      if (isMobile) {
        initConfig.login_uri = `${window.location.origin}/login.html`;
      }
      
      google.accounts.id.initialize(initConfig);

      
      if (container) {
        google.accounts.id.renderButton(
          container,
          { 
            theme: 'outline', 
            size: 'large', 
            type: 'standard',
            width: container.offsetWidth || 200
          }
        );
        
        
        setTimeout(() => {
          const iframe = container.querySelector('iframe');
          if (iframe) {
            iframe.style.width = '100%';
            iframe.style.height = '100%';
          }
        }, 100);
      }

      
      btn.addEventListener('click', (e) => {
        
        if (!container || !container.querySelector('iframe')) {
          e.preventDefault();
          google.accounts.id.prompt((notification) => {
            if (notification && notification.isNotDisplayed && notification.isNotDisplayed()) {
              showNotification('Popup diblokir. Izinkan popup untuk login dengan Google.', 'info');
            }
          });
        }
      });

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
      const redirectUrl = data.user.role === 'admin' ? 'admin.html' : 'index.html';
      setTimeout(() => window.location.href = redirectUrl, 700);
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
  const recoveryForm = document.getElementById('recoveryForm');
  const resetPasswordForm = document.getElementById('resetPasswordForm');
  const authCard = document.querySelector('.auth-card');
  const authTabs = document.querySelector('.auth-tabs');
  const tabButtons = document.querySelectorAll('.tab-btn');

  const updateCardHeight = (form) => {
    
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        let totalHeight = 0;
        
        
        Array.from(authCard.children).forEach(child => {
          if (!child.classList.contains('hidden') && getComputedStyle(child).display !== 'none') {
            const style = getComputedStyle(child);
            totalHeight += child.offsetHeight + parseInt(style.marginTop) + parseInt(style.marginBottom);
          }
        });

        
        const cardStyle = getComputedStyle(authCard);
        totalHeight += parseInt(cardStyle.paddingTop) + parseInt(cardStyle.paddingBottom);

        
        authCard.style.height = totalHeight + 'px';
        authCard.style.minHeight = ''; 
      });
    });
  };

  
  const toggleTabs = (show) => {
    if (authTabs) {
      if (show) authTabs.classList.remove('hidden');
      else authTabs.classList.add('hidden');
    }
  };

  
  const toggleGlobalFooter = (show) => {
    
    const globalFooter = Array.from(authCard.children).find(el => el.classList.contains('auth-footer'));
    if (globalFooter) {
      if (show) globalFooter.classList.remove('hidden');
      else globalFooter.classList.add('hidden');
    }
  };

  
  const toggleMainHeader = (show) => {
    const mainHeader = Array.from(authCard.children).find(el => el.classList.contains('auth-header'));
    if (mainHeader) {
      if (show) mainHeader.classList.remove('hidden');
      else mainHeader.classList.add('hidden');
    }
  };

  
  const forms = [loginForm, registerForm, otpForm, recoveryForm, resetPasswordForm].filter(f => f);
  const activeForm = forms.find(f => !f.classList.contains('hidden'));

  
  if (authCard) {
    authCard.style.height = authCard.offsetHeight + 'px';
    authCard.style.minHeight = '';
  }

  
  const executeSwitch = () => {
    tabButtons.forEach(btn => btn.classList.remove('active'));

    if (mode === 'login') {
      toggleTabs(true);
      toggleGlobalFooter(true);
      toggleMainHeader(true);
      tabButtons[0].classList.add('active');
      authTabs.classList.remove('tab-daftar');
      registerForm.classList.add('hidden');
      otpForm.classList.add('hidden');
      if(recoveryForm) recoveryForm.classList.add('hidden');
      if(resetPasswordForm) resetPasswordForm.classList.add('hidden');
      loginForm.classList.remove('hidden');
      updateCardHeight(loginForm);
    } else if (mode === 'register') {
      toggleTabs(true);
      toggleGlobalFooter(true);
      toggleMainHeader(true);
      tabButtons[1].classList.add('active');
      authTabs.classList.add('tab-daftar');
      loginForm.classList.add('hidden');
      otpForm.classList.add('hidden');
      if(recoveryForm) recoveryForm.classList.add('hidden');
      if(resetPasswordForm) resetPasswordForm.classList.add('hidden');
      registerForm.classList.remove('hidden');
      updateCardHeight(registerForm);
    } else if (mode === 'otp') {
      toggleTabs(false); 
      toggleGlobalFooter(false); 
      toggleMainHeader(false); 
      tabButtons.forEach(btn => btn.classList.remove('active'));
      authTabs.classList.remove('tab-daftar');
      loginForm.classList.add('hidden');
      registerForm.classList.add('hidden');
      if(recoveryForm) recoveryForm.classList.add('hidden');
      if(resetPasswordForm) resetPasswordForm.classList.add('hidden');
      otpForm.classList.remove('hidden');
      updateCardHeight(otpForm);
    } else if (mode === 'recovery') {
      toggleTabs(false); 
      toggleGlobalFooter(false); 
      toggleMainHeader(false); 
      tabButtons.forEach(btn => btn.classList.remove('active'));
      loginForm.classList.add('hidden');
      registerForm.classList.add('hidden');
      otpForm.classList.add('hidden');
      if(resetPasswordForm) resetPasswordForm.classList.add('hidden');
      if(recoveryForm) recoveryForm.classList.remove('hidden');
      if(recoveryForm) updateCardHeight(recoveryForm);
    } else if (mode === 'reset-password') {
      toggleTabs(false); 
      toggleGlobalFooter(false); 
      toggleMainHeader(false); 
      tabButtons.forEach(btn => btn.classList.remove('active'));
      loginForm.classList.add('hidden');
      registerForm.classList.add('hidden');
      otpForm.classList.add('hidden');
      if(recoveryForm) recoveryForm.classList.add('hidden');
      if(resetPasswordForm) {
        resetPasswordForm.classList.remove('hidden');
        updateCardHeight(resetPasswordForm);
      }
    }
  };

  
  if (activeForm) {
    activeForm.classList.add('form-exit');
    
    setTimeout(() => {
      activeForm.classList.remove('form-exit');
      activeForm.classList.add('hidden'); 
      executeSwitch();
    }, 150); 
  } else {
    executeSwitch();
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
      const redirectUrl = data.user.role === 'admin' ? 'admin.html' : 'index.html';
      setTimeout(() => window.location.href = redirectUrl, 800);
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

  
  if (otpType === 'recovery') {
    
    document.getElementById('resetOtpHidden').value = otp;
    setMode('reset-password');
    return;
  }

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
        const redirectUrl = data.user.role === 'admin' ? 'admin.html' : 'index.html';
        setTimeout(() => window.location.href = redirectUrl, 1000);
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
  try {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    window.location.href = user.role === 'admin' ? 'admin.html' : 'index.html';
  } catch (e) {
    window.location.href = 'index.html';
  }
}

function hideLoadingScreen() {
  const loadingScreen = document.getElementById('loadingScreen');
  const authCard = document.querySelector('.auth-card');
  
  if (loadingScreen) {
    loadingScreen.classList.add('hidden');
    setTimeout(() => {
      loadingScreen.remove();
    }, 1600); 
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


function initRecoverySystem() {
  const authCard = document.querySelector('.auth-card');
  const loginForm = document.getElementById('loginForm');
  
  if (!authCard || !loginForm) return;

  
  const oldLinks = document.querySelectorAll('a[href*="password.html"]');
  oldLinks.forEach(link => {
    
    if (link.parentElement && link.parentElement.tagName === 'P') {
      link.parentElement.remove();
    } else {
      link.remove();
    }
  });

  
  const loginFooter = loginForm.querySelector('.auth-footer');
  
  if (loginFooter) {
    const forgotLink = document.createElement('div');
    forgotLink.style.marginBottom = '15px';
    forgotLink.innerHTML = `<a href="#" onclick="setMode('recovery'); return false;" style="font-size: 0.9rem;">Lupa Password?</a>`;
    loginFooter.insertBefore(forgotLink, loginFooter.firstChild);
  } else {
    
    const submitBtn = loginForm.querySelector('button[type="submit"]');
    if (submitBtn) {
      const forgotLink = document.createElement('div');
      forgotLink.className = 'recovery-link';
      forgotLink.style.marginBottom = '12px';
      forgotLink.style.textAlign = 'right'; 
      forgotLink.innerHTML = `<a href="#" onclick="setMode('recovery'); return false;" style="font-size: 0.9rem; color: var(--text-dim); text-decoration: none; transition: color 0.2s;" onmouseover="this.style.color='var(--primary)'" onmouseout="this.style.color='var(--text-dim)'">Lupa Password?</a>`;
      
      loginForm.insertBefore(forgotLink, submitBtn);
    }
  }

  
  const recoveryFormHTML = `
    <form id="recoveryForm" class="auth-form hidden">
      <div class="auth-header">
        <h1>Pemulihan Akun</h1>
        <p class="subtitle">Masukkan email Anda untuk menerima kode</p>
      </div>
      <div class="input-group">
        <input type="email" id="recEmail" placeholder=" " required>
        <label>Email Terdaftar</label>
      </div>
      <button type="submit" class="btn-submit">Kirim Kode</button>
      <div class="auth-footer">
        <a href="#" onclick="setMode('login'); return false;">Kembali ke Login</a>
      </div>
    </form>
  `;
  authCard.insertAdjacentHTML('beforeend', recoveryFormHTML);

  
  const resetFormHTML = `
    <form id="resetPasswordForm" class="auth-form hidden">
      <div class="auth-header">
        <h1>Password Baru</h1>
        <p class="subtitle">Buat password baru untuk akun Anda</p>
      </div>
      <input type="hidden" id="resetOtpHidden">
      <div class="input-group">
        <input type="password" id="newPassword" placeholder=" " required>
        <label>Password Baru</label>
      </div>
      <button type="submit" class="btn-submit">Simpan Password</button>
    </form>
  `;
  authCard.insertAdjacentHTML('beforeend', resetFormHTML);

  
  const newInputs = authCard.querySelectorAll('#recoveryForm input, #resetPasswordForm input');
  newInputs.forEach(input => {
    input.addEventListener('focus', () => document.body.classList.add('input-focused'));
    input.addEventListener('blur', () => document.body.classList.remove('input-focused'));
  });

  
  document.getElementById('recoveryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('recEmail').value.trim();
    if (!email) return showNotification('Masukkan email!', 'error');

    const btn = e.target.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Mengirim...';

    try {
      const res = await fetch(`${API_URL}/api/recovery/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      
      if (data.success) {
        showNotification('Kode terkirim! Cek email Anda.', 'success');
        document.getElementById('otpEmailHidden').value = email;
        document.getElementById('otpType').value = 'recovery';
        setMode('otp');
      } else {
        showNotification(data.error || 'Gagal mengirim kode', 'error');
      }
    } catch (err) {
      showNotification('Error koneksi', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Kirim Kode';
    }
  });

  document.getElementById('resetPasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('otpEmailHidden').value;
    const otp = document.getElementById('resetOtpHidden').value;
    const newPassword = document.getElementById('newPassword').value.trim();

    if (!newPassword || newPassword.length < 6) return showNotification('Password minimal 6 karakter', 'error');

    const btn = e.target.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Menyimpan...';

    try {
      const res = await fetch(`${API_URL}/api/recovery/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp, newPassword })
      });
      const data = await res.json();

      if (data.success) {
        showNotification('Password berhasil diubah! Silakan login.', 'success');
        setTimeout(() => setMode('login'), 1500);
      } else {
        showNotification(data.error || 'Gagal mereset password', 'error');
        
        if (data.error.includes('OTP') || data.error.includes('Kode')) {
             setTimeout(() => setMode('otp'), 1500);
        }
      }
    } catch (err) {
      showNotification('Error koneksi', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Simpan Password';
    }
  });
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
  
  const minLoadTime = new Promise(resolve => setTimeout(resolve, 5000));
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
  
  
  authCard.style.height = 'auto';
  authCard.style.minHeight = '';
  
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
  
  
  initRecoverySystem();
  
  
  if (localStorage.getItem('newUser') === 'true') {
    showNotification('Selamat datang! Akun Anda telah berhasil dibuat.', 'success');
    localStorage.removeItem('newUser');
  }
  
  
  const urlParams = new URLSearchParams(window.location.search);
  
  
  const googleUserData = urlParams.get('google_user');
  if (googleUserData) {
    try {
      const userData = JSON.parse(decodeURIComponent(googleUserData));
      window.history.replaceState({}, document.title, window.location.pathname);
      
      localStorage.setItem('currentUser', JSON.stringify(userData));
      showNotification('Login Google sukses! Mengalihkan...', 'success');
      const redirectUrl = userData.role === 'admin' ? 'admin.html' : 'index.html';
      setTimeout(() => window.location.href = redirectUrl, 700);
      return;
    } catch (e) {
      console.error('Failed to parse google_user data:', e);
    }
  }
  
  
  const error = urlParams.get('error');
  if (error) {
    window.history.replaceState({}, document.title, window.location.pathname);
    showNotification('Login Google gagal: ' + decodeURIComponent(error), 'error');
  }
  
  
  const credential = urlParams.get('credential');
  const g_csrf_token = urlParams.get('g_csrf_token');
  
  if (credential && g_csrf_token) {
    
    window.history.replaceState({}, document.title, window.location.pathname);
    
    handleGoogleCredential({ credential });
  } else {
    initGoogleLogin();
  }
});