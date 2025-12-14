// recovery.js
const API_URL = window.location.origin;

function showToast(message, type = 'info') {
  const toastBox = document.getElementById('toastBox');
  if (!toastBox) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

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

// Fungsi untuk kirim kode pemulihan
async function sendRecoveryCode() {
  const email = document.getElementById('regEmail').value.trim();
  const username = document.getElementById('regUsername').value.trim();

  if (!email && !username) {
    showToast('Masukkan email atau username!', 'error');
    return;
  }

  const submitBtn = document.querySelector('#registerForm button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Mengirim...';

  try {
    const res = await fetch(`${API_URL}/api/recovery/send-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, username })
    });
    
    const data = await res.json();
    
    if (data.success) {
      showToast('Kode pemulihan telah dikirim ke email Anda', 'success');
      // Switch ke form OTP
      document.getElementById('registerForm').classList.add('hidden');
      document.getElementById('otpForm').classList.remove('hidden');
      document.getElementById('otpEmailHidden').value = email || data.email;
      document.getElementById('otpType').value = 'recovery';
    } else {
      showToast(data.error || 'Gagal mengirim kode', 'error');
    }
  } catch (error) {
    showToast('Error jaringan: ' + error.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Kirim Kode';
  }
}

// Fungsi untuk verifikasi OTP dan reset password
async function verifyRecoveryOTP() {
  const email = document.getElementById('otpEmailHidden').value.trim();
  const otp = document.getElementById('otpCode').value.trim();

  if (!/^\d{6}$/.test(otp)) {
    showToast('Kode OTP harus 6 digit angka.', 'error');
    return;
  }

  const submitBtn = document.querySelector('#otpForm button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Memverifikasi...';

  try {
    const res = await fetch(`${API_URL}/api/recovery/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp })
    });
    
    const data = await res.json();
    
    if (data.success) {
      showToast('Verifikasi berhasil! Arahkan ke reset password...', 'success');
      // Simpan token dan redirect ke reset password page
      localStorage.setItem('recoveryToken', data.token);
      setTimeout(() => {
        window.location.href = 'reset-password.html';
      }, 1000);
    } else {
      showToast(data.error || 'OTP Salah', 'error');
    }
  } catch (error) {
    showToast('Error jaringan: ' + error.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Verifikasi';
  }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', function() {
  // Inisialisasi feather icons
  if(typeof feather !== 'undefined') feather.replace();

  const registerForm = document.getElementById('registerForm');
  const otpForm = document.getElementById('otpForm');

  if (registerForm) {
    registerForm.addEventListener('submit', function(e) {
      e.preventDefault();
      sendRecoveryCode();
    });
  }

  if (otpForm) {
    otpForm.addEventListener('submit', function(e) {
      e.preventDefault();
      verifyRecoveryOTP();
    });

    // Auto-focus OTP input
    const otpInput = document.getElementById('otpCode');
    if (otpInput) {
      otpInput.focus();
    }
  }

  // Auto move to next input in OTP (jika ingin 6 input terpisah)
  const otpCodeInput = document.getElementById('otpCode');
  if (otpCodeInput) {
    otpCodeInput.addEventListener('input', function(e) {
      if (this.value.length === 6) {
        document.querySelector('#otpForm button[type="submit"]').focus();
      }
    });
  }
});