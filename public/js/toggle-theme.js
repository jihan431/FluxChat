feather.replace();

const btn = document.getElementById('themeToggle');
const savedTheme = localStorage.getItem('fluxchat-theme');
if (savedTheme === 'light') {
  document.body.classList.add('light');
}

function updateThemeIcon(isLight) {
  btn.innerHTML = `<i data-feather="${isLight ? 'moon' : 'sun'}"></i>`;
  feather.replace();
}
updateThemeIcon(document.body.classList.contains('light'));

btn.addEventListener('click', async (e) => {
  
  if (!document.startViewTransition) {
    
    const isLight = document.body.classList.toggle('light');
    localStorage.setItem('fluxchat-theme', isLight ? 'light' : 'dark');
    updateThemeIcon(isLight);
    return;
  }

  
  const x = e.clientX;
  const y = e.clientY;

  
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  ) * 1.2; 

  
  document.documentElement.style.setProperty('--x', x + 'px');
  document.documentElement.style.setProperty('--y', y + 'px');
  document.documentElement.style.setProperty('--r', endRadius + 'px');

  
  const isGoingToDark = document.body.classList.contains('light');
  document.documentElement.setAttribute('data-theme-transition', isGoingToDark ? 'in' : 'out');

  
  const transition = document.startViewTransition(() => {
    
    document.body.classList.add('disable-transitions');
    const isLight = document.body.classList.toggle('light');
    localStorage.setItem('fluxchat-theme', isLight ? 'light' : 'dark');
    updateThemeIcon(isLight);
  });

  
  transition.finished.finally(() => {
    document.documentElement.removeAttribute('data-theme-transition');
    
    
    
    setTimeout(() => {
      document.body.classList.remove('disable-transitions');
      document.documentElement.style.removeProperty('--x');
      document.documentElement.style.removeProperty('--y');
      document.documentElement.style.removeProperty('--r');
    }, 50);
  });
});
