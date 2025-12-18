
function setAvatar(element, user, options = {}) {
  
  const defaults = {
    size: 'medium', 
    showInitials: true,
    className: ''
  };
  
  const config = { ...defaults, ...options };
  
  if (!element) return;
  
  
  element.textContent = '';
  element.className = element.className.replace(/\bavatar-\S*/g, '').trim();
  if (config.className) {
    element.className += ' ' + config.className;
  }
  
  
  if (user.avatar && user.avatar !== 'default' && 
      (user.avatar.startsWith('data:') || user.avatar.startsWith('http') || user.avatar.startsWith('//'))) {
    
    
    let avatarUrl = user.avatar;
    if (avatarUrl.startsWith('//')) {
      avatarUrl = window.location.protocol + avatarUrl;
    }
    
    
    element.style.backgroundImage = `url("${avatarUrl}")`;
    element.style.backgroundSize = 'cover';
    element.style.backgroundPosition = 'center';
    element.style.backgroundColor = 'transparent';
    element.textContent = '';
  } else if (config.showInitials) {
    
    const initial = getUserInitial(user);
    element.style.backgroundImage = 'none';
    element.style.backgroundColor = getColorFromName(user.nama || user.username);
    element.style.display = 'flex';
    element.style.alignItems = 'center';
    element.style.justifyContent = 'center';
    element.style.color = 'white';
    element.style.fontWeight = '600';
    element.textContent = initial;
  }
}

function getAvatarGradient(name) {
  
  return 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
}

function getUserInitial(user) {
  if (!user) return 'U';
  
  const name = user.nama || user.username || 'U';
  return name.charAt(0).toUpperCase();
}

function getColorFromName(name) {
  if (!name) return '#7a80ff';
  
  
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 45%)`;
}

function updateAllUserAvatars(user) {
  if (!user) return;
  
  
  const profileAvatar = document.getElementById('userProfileAvatar');
  if (profileAvatar) {
    setAvatar(profileAvatar, user, { size: 'large' });
  }
  
  
  const profileModalAvatar = document.getElementById('profileAvatarDisplay');
  if (profileModalAvatar) {
    setAvatar(profileModalAvatar, user, { size: 'large' });
  }
  
  
  const chatAvatar = document.getElementById('chatAvatar');
  if (chatAvatar) {
    setAvatar(chatAvatar, user, { size: 'small' });
  }
  
  
  const callAvatar = document.getElementById('callAvatar');
  if (callAvatar) {
    setAvatar(callAvatar, user, { size: 'large' });
  }
  
  
  const userProfileAvatar = document.getElementById('userProfileAvatar');
  if (userProfileAvatar) {
    setAvatar(userProfileAvatar, user, { size: 'large' });
  }
}


window.setAvatar = setAvatar;
window.getUserInitial = getUserInitial;
window.getColorFromName = getColorFromName;
window.updateAllUserAvatars = updateAllUserAvatars;
window.getAvatarGradient = getAvatarGradient;