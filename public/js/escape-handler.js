document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        // --- 1. PRIORITAS TERTINGGI: MODALS & OVERLAYS ---

        // A. Context Menu (Klik Kanan Pesan)
        const contextMenu = document.getElementById('messageContextMenu');
        if (contextMenu && !contextMenu.classList.contains('hidden')) {
            contextMenu.classList.add('hidden');
            return;
        }

        // B. Image Preview
        const imagePreview = document.getElementById('imagePreviewModal');
        if (imagePreview && !imagePreview.classList.contains('hidden')) {
            if (typeof closeImagePreview === 'function') closeImagePreview();
            return;
        }

        // C. Status (Viewer & Create)
        const statusViewer = document.getElementById('viewStatusModal');
        if (statusViewer && !statusViewer.classList.contains('hidden')) {
            if (typeof closeStatusViewer === 'function') closeStatusViewer();
            return;
        }
        const createStatus = document.getElementById('createStatusModal');
        if (createStatus && !createStatus.classList.contains('hidden')) {
            if (typeof closeCreateStatusModal === 'function') closeCreateStatusModal();
            return;
        }

        // D. Contacts Modal
        const contactsModal = document.getElementById('contactsModal');
        if (contactsModal && !contactsModal.classList.contains('hidden')) {
            if (window.ContactsModal && typeof window.ContactsModal.close === 'function') {
                window.ContactsModal.close();
            }
            return;
        }

        // E. Generic Modals (Create Group, Profile, Group Info, dll)
        const openModal = document.querySelector('.modal:not(.hidden)');
        if (openModal) {
            // Coba tutup dengan fungsi spesifik jika ada (untuk cleanup yang lebih baik)
            if (openModal.id === 'groupProfileModal' && typeof closeGroupProfileModal === 'function') {
                closeGroupProfileModal();
            } else if (openModal.id === 'profileModal' && typeof closeProfileModal === 'function') {
                closeProfileModal();
            } else {
                // Fallback: Sembunyikan modal secara manual
                openModal.classList.add('hidden');
                openModal.classList.remove('active');
            }
            return;
        }

        // --- 2. PRIORITAS KEDUA: CHAT ROOM ---
        const chatRoom = document.getElementById('chatRoom');
        if (chatRoom && !chatRoom.classList.contains('hidden')) {
            if (typeof closeChat === 'function') {
                closeChat();
            } else {
                const welcomeScreen = document.getElementById('welcomeScreen');
                chatRoom.classList.add('hidden');
                if (welcomeScreen) welcomeScreen.classList.remove('hidden');
            }
        }
    }
});