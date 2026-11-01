// RideNow Administrator Management Engine (Vanilla JS + DOM + Fetch)

(function () {
    "use strict";

    const API_BASE = window.location.origin.includes("3000")
        ? window.location.origin
        : "http://localhost:3000";

    const state = {
        admins: [],
        filter: {
            search: "",
            role: "all",
            status: "all"
        },
        currentUserId: null,
        pendingDeleteAdmin: null,
        isLoading: false
    };

    // DOM Elements Cache
    const el = {
        superAdminName: document.getElementById("superAdminName"),
        superAdminAvatar: document.getElementById("superAdminAvatar"),
        logoutBtn: document.getElementById("logoutBtn"),
        refreshBtn: document.getElementById("refreshBtn"),
        addAdminBtn: document.getElementById("addAdminBtn"),
        toastContainer: document.getElementById("toastContainer"),

        // Stats
        statTotalAdmins: document.getElementById("statTotalAdmins"),
        statActiveAdminsMeta: document.getElementById("statActiveAdminsMeta"),
        statSuperAdmins: document.getElementById("statSuperAdmins"),
        statStandardAdmins: document.getElementById("statStandardAdmins"),

        // Filter & Search
        searchInput: document.getElementById("searchInput"),
        roleFilter: document.getElementById("roleFilter"),
        statusFilter: document.getElementById("statusFilter"),
        resetFiltersBtn: document.getElementById("resetFiltersBtn"),
        adminResultsCount: document.getElementById("adminResultsCount"),
        adminsTableBody: document.getElementById("adminsTableBody"),

        // Create / Edit Modal
        adminModal: document.getElementById("adminModal"),
        modalTitle: document.getElementById("modalTitle"),
        modalCloseBtn: document.getElementById("modalCloseBtn"),
        modalCancelBtn: document.getElementById("modalCancelBtn"),
        adminForm: document.getElementById("adminForm"),
        editAdminId: document.getElementById("editAdminId"),
        fName: document.getElementById("fName"),
        fEmail: document.getElementById("fEmail"),
        fMobile: document.getElementById("fMobile"),
        fPassword: document.getElementById("fPassword"),
        pwdReq: document.getElementById("pwdReq"),
        pwdHint: document.getElementById("pwdHint"),
        fRole: document.getElementById("fRole"),
        fStatus: document.getElementById("fStatus"),
        formError: document.getElementById("formError"),
        formSubmitBtn: document.getElementById("formSubmitBtn"),

        // Safe Deletion Modal
        deleteModal: document.getElementById("deleteModal"),
        deleteModalCloseBtn: document.getElementById("deleteModalCloseBtn"),
        deleteModalCancelBtn: document.getElementById("deleteModalCancelBtn"),
        confirmDeleteBtn: document.getElementById("confirmDeleteBtn"),
        deleteAdminName: document.getElementById("deleteAdminName"),
        deleteAdminEmail: document.getElementById("deleteAdminEmail")
    };

    // Toast Notification System
    function showToast(message, type = "success") {
        let container = el.toastContainer;
        if (!container) {
            container = document.createElement("div");
            container.id = "toastContainer";
            container.setAttribute("aria-live", "polite");
            document.body.appendChild(container);
            el.toastContainer = container;
        }

        const toast = document.createElement("div");
        toast.className = `toast toast-${type}`;
        const icon = type === "success" ? "✓" : (type === "danger" ? "✕" : "ℹ");
        toast.innerHTML = `<span>${icon}</span> <div>${escapeHtml(message)}</div>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = "0";
            toast.style.transform = "translateX(100%)";
            toast.style.transition = "all 0.3s ease";
            setTimeout(() => toast.remove(), 300);
        }, 3600);
    }

    function escapeHtml(str) {
        if (str === null || str === undefined) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function checkSuperAdminSession() {
        try {
            const storedUser = localStorage.getItem("ridenow_user");
            if (storedUser) {
                const user = JSON.parse(storedUser);
                state.currentUserId = user.user_id || user.id;
                if (el.superAdminName && user.name) {
                    const roleLabel = user.role === "super_admin" ? "Super Admin" : "Admin";
                    el.superAdminName.textContent = `${user.name} (${roleLabel})`;
                }
                if (el.superAdminAvatar && user.name) {
                    const initials = user.name.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase();
                    el.superAdminAvatar.textContent = initials || "SA";
                }
            }
        } catch (e) {
            console.error("Session parse error:", e);
        }
    }

    // ========================================================
    // 1. FETCH & RENDER ADMINISTRATORS
    // ========================================================
    async function loadAdmins() {
        state.isLoading = true;
        el.adminsTableBody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-state-cell">
                    <span class="loading-spinner"></span> Loading administrators from database...
                </td>
            </tr>
        `;

        try {
            const res = await fetch(`${API_BASE}/api/superadmin/admins`, {
                headers: { "Content-Type": "application/json" }
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.message || "Failed to load administrator accounts");
            }

            state.admins = data.admins || [];
            updateSummaryKpis(data.summary || {});
            renderAdminsTable();
        } catch (err) {
            console.error("Load admins error:", err);
            el.adminsTableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-state-cell" style="color: var(--status-danger);">
                        ✕ Unable to load administrators: ${escapeHtml(err.message)}
                    </td>
                </tr>
            `;
            el.adminResultsCount.textContent = "Error loading list";
        } finally {
            state.isLoading = false;
        }
    }

    function updateSummaryKpis(summary) {
        if (el.statTotalAdmins) el.statTotalAdmins.textContent = `${summary.total || 0} Staff`;
        if (el.statActiveAdminsMeta) el.statActiveAdminsMeta.textContent = `${summary.active || 0} Active Staff`;
        if (el.statSuperAdmins) el.statSuperAdmins.textContent = summary.super_admins || 0;
        if (el.statStandardAdmins) el.statStandardAdmins.textContent = summary.admins || 0;
    }

    function renderAdminsTable() {
        const tbody = el.adminsTableBody;
        const q = state.filter.search.toLowerCase().trim();
        const rFilter = state.filter.role;
        const sFilter = state.filter.status;

        const filtered = state.admins.filter(admin => {
            const matchesRole = rFilter === "all" || admin.role === rFilter;
            const matchesStatus = sFilter === "all" || admin.status === sFilter;
            const matchesSearch = !q ||
                (admin.name && admin.name.toLowerCase().includes(q)) ||
                (admin.email && admin.email.toLowerCase().includes(q)) ||
                (admin.mobile && admin.mobile.includes(q));
            return matchesRole && matchesStatus && matchesSearch;
        });

        el.adminResultsCount.textContent = `Showing ${filtered.length} of ${state.admins.length} administrators`;

        if (filtered.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-state-cell">
                        No administrator accounts found matching filters.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = filtered.map(admin => {
            const isSuper = admin.role === "super_admin";
            const roleBadge = isSuper
                ? `<span class="badge-pill badge-super-admin">👑 Super Admin</span>`
                : `<span class="badge-pill badge-admin">🛡️ Admin</span>`;

            const isActive = admin.status === "active";
            const statusBadge = isActive
                ? `<span class="badge-pill badge-success">Active</span>`
                : `<span class="badge-pill badge-danger">Inactive</span>`;

            const toggleText = isActive ? "Deactivate" : "Activate";
            const toggleClass = isActive ? "btn-reject" : "btn-approve";

            // Permissions formatting
            let permsHtml = "";
            if (isSuper && admin.permissions.length === 0) {
                permsHtml = `<span class="permission-pill perm-all">★ Full Root Privileges</span>`;
            } else if (admin.permissions.length > 0) {
                permsHtml = admin.permissions.map(p => {
                    const clean = p.replace("manage_", "").replace("view_", "");
                    return `<span class="permission-pill">${escapeHtml(clean)}</span>`;
                }).join(" ");
            } else {
                permsHtml = `<span style="font-size: 11px; color: var(--text-muted);">None assigned</span>`;
            }

            const isSelf = state.currentUserId && state.currentUserId === admin.user_id;
            const selfTag = isSelf ? `<span class="badge-pill badge-info" style="font-size: 9px; margin-left: 4px;">You</span>` : "";

            return `
                <tr data-admin-id="${admin.user_id}">
                    <td>
                        <div style="font-weight: 700; color: var(--text-primary); font-size: 14px;">
                            ${escapeHtml(admin.name)}
                            ${selfTag}
                        </div>
                        <div style="font-size: 11px; color: var(--text-muted);">ID: #${admin.user_id} • Created ${escapeHtml(admin.formatted_created || "")}</div>
                    </td>
                    <td>
                        <div style="font-size: 12px; font-weight: 500;">${escapeHtml(admin.email)}</div>
                        <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(admin.mobile)}</div>
                    </td>
                    <td>${roleBadge}</td>
                    <td>
                        <div class="permission-badges-list">
                            ${permsHtml}
                        </div>
                    </td>
                    <td>${statusBadge}</td>
                    <td style="font-size: 12px; color: var(--text-secondary); text-align: center;">
                        <span style="font-weight: 650;">${admin.total_actions}</span> actions
                    </td>
                    <td style="text-align: center;">
                        <div class="table-actions" style="justify-content: center; gap: 6px;">
                            <button type="button" class="btn-table-action btn-view btn-edit-admin" data-admin-id="${admin.user_id}" title="Edit admin details">
                                ✏️ Edit
                            </button>
                            <button type="button" class="btn-table-action ${toggleClass} btn-status-admin" data-admin-id="${admin.user_id}" data-current-status="${admin.status}" ${isSelf ? 'disabled title="Cannot change status of currently logged in user"' : ''}>
                                ${toggleText}
                            </button>
                            <button type="button" class="btn-table-action btn-reject btn-delete-admin" data-admin-id="${admin.user_id}" ${isSelf ? 'disabled title="Cannot delete your own account"' : ''} title="Safe delete administrator">
                                🗑️ Delete
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join("");
    }

    // ========================================================
    // 2. CREATE & EDIT ADMINISTRATOR MODAL
    // ========================================================
    function openAdminModal(isEdit = false, admin = null) {
        el.formError.style.display = "none";
        el.adminForm.reset();

        // Clear all permission checkboxes
        const checkboxes = el.adminForm.querySelectorAll('input[name="permissions"]');
        checkboxes.forEach(cb => cb.checked = false);

        if (isEdit && admin) {
            el.modalTitle.textContent = `Edit Administrator: ${admin.name}`;
            el.editAdminId.value = admin.user_id;
            el.fName.value = admin.name;
            el.fEmail.value = admin.email;
            el.fMobile.value = admin.mobile;
            el.fRole.value = admin.role;
            el.fStatus.value = admin.status;
            el.fPassword.value = "";
            el.fPassword.required = false;
            el.pwdReq.style.display = "none";
            el.pwdHint.textContent = "Leave blank to keep existing password.";
            el.formSubmitBtn.textContent = "Save Changes";

            // Check assigned permissions
            if (admin.permissions && admin.permissions.length > 0) {
                checkboxes.forEach(cb => {
                    if (admin.permissions.includes(cb.value)) {
                        cb.checked = true;
                    }
                });
            } else if (admin.role === "super_admin") {
                checkboxes.forEach(cb => cb.checked = true);
            }
        } else {
            el.modalTitle.textContent = "Create Administrator Account";
            el.editAdminId.value = "";
            el.fRole.value = "admin";
            el.fStatus.value = "active";
            el.fPassword.value = "";
            el.fPassword.required = true;
            el.pwdReq.style.display = "inline";
            el.pwdHint.textContent = "Minimum 6 characters. Securely hashed on creation.";
            el.formSubmitBtn.textContent = "Create Administrator";

            // Default check operational permissions
            checkboxes.forEach(cb => {
                if (cb.value !== "system_settings") cb.checked = true;
            });
        }

        el.adminModal.style.display = "flex";
        setTimeout(() => el.fName.focus(), 50);
    }

    function closeAdminModal() {
        el.adminModal.style.display = "none";
        el.adminForm.reset();
        el.editAdminId.value = "";
    }

    async function handleAdminFormSubmit(e) {
        e.preventDefault();
        el.formError.style.display = "none";

        const adminId = el.editAdminId.value.trim();
        const isEdit = Boolean(adminId);

        const name = el.fName.value.trim();
        const email = el.fEmail.value.trim();
        const mobile = el.fMobile.value.trim();
        const password = el.fPassword.value.trim();
        const role = el.fRole.value;
        const status = el.fStatus.value;

        // Permissions
        const checkedPerms = [];
        const checkboxes = el.adminForm.querySelectorAll('input[name="permissions"]:checked');
        checkboxes.forEach(cb => checkedPerms.push(cb.value));

        if (!name || name.length < 2) {
            showFormError("Full name must be at least 2 characters.");
            el.fName.focus();
            return;
        }
        if (!email || !email.includes("@")) {
            showFormError("A valid email address is required.");
            el.fEmail.focus();
            return;
        }
        if (!mobile || !/^\d{10}$/.test(mobile)) {
            showFormError("Mobile number must be a valid 10-digit number.");
            el.fMobile.focus();
            return;
        }
        if (!isEdit && (!password || password.length < 6)) {
            showFormError("Password must be at least 6 characters long.");
            el.fPassword.focus();
            return;
        }

        const payload = {
            name,
            email,
            mobile,
            role,
            status,
            permissions: checkedPerms
        };
        if (password) payload.password = password;

        const submitBtn = el.formSubmitBtn;
        submitBtn.disabled = true;
        submitBtn.textContent = "Saving...";

        try {
            const url = isEdit
                ? `${API_BASE}/api/superadmin/admins/${adminId}`
                : `${API_BASE}/api/superadmin/admins`;
            const method = isEdit ? "PATCH" : "POST";

            const res = await fetch(url, {
                method: method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.message || "Failed to save administrator account");
            }

            closeAdminModal();
            showToast(data.message || (isEdit ? "Administrator updated successfully!" : "Administrator created successfully!"), "success");
            await loadAdmins();
        } catch (err) {
            console.error("Admin save error:", err);
            showFormError(err.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = isEdit ? "Save Changes" : "Create Administrator";
        }
    }

    function showFormError(msg) {
        el.formError.textContent = msg;
        el.formError.style.display = "block";
    }

    // ========================================================
    // 3. ACTIVATE & DEACTIVATE ADMINISTRATOR
    // ========================================================
    async function toggleAdminStatus(adminId, currentStatus, btn) {
        btn.disabled = true;
        const newStatus = currentStatus === "active" ? "inactive" : "active";

        try {
            const res = await fetch(`${API_BASE}/api/superadmin/admins/${adminId}/status`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: newStatus })
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.message || "Failed to update status");
            }

            showToast(data.message || `Administrator is now ${newStatus}`, "success");
            await loadAdmins();
        } catch (err) {
            console.error("Status toggle error:", err);
            showToast(err.message, "danger");
            btn.disabled = false;
        }
    }

    // ========================================================
    // 4. SAFE ADMINISTRATOR DELETION
    // ========================================================
    function openDeleteModal(admin) {
        state.pendingDeleteAdmin = admin;
        el.deleteAdminName.textContent = `${admin.name} (${admin.role === 'super_admin' ? 'Super Admin' : 'Admin'})`;
        el.deleteAdminEmail.textContent = `Email: ${admin.email} • Mobile: ${admin.mobile}`;
        el.deleteModal.style.display = "flex";
    }

    function closeDeleteModal() {
        el.deleteModal.style.display = "none";
        state.pendingDeleteAdmin = null;
    }

    async function confirmDeleteAdmin() {
        if (!state.pendingDeleteAdmin) return;
        const admin = state.pendingDeleteAdmin;
        const adminId = admin.user_id;

        const btn = el.confirmDeleteBtn;
        btn.disabled = true;
        btn.textContent = "Deleting safely...";

        try {
            const res = await fetch(`${API_BASE}/api/superadmin/admins/${adminId}`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" }
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.message || "Safe deletion failed");
            }

            closeDeleteModal();
            showToast(data.message || `Administrator ${admin.name} deleted successfully`, "success");
            await loadAdmins();
        } catch (err) {
            console.error("Safe deletion error:", err);
            showToast(err.message, "danger");
        } finally {
            btn.disabled = false;
            btn.textContent = "Delete Administrator Permanently";
        }
    }

    // ========================================================
    // 5. EVENT LISTENERS
    // ========================================================
    function setupEventListeners() {
        // Refresh
        el.refreshBtn.addEventListener("click", () => {
            loadAdmins();
            showToast("Administrator directory refreshed", "info");
        });

        // Search & Filters
        let searchDebounce = null;
        el.searchInput.addEventListener("input", (e) => {
            clearTimeout(searchDebounce);
            searchDebounce = setTimeout(() => {
                state.filter.search = e.target.value;
                renderAdminsTable();
            }, 200);
        });

        el.roleFilter.addEventListener("change", (e) => {
            state.filter.role = e.target.value;
            renderAdminsTable();
        });

        el.statusFilter.addEventListener("change", (e) => {
            state.filter.status = e.target.value;
            renderAdminsTable();
        });

        el.resetFiltersBtn.addEventListener("click", () => {
            state.filter.search = "";
            state.filter.role = "all";
            state.filter.status = "all";
            el.searchInput.value = "";
            el.roleFilter.value = "all";
            el.statusFilter.value = "all";
            renderAdminsTable();
        });

        // Table actions delegation
        el.adminsTableBody.addEventListener("click", (e) => {
            // Edit
            const editBtn = e.target.closest(".btn-edit-admin");
            if (editBtn) {
                const adminId = parseInt(editBtn.dataset.adminId, 10);
                const admin = state.admins.find(a => a.user_id === adminId);
                if (admin) openAdminModal(true, admin);
                return;
            }

            // Status toggle
            const statusBtn = e.target.closest(".btn-status-admin");
            if (statusBtn && !statusBtn.disabled) {
                const adminId = parseInt(statusBtn.dataset.adminId, 10);
                const currentStatus = statusBtn.dataset.currentStatus;
                toggleAdminStatus(adminId, currentStatus, statusBtn);
                return;
            }

            // Delete
            const deleteBtn = e.target.closest(".btn-delete-admin");
            if (deleteBtn && !deleteBtn.disabled) {
                const adminId = parseInt(deleteBtn.dataset.adminId, 10);
                const admin = state.admins.find(a => a.user_id === adminId);
                if (admin) openDeleteModal(admin);
                return;
            }
        });

        // Add admin button
        el.addAdminBtn.addEventListener("click", () => openAdminModal(false));

        // Create / Edit modal triggers
        el.modalCloseBtn.addEventListener("click", closeAdminModal);
        el.modalCancelBtn.addEventListener("click", closeAdminModal);
        el.adminModal.addEventListener("click", (e) => {
            if (e.target === el.adminModal) closeAdminModal();
        });
        el.adminForm.addEventListener("submit", handleAdminFormSubmit);

        // Delete modal triggers
        el.deleteModalCloseBtn.addEventListener("click", closeDeleteModal);
        el.deleteModalCancelBtn.addEventListener("click", closeDeleteModal);
        el.deleteModal.addEventListener("click", (e) => {
            if (e.target === el.deleteModal) closeDeleteModal();
        });
        el.confirmDeleteBtn.addEventListener("click", confirmDeleteAdmin);

        // Logout
        if (el.logoutBtn) {
            el.logoutBtn.addEventListener("click", () => {
                localStorage.removeItem("ridenow_user");
            });
        }

        // Auto open "create" modal if query param action=new
        const params = new URLSearchParams(window.location.search);
        if (params.get("action") === "new") {
            setTimeout(() => openAdminModal(false), 200);
        }
    }

    // Initialize
    document.addEventListener("DOMContentLoaded", () => {
        checkSuperAdminSession();
        setupEventListeners();
        loadAdmins();
    });

    window.RideNowAdmins = {
        loadAdmins,
        openAdminModal,
        openDeleteModal
    };

})();

