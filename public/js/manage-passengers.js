// RideNow Admin - Manage Passengers (Vanilla JS + DOM + Fetch)

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
            active: 0,
            blocked: 0
        }
    };

    // DOM Elements Cache
    const el = {
        passengersList: document.getElementById("passengersList"),
        searchInput: document.getElementById("searchInput"),
        statusFilter: document.getElementById("statusFilter"),
        limitFilter: document.getElementById("limitFilter"),
        resetFiltersBtn: document.getElementById("resetFiltersBtn"),
        refreshBtn: document.getElementById("refreshBtn"),
        paginationBar: document.getElementById("paginationBar"),
        paginationInfo: document.getElementById("paginationInfo"),
        paginationControls: document.getElementById("paginationControls"),
        statTotalPassengers: document.getElementById("statTotalPassengers"),
        statActivePassengers: document.getElementById("statActivePassengers"),
        statBlockedPassengers: document.getElementById("statBlockedPassengers"),
        passengersSubtitle: document.getElementById("passengersSubtitle"),
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

    // HTML sanitizer to prevent XSS
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
            case "active":
                badgeClass = "badge-success";
                label = "Active";
                break;
            case "blocked":
                badgeClass = "badge-danger";
                label = "Blocked";
                break;
            case "inactive":
                badgeClass = "badge-warning";
                label = "Inactive";
                break;
            default:
                badgeClass = "badge-info";
                label = status ? status.charAt(0).toUpperCase() + status.slice(1) : "Pending";
        }

        return `<span class="badge-pill ${badgeClass}">${label}</span>`;
    }

    // Generate Action Button HTML
    function getActionButtonHtml(passenger) {
        const isBlocked = passenger.status === "blocked";
        const btnClass = isBlocked ? "btn-unblock" : "btn-block";
        const btnText = isBlocked ? "Unblock" : "Block";
        const targetStatus = isBlocked ? "active" : "blocked";

        return `
            <button 
                type="button" 
                class="btn-table-action btn-status-toggle ${btnClass}"
                data-user-id="${passenger.user_id}"
                data-name="${escapeHtml(passenger.name)}"
                data-target-status="${targetStatus}"
                title="${btnText} passenger ${escapeHtml(passenger.name)}"
            >
                ${btnText}
            </button>
        `;
    }

    // Update KPI Metric Cards
    function updateSummaryMetrics(summary) {
        if (!summary) return;
        state.summary = { ...summary };

        if (el.statTotalPassengers) {
            el.statTotalPassengers.textContent = (summary.total || 0).toLocaleString();
        }
        if (el.statActivePassengers) {
            el.statActivePassengers.textContent = (summary.active || 0).toLocaleString();
        }
        if (el.statBlockedPassengers) {
            el.statBlockedPassengers.textContent = (summary.blocked || 0).toLocaleString();
        }
    }

    // Render Passenger Row HTML
    function createPassengerRow(passenger) {
        const tr = document.createElement("tr");
        tr.id = `passenger-row-${passenger.user_id}`;
        tr.dataset.userId = passenger.user_id;
        tr.dataset.status = passenger.status;

        const regDate = passenger.formatted_created_at || (passenger.created_at ? new Date(passenger.created_at).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric"
        }) : "N/A");

        const tripBadge = passenger.total_trips > 0
            ? `<span class="badge-pill badge-info" style="font-size: 10px; margin-left: 6px;">${passenger.total_trips} ${passenger.total_trips === 1 ? 'trip' : 'trips'}</span>`
            : "";

        tr.innerHTML = `
            <td><strong style="color: var(--text-secondary);">#${passenger.user_id}</strong></td>
            <td>
                <div style="font-weight: 600; color: var(--text-primary);">
                    ${escapeHtml(passenger.name)}
                    ${tripBadge}
                </div>
                ${passenger.default_address ? `<div class="passenger-sub-info">📍 ${escapeHtml(passenger.default_address)}</div>` : ''}
            </td>
            <td>
                <a href="mailto:${escapeHtml(passenger.email)}" style="color: var(--text-primary); text-decoration: none;">
                    ${escapeHtml(passenger.email)}
                </a>
            </td>
            <td>
                <span style="font-family: monospace; font-size: 13px;">${escapeHtml(passenger.phone || "N/A")}</span>
            </td>
            <td class="status-cell">
                ${getStatusBadge(passenger.status)}
            </td>
            <td>
                <span style="color: var(--text-secondary); font-size: 12px;">${regDate}</span>
            </td>
            <td class="action-cell" style="text-align: center;">
                ${getActionButtonHtml(passenger)}
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
            el.paginationInfo.textContent = "Showing 0 passengers";
            el.paginationControls.innerHTML = "";
            return;
        }

        const startIdx = (page - 1) * limit + 1;
        const endIdx = Math.min(page * limit, total);
        el.paginationInfo.textContent = `Showing ${startIdx} to ${endIdx} of ${total} passenger${total === 1 ? '' : 's'}`;

        let html = "";

        // Previous Button
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

        // Page Number Buttons
        for (let p = 1; p <= totalPages; p++) {
            // Display first, last, and window around current page
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

    // Load Passengers List via Fetch
    async function loadPassengers() {
        if (state.isLoading) return;
        state.isLoading = true;

        if (el.refreshBtn) {
            el.refreshBtn.disabled = true;
            el.refreshBtn.innerHTML = `<span class="loading-spinner"></span> Loading...`;
        }

        el.passengersList.innerHTML = `
            <tr>
                <td colspan="7" class="empty-state">
                    <span class="loading-spinner"></span> Loading passenger records from MySQL...
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
            const response = await fetch(`${API_BASE}/api/admin/passengers?${queryParams.toString()}`, {
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
                throw new Error(data.message || "Failed to load passenger list");
            }

            // Update KPI metric summaries
            if (data.summary) {
                updateSummaryMetrics(data.summary);
            }

            const passengers = data.passengers || [];

            // Update subtitle context
            if (el.passengersSubtitle) {
                if (state.search || state.status !== "all") {
                    el.passengersSubtitle.textContent = `Found ${data.pagination.total} matching passenger record(s).`;
                } else {
                    el.passengersSubtitle.textContent = `Total of ${data.pagination.total} registered passenger accounts.`;
                }
            }

            // Handle Empty State
            if (passengers.length === 0) {
                el.passengersList.innerHTML = `
                    <tr>
                        <td colspan="7" class="empty-state">
                            <div style="font-size: 28px; margin-bottom: 8px;">🔍</div>
                            <strong>No passengers found</strong>
                            <p style="margin-top: 4px; color: var(--text-muted); font-size: 12px;">
                                ${state.search || state.status !== "all" 
                                    ? "No accounts match your search/filter parameters. Try resetting your filters." 
                                    : "No passenger accounts registered yet."}
                            </p>
                        </td>
                    </tr>
                `;
                renderPagination({ total: 0, page: 1, limit: state.limit, totalPages: 1 });
                return;
            }

            // Render Rows via DOM Manipulation
            el.passengersList.innerHTML = "";
            const fragment = document.createDocumentFragment();
            passengers.forEach(p => {
                fragment.appendChild(createPassengerRow(p));
            });
            el.passengersList.appendChild(fragment);

            // Render Pagination
            if (data.pagination) {
                renderPagination(data.pagination);
            }

        } catch (err) {
            console.error("Error fetching passengers:", err);
            el.passengersList.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-state" style="color: var(--status-danger);">
                        <div style="font-size: 24px; margin-bottom: 6px;">⚠️</div>
                        <strong>Failed to fetch passenger records</strong>
                        <p style="margin-top: 4px; font-size: 12px; color: var(--text-secondary);">${escapeHtml(err.message)}</p>
                        <button type="button" class="btn-secondary" style="margin-top: 12px;" onclick="window.RideNowPassengers.reload()">Try Again</button>
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

    // Toggle Passenger Account Status (Block / Unblock) with Granular DOM Row Refresh
    async function updatePassengerStatus(userId, targetStatus, passengerName, buttonElement) {
        const row = document.getElementById(`passenger-row-${userId}`);
        if (!row) {
            console.warn(`Row passenger-row-${userId} not found in DOM`);
            return;
        }

        const originalBtnText = buttonElement.textContent;
        buttonElement.disabled = true;
        buttonElement.innerHTML = `<span class="loading-spinner"></span>`;

        try {
            const response = await fetch(`${API_BASE}/api/admin/passengers/${userId}/status`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                body: JSON.stringify({ status: targetStatus })
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.message || `Failed to update status to ${targetStatus}`);
            }

            const updatedPassenger = data.passenger;
            const newStatus = updatedPassenger.status;
            const prevStatus = updatedPassenger.previous_status;

            // Direct DOM Manipulation on the specific table row:
            row.dataset.status = newStatus;

            // 1. Refresh Status Badge cell
            const statusCell = row.querySelector(".status-cell");
            if (statusCell) {
                statusCell.innerHTML = getStatusBadge(newStatus);
            }

            // 2. Refresh Action Cell with updated button
            const actionCell = row.querySelector(".action-cell");
            if (actionCell) {
                actionCell.innerHTML = getActionButtonHtml(updatedPassenger);
            }

            // 3. Trigger Row Highlight Flash Animation
            row.classList.remove("row-updated-active", "row-updated-blocked");
            void row.offsetWidth; // Force CSS reflow to re-trigger animation
            if (newStatus === "active") {
                row.classList.add("row-updated-active");
            } else if (newStatus === "blocked") {
                row.classList.add("row-updated-blocked");
            }

            // 4. Incrementally update summary KPI counters without re-rendering everything
            if (prevStatus === "active" && newStatus === "blocked") {
                state.summary.active = Math.max(0, state.summary.active - 1);
                state.summary.blocked += 1;
            } else if (prevStatus === "blocked" && newStatus === "active") {
                state.summary.blocked = Math.max(0, state.summary.blocked - 1);
                state.summary.active += 1;
            }
            updateSummaryMetrics(state.summary);

            // 5. User Feedback via Toast
            const actionVerb = newStatus === "active" ? "unblocked and activated" : "blocked";
            showToast(`Passenger ${passengerName} has been ${actionVerb}. Recorded in system_logs.`, "success");

        } catch (err) {
            console.error("Error updating passenger status:", err);
            buttonElement.disabled = false;
            buttonElement.textContent = originalBtnText;
            showToast(`Failed to update status: ${err.message}`, "danger");
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
        // Table Action Click Delegation (Block / Unblock buttons)
        el.passengersList.addEventListener("click", function (e) {
            const btn = e.target.closest(".btn-status-toggle");
            if (!btn || btn.disabled) return;

            const userId = btn.dataset.userId;
            const targetStatus = btn.dataset.targetStatus;
            const passengerName = btn.dataset.name || "Passenger";

            if (!userId || !targetStatus) return;

            // Confirm blocking for safety
            if (targetStatus === "blocked") {
                const confirmMsg = `Are you sure you want to BLOCK ${passengerName}?\n\nThey will be prevented from logging in and requesting cab rides.`;
                if (!window.confirm(confirmMsg)) return;
            }

            updatePassengerStatus(userId, targetStatus, passengerName, btn);
        });

        // Search Input (Debounced)
        let searchDebounceTimer = null;
        el.searchInput.addEventListener("input", function (e) {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                state.search = e.target.value.trim();
                state.page = 1;
                loadPassengers();
            }, 300);
        });

        // Search Input 'Enter' or clear
        el.searchInput.addEventListener("search", function (e) {
            state.search = e.target.value.trim();
            state.page = 1;
            loadPassengers();
        });

        // Status Filter Dropdown
        el.statusFilter.addEventListener("change", function (e) {
            state.status = e.target.value;
            state.page = 1;
            loadPassengers();
        });

        // Items Per Page Limit Selector
        el.limitFilter.addEventListener("change", function (e) {
            state.limit = parseInt(e.target.value, 10) || 10;
            state.page = 1;
            loadPassengers();
        });

        // Reset Filters Button
        el.resetFiltersBtn.addEventListener("click", function () {
            state.search = "";
            state.status = "all";
            state.page = 1;
            el.searchInput.value = "";
            el.statusFilter.value = "all";
            loadPassengers();
        });

        // Refresh Data Button
        el.refreshBtn.addEventListener("click", function () {
            loadPassengers();
        });

        // Pagination Controls Click Delegation
        el.paginationControls.addEventListener("click", function (e) {
            const btn = e.target.closest(".pagination-btn");
            if (!btn || btn.disabled || btn.classList.contains("active")) return;

            const targetPage = parseInt(btn.dataset.page, 10);
            if (targetPage && targetPage >= 1 && targetPage <= state.totalPages) {
                state.page = targetPage;
                loadPassengers();
                // Smooth scroll back to table
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
    window.RideNowPassengers = {
        reload: loadPassengers,
        state: state
    };

    // Initialize Page
    document.addEventListener("DOMContentLoaded", function () {
        checkAdminSession();
        setupEventListeners();
        loadPassengers();
    });

})();

