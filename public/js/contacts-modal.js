// ==================== CONTACTS MODAL COMPONENT ====================
// Modal untuk menampilkan daftar kontak dengan search functionality
// Integrates dengan existing search dan contact list logic dari app.js

window.ContactsModal = {
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
      <button class="icon-btn close-modal" onclick="window.ContactsModal.close()">
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
        // Render requests + friends
        this.renderFullList(listContainer);
      } else {
        // Fallback: fetch friends list
        const currentUser = JSON.parse(localStorage.getItem('currentUser'));
        const res = await fetch(`${window.location.origin}/api/friends/list/${currentUser.id}`);
        const data = await res.json();

        console.log('Friends list data:', data);

        if (data.success && data.friends) {
          window.allUsers = data.friends;
          window.allRequests = data.requests || [];
          this.renderFullList(listContainer);
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
   * Render Full List (Requests + Contacts)
   */
  renderFullList(container) {
    container.innerHTML = '';

    // 1. Render Friend Requests
    if (window.allRequests && window.allRequests.length > 0) {
      const reqHeader = document.createElement('div');
      reqHeader.innerHTML = 'Friend Requests';
      reqHeader.style.padding = '12px 10px 8px';
      reqHeader.style.color = 'var(--primary-light)';
      reqHeader.style.fontSize = '0.8rem';
      reqHeader.style.fontWeight = '700';
      reqHeader.style.textTransform = 'uppercase';
      reqHeader.style.letterSpacing = '0.5px';
      container.appendChild(reqHeader);

      window.allRequests.forEach(req => {
        const div = document.createElement('div');
        div.className = 'contact-item';
        div.style.background = 'rgba(255, 165, 0, 0.05)';
        div.style.border = '1px solid rgba(255, 165, 0, 0.2)';
        
        div.innerHTML = `
          <div class="contact-avatar">
            ${this.createAvatarHTML(req.from, false)}
          </div>
          <div class="contact-info">
            <h4 class="contact-name">${req.from.nama}</h4>
            <p class="contact-username">@${req.from.username}</p>
          </div>
          <div class="contact-action" style="display:flex; gap:8px; width:auto;">
            <button class="contact-action-btn" style="color:var(--success); background:rgba(16, 185, 129, 0.15);" onclick="respondFriend('${req.from._id}', 'accept')" title="Terima">
              <i data-feather="check"></i>
            </button>
            <button class="contact-action-btn" style="color:var(--danger); background:rgba(239, 68, 68, 0.15);" onclick="respondFriend('${req.from._id}', 'reject')" title="Tolak">
              <i data-feather="x"></i>
            </button>
          </div>
        `;
        container.appendChild(div);
      });

      const divider = document.createElement('div');
      divider.style.borderBottom = '1px solid var(--border)';
      divider.style.margin = '15px 0';
      container.appendChild(divider);
    }

    // 2. Render Contacts
    if (window.allUsers && window.allUsers.length > 0) {
      this.appendContactItems(window.allUsers, container);
    } else if (!window.allRequests || window.allRequests.length === 0) {
      this.showEmptyState();
    }
    
    if (typeof feather !== 'undefined') feather.replace();
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
    this.appendContactItems(contacts, listContainer);
    if (typeof feather !== 'undefined') feather.replace();
  },

  /**
   * Helper to append contact items to a container
   */
  appendContactItems(contacts, container) {
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
          <button class="contact-action-btn add-btn" onclick="window.ContactsModal.sendFriendRequest(event, '${user._id}')" title="Add friend">
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

      container.appendChild(contactItem);
    });
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

      // FIX: Struktur nested div agar badge online tidak terpotong overflow:hidden
      return `<div class="avatar small ${onlineClass} avatar-bg-container" style="overflow: visible !important; background: transparent !important;">
        <div style="width: 100%; height: 100%; border-radius: 50%; overflow: hidden; position: relative;">
          <div class="avatar-bg-overlay" style="background: ${gradient}; width: 100%; height: 100%; position: absolute; top: 0; left: 0; display: flex; align-items: center; justify-content: center; color: white;">${initial}</div>
          <img src="${user.avatar}" class="avatar-bg-img" style="width: 100%; height: 100%; object-fit: cover; position: absolute; top: 0; left: 0;" onerror="this.style.display='none'">
        </div>
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
    window.ContactsModal.init();
  });
} else {
  window.ContactsModal.init();
}
