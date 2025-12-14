/**
 * Shared utility functions for handling user avatars/profile pictures
 */

/**
 * Sets the avatar for an element, handling both image URLs and text avatars
 * @param {HTMLElement} element - The DOM element to set the avatar for
 * @param {Object} user - User object containing avatar, nama, and username properties
 * @param {Object} options - Optional configuration
 */
function setAvatar(element, user, options = {}) {
  // Default options
  const defaults = {
    size: 'medium', // 'small', 'medium', 'large'
    showInitials: true,
    className: ''
  };
  
  const config = { ...defaults, ...options };
  
  if (!element) return;
  
  // Clear any existing content/styles
  element.textContent = '';
  element.className = element.className.replace(/\bavatar-\S*/g, '').trim();
  if (config.className) {
    element.className += ' ' + config.className;
  }
  
  // Check if user has a valid avatar URL
  if (user.avatar && user.avatar !== 'default' && 
      (user.avatar.startsWith('data:') || user.avatar.startsWith('http') || user.avatar.startsWith('//'))) {
    
    // Handle protocol-relative URLs
    let avatarUrl = user.avatar;
    if (avatarUrl.startsWith('//')) {
      avatarUrl = window.location.protocol + avatarUrl;
    }
    
    // Set background image
    element.style.backgroundImage = `url("${avatarUrl}")`;
    element.style.backgroundSize = 'cover';
    element.style.backgroundPosition = 'center';
    element.style.backgroundColor = 'transparent';
    element.textContent = '';
  } else if (config.showInitials) {
    // Show text avatar with initials
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
  // Use single gradient for all avatars
  return 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
}

/**
 * Gets the user's initial for avatar display
 * @param {Object} user - User object
 * @returns {string} The user's initial
 */
function getUserInitial(user) {
  if (!user) return 'U';
  
  const name = user.nama || user.username || 'U';
  return name.charAt(0).toUpperCase();
}

/**
 * Generates a color based on the user's name for text avatars
 * @param {string} name - User's name
 * @returns {string} CSS background color
 */
function getColorFromName(name) {
  if (!name) return '#7a80ff';
  
  // Simple hash function to generate consistent colors
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  // Generate HSL color
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 45%)`;
}

/**
 * Updates all avatar elements for a user
 * @param {Object} user - User object
 */
function updateAllUserAvatars(user) {
  if (!user) return;
  
  // Update profile page avatar
  const profileAvatar = document.getElementById('userProfileAvatar');
  if (profileAvatar) {
    setAvatar(profileAvatar, user, { size: 'large' });
  }
  
  // Update profile modal avatar
  const profileModalAvatar = document.getElementById('profileAvatarDisplay');
  if (profileModalAvatar) {
    setAvatar(profileModalAvatar, user, { size: 'large' });
  }
  
  // Update chat header avatar
  const chatAvatar = document.getElementById('chatAvatar');
  if (chatAvatar) {
    setAvatar(chatAvatar, user, { size: 'small' });
  }
  
  // Update call modal avatar
  const callAvatar = document.getElementById('callAvatar');
  if (callAvatar) {
    setAvatar(callAvatar, user, { size: 'large' });
  }
  
  // Update user profile modal avatar
  const userProfileAvatar = document.getElementById('userProfileAvatar');
  if (userProfileAvatar) {
    setAvatar(userProfileAvatar, user, { size: 'large' });
  }
}

// Make functions available globally
window.setAvatar = setAvatar;
window.getUserInitial = getUserInitial;
window.getColorFromName = getColorFromName;
window.updateAllUserAvatars = updateAllUserAvatars;
window.getAvatarGradient = getAvatarGradient;