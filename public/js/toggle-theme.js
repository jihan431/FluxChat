feather.replace();

const btn = document.getElementById('themeToggle');

function updateThemeIcon(isLight) {
  btn.innerHTML = `<i data-feather="${isLight ? 'moon' : 'sun'}"></i>`;
  feather.replace();
}

btn.addEventListener('click', async (e) => {
  // 1. Cek dukungan browser untuk View Transition API
  if (!document.startViewTransition) {
    // Fallback: Animasi standar jika browser tidak mendukung
    const isLight = document.body.classList.toggle('light');
    updateThemeIcon(isLight);
    return;
  }

  // 2. Ambil koordinat klik mouse untuk pusat lingkaran
  const x = e.clientX;
  const y = e.clientY;

  // Hitung radius lingkaran sampai ke sudut terjauh layar
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  ) * 1.2; // Kalikan 1.2 agar lingkaran pasti menutupi seluruh layar (termasuk sudut)

  // 3. Set CSS Variables agar CSS bisa menangani animasi secara instan (Anti-Flicker)
  document.documentElement.style.setProperty('--x', x + 'px');
  document.documentElement.style.setProperty('--y', y + 'px');
  document.documentElement.style.setProperty('--r', endRadius + 'px');

  // Tentukan arah animasi: Jika body punya class 'light', berarti mau ke Dark (Masuk/Shrink)
  const isGoingToDark = document.body.classList.contains('light');
  document.documentElement.setAttribute('data-theme-transition', isGoingToDark ? 'in' : 'out');

  // 4. Mulai Transisi
  const transition = document.startViewTransition(() => {
    // Matikan transisi CSS biasa agar snapshot tajam
    document.body.classList.add('disable-transitions');
    const isLight = document.body.classList.toggle('light');
    updateThemeIcon(isLight);
  });

  // 5. Bersihkan setelah selesai
  transition.finished.finally(() => {
    document.documentElement.removeAttribute('data-theme-transition');
    
    // FIX: Beri jeda sedikit sebelum mengaktifkan kembali transisi CSS standar
    // Ini mencegah "flicker" di akhir animasi karena race condition rendering
    setTimeout(() => {
      document.body.classList.remove('disable-transitions');
      document.documentElement.style.removeProperty('--x');
      document.documentElement.style.removeProperty('--y');
      document.documentElement.style.removeProperty('--r');
    }, 50);
  });
});
