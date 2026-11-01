// RideNow Super Admin Dashboard Engine (Vanilla JS + DOM + Fetch)

(function () {
    "use strict";

    const API_BASE = window.location.origin.includes("3000")
        ? window.location.origin
        : "http://localhost:3000";

    const state = {
        stats: null,
        logs: [],
        filteredLogs: [],
        logSearch: "",
        actionFilter: "all",
        isLoading: false
    };

    // DOM Elements Cache
    const el = {
        superAdminName: document.getElementById("superAdminName"),
        superAdminAvatar: document.getElementById("superAdminAvatar"),
        logoutBtn: document.getElementById("logoutBtn"),
        refreshBtn: document.getElementById("refreshBtn"),
        refreshLogsBtn: document.getElementById("refreshLogsBtn"),
        toastContainer: document.getElementById("toastContainer"),

        // KPIs
        statGrossRevenue: document.getElementById("statGrossRevenue"),
        statNetRevenueBadge: document.getElementById("statNetRevenueBadge"),
        statCancelRevenueMeta: document.getElementById("statCancelRevenueMeta"),
        statTotalUsers: document.getElementById("statTotalUsers"),
        statActiveUsersBadge: document.getElementById("statActiveUsersBadge"),
        statPassengersDriversMeta: document.getElementById("statPassengersDriversMeta"),
        statApprovedDrivers: document.getElementById("statApprovedDrivers"),
        statPendingDriversBadge: document.getElementById("statPendingDriversBadge"),
        statActiveVehiclesMeta: document.getElementById("statActiveVehiclesMeta"),
        statTotalTrips: document.getElementById("statTotalTrips"),
        statCompletedTripsBadge: document.getElementById("statCompletedTripsBadge"),
        statCancelledTripsMeta: document.getElementById("statCancelledTripsMeta"),
        statTotalAdmins: document.getElementById("statTotalAdmins"),
        statSuperAdminsBadge: document.getElementById("statSuperAdminsBadge"),
        statStandardAdminsMeta: document.getElementById("statStandardAdminsMeta"),
        statUptime: document.getElementById("statUptime"),
        statMemoryBadge: document.getElementById("statMemoryBadge"),
        statActiveSessionsMeta: document.getElementById("statActiveSessionsMeta"),

        // Alerts
        systemAlertsContainer: document.getElementById("systemAlertsContainer"),
        alertsCountBadge: document.getElementById("alertsCountBadge"),

        // Logs
        logSearchInput: document.getElementById("logSearchInput"),
        actionFilter: document.getElementById("actionFilter"),
        resetLogFiltersBtn: document.getElementById("resetLogFiltersBtn"),
        logResultsCount: document.getElementById("logResultsCount"),
        logsTableBody: document.getElementById("logsTableBody")
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

    function formatCurrency(val) {
        return new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency: "INR",
            maximumFractionDigits: 2
        }).format(val || 0);
    }

    function formatUptime(seconds) {
        const d = Math.floor(seconds / 86400);
        const h = Math.floor((seconds % 86400) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        if (d > 0) return `${d}d ${h}h ${m}m`;
        return `${h}h ${m}m`;
    }

    function checkSuperAdminSession() {
        try {
            const storedUser = localStorage.getItem("ridenow_user");
            if (storedUser) {
                const user = JSON.parse(storedUser);
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
            console.error("Session check error:", e);
        }
    }

    // ========================================================
    // 1. FETCH & POPULATE SYSTEM-WIDE STATISTICS
    // ========================================================
    async function loadDashboardStats() {
        state.isLoading = true;
        if (el.refreshBtn) {
            el.refreshBtn.disabled = true;
            el.refreshBtn.textContent = "Loading...";
        }

        try {
            const res = await fetch(`${API_BASE}/api/superadmin/dashboard/stats`, {
                headers: { "Content-Type": "application/json" }
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.message || "Failed to load superadmin stats");
            }

            state.stats = data;
            renderKpis(data);
            renderAlerts(data.alerts || []);
            state.logs = data.recent_logs || [];
            filterAndRenderLogs();
        } catch (err) {
            console.error("Superadmin dashboard error:", err);
            showToast("Failed to load dashboard data: " + err.message, "danger");
        } finally {
            state.isLoading = false;
            if (el.refreshBtn) {
                el.refreshBtn.disabled = false;
                el.refreshBtn.textContent = "🔄 Refresh";
            }
        }
    }

    function renderKpis(data) {
        const u = data.system_overview || {};
        const d = data.driver_metrics || {};
        const f = data.fleet_metrics || {};
        const t = data.trips_metrics || {};
        const r = data.system_runtime || {};

        // Revenue
        el.statGrossRevenue.textContent = formatCurrency(t.gross_revenue || 0);
        el.statNetRevenueBadge.textContent = `Net: ${formatCurrency(t.net_revenue || 0)}`;
        el.statCancelRevenueMeta.textContent = `${formatCurrency(t.cancellation_revenue || 0)} cancel fees`;

        // Users
        el.statTotalUsers.textContent = u.total_users || 0;
        el.statActiveUsersBadge.textContent = `${u.active_users || 0} Active`;
        el.statPassengersDriversMeta.textContent = `${u.passengers || 0} passengers, ${u.drivers || 0} drivers`;

        // Fleet & Drivers
        el.statApprovedDrivers.textContent = `${d.approved || 0} Drivers`;
        el.statPendingDriversBadge.textContent = `${d.pending || 0} Pending Verification`;
        el.statActiveVehiclesMeta.textContent = `${f.active || 0} active fleet units (${f.maintenance || 0} maintenance)`;

        // Trips
        el.statTotalTrips.textContent = t.total_trips || 0;
        el.statCompletedTripsBadge.textContent = `${t.completed || 0} Completed (${t.cancellation_rate || 0}% cancel)`;
        el.statCancelledTripsMeta.textContent = `${t.cancelled || 0} cancelled, ${t.active || 0} active`;

        // Administrators
        const totalAdmins = (u.admins || 0) + (u.super_admins || 0);
        el.statTotalAdmins.textContent = `${totalAdmins} Admin Staff`;
        el.statSuperAdminsBadge.textContent = `${u.super_admins || 0} Super Admins`;
        el.statStandardAdminsMeta.textContent = `${u.admins || 0} standard operational admins`;

        // Runtime
        el.statUptime.textContent = `Uptime: ${formatUptime(r.uptime_seconds || 0)}`;
        el.statMemoryBadge.textContent = `RAM: ${r.memory_rss_mb || 0} MB`;
        el.statActiveSessionsMeta.textContent = `${r.active_sessions || 0} active sessions (${r.node_version || "Node"})`;
    }

    // ========================================================
    // 2. RENDER SYSTEM ALERTS
    // ========================================================
    function renderAlerts(alerts) {
        const container = el.systemAlertsContainer;
        el.alertsCountBadge.textContent = `${alerts.length} Active Notice${alerts.length !== 1 ? 's' : ''}`;

        if (!alerts || alerts.length === 0) {
            container.innerHTML = `
                <div class="system-alert-item alert-success">
                    <span class="alert-icon">✅</span>
                    <div class="alert-content">
                        <div class="alert-title">All Systems Operating Normally</div>
                        <div class="alert-desc">Zero security anomalies or pending operational blockages detected.</div>
                    </div>
                </div>
            `;
            return;
        }

        const iconMap = {
            danger: "🚨",
            warning: "⚠️",
            info: "ℹ️",
            success: "✅"
        };

        container.innerHTML = alerts.map(a => {
            const icon = iconMap[a.level] || "ℹ️";
            return `
                <div class="system-alert-item alert-${a.level || 'info'}">
                    <span class="alert-icon">${icon}</span>
                    <div class="alert-content">
                        <div class="alert-title">
                            ${escapeHtml(a.title)}
                            ${a.count > 0 ? `<span class="badge-pill badge-${a.level || 'info'}" style="font-size: 10px;">${a.count}</span>` : ''}
                        </div>
                        <div class="alert-desc">${escapeHtml(a.description)}</div>
                    </div>
                </div>
            `;
        }).join("");
    }

    // ========================================================
    // 3. ADMINISTRATOR AUDIT TRAIL
    // ========================================================
    function filterAndRenderLogs() {
        const tbody = el.logsTableBody;
        const q = state.logSearch.toLowerCase().trim();
        const act = state.actionFilter;

        const filtered = state.logs.filter(log => {
            const matchesAction = act === "all" || log.action === act;
            const matchesSearch = !q ||
                (log.description && log.description.toLowerCase().includes(q)) ||
                (log.action && log.action.toLowerCase().includes(q)) ||
                (log.user_name && log.user_name.toLowerCase().includes(q)) ||
                (log.ip_address && log.ip_address.includes(q));
            return matchesAction && matchesSearch;
        });

        el.logResultsCount.textContent = `Showing ${filtered.length} of ${state.logs.length} audit entries`;

        if (filtered.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="empty-state-cell">
                        No activity records found matching filter criteria.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = filtered.map(log => {
            let actionBadgeClass = "badge-info";
            const a = (log.action || "").toUpperCase();
            if (a.includes("DELETE") || a.includes("REJECT") || a.includes("SUSPEND")) actionBadgeClass = "badge-danger";
            else if (a.includes("CREATE") || a.includes("APPROVE") || a.includes("COMPLETE")) actionBadgeClass = "badge-success";
            else if (a.includes("UPDATE") || a.includes("CHANGE")) actionBadgeClass = "badge-warning";

            const roleBadge = log.user_role === "super_admin"
                ? `<span class="badge-pill badge-super-admin" style="font-size: 10px; margin-left: 4px;">Super Admin</span>`
                : (log.user_role === "admin" ? `<span class="badge-pill badge-admin" style="font-size: 10px; margin-left: 4px;">Admin</span>` : '');

            return `
                <tr>
                    <td style="white-space: nowrap; font-size: 12px; color: var(--text-secondary);">
                        ${escapeHtml(log.formatted_time || log.created_at)}
                    </td>
                    <td>
                        <div style="font-weight: 650; color: var(--text-primary); font-size: 13px;">
                            ${escapeHtml(log.user_name)}
                            ${roleBadge}
                        </div>
                        <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(log.user_email)}</div>
                    </td>
                    <td>
                        <span class="badge-pill ${actionBadgeClass}" style="font-family: monospace; font-size: 11px;">
                            ${escapeHtml(log.action)}
                        </span>
                    </td>
                    <td style="font-size: 13px; color: var(--text-primary); max-width: 380px;">
                        ${escapeHtml(log.description)}
                    </td>
                    <td style="font-family: monospace; font-size: 11px; color: var(--text-muted);">
                        ${escapeHtml(log.ip_address || "127.0.0.1")}
                    </td>
                </tr>
            `;
        }).join("");
    }

    // ========================================================
    // 4. EVENT LISTENERS
    // ========================================================
    function setupEventListeners() {
        el.refreshBtn.addEventListener("click", () => {
            loadDashboardStats();
            showToast("Super Admin control center refreshed", "info");
        });

        if (el.refreshLogsBtn) {
            el.refreshLogsBtn.addEventListener("click", () => {
                loadDashboardStats();
                showToast("Audit logs updated", "info");
            });
        }

        let debounce = null;
        el.logSearchInput.addEventListener("input", (e) => {
            clearTimeout(debounce);
            debounce = setTimeout(() => {
                state.logSearch = e.target.value;
                filterAndRenderLogs();
            }, 200);
        });

        el.actionFilter.addEventListener("change", (e) => {
            state.actionFilter = e.target.value;
            filterAndRenderLogs();
        });

        el.resetLogFiltersBtn.addEventListener("click", () => {
            state.logSearch = "";
            state.actionFilter = "all";
            el.logSearchInput.value = "";
            el.actionFilter.value = "all";
            filterAndRenderLogs();
        });

        if (el.logoutBtn) {
            el.logoutBtn.addEventListener("click", () => {
                localStorage.removeItem("ridenow_user");
            });
        }
    }

    // Initialize
    document.addEventListener("DOMContentLoaded", () => {
        checkSuperAdminSession();
        setupEventListeners();
        loadDashboardStats();
    });

    window.RideNowSuperAdmin = {
        reload: loadDashboardStats
    };

})();

