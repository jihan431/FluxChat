feather.replace();

const btn = document.getElementById('themeToggle');

btn.addEventListener('click', () => {
  const isLight = document.body.classList.toggle('light');
  btn.innerHTML = `<i data-feather="${isLight ? 'moon' : 'sun'}"></i>`;
  feather.replace();
});
