// ==================== CONTACTS MODAL COMPONENT ====================
// Modal untuk menampilkan daftar kontak dengan search functionality
// Integrates dengan existing search dan contact list logic dari app.js

const ContactsModal = {
  isOpen: false,
  searchTimeout: null,

  /**
   * Initialize modal and attach event listeners
   */
  init() {
    const modal = document.getElementById('contactsModal');
    if (!modal) return;

    // Render initial HTML structure
    this.renderStructure();

    // Attach event listeners
    this.attachEventListeners();

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        this.close();
      }
    });

    // Close on ESC key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });
  },

  /**
   * Render modal structure with search bar and contact list
   */
  renderStructure() {
    const content = document.querySelector('.contacts-modal-content');
    if (!content) return;

    content.innerHTML = `
      <button class="icon-btn close-modal" onclick="ContactsModal.close()">
        <i data-feather="x"></i>
      </button>

      <div class="contacts-modal-header">
        <h2>Contacts</h2>
        <p class="contacts-modal-subtitle">Find and add new friends</p>
      </div>

      <div class="contacts-search-bar">
        <input 
          type="text" 
          id="contactsSearchInput" 
          class="contacts-search-input"
          placeholder="Search contacts or add friends..." 
          autocomplete="off"
        >
        <span class="search-icon">
          <i data-feather="search"></i>
        </span>
      </div>

      <div class="contacts-list-container">
        <div id="contactsList" class="contacts-list">
          <div class="empty-state">
            <i data-feather="users"></i>
            <p>Start typing to search contacts</p>
          </div>
        </div>
      </div>
    `;

    // Initialize feather icons
    if (typeof feather !== 'undefined') {
      feather.replace();
    }
  },

  /**
   * Attach event listeners for search and interactions
   */
  attachEventListeners() {
    const searchInput = document.getElementById('contactsSearchInput');
    if (!searchInput) return;

    // Focus input on modal open
    searchInput.addEventListener('focus', () => {
      searchInput.parentElement.classList.add('focused');
    });

    searchInput.addEventListener('blur', () => {
      searchInput.parentElement.classList.remove('focused');
    });

    // Search with debounce
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      
      if (this.searchTimeout) {
        clearTimeout(this.searchTimeout);
      }

      if (!query) {
        this.loadAllContacts();
        return;
      }

      this.searchTimeout = setTimeout(() => {
        this.performSearch(query);
      }, 300);
    });
  },

  /**
   * Open modal with fade + scale animation
   */
  open() {
    const modal = document.getElementById('contactsModal');
    if (!modal) return;

    modal.classList.remove('hidden');
    modal.classList.add('active');
    this.isOpen = true;

    // Trigger animation
    setTimeout(() => {
      const content = modal.querySelector('.contacts-modal-content');
      if (content) {
        content.classList.add('fade-scale-in');
      }
    }, 10);

    // Focus search input
    setTimeout(() => {
      const input = document.getElementById('contactsSearchInput');
      if (input) input.focus();
    }, 100);

    // Load initial contacts
    this.loadAllContacts();

    // Prevent body scroll
    document.body.style.overflow = 'hidden';
  },

  /**
   * Close modal with fade out animation
   */
  close() {
    const modal = document.getElementById('contactsModal');
    if (!modal) return;

    const content = modal.querySelector('.contacts-modal-content');
    if (content) {
      content.classList.remove('fade-scale-in');
      content.classList.add('fade-scale-out');
    }

    setTimeout(() => {
      modal.classList.add('hidden');
      modal.classList.remove('active');
      this.isOpen = false;

      // Clear search
      const searchInput = document.getElementById('contactsSearchInput');
      if (searchInput) {
        searchInput.value = '';
      }

      // Restore body scroll
      document.body.style.overflow = '';
    }, 300);
  },

  /**
   * Load and display all available contacts
   */
  async loadAllContacts() {
    const listContainer = document.getElementById('contactsList');
    if (!listContainer) return;

    // Show loading state
    listContainer.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Loading contacts...</p>
      </div>
    `;

    try {
      // Use existing data from app.js if available
      if (window.allUsers && window.allUsers.length > 0) {
        this.displayContacts(window.allUsers);
      } else {
        // Fallback: fetch friends list
        const currentUser = JSON.parse(localStorage.getItem('currentUser'));
        const res = await fetch(`${window.location.origin}/api/friends/list/${currentUser.id}`);
        const data = await res.json();

        console.log('Friends list data:', data);

        if (data.success && data.friends) {
          this.displayContacts(data.friends);
        } else {
          this.showEmptyState();
        }
      }
    } catch (err) {
      listContainer.innerHTML = `
        <div class="error-state">
          <i data-feather="alert-circle"></i>
          <p>Failed to load contacts</p>
        </div>
      `;
      if (typeof feather !== 'undefined') feather.replace();
    }
  },

  /**
   * Perform search for contacts
   */
  async performSearch(query) {
    const listContainer = document.getElementById('contactsList');
    if (!listContainer) return;

    // Show loading state
    listContainer.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Searching...</p>
      </div>
    `;

    try {
      const currentUser = JSON.parse(localStorage.getItem('currentUser'));
      const res = await fetch(
        `${window.location.origin}/api/users/search?query=${encodeURIComponent(query)}&currentUserId=${currentUser.id}`
      );
      const data = await res.json();

      if (data.success) {
        if (data.users && data.users.length > 0) {
          this.displayContacts(data.users);
        } else {
          this.showEmptyState('No contacts found');
        }
      }
    } catch (err) {
      listContainer.innerHTML = `
        <div class="error-state">
          <i data-feather="alert-circle"></i>
          <p>Search failed</p>
        </div>
      `;
      if (typeof feather !== 'undefined') feather.replace();
    }
  },

  /**
   * Display contacts in the modal
   */
  displayContacts(contacts) {
    const listContainer = document.getElementById('contactsList');
    if (!listContainer || !contacts || contacts.length === 0) {
      this.showEmptyState();
      return;
    }

    listContainer.innerHTML = '';

    contacts.forEach(user => {
      const isOnline = window.userStatusMap && window.userStatusMap[user.username] === 'online';
      const contactItem = document.createElement('div');
      contactItem.className = 'contact-item';
      if (isOnline) contactItem.classList.add('online');

      // Determine action button based on friendship status
      let actionButton = '';
      if (user.isFriend) {
        // Friend: don't show action button, just make clickable
        actionButton = '';
      } else if (user.isPending) {
        // Request pending
        actionButton = `
          <button class="contact-action-btn pending-btn" disabled title="Request pending">
            <i data-feather="clock"></i>
          </button>
        `;
      } else {
        // Not a friend: show add button
        actionButton = `
          <button class="contact-action-btn add-btn" onclick="ContactsModal.sendFriendRequest(event, '${user._id}')" title="Add friend">
            <i data-feather="user-plus"></i>
          </button>
        `;
      }

      // Get last message if exists (only for non-friends)
      let lastMessageHTML = '';
      if (!user.isFriend) {
        const lastMsg = window.getLastMessageForUser && window.getLastMessageForUser(user.username);
        if (lastMsg) {
          const lastMessageText = lastMsg.message.length > 30 ? lastMsg.message.substring(0, 27) + '...' : lastMsg.message;
          lastMessageHTML = `<p class="contact-last-message">${lastMessageText}</p>`;
        }
      }

      // Conditional rendering based on isFriend
      let usernameHTML = '';
      if (!user.isFriend) {
        usernameHTML = `<p class="contact-username">@${user.username}</p>`;
      }

      contactItem.innerHTML = `
        <div class="contact-avatar">
          ${this.createAvatarHTML(user, isOnline)}
        </div>
        <div class="contact-info">
          <h4 class="contact-name">${user.nama || user.name}</h4>
          ${usernameHTML}
          ${lastMessageHTML}
        </div>
        <div class="contact-action">
          ${actionButton}
        </div>
      `;

      // Add click handler to start chat (if friend)
      if (user.isFriend) {
        contactItem.style.cursor = 'pointer';
        contactItem.addEventListener('click', (e) => {
          if (e.target.closest('.contact-action-btn')) return;
          this.startChat(e, user._id);
        });
      }

      listContainer.appendChild(contactItem);
    });

    // Replace feather icons
    if (typeof feather !== 'undefined') {
      feather.replace();
    }
  },

  /**
   * Show empty state
   */
  showEmptyState(message = 'No contacts available') {
    const listContainer = document.getElementById('contactsList');
    if (!listContainer) return;

    listContainer.innerHTML = `
      <div class="empty-state">
        <i data-feather="users"></i>
        <p>${message}</p>
      </div>
    `;

    if (typeof feather !== 'undefined') {
      feather.replace();
    }
  },

  /**
   * Create avatar HTML for contact
   */
  createAvatarHTML(user, isOnline = false) {
    const onlineClass = isOnline ? 'online' : '';

    if (user.avatar && user.avatar !== 'default' && 
        (user.avatar.startsWith('data:') || user.avatar.startsWith('http'))) {
      
      // Fallback logic jika gambar rusak (ORB Error)
      const initial = (user.nama || user.name || 'U').charAt(0).toUpperCase();
      const gradient = window.getAvatarGradient 
        ? window.getAvatarGradient(user.nama || user.name || 'User')
        : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';

      return `<div class="avatar small ${onlineClass} avatar-bg-container">
        <div class="avatar-bg-overlay" style="background: ${gradient};">${initial}</div>
        <img src="${user.avatar}" class="avatar-bg-img" onerror="this.style.display='none'">
      </div>`;
    } else {
      const initial = (user.nama || user.name || 'U').charAt(0).toUpperCase();
      const gradient = window.getAvatarGradient 
        ? window.getAvatarGradient(user.nama || user.name || 'User')
        : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
      
      return `<div class="avatar small ${onlineClass} avatar-gradient" style="background: ${gradient} !important;">${initial}</div>`;
    }
  },

  /**
   * Start chat with a contact
   */
  startChat(e, userId) {
    e.preventDefault();
    e.stopPropagation();

    const friend = window.allUsers && window.allUsers.find(u => u._id === userId);
    if (friend && window.selectUser) {
      window.selectUser(friend);
      this.close();
    }
  },

  /**
   * Send friend request
   */
  async sendFriendRequest(e, targetId) {
    e.preventDefault();
    e.stopPropagation();

    const btn = e.currentTarget;
    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i data-feather="clock"></i>';

    try {
      const currentUser = JSON.parse(localStorage.getItem('currentUser'));
      const res = await fetch(`${window.location.origin}/api/friends/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromId: currentUser._id || currentUser.id,
          toId: targetId
        })
      });

      const data = await res.json();

      if (data.success) {
        btn.classList.remove('add-btn');
        btn.classList.add('pending-btn');
        btn.innerHTML = '<i data-feather="clock"></i>';
        btn.disabled = true;
        btn.title = 'Request pending';
        
        if (window.Toast) {
          window.Toast.show('Friend request sent!', 'success');
        }

        // Reload contacts after short delay
        setTimeout(() => {
          const searchInput = document.getElementById('contactsSearchInput');
          if (searchInput && searchInput.value.trim()) {
            this.performSearch(searchInput.value.trim());
          } else {
            this.loadAllContacts();
          }
        }, 500);
      } else {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
        if (window.Toast) {
          window.Toast.show(data.error || 'Failed to send request', 'error');
        }
      }
    } catch (err) {
      btn.innerHTML = originalHTML;
      btn.disabled = false;
      if (window.Toast) {
        window.Toast.show('Connection error', 'error');
      }
    }

    if (typeof feather !== 'undefined') {
      feather.replace();
    }
  }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    ContactsModal.init();
  });
} else {
  ContactsModal.init();
}
