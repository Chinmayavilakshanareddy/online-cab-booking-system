// RideNow System Audit Logs Module (Vanilla JS + DOM + Fetch)

(function () {
    "use strict";

    const API_BASE = window.location.origin.includes("3000")
        ? window.location.origin
        : "http://localhost:3000";

    const state = {
        logs: [],
        pagination: {
            page: 1,
            limit: 25,
            total: 0,
            totalPages: 1
        },
        filters: {
            search: "",
            action: "all",
            adminId: "all",
            dateFrom: "",
            dateTo: ""
        },
        availableActions: [],
        availableActors: [],
        isLoading: false
    };

    // DOM Elements Cache
    const el = {
        adminUserName: document.getElementById("adminUserName"),
        adminUserAvatar: document.getElementById("adminUserAvatar"),
        logoutBtn: document.getElementById("logoutBtn"),
        refreshBtn: document.getElementById("refreshBtn"),
        exportCsvBtn: document.getElementById("exportCsvBtn"),
        toastContainer: document.getElementById("toastContainer"),

        // KPIs
        kpiTotalLogs: document.getElementById("kpiTotalLogs"),
        kpiTodayCount: document.getElementById("kpiTodayCount"),
        kpiTodayMeta: document.getElementById("kpiTodayMeta"),
        kpiUniqueActors: document.getElementById("kpiUniqueActors"),
        kpiLatestActivity: document.getElementById("kpiLatestActivity"),

        // Filters
        searchInput: document.getElementById("searchInput"),
        actionFilter: document.getElementById("actionFilter"),
        adminFilter: document.getElementById("adminFilter"),
        dateFrom: document.getElementById("dateFrom"),
        dateTo: document.getElementById("dateTo"),
        applyFiltersBtn: document.getElementById("applyFiltersBtn"),
        resetFiltersBtn: document.getElementById("resetFiltersBtn"),
        limitSelect: document.getElementById("limitSelect"),
        logResultsCount: document.getElementById("logResultsCount"),
        logsTableBody: document.getElementById("logsTableBody"),

        // Pagination
        paginationInfo: document.getElementById("paginationInfo"),
        prevPageBtn: document.getElementById("prevPageBtn"),
        nextPageBtn: document.getElementById("nextPageBtn")
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

    // Determine Action Badge Style
    function getActionBadge(action) {
        if (!action) return `<span class="badge-action badge-action-default">UNKNOWN</span>`;

        const upper = action.toUpperCase();
        let badgeClass = "badge-action-default";

        if (upper.includes("LOGIN") || upper.includes("LOGOUT") || upper.includes("AUTH") || upper.includes("REGISTER")) {
            badgeClass = "badge-action-auth";
        } else if (upper.includes("DRIVER")) {
            badgeClass = "badge-action-driver";
        } else if (upper.includes("PASSENGER")) {
            badgeClass = "badge-action-passenger";
        } else if (upper.includes("TRIP") || upper.includes("RIDE")) {
            badgeClass = "badge-action-trip";
        } else if (upper.includes("ADMIN") || upper.includes("PERMISSION")) {
            badgeClass = "badge-action-admin";
        } else if (upper.includes("SETTING") || upper.includes("CONFIG") || upper.includes("SYSTEM")) {
            badgeClass = "badge-action-settings";
        }

        return `<span class="badge-action ${badgeClass}">${escapeHtml(action)}</span>`;
    }

    // ========================================================
    // 1. FETCH & RENDER LOGS
    // ========================================================
    async function loadLogs() {
        state.isLoading = true;
        if (el.refreshBtn) {
            el.refreshBtn.disabled = true;
            el.refreshBtn.innerHTML = `<span class="loading-spinner"></span> Loading...`;
        }

        el.logsTableBody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state-cell">
                    <span class="loading-spinner"></span> Loading audit event logs from database...
                </td>
            </tr>
        `;

        const queryParams = new URLSearchParams({
            page: state.pagination.page,
            limit: state.pagination.limit,
            search: state.filters.search,
            action: state.filters.action,
            adminId: state.filters.adminId,
            dateFrom: state.filters.dateFrom,
            dateTo: state.filters.dateTo
        });

        try {
            const res = await fetch(`${API_BASE}/api/admin/logs?${queryParams.toString()}`, {
                headers: { "Content-Type": "application/json" }
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.message || "Failed to load audit logs");
            }

            state.logs = data.logs || [];
            if (data.pagination) {
                state.pagination.total = data.pagination.total;
                state.pagination.page = data.pagination.page;
                state.pagination.limit = data.pagination.limit;
                state.pagination.totalPages = data.pagination.totalPages;
            }

            if (data.summary) {
                updateKpis(data.summary);
            }

            if (data.filter_options) {
                populateDropdowns(data.filter_options);
            }

            renderLogsTable();
            updatePaginationUi();
        } catch (err) {
            console.error("Load logs error:", err);
            el.logsTableBody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-state-cell" style="color: var(--status-danger);">
                        Unable to load audit logs: ${escapeHtml(err.message)}
                    </td>
                </tr>
            `;
            if (el.logResultsCount) el.logResultsCount.textContent = "Error loading logs";
        } finally {
            state.isLoading = false;
            if (el.refreshBtn) {
                el.refreshBtn.disabled = false;
                el.refreshBtn.textContent = "Refresh";
            }
        }
    }

    function updateKpis(summary) {
        if (el.kpiTotalLogs) el.kpiTotalLogs.textContent = `${summary.total_logs || 0}`;
        if (el.kpiTodayCount) el.kpiTodayCount.textContent = `${summary.today_count || 0}`;
        if (el.kpiUniqueActors) el.kpiUniqueActors.textContent = `${summary.unique_actors || 0} Actors`;
        if (el.kpiLatestActivity) el.kpiLatestActivity.textContent = summary.latest_activity || "None";
    }

    function populateDropdowns(options) {
        // Populate Actions dropdown once or when list changes
        if (options.actions && el.actionFilter && el.actionFilter.options.length <= 1) {
            const currentSelected = el.actionFilter.value;
            el.actionFilter.innerHTML = `<option value="all">All Actions (${options.actions.length})</option>`;
            options.actions.forEach(act => {
                const opt = document.createElement("option");
                opt.value = act;
                opt.textContent = act;
                el.actionFilter.appendChild(opt);
            });
            el.actionFilter.value = currentSelected;
        }

        // Populate Actors dropdown
        if (options.actors && el.adminFilter && el.adminFilter.options.length <= 2) {
            const currentSelected = el.adminFilter.value;
            el.adminFilter.innerHTML = `
                <option value="all">All Actors</option>
                <option value="system">System Automated</option>
            `;
            options.actors.forEach(actor => {
                const opt = document.createElement("option");
                opt.value = actor.user_id;
                opt.textContent = `${actor.name} (${actor.role})`;
                el.adminFilter.appendChild(opt);
            });
            el.adminFilter.value = currentSelected;
        }
    }

    function renderLogsTable() {
        if (el.logResultsCount) {
            const start = state.logs.length > 0 ? (state.pagination.page - 1) * state.pagination.limit + 1 : 0;
            const end = (state.pagination.page - 1) * state.pagination.limit + state.logs.length;
            el.logResultsCount.textContent = `Showing ${start}-${end} of ${state.pagination.total} audit event${state.pagination.total === 1 ? '' : 's'}`;
        }

        if (state.logs.length === 0) {
            el.logsTableBody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-state-cell">
                        No system activity logs found matching the specified filters.
                    </td>
                </tr>
            `;
            return;
        }

        const rowsHtml = state.logs.map(log => {
            const actionBadge = getActionBadge(log.action);
            const isSystem = !log.user_id || log.user_name === "System";

            const actorRolePill = isSystem
                ? `<span class="badge-role" style="background: #f1f5f9; color: #475569; font-size: 10px;">SYSTEM</span>`
                : (log.user_role === "super_admin"
                    ? `<span class="badge-role badge-role-super" style="font-size: 10px;">SUPER ADMIN</span>`
                    : `<span class="badge-role badge-admin" style="font-size: 10px;">ADMIN</span>`);

            const ipDisplay = log.ip_address
                ? `<span style="font-family: monospace; font-size: 12px; color: var(--text-secondary); background: #f8fafc; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color);">${escapeHtml(log.ip_address)}</span>`
                : `<span style="color: var(--text-muted); font-size: 12px;">-</span>`;

            return `
                <tr>
                    <td style="font-weight: 700; color: var(--text-secondary); font-size: 13px;">
                        #${log.log_id}
                    </td>
                    <td style="font-size: 12px; color: var(--text-secondary); white-space: nowrap;">
                        ${escapeHtml(log.formatted_time || log.created_at)}
                    </td>
                    <td>
                        <div style="display: flex; flex-direction: column; gap: 2px;">
                            <div style="font-weight: 700; color: var(--text-primary); font-size: 13px; display: flex; align-items: center; gap: 6px;">
                                ${escapeHtml(log.user_name)}
                                ${actorRolePill}
                            </div>
                            ${log.user_email && !isSystem ? `<div style="font-size: 11px; color: var(--text-secondary);">${escapeHtml(log.user_email)}</div>` : ''}
                        </div>
                    </td>
                    <td>
                        ${actionBadge}
                    </td>
                    <td style="font-size: 13px; color: var(--text-primary); line-height: 1.4;">
                        ${escapeHtml(log.description || '-')}
                    </td>
                    <td style="text-align: right;">
                        ${ipDisplay}
                    </td>
                </tr>
            `;
        }).join("");

        el.logsTableBody.innerHTML = rowsHtml;
    }

    function updatePaginationUi() {
        if (el.paginationInfo) {
            el.paginationInfo.textContent = `Page ${state.pagination.page} of ${state.pagination.totalPages || 1} (${state.pagination.total} total logs)`;
        }

        if (el.prevPageBtn) {
            el.prevPageBtn.disabled = state.pagination.page <= 1;
        }

        if (el.nextPageBtn) {
            el.nextPageBtn.disabled = state.pagination.page >= state.pagination.totalPages;
        }
    }

    // ========================================================
    // 2. EXPORT CSV
    // ========================================================
    function exportToCsv() {
        if (!state.logs || state.logs.length === 0) {
            showToast("No logs available to export.", "warning");
            return;
        }

        const headers = ["Log ID", "Timestamp", "Actor Name", "Actor Role", "Actor Email", "Action", "Description", "IP Address"];
        const rows = state.logs.map(log => [
            log.log_id,
            `"${(log.formatted_time || log.created_at || '').replace(/"/g, '""')}"`,
            `"${(log.user_name || 'System').replace(/"/g, '""')}"`,
            `"${(log.user_role || 'system').replace(/"/g, '""')}"`,
            `"${(log.user_email || '').replace(/"/g, '""')}"`,
            `"${(log.action || '').replace(/"/g, '""')}"`,
            `"${(log.description || '').replace(/"/g, '""')}"`,
            `"${(log.ip_address || '').replace(/"/g, '""')}"`
        ]);

        const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\r\n");
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        const today = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `ridenow_system_logs_${today}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast(`Exported ${state.logs.length} logs to CSV file successfully!`, "success");
    }

    // ========================================================
    // 3. EVENT LISTENERS
    // ========================================================
    function setupEventListeners() {
        if (el.refreshBtn) {
            el.refreshBtn.addEventListener("click", loadLogs);
        }

        if (el.exportCsvBtn) {
            el.exportCsvBtn.addEventListener("click", exportToCsv);
        }

        // Search debounce
        if (el.searchInput) {
            let debounceTimer;
            el.searchInput.addEventListener("input", () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    state.filters.search = el.searchInput.value.trim();
                    state.pagination.page = 1;
                    loadLogs();
                }, 300);
            });
        }

        // Action filter
        if (el.actionFilter) {
            el.actionFilter.addEventListener("change", () => {
                state.filters.action = el.actionFilter.value;
                state.pagination.page = 1;
                loadLogs();
            });
        }

        // Admin/Actor filter
        if (el.adminFilter) {
            el.adminFilter.addEventListener("change", () => {
                state.filters.adminId = el.adminFilter.value;
                state.pagination.page = 1;
                loadLogs();
            });
        }

        // Apply filters button
        if (el.applyFiltersBtn) {
            el.applyFiltersBtn.addEventListener("click", () => {
                if (el.dateFrom) state.filters.dateFrom = el.dateFrom.value;
                if (el.dateTo) state.filters.dateTo = el.dateTo.value;
                state.pagination.page = 1;
                loadLogs();
            });
        }

        // Reset filters button
        if (el.resetFiltersBtn) {
            el.resetFiltersBtn.addEventListener("click", () => {
                state.filters.search = "";
                state.filters.action = "all";
                state.filters.adminId = "all";
                state.filters.dateFrom = "";
                state.filters.dateTo = "";
                state.pagination.page = 1;

                if (el.searchInput) el.searchInput.value = "";
                if (el.actionFilter) el.actionFilter.value = "all";
                if (el.adminFilter) el.adminFilter.value = "all";
                if (el.dateFrom) el.dateFrom.value = "";
                if (el.dateTo) el.dateTo.value = "";

                loadLogs();
            });
        }

        // Page size dropdown
        if (el.limitSelect) {
            el.limitSelect.addEventListener("change", () => {
                state.pagination.limit = parseInt(el.limitSelect.value, 10) || 25;
                state.pagination.page = 1;
                loadLogs();
            });
        }

        // Pagination buttons
        if (el.prevPageBtn) {
            el.prevPageBtn.addEventListener("click", () => {
                if (state.pagination.page > 1) {
                    state.pagination.page--;
                    loadLogs();
                }
            });
        }

        if (el.nextPageBtn) {
            el.nextPageBtn.addEventListener("click", () => {
                if (state.pagination.page < state.pagination.totalPages) {
                    state.pagination.page++;
                    loadLogs();
                }
            });
        }

        // Logout
        if (el.logoutBtn) {
            el.logoutBtn.addEventListener("click", async (e) => {
                e.preventDefault();
                try {
                    await fetch(`${API_BASE}/api/auth/logout`, { method: "POST" });
                } catch (err) {
                    console.warn("Logout error:", err);
                }
                localStorage.removeItem("ridenow_user");
                window.location.href = "../customer/login.html";
            });
        }
    }

    // Initialize
    checkAdminSession();
    setupEventListeners();
    loadLogs();

})();

