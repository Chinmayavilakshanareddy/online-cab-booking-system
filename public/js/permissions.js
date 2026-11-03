// RideNow Permissions Management Module (Vanilla JS + DOM + Fetch)

(function () {
    "use strict";

    const API_BASE = window.location.origin.includes("3000")
        ? window.location.origin
        : "http://localhost:3000";

    const state = {
        admins: [],
        availablePermissions: [],
        filter: {
            search: "",
            role: "all",
            access: "all"
        },
        selectedAdmin: null,
        isLoading: false
    };

    // DOM Elements Cache
    const el = {
        adminUserName: document.getElementById("adminUserName"),
        adminUserAvatar: document.getElementById("adminUserAvatar"),
        logoutBtn: document.getElementById("logoutBtn"),
        refreshBtn: document.getElementById("refreshBtn"),
        toastContainer: document.getElementById("toastContainer"),

        // KPIs
        kpiTotalAdmins: document.getElementById("kpiTotalAdmins"),
        kpiSuperAdmins: document.getElementById("kpiSuperAdmins"),
        kpiFullAccess: document.getElementById("kpiFullAccess"),
        kpiRestricted: document.getElementById("kpiRestricted"),
        kpiTotalGranted: document.getElementById("kpiTotalGranted"),

        // Filter & Search
        searchInput: document.getElementById("searchInput"),
        roleFilter: document.getElementById("roleFilter"),
        accessFilter: document.getElementById("accessFilter"),
        resetFiltersBtn: document.getElementById("resetFiltersBtn"),
        adminResultsCount: document.getElementById("adminResultsCount"),
        permissionsTableBody: document.getElementById("permissionsTableBody"),

        // Catalog accordion
        catalogToggleHeader: document.getElementById("catalogToggleHeader"),
        toggleCatalogBtn: document.getElementById("toggleCatalogBtn"),
        catalogContent: document.getElementById("catalogContent"),

        // Modal
        permissionModal: document.getElementById("permissionModal"),
        modalCloseBtn: document.getElementById("modalCloseBtn"),
        modalCancelBtn: document.getElementById("modalCancelBtn"),
        permissionForm: document.getElementById("permissionForm"),
        editAdminId: document.getElementById("editAdminId"),
        modalAdminName: document.getElementById("modalAdminName"),
        modalAdminEmail: document.getElementById("modalAdminEmail"),
        modalAdminRoleBadge: document.getElementById("modalAdminRoleBadge"),
        superAdminWarning: document.getElementById("superAdminWarning"),
        modalCheckboxGrid: document.getElementById("modalCheckboxGrid"),
        selectAllBtn: document.getElementById("selectAllBtn"),
        deselectAllBtn: document.getElementById("deselectAllBtn"),
        savePermissionsBtn: document.getElementById("savePermissionsBtn"),
        modalError: document.getElementById("modalError")
    };

    // Show Toast Notification
    function showToast(message, type = "success") {
        let container = el.toastContainer;
        if (!container) {
            container = document.createElement("div");
            container.id = "toastContainer";
            document.body.appendChild(container);
            el.toastContainer = container;
        }

        const toast = document.createElement("div");
        toast.className = `toast toast-${type}`;
        const prefix = type === "success" ? "[Success]" : (type === "danger" ? "[Error]" : "[Info]");
        toast.innerHTML = `<span style="font-weight: bold; margin-right: 6px;">${prefix}</span> <div>${escapeHtml(message)}</div>`;
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

    function checkAdminSession() {
        try {
            const storedUser = localStorage.getItem("ridenow_user");
            if (storedUser) {
                const user = JSON.parse(storedUser);
                if (el.adminUserName && user.name) {
                    const roleLabel = user.role === "super_admin" ? "Super Admin" : "Admin";
                    el.adminUserName.textContent = `${user.name} (${roleLabel})`;
                }
                if (el.adminUserAvatar && user.name) {
                    const initials = user.name.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase();
                    el.adminUserAvatar.textContent = initials || "AD";
                }
            }
        } catch (e) {
            console.error("Session parse error:", e);
        }
    }

    // ========================================================
    // 1. FETCH & RENDER PERMISSIONS
    // ========================================================
    async function loadPermissions() {
        state.isLoading = true;
        if (el.refreshBtn) {
            el.refreshBtn.disabled = true;
            el.refreshBtn.innerHTML = `<span class="loading-spinner"></span> Loading...`;
        }

        el.permissionsTableBody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state-cell">
                    <span class="loading-spinner"></span> Loading permissions from database...
                </td>
            </tr>
        `;

        try {
            const res = await fetch(`${API_BASE}/api/admin/permissions`, {
                headers: { "Content-Type": "application/json" }
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.message || "Failed to load permissions");
            }

            state.admins = data.admins || [];
            state.availablePermissions = data.available_permissions || [];

            updateKpis(data.summary || {});
            renderPermissionsTable();
        } catch (err) {
            console.error("Load permissions error:", err);
            el.permissionsTableBody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-state-cell" style="color: var(--status-danger);">
                        Unable to load permissions: ${escapeHtml(err.message)}
                    </td>
                </tr>
            `;
            if (el.adminResultsCount) el.adminResultsCount.textContent = "Error loading permissions";
        } finally {
            state.isLoading = false;
            if (el.refreshBtn) {
                el.refreshBtn.disabled = false;
                el.refreshBtn.textContent = "Refresh";
            }
        }
    }

    function updateKpis(summary) {
        if (el.kpiTotalAdmins) el.kpiTotalAdmins.textContent = `${summary.total_admins || 0}`;
        if (el.kpiSuperAdmins) el.kpiSuperAdmins.textContent = `${summary.super_admins || 0} Super`;
        if (el.kpiFullAccess) el.kpiFullAccess.textContent = `${summary.full_access_count || 0}`;
        if (el.kpiRestricted) el.kpiRestricted.textContent = `${summary.restricted_count || 0}`;
        if (el.kpiTotalGranted) el.kpiTotalGranted.textContent = `${summary.total_permissions_granted || 0}`;
    }

    function getFilteredAdmins() {
        const query = state.filter.search.toLowerCase().trim();
        const role = state.filter.role;
        const access = state.filter.access;

        return state.admins.filter(a => {
            const matchesSearch = !query ||
                a.name.toLowerCase().includes(query) ||
                a.email.toLowerCase().includes(query) ||
                (a.mobile && a.mobile.includes(query));

            const matchesRole = role === "all" || a.role === role;

            let matchesAccess = true;
            if (access === "full") {
                matchesAccess = a.is_full_access;
            } else if (access === "restricted") {
                matchesAccess = !a.is_full_access;
            }

            return matchesSearch && matchesRole && matchesAccess;
        });
    }

    function renderPermissionsTable() {
        const filtered = getFilteredAdmins();

        if (el.adminResultsCount) {
            el.adminResultsCount.textContent = `Showing ${filtered.length} of ${state.admins.length} administrator${state.admins.length === 1 ? '' : 's'}`;
        }

        if (filtered.length === 0) {
            el.permissionsTableBody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-state-cell">
                        No administrator accounts matched your search/filter criteria.
                    </td>
                </tr>
            `;
            return;
        }

        const permIconMap = {
            manage_passengers: "Passengers",
            manage_drivers: "Drivers",
            manage_vehicles: "Vehicles",
            manage_trips: "Trips",
            manage_fares: "Fares",
            view_reports: "Reports",
            system_settings: "Settings & Logs"
        };

        const rowsHtml = filtered.map(admin => {
            const isSuper = admin.role === "super_admin";
            const roleBadgeClass = isSuper ? "badge-role-super" : "badge-admin";
            const roleLabel = isSuper ? "Super Admin" : "Standard Admin";

            const initials = admin.name
                .split(" ")
                .map(n => n[0])
                .join("")
                .substring(0, 2)
                .toUpperCase();

            const statusClass = admin.status === "active" ? "status-badge-active" : "status-badge-inactive";
            const statusLabel = admin.status === "active" ? "Active" : "Inactive";

            let permissionsPills = "";
            if (isSuper) {
                permissionsPills = `
                    <span class="perm-badge perm-badge-super">
                        Root Super Admin - All System Permissions Enabled
                    </span>
                `;
            } else if (!admin.permissions || admin.permissions.length === 0) {
                permissionsPills = `
                    <span class="perm-badge" style="background: #fef2f2; color: #991b1b; border-color: #fca5a5;">
                        No permissions assigned (Restricted Access)
                    </span>
                `;
            } else {
                permissionsPills = admin.permissions.map(p => {
                    const label = permIconMap[p] || p;
                    return `<span class="perm-badge perm-badge-active">${label}</span>`;
                }).join(" ");
            }

            const grantedCount = isSuper ? "7 / 7" : `${admin.permissions ? admin.permissions.length : 0} / 7`;

            const actionBtn = isSuper
                ? `<button type="button" class="btn-table-action" disabled title="Super Admin permissions are fixed with root access" style="opacity: 0.5; cursor: not-allowed;">Fixed (Root)</button>`
                : `<button type="button" class="btn-table-action btn-approve" data-edit-id="${admin.user_id}">Edit Permissions</button>`;

            return `
                <tr>
                    <td>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <div class="user-avatar" style="width: 34px; height: 34px; font-size: 13px; background: ${isSuper ? '#1e3a8a' : '#2563eb'};">
                                ${escapeHtml(initials)}
                            </div>
                            <div>
                                <div style="font-weight: 700; color: var(--text-primary); font-size: 14px;">${escapeHtml(admin.name)}</div>
                                <div style="font-size: 12px; color: var(--text-secondary);">${escapeHtml(admin.email)}</div>
                            </div>
                        </div>
                    </td>
                    <td>
                        <span class="badge-role ${roleBadgeClass}">${roleLabel}</span>
                    </td>
                    <td>
                        <span class="status-badge ${statusClass}">${statusLabel}</span>
                    </td>
                    <td>
                        <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                            ${permissionsPills}
                        </div>
                    </td>
                    <td style="text-align: center; font-weight: 700; font-size: 13px;">
                        ${grantedCount}
                    </td>
                    <td style="text-align: center;">
                        ${actionBtn}
                    </td>
                </tr>
            `;
        }).join("");

        el.permissionsTableBody.innerHTML = rowsHtml;
    }

    // ========================================================
    // 2. MODAL: EDIT PERMISSIONS
    // ========================================================
    function openEditModal(adminId) {
        const admin = state.admins.find(a => a.user_id === Number(adminId));
        if (!admin) return;

        state.selectedAdmin = admin;
        el.editAdminId.value = admin.user_id;
        el.modalAdminName.textContent = admin.name;
        el.modalAdminEmail.textContent = admin.email;

        const isSuper = admin.role === "super_admin";
        el.modalAdminRoleBadge.className = isSuper ? "badge-pill badge-super-admin" : "badge-pill badge-admin";
        el.modalAdminRoleBadge.textContent = isSuper ? "Super Administrator" : "Standard Administrator";

        el.superAdminWarning.style.display = isSuper ? "block" : "none";
        el.savePermissionsBtn.disabled = isSuper;
        el.selectAllBtn.disabled = isSuper;
        el.deselectAllBtn.disabled = isSuper;

        if (el.modalError) {
            el.modalError.style.display = "none";
            el.modalError.textContent = "";
        }

        // Render checkboxes
        const catalog = state.availablePermissions.length > 0 ? state.availablePermissions : [
            { key: "manage_passengers", label: "Manage Passengers", description: "View, activate, block, or modify passenger accounts" },
            { key: "manage_drivers", label: "Manage Drivers", description: "Review driver licenses, approve, reject, or suspend driver profiles" },
            { key: "manage_vehicles", label: "Manage Vehicles", description: "Register, inspect, and maintain fleet vehicle records" },
            { key: "manage_trips", label: "Manage Trips & Bookings", description: "Monitor active rides, dispatch, and resolve booking issues" },
            { key: "manage_fares", label: "Fare Rules & Service Areas", description: "Configure vehicle pricing models, surge rates, and operational zones" },
            { key: "view_reports", label: "Reports & Analytics", description: "Access financial reports, driver earnings, and business analytics" },
            { key: "system_settings", label: "System Settings & Logs", description: "Govern application parameters and inspect system audit logs" }
        ];

        const assignedSet = new Set(admin.permissions || []);

        const gridHtml = catalog.map(p => {
            const checked = isSuper || assignedSet.has(p.key) ? "checked" : "";
            const disabled = isSuper ? "disabled" : "";

            return `
                <label class="permission-checkbox-label" style="padding: 10px 12px; background: #ffffff; border: 1px solid var(--border-color); border-radius: var(--radius-sm); margin: 0; display: flex; align-items: flex-start; gap: 12px;">
                    <input type="checkbox" name="permissions" value="${p.key}" ${checked} ${disabled} style="margin-top: 3px;">
                    <div style="flex: 1;">
                        <div style="font-size: 13px; font-weight: 700; color: var(--text-primary);">
                            ${escapeHtml(p.label)}
                        </div>
                        <div style="font-size: 12px; color: var(--text-secondary); font-weight: normal; margin-top: 2px;">
                            ${escapeHtml(p.description)}
                        </div>
                    </div>
                </label>
            `;
        }).join("");

        el.modalCheckboxGrid.innerHTML = gridHtml;
        el.permissionModal.style.display = "flex";
    }

    function closeModal() {
        el.permissionModal.style.display = "none";
        state.selectedAdmin = null;
    }

    async function handleSavePermissions(e) {
        e.preventDefault();
        if (!state.selectedAdmin) return;

        const adminId = state.selectedAdmin.user_id;
        const selectedCheckboxes = el.modalCheckboxGrid.querySelectorAll("input[name='permissions']:checked");
        const selectedPermissions = Array.from(selectedCheckboxes).map(cb => cb.value);

        el.savePermissionsBtn.disabled = true;
        el.savePermissionsBtn.innerHTML = `<span class="loading-spinner"></span> Saving...`;

        try {
            const res = await fetch(`${API_BASE}/api/admin/permissions/${adminId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ permissions: selectedPermissions })
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.message || "Failed to update permissions.");
            }

            showToast(data.message || "Permissions updated successfully!", "success");
            closeModal();
            loadPermissions();
        } catch (err) {
            console.error("Save permissions error:", err);
            if (el.modalError) {
                el.modalError.textContent = err.message || "Failed to save permissions.";
                el.modalError.style.display = "block";
            }
        } finally {
            el.savePermissionsBtn.disabled = false;
            el.savePermissionsBtn.textContent = "Save Permissions";
        }
    }

    // ========================================================
    // 3. EVENT LISTENERS
    // ========================================================
    function setupEventListeners() {
        if (el.refreshBtn) {
            el.refreshBtn.addEventListener("click", loadPermissions);
        }

        if (el.searchInput) {
            let debounceTimer;
            el.searchInput.addEventListener("input", () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    state.filter.search = el.searchInput.value;
                    renderPermissionsTable();
                }, 200);
            });
        }

        if (el.roleFilter) {
            el.roleFilter.addEventListener("change", () => {
                state.filter.role = el.roleFilter.value;
                renderPermissionsTable();
            });
        }

        if (el.accessFilter) {
            el.accessFilter.addEventListener("change", () => {
                state.filter.access = el.accessFilter.value;
                renderPermissionsTable();
            });
        }

        if (el.resetFiltersBtn) {
            el.resetFiltersBtn.addEventListener("click", () => {
                state.filter.search = "";
                state.filter.role = "all";
                state.filter.access = "all";
                if (el.searchInput) el.searchInput.value = "";
                if (el.roleFilter) el.roleFilter.value = "all";
                if (el.accessFilter) el.accessFilter.value = "all";
                renderPermissionsTable();
            });
        }

        // Accordion Toggle
        if (el.catalogToggleHeader) {
            el.catalogToggleHeader.addEventListener("click", () => {
                const isHidden = el.catalogContent.style.display === "none";
                el.catalogContent.style.display = isHidden ? "block" : "none";
                el.toggleCatalogBtn.textContent = isHidden ? "Hide Details" : "Show Details";
            });
        }

        // Table Action Click (Edit Permissions)
        if (el.permissionsTableBody) {
            el.permissionsTableBody.addEventListener("click", (e) => {
                const editBtn = e.target.closest("button[data-edit-id]");
                if (editBtn) {
                    const id = editBtn.getAttribute("data-edit-id");
                    openEditModal(id);
                }
            });
        }

        // Modal actions
        if (el.modalCloseBtn) el.modalCloseBtn.addEventListener("click", closeModal);
        if (el.modalCancelBtn) el.modalCancelBtn.addEventListener("click", closeModal);
        if (el.permissionModal) {
            el.permissionModal.addEventListener("click", (e) => {
                if (e.target === el.permissionModal) closeModal();
            });
        }

        if (el.selectAllBtn) {
            el.selectAllBtn.addEventListener("click", () => {
                el.modalCheckboxGrid.querySelectorAll("input[type='checkbox']:not([disabled])").forEach(cb => {
                    cb.checked = true;
                });
            });
        }

        if (el.deselectAllBtn) {
            el.deselectAllBtn.addEventListener("click", () => {
                el.modalCheckboxGrid.querySelectorAll("input[type='checkbox']:not([disabled])").forEach(cb => {
                    cb.checked = false;
                });
            });
        }

        if (el.permissionForm) {
            el.permissionForm.addEventListener("submit", handleSavePermissions);
        }

        // Logout
        if (el.logoutBtn) {
            el.logoutBtn.addEventListener("click", async (e) => {
                e.preventDefault();
                try {
                    await fetch(`${API_BASE}/api/auth/logout`, { method: "POST" });
                } catch (err) {
                    console.warn("Logout request error:", err);
                }
                localStorage.removeItem("ridenow_user");
                window.location.href = "../customer/login.html";
            });
        }
    }

    // Initialize
    checkAdminSession();
    setupEventListeners();
    loadPermissions();

})();

