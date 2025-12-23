
(function () {
  "use strict";

  
  let currentUser = null;
  let currentSection = "dashboard";
  let usersData = { users: [], pagination: {} };
  let groupsData = { groups: [], pagination: {} };

  
  const menuToggle = document.getElementById("menuToggle");
  const sidebar = document.querySelector(".sidebar");
  const navItems = document.querySelectorAll(".nav-item");
  const pageTitle = document.getElementById("pageTitle");
  const logoutBtn = document.getElementById("logoutBtn");
  const toast = document.getElementById("toast");

  
  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    checkAuth();
    setupEventListeners();
    updateTime();
    setInterval(updateTime, 1000);
  }

  
  function checkAuth() {
    const userData = localStorage.getItem("currentUser");
    if (!userData) {
      window.location.href = "/login.html";
      return;
    }

    try {
      currentUser = JSON.parse(userData);
      if (currentUser.role !== "admin") {
        showToast("Akses ditolak. Anda bukan admin.", "error");
        setTimeout(() => {
          window.location.href = "/index.html";
        }, 1500);
        return;
      }

      
      document.getElementById("adminName").textContent = currentUser.nama || currentUser.username;
      const avatarEl = document.getElementById("adminAvatar");
      if (currentUser.avatar && currentUser.avatar.startsWith("data:")) {
        avatarEl.innerHTML = `<img src="${currentUser.avatar}" alt="Avatar" />`;
      } else {
        avatarEl.textContent = (currentUser.nama || currentUser.username).charAt(0).toUpperCase();
      }

      
      loadDashboardStats();
    } catch (e) {
      console.error("Auth error:", e);
      window.location.href = "/login.html";
    }
  }

  
  function setupEventListeners() {
    
    menuToggle?.addEventListener("click", () => {
      sidebar.classList.toggle("active");
    });

    
    navItems.forEach((item) => {
      item.addEventListener("click", (e) => {
        e.preventDefault();
        const section = item.dataset.section;
        showSection(section);
        sidebar.classList.remove("active");
      });
    });

    
    logoutBtn?.addEventListener("click", logout);

    
    document.getElementById("userSearch")?.addEventListener("input", debounce(searchUsers, 300));
    document.getElementById("groupSearch")?.addEventListener("input", debounce(searchGroups, 300));

    
    document.getElementById("editUserForm")?.addEventListener("submit", handleEditUser);

    
    document.querySelectorAll(".modal").forEach((modal) => {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) {
          closeModal(modal.id);
        }
      });
    });

    
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        document.querySelectorAll(".modal.active").forEach((modal) => {
          closeModal(modal.id);
        });
      }
    });
  }

  
  window.showSection = function (section) {
    currentSection = section;

    
    navItems.forEach((item) => {
      item.classList.toggle("active", item.dataset.section === section);
    });

    
    const titles = {
      dashboard: "Dashboard",
      users: "User Management",
      groups: "Group Management",
    };
    pageTitle.textContent = titles[section] || "Dashboard";

    
    document.querySelectorAll(".content-section").forEach((s) => {
      s.classList.remove("active");
    });
    document.getElementById(`${section}Section`)?.classList.add("active");

    
    if (section === "users") {
      loadUsers();
    } else if (section === "groups") {
      loadGroups();
    } else if (section === "dashboard") {
      loadDashboardStats();
    }
  };

  
  async function loadDashboardStats() {
    try {
      const res = await fetch(`/api/admin/stats?adminId=${currentUser.id}`);
      const data = await res.json();

      if (data.success) {
        document.getElementById("totalUsers").textContent = formatNumber(data.stats.totalUsers);
        document.getElementById("totalMessages").textContent = formatNumber(data.stats.totalMessages);
        document.getElementById("totalGroups").textContent = formatNumber(data.stats.totalGroups);
        document.getElementById("newUsersToday").textContent = formatNumber(data.stats.newUsersToday);
      }
    } catch (error) {
      console.error("Failed to load stats:", error);
      showToast("Gagal memuat statistik", "error");
    }
  }

  
  async function loadUsers(page = 1, search = "") {
    const tbody = document.getElementById("usersTableBody");
    tbody.innerHTML = `<tr><td colspan="6" class="loading-cell"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>`;

    try {
      const searchValue = search || document.getElementById("userSearch")?.value || "";
      const res = await fetch(
        `/api/admin/users?adminId=${currentUser.id}&page=${page}&limit=20&search=${encodeURIComponent(searchValue)}`
      );
      const data = await res.json();

      if (data.success) {
        usersData = data;
        renderUsers(data.users);
        renderPagination("users", data.pagination);
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error("Failed to load users:", error);
      tbody.innerHTML = `<tr><td colspan="6" class="loading-cell"><i class="fas fa-exclamation-circle"></i> Gagal memuat data</td></tr>`;
    }
  }

  
  function renderUsers(users) {
    const tbody = document.getElementById("usersTableBody");

    if (!users || users.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="empty-state">
            <i class="fas fa-users"></i>
            <p>Tidak ada user ditemukan</p>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = users
      .map((user) => {
        const avatarContent =
          user.avatar && user.avatar.startsWith("data:")
            ? `<img src="${user.avatar}" alt="Avatar" />`
            : (user.nama || user.username).charAt(0).toUpperCase();

        
        const isAdmin = user.role === "admin";
        const isSelf = user._id === currentUser.id;
        const actionsHtml = (isAdmin || isSelf) ? `<span style="color: var(--text-secondary); font-size: 0.8rem;">-</span>` : `
          <div class="action-buttons">
            <button class="btn-icon edit" onclick="editUser('${user._id}')" title="Edit">
              <i class="fas fa-edit"></i>
            </button>
            <button class="btn-icon delete" onclick="confirmDeleteUser('${user._id}', '${escapeHtml(user.username)}')" title="Delete">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        `;

        return `
        <tr>
          <td>
            <div class="user-cell">
              <div class="user-avatar">${avatarContent}</div>
              <div class="user-details">
                <span class="user-name">${escapeHtml(user.nama || "-")}</span>
                <span class="user-username">@${escapeHtml(user.username)}</span>
              </div>
            </div>
          </td>
          <td>${escapeHtml(user.email)}</td>
          <td><span class="role-badge ${user.role}">${user.role || "user"}</span></td>
          <td>
            <span class="provider-badge ${user.authProvider || "local"}">
              <i class="fab fa-${user.authProvider === "google" ? "google" : "envelope"}"></i>
              ${user.authProvider || "local"}
            </span>
          </td>
          <td>${formatDate(user.lastSeen)}</td>
          <td>${actionsHtml}</td>
        </tr>
      `;
      })
      .join("");
  }

  
  async function loadGroups(page = 1) {
    const tbody = document.getElementById("groupsTableBody");
    tbody.innerHTML = `<tr><td colspan="5" class="loading-cell"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>`;

    try {
      const res = await fetch(`/api/admin/groups?adminId=${currentUser.id}&page=${page}&limit=20`);
      const data = await res.json();

      if (data.success) {
        groupsData = data;
        renderGroups(data.groups);
        renderPagination("groups", data.pagination);
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error("Failed to load groups:", error);
      tbody.innerHTML = `<tr><td colspan="5" class="loading-cell"><i class="fas fa-exclamation-circle"></i> Gagal memuat data</td></tr>`;
    }
  }

  
  function renderGroups(groups) {
    const tbody = document.getElementById("groupsTableBody");

    if (!groups || groups.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="empty-state">
            <i class="fas fa-layer-group"></i>
            <p>Tidak ada grup ditemukan</p>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = groups
      .map((group) => {
        const avatarContent =
          group.avatar && group.avatar.startsWith("data:")
            ? `<img src="${group.avatar}" alt="Avatar" />`
            : (group.nama || "G").charAt(0).toUpperCase();

        return `
        <tr>
          <td>
            <div class="user-cell">
              <div class="user-avatar">${avatarContent}</div>
              <div class="user-details">
                <span class="user-name">${escapeHtml(group.nama)}</span>
              </div>
            </div>
          </td>
          <td>${group.createdBy ? escapeHtml(group.createdBy.nama || group.createdBy.username) : "-"}</td>
          <td>${group.members?.length || 0} members</td>
          <td>${formatDate(group.createdAt)}</td>
          <td>
            <div class="action-buttons">
              <button class="btn-icon delete" onclick="confirmDeleteGroup('${group._id}', '${escapeHtml(group.nama)}')" title="Delete">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
      })
      .join("");
  }

  
  function renderPagination(type, pagination) {
    const container = document.getElementById(`${type}Pagination`);
    if (!container || !pagination) return;

    const { page, totalPages } = pagination;
    if (totalPages <= 1) {
      container.innerHTML = "";
      return;
    }

    let html = `
      <button class="page-btn" onclick="goToPage('${type}', ${page - 1})" ${page <= 1 ? "disabled" : ""}>
        <i class="fas fa-chevron-left"></i>
      </button>
    `;

    
    const startPage = Math.max(1, page - 2);
    const endPage = Math.min(totalPages, page + 2);

    if (startPage > 1) {
      html += `<button class="page-btn" onclick="goToPage('${type}', 1)">1</button>`;
      if (startPage > 2) {
        html += `<span style="color: var(--gray-500)">...</span>`;
      }
    }

    for (let i = startPage; i <= endPage; i++) {
      html += `<button class="page-btn ${i === page ? "active" : ""}" onclick="goToPage('${type}', ${i})">${i}</button>`;
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        html += `<span style="color: var(--gray-500)">...</span>`;
      }
      html += `<button class="page-btn" onclick="goToPage('${type}', ${totalPages})">${totalPages}</button>`;
    }

    html += `
      <button class="page-btn" onclick="goToPage('${type}', ${page + 1})" ${page >= totalPages ? "disabled" : ""}>
        <i class="fas fa-chevron-right"></i>
      </button>
    `;

    container.innerHTML = html;
  }

  
  window.goToPage = function (type, page) {
    if (type === "users") {
      loadUsers(page);
    } else if (type === "groups") {
      loadGroups(page);
    }
  };

  
  function searchUsers() {
    const search = document.getElementById("userSearch")?.value || "";
    loadUsers(1, search);
  }

  
  function searchGroups() {
    
    const search = document.getElementById("groupSearch")?.value?.toLowerCase() || "";
    const filteredGroups = groupsData.groups.filter(
      (g) => g.nama.toLowerCase().includes(search) || g.createdBy?.nama?.toLowerCase().includes(search)
    );
    renderGroups(filteredGroups);
  }

  
  window.editUser = async function (userId) {
    try {
      const res = await fetch(`/api/admin/users/${userId}?adminId=${currentUser.id}`);
      const data = await res.json();

      if (data.success) {
        const user = data.user;
        document.getElementById("editUserId").value = user._id;
        document.getElementById("editUsername").value = user.username || "";
        document.getElementById("editEmail").value = user.email || "";
        document.getElementById("resetPassword").checked = false;

        openModal("editUserModal");
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error("Failed to load user:", error);
      showToast(error.message || "Gagal memuat data user", "error");
    }
  };

  
  async function handleEditUser(e) {
    e.preventDefault();

    const userId = document.getElementById("editUserId").value;
    const email = document.getElementById("editEmail").value;
    const resetPassword = document.getElementById("resetPassword").checked;

    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          adminId: currentUser.id,
          email,
          resetPassword,
        }),
      });

      const data = await res.json();

      if (data.success) {
        showToast(data.message || "User berhasil diperbarui", "success");
        closeModal("editUserModal");
        loadUsers(usersData.pagination?.page || 1);
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error("Failed to update user:", error);
      showToast(error.message || "Gagal memperbarui user", "error");
    }
  }

  
  window.confirmDeleteUser = function (userId, username) {
    document.getElementById("deleteMessage").textContent = `Apakah Anda yakin ingin menghapus user @${username}? Semua data terkait akan dihapus permanen.`;
    document.getElementById("confirmDeleteBtn").onclick = () => deleteUser(userId);
    openModal("deleteModal");
  };

  
  async function deleteUser(userId) {
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ adminId: currentUser.id }),
      });

      const data = await res.json();

      if (data.success) {
        showToast("User berhasil dihapus", "success");
        closeModal("deleteModal");
        loadUsers(1);
        loadDashboardStats();
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error("Failed to delete user:", error);
      showToast(error.message || "Gagal menghapus user", "error");
    }
  }

  
  window.confirmDeleteGroup = function (groupId, groupName) {
    document.getElementById("deleteMessage").textContent = `Apakah Anda yakin ingin menghapus grup "${groupName}"? Semua pesan dalam grup akan dihapus.`;
    document.getElementById("confirmDeleteBtn").onclick = () => deleteGroup(groupId);
    openModal("deleteModal");
  };

  
  async function deleteGroup(groupId) {
    try {
      const res = await fetch(`/api/admin/groups/${groupId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ adminId: currentUser.id }),
      });

      const data = await res.json();

      if (data.success) {
        showToast("Grup berhasil dihapus", "success");
        closeModal("deleteModal");
        loadGroups(1);
        loadDashboardStats();
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error("Failed to delete group:", error);
      showToast(error.message || "Gagal menghapus grup", "error");
    }
  }

  
  function openModal(modalId) {
    document.getElementById(modalId)?.classList.add("active");
  }

  window.closeModal = function (modalId) {
    document.getElementById(modalId)?.classList.remove("active");
  };

  
  function logout() {
    localStorage.removeItem("currentUser");
    window.location.href = "/login.html";
  }

  
  function showToast(message, type = "success") {
    const toastEl = document.getElementById("toast");
    const icon = toastEl.querySelector(".toast-icon");
    const msg = toastEl.querySelector(".toast-message");

    toastEl.className = `toast ${type}`;
    icon.className = `toast-icon fas fa-${type === "success" ? "check-circle" : "exclamation-circle"}`;
    msg.textContent = message;

    toastEl.classList.add("show");
    setTimeout(() => {
      toastEl.classList.remove("show");
    }, 3000);
  }

  
  function updateTime() {
    const now = new Date();
    const options = {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    };
    document.getElementById("currentTime").textContent = now.toLocaleDateString("id-ID", options);
  }

  
  function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
    if (num >= 1000) return (num / 1000).toFixed(1) + "K";
    return num?.toString() || "0";
  }

  function formatDate(dateStr) {
    if (!dateStr) return "-";
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

    return date.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  }

  function escapeHtml(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
})();
