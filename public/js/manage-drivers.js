// RideNow Admin - Manage Drivers (Vanilla JS + DOM + Fetch)

(function () {
    "use strict";

    // Determine backend API origin
    const API_BASE = window.location.origin.includes("3000")
        ? window.location.origin
        : "http://localhost:3000";

    // Component state
    const state = {
        page: 1,
        limit: 10,
        search: "",
        status: "all",
        totalPages: 1,
        totalRecords: 0,
        isLoading: false,
        summary: {
            total: 0,
            approved: 0,
            pending: 0,
            rejected: 0,
            blocked: 0
        }
    };

    // DOM Elements Cache
    const el = {
        driversList: document.getElementById("driversList"),
        searchInput: document.getElementById("searchInput"),
        statusFilter: document.getElementById("statusFilter"),
        limitFilter: document.getElementById("limitFilter"),
        resetFiltersBtn: document.getElementById("resetFiltersBtn"),
        refreshBtn: document.getElementById("refreshBtn"),
        paginationBar: document.getElementById("paginationBar"),
        paginationInfo: document.getElementById("paginationInfo"),
        paginationControls: document.getElementById("paginationControls"),
        statTotalDrivers: document.getElementById("statTotalDrivers"),
        statApprovedDrivers: document.getElementById("statApprovedDrivers"),
        statPendingDrivers: document.getElementById("statPendingDrivers"),
        statBlockedDrivers: document.getElementById("statBlockedDrivers"),
        sidebarPendingBadge: document.getElementById("sidebarPendingBadge"),
        driversSubtitle: document.getElementById("driversSubtitle"),
        adminUserName: document.getElementById("adminUserName"),
        adminUserAvatar: document.getElementById("adminUserAvatar"),
        logoutBtn: document.getElementById("logoutBtn"),
        toastContainer: document.getElementById("toastContainer")
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

    // HTML sanitizer
    function escapeHtml(str) {
        if (str === null || str === undefined) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Get Status Badge HTML
    function getStatusBadge(status) {
        const s = (status || "").toLowerCase();
        let badgeClass = "badge-info";
        let label = "Pending";

        switch (s) {
            case "approved":
                badgeClass = "badge-success";
                label = "Approved";
                break;
            case "pending":
                badgeClass = "badge-warning";
                label = "Pending";
                break;
            case "rejected":
                badgeClass = "badge-danger";
                label = "Rejected";
                break;
            case "blocked":
            case "suspended":
                badgeClass = "badge-danger";
                label = "Blocked";
                break;
            default:
                badgeClass = "badge-info";
                label = status ? status.charAt(0).toUpperCase() + status.slice(1) : "Unknown";
        }

        return `<span class="badge-pill ${badgeClass}">${label}</span>`;
    }

    // Generate Action Buttons based on current driver status
    function getActionButtonsHtml(driver) {
        const s = (driver.status || "").toLowerCase();
        const driverId = driver.driver_id;
        const name = escapeHtml(driver.name);

        let buttons = "";

        if (s === "pending") {
            // Pending: Approve or Reject
            buttons = `
                <div class="table-actions" style="justify-content: center;">
                    <button 
                        type="button" 
                        class="btn-table-action btn-approve btn-action-toggle" 
                        data-driver-id="${driverId}" 
                        data-action="approve" 
                        data-name="${name}"
                        title="Approve driver application"
                    >
                        Approve
                    </button>
                    <button 
                        type="button" 
                        class="btn-table-action btn-reject btn-action-toggle" 
                        data-driver-id="${driverId}" 
                        data-action="reject" 
                        data-name="${name}"
                        title="Reject driver application"
                    >
                        Reject
                    </button>
                </div>
            `;
        } else if (s === "approved") {
            // Approved: Block
            buttons = `
                <div class="table-actions" style="justify-content: center;">
                    <button 
                        type="button" 
                        class="btn-table-action btn-block btn-action-toggle" 
                        data-driver-id="${driverId}" 
                        data-action="block" 
                        data-name="${name}"
                        title="Block and suspend driver"
                    >
                        Block
                    </button>
                </div>
            `;
        } else if (s === "blocked" || s === "suspended") {
            // Blocked: Unblock
            buttons = `
                <div class="table-actions" style="justify-content: center;">
                    <button 
                        type="button" 
                        class="btn-table-action btn-unblock btn-action-toggle" 
                        data-driver-id="${driverId}" 
                        data-action="unblock" 
                        data-name="${name}"
                        title="Unblock driver and restore active status"
                    >
                        Unblock
                    </button>
                </div>
            `;
        } else if (s === "rejected") {
            // Rejected: Re-Approve
            buttons = `
                <div class="table-actions" style="justify-content: center;">
                    <button 
                        type="button" 
                        class="btn-table-action btn-approve btn-action-toggle" 
                        data-driver-id="${driverId}" 
                        data-action="approve" 
                        data-name="${name}"
                        title="Re-approve driver application"
                    >
                        Re-Approve
                    </button>
                </div>
            `;
        }

        return buttons;
    }

    // Update KPI Metric Cards
    function updateSummaryMetrics(summary) {
        if (!summary) return;
        state.summary = { ...summary };

        if (el.statTotalDrivers) {
            el.statTotalDrivers.textContent = (summary.total || 0).toLocaleString();
        }
        if (el.statApprovedDrivers) {
            el.statApprovedDrivers.textContent = (summary.approved || 0).toLocaleString();
        }
        if (el.statPendingDrivers) {
            el.statPendingDrivers.textContent = (summary.pending || 0).toLocaleString();
        }
        if (el.statBlockedDrivers) {
            el.statBlockedDrivers.textContent = (summary.blocked || 0).toLocaleString();
        }

        // Update sidebar pending badge
        if (el.sidebarPendingBadge) {
            const pendingCount = summary.pending || 0;
            el.sidebarPendingBadge.textContent = pendingCount;
            el.sidebarPendingBadge.style.display = pendingCount > 0 ? "inline-block" : "none";
        }
    }

    // Render Driver Row HTML
    function createDriverRow(driver) {
        const tr = document.createElement("tr");
        tr.id = `driver-row-${driver.driver_id}`;
        tr.dataset.driverId = driver.driver_id;
        tr.dataset.status = driver.status;

        // License status indicator
        const isExpired = Boolean(driver.is_license_expired);
        const expiryBadge = isExpired
            ? `<span class="badge-pill badge-danger" style="font-size: 10px;">Expired</span>`
            : `<span class="badge-pill badge-success" style="font-size: 10px;">Valid</span>`;

        // Vehicle info cell
        let vehicleHtml = "";
        if (driver.vehicle_number) {
            const vStatus = driver.vehicle_status === "active"
                ? `<span class="badge-pill badge-success" style="font-size: 10px;">Active</span>`
                : `<span class="badge-pill badge-warning" style="font-size: 10px;">Inactive</span>`;

            vehicleHtml = `
                <div class="vehicle-info-cell">
                    <div>
                        <span class="vehicle-plate">${escapeHtml(driver.vehicle_number)}</span>
                        ${vStatus}
                    </div>
                    <span class="vehicle-details-sub">
                        ${escapeHtml(driver.model)} (${escapeHtml(driver.vehicle_type || 'Cab')}) • ${driver.capacity || 4} seats
                    </span>
                </div>
            `;
        } else {
            vehicleHtml = `<span style="color: var(--text-muted); font-size: 12px;">No vehicle assigned</span>`;
        }

        // Rating & Trips
        const rating = (driver.rating || 5.0).toFixed(1);
        const tripsCount = driver.total_trips || 0;

        tr.innerHTML = `
            <td>
                <div class="driver-info-cell">
                    <span class="driver-name">${escapeHtml(driver.name)} <strong style="color: var(--text-secondary); font-size: 11px;">#${driver.driver_id}</strong></span>
                    <span class="driver-sub">${escapeHtml(driver.email)}</span>
                    <span class="driver-sub">📞 ${escapeHtml(driver.phone || 'N/A')}</span>
                </div>
            </td>
            <td>
                <div class="license-box">
                    <span class="license-num">${escapeHtml(driver.license_no)}</span>
                    <div class="expiry-tag">
                        <span style="color: var(--text-secondary);">Exp: ${escapeHtml(driver.formatted_license_expiry || driver.license_expiry)}</span>
                        ${expiryBadge}
                    </div>
                </div>
            </td>
            <td class="vehicle-cell">
                ${vehicleHtml}
            </td>
            <td>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <span class="rating-badge">★ ${rating}</span>
                    <small style="color: var(--text-muted); font-size: 11px;">${tripsCount} ${tripsCount === 1 ? 'trip' : 'trips'}</small>
                </div>
            </td>
            <td class="status-cell">
                ${getStatusBadge(driver.status)}
            </td>
            <td class="action-cell" style="text-align: center;">
                ${getActionButtonsHtml(driver)}
            </td>
        `;

        return tr;
    }

    // Render Pagination Controls
    function renderPagination(pagination) {
        if (!el.paginationControls || !el.paginationInfo) return;

        const total = pagination.total || 0;
        const page = pagination.page || 1;
        const limit = pagination.limit || 10;
        const totalPages = pagination.totalPages || 1;

        state.totalPages = totalPages;
        state.totalRecords = total;

        if (total === 0) {
            el.paginationInfo.textContent = "Showing 0 drivers";
            el.paginationControls.innerHTML = "";
            return;
        }

        const startIdx = (page - 1) * limit + 1;
        const endIdx = Math.min(page * limit, total);
        el.paginationInfo.textContent = `Showing ${startIdx} to ${endIdx} of ${total} driver partner${total === 1 ? '' : 's'}`;

        let html = "";

        // Prev Button
        html += `
            <button 
                type="button" 
                class="pagination-btn" 
                data-page="${page - 1}" 
                ${page <= 1 ? "disabled" : ""}
                aria-label="Previous page"
            >
                ← Prev
            </button>
        `;

        // Page Numbers
        for (let p = 1; p <= totalPages; p++) {
            if (p === 1 || p === totalPages || (p >= page - 1 && p <= page + 1)) {
                html += `
                    <button 
                        type="button" 
                        class="pagination-btn ${p === page ? 'active' : ''}" 
                        data-page="${p}"
                        aria-label="Page ${p}"
                        ${p === page ? 'aria-current="page"' : ''}
                    >
                        ${p}
                    </button>
                `;
            } else if (p === page - 2 || p === page + 2) {
                html += `<span style="padding: 0 4px; color: var(--text-muted);">&hellip;</span>`;
            }
        }

        // Next Button
        html += `
            <button 
                type="button" 
                class="pagination-btn" 
                data-page="${page + 1}" 
                ${page >= totalPages ? "disabled" : ""}
                aria-label="Next page"
            >
                Next →
            </button>
        `;

        el.paginationControls.innerHTML = html;
    }

    // Load Drivers via Fetch
    async function loadDrivers() {
        if (state.isLoading) return;
        state.isLoading = true;

        if (el.refreshBtn) {
            el.refreshBtn.disabled = true;
            el.refreshBtn.innerHTML = `<span class="loading-spinner"></span> Loading...`;
        }

        el.driversList.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    <span class="loading-spinner"></span> Loading driver partners from database...
                </td>
            </tr>
        `;

        const queryParams = new URLSearchParams({
            page: state.page,
            limit: state.limit,
            status: state.status,
            search: state.search
        });

        try {
            const response = await fetch(`${API_BASE}/api/admin/drivers?${queryParams.toString()}`, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.message || "Failed to load driver list");
            }

            // Update KPI metric summaries
            if (data.summary) {
                updateSummaryMetrics(data.summary);
            }

            const drivers = data.drivers || [];

            // Update subtitle
            if (el.driversSubtitle) {
                if (state.search || state.status !== "all") {
                    el.driversSubtitle.textContent = `Found ${data.pagination.total} matching driver partner(s).`;
                } else {
                    el.driversSubtitle.textContent = `Total of ${data.pagination.total} registered driver accounts.`;
                }
            }

            // Empty state handling
            if (drivers.length === 0) {
                el.driversList.innerHTML = `
                    <tr>
                        <td colspan="6" class="empty-state">
                            <div style="font-size: 28px; margin-bottom: 8px;">🚖</div>
                            <strong>No driver partners found</strong>
                            <p style="margin-top: 4px; color: var(--text-muted); font-size: 12px;">
                                ${state.search || state.status !== "all" 
                                    ? "No drivers match your search/filter criteria. Try resetting filters." 
                                    : "No driver accounts registered yet."}
                            </p>
                        </td>
                    </tr>
                `;
                renderPagination({ total: 0, page: 1, limit: state.limit, totalPages: 1 });
                return;
            }

            // Render table rows
            el.driversList.innerHTML = "";
            const fragment = document.createDocumentFragment();
            drivers.forEach(d => {
                fragment.appendChild(createDriverRow(d));
            });
            el.driversList.appendChild(fragment);

            // Render pagination
            if (data.pagination) {
                renderPagination(data.pagination);
            }

        } catch (err) {
            console.error("Error fetching drivers:", err);
            el.driversList.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-state" style="color: var(--status-danger);">
                        <div style="font-size: 24px; margin-bottom: 6px;">⚠️</div>
                        <strong>Failed to load driver partners</strong>
                        <p style="margin-top: 4px; font-size: 12px; color: var(--text-secondary);">${escapeHtml(err.message)}</p>
                        <button type="button" class="btn-secondary" style="margin-top: 12px;" onclick="window.RideNowDrivers.reload()">Try Again</button>
                    </td>
                </tr>
            `;
            showToast(`Error: ${err.message}`, "danger");
        } finally {
            state.isLoading = false;
            if (el.refreshBtn) {
                el.refreshBtn.disabled = false;
                el.refreshBtn.innerHTML = `<span>🔄</span> Refresh Data`;
            }
        }
    }

    // Execute Driver Action (Approve, Reject, Block, Unblock) via Fetch and Update Row DOM
    async function executeDriverAction(driverId, action, driverName, buttonElement) {
        const row = document.getElementById(`driver-row-${driverId}`);
        if (!row) {
            console.warn(`Row driver-row-${driverId} not found in DOM`);
            return;
        }

        const originalBtnText = buttonElement.textContent;
        buttonElement.disabled = true;
        buttonElement.innerHTML = `<span class="loading-spinner"></span>`;

        try {
            // Reuses the backend operation at /api/admin/drivers/:id/:action
            const response = await fetch(`${API_BASE}/api/admin/drivers/${driverId}/${action}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                }
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.message || `Failed to perform ${action} on driver`);
            }

            const newStatus = data.status;
            const prevStatus = data.previous_status;

            // Granular Row DOM Manipulation:
            row.dataset.status = newStatus;

            // 1. Refresh Status Badge cell
            const statusCell = row.querySelector(".status-cell");
            if (statusCell) {
                statusCell.innerHTML = getStatusBadge(newStatus);
            }

            // 2. Refresh Action Cell with updated buttons
            const actionCell = row.querySelector(".action-cell");
            if (actionCell) {
                actionCell.innerHTML = getActionButtonsHtml({
                    driver_id: driverId,
                    name: driverName,
                    status: newStatus
                });
            }

            // 3. Refresh Linked Vehicle badge if vehicle cell present
            const vehicleCell = row.querySelector(".vehicle-cell");
            if (vehicleCell) {
                const vehicleBadge = vehicleCell.querySelector(".badge-pill");
                if (vehicleBadge) {
                    if (newStatus === "approved") {
                        vehicleBadge.className = "badge-pill badge-success";
                        vehicleBadge.textContent = "Active";
                    } else {
                        vehicleBadge.className = "badge-pill badge-warning";
                        vehicleBadge.textContent = "Inactive";
                    }
                }
            }

            // 4. Trigger Row Flash Highlight Animation
            row.classList.remove("row-updated-active", "row-updated-blocked");
            void row.offsetWidth; // Force CSS reflow
            if (newStatus === "approved") {
                row.classList.add("row-updated-active");
            } else if (newStatus === "blocked" || newStatus === "rejected") {
                row.classList.add("row-updated-blocked");
            }

            // 5. Update KPI Summary Counters without full re-fetch
            if (prevStatus && state.summary[prevStatus] !== undefined) {
                state.summary[prevStatus] = Math.max(0, state.summary[prevStatus] - 1);
            }
            if (state.summary[newStatus] !== undefined) {
                state.summary[newStatus] += 1;
            }
            updateSummaryMetrics(state.summary);

            // 6. User Feedback via Toast
            showToast(data.message || `Driver ${driverName} has been ${newStatus}.`, "success");

        } catch (err) {
            console.error(`Error performing ${action} on driver ${driverId}:`, err);
            buttonElement.disabled = false;
            buttonElement.textContent = originalBtnText;
            showToast(`Operation failed: ${err.message}`, "danger");
        }
    }

    // Check user admin session from localStorage
    function checkAdminSession() {
        try {
            const storedUser = localStorage.getItem("ridenow_user");
            if (storedUser) {
                const user = JSON.parse(storedUser);
                if (el.adminUserName && user.name) {
                    el.adminUserName.textContent = `${user.name} (${user.role ? user.role.toUpperCase() : "Admin"})`;
                }
                if (el.adminUserAvatar && user.name) {
                    const initials = user.name
                        .split(" ")
                        .map(n => n[0])
                        .join("")
                        .substring(0, 2)
                        .toUpperCase();
                    el.adminUserAvatar.textContent = initials || "AD";
                }
            }
        } catch (e) {
            // Ignore parse errors
        }
    }

    // Attach Event Listeners
    function setupEventListeners() {
        // Table Action Click Delegation (Approve, Reject, Block, Unblock)
        el.driversList.addEventListener("click", function (e) {
            const btn = e.target.closest(".btn-action-toggle");
            if (!btn || btn.disabled) return;

            const driverId = btn.dataset.driverId;
            const action = btn.dataset.action;
            const driverName = btn.dataset.name || "Driver";

            if (!driverId || !action) return;

            // Confirm destructive actions
            if (action === "block") {
                const confirmMsg = `Are you sure you want to BLOCK driver ${driverName}?\n\nThey will be suspended from accepting rides and their vehicle will be deactivated.`;
                if (!window.confirm(confirmMsg)) return;
            } else if (action === "reject") {
                const confirmMsg = `Are you sure you want to REJECT driver ${driverName}'s application?`;
                if (!window.confirm(confirmMsg)) return;
            }

            executeDriverAction(driverId, action, driverName, btn);
        });

        // Search Input (Debounced)
        let searchDebounceTimer = null;
        el.searchInput.addEventListener("input", function (e) {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                state.search = e.target.value.trim();
                state.page = 1;
                loadDrivers();
            }, 300);
        });

        // Search Input 'Enter' or clear
        el.searchInput.addEventListener("search", function (e) {
            state.search = e.target.value.trim();
            state.page = 1;
            loadDrivers();
        });

        // Status Filter Dropdown
        el.statusFilter.addEventListener("change", function (e) {
            state.status = e.target.value;
            state.page = 1;
            loadDrivers();
        });

        // Items Per Page Limit Selector
        el.limitFilter.addEventListener("change", function (e) {
            state.limit = parseInt(e.target.value, 10) || 10;
            state.page = 1;
            loadDrivers();
        });

        // Reset Filters Button
        el.resetFiltersBtn.addEventListener("click", function () {
            state.search = "";
            state.status = "all";
            state.page = 1;
            el.searchInput.value = "";
            el.statusFilter.value = "all";
            loadDrivers();
        });

        // Refresh Data Button
        el.refreshBtn.addEventListener("click", function () {
            loadDrivers();
        });

        // Pagination Controls Click Delegation
        el.paginationControls.addEventListener("click", function (e) {
            const btn = e.target.closest(".pagination-btn");
            if (!btn || btn.disabled || btn.classList.contains("active")) return;

            const targetPage = parseInt(btn.dataset.page, 10);
            if (targetPage && targetPage >= 1 && targetPage <= state.totalPages) {
                state.page = targetPage;
                loadDrivers();
                const tableCard = document.querySelector(".card");
                if (tableCard) {
                    tableCard.scrollIntoView({ behavior: "smooth", block: "start" });
                }
            }
        });

        // Logout Button
        if (el.logoutBtn) {
            el.logoutBtn.addEventListener("click", function () {
                localStorage.removeItem("ridenow_user");
            });
        }
    }

    // Public API for debugging/reloading
    window.RideNowDrivers = {
        reload: loadDrivers,
        state: state
    };

    // Initialize Page
    document.addEventListener("DOMContentLoaded", function () {
        checkAdminSession();
        setupEventListeners();
        loadDrivers();
    });

})();

