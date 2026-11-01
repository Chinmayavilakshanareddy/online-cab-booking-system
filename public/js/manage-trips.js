// RideNow Admin - Manage Trips & Bookings (Vanilla JS + DOM + Fetch)

(function () {
    "use strict";

    const API_BASE = window.location.origin.includes("3000")
        ? window.location.origin
        : "http://localhost:3000";

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
            assigned: 0,
            started: 0,
            completed: 0,
            cancelled: 0,
            total_revenue: 0
        }
    };

    // DOM Elements Cache
    const el = {
        tripsList: document.getElementById("tripsList"),
        searchInput: document.getElementById("searchInput"),
        statusFilter: document.getElementById("statusFilter"),
        limitFilter: document.getElementById("limitFilter"),
        resetFiltersBtn: document.getElementById("resetFiltersBtn"),
        refreshBtn: document.getElementById("refreshBtn"),
        paginationBar: document.getElementById("paginationBar"),
        paginationInfo: document.getElementById("paginationInfo"),
        paginationControls: document.getElementById("paginationControls"),
        statTotalTrips: document.getElementById("statTotalTrips"),
        statStartedTrips: document.getElementById("statStartedTrips"),
        statCompletedTrips: document.getElementById("statCompletedTrips"),
        statCancelledTrips: document.getElementById("statCancelledTrips"),
        tripsSubtitle: document.getElementById("tripsSubtitle"),
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

    function getTripStatusBadge(status) {
        const s = (status || "").toLowerCase();
        let badgeClass = "badge-info";
        let label = "Assigned";

        switch (s) {
            case "assigned":
                badgeClass = "badge-warning";
                label = "Assigned";
                break;
            case "started":
                badgeClass = "badge-info";
                label = "In Progress";
                break;
            case "completed":
                badgeClass = "badge-success";
                label = "Completed";
                break;
            case "cancelled":
                badgeClass = "badge-danger";
                label = "Cancelled";
                break;
            default:
                badgeClass = "badge-info";
                label = status ? status.charAt(0).toUpperCase() + status.slice(1) : "Unknown";
        }

        return `<span class="badge-pill ${badgeClass}">${label}</span>`;
    }

    function getActionButtonsHtml(trip) {
        const s = (trip.trip_status || "").toLowerCase();
        const tripId = trip.trip_id;

        if (s === "assigned") {
            return `
                <div class="table-actions" style="justify-content: center; gap: 4px;">
                    <button type="button" class="btn-table-action btn-approve btn-trip-action" data-trip-id="${tripId}" data-status="started" title="Start Ride">
                        ▶ Start
                    </button>
                    <button type="button" class="btn-table-action btn-reject btn-trip-action" data-trip-id="${tripId}" data-status="cancelled" title="Cancel Booking">
                        ✕ Cancel
                    </button>
                </div>
            `;
        }

        if (s === "started") {
            return `
                <div class="table-actions" style="justify-content: center; gap: 4px;">
                    <button type="button" class="btn-table-action btn-approve btn-trip-action" data-trip-id="${tripId}" data-status="completed" title="Complete Ride">
                        ✓ Complete
                    </button>
                    <button type="button" class="btn-table-action btn-reject btn-trip-action" data-trip-id="${tripId}" data-status="cancelled" title="Abort / Cancel Ride">
                        ✕ Cancel
                    </button>
                </div>
            `;
        }

        if (s === "completed") {
            return `<span style="font-size: 11px; color: var(--status-success); font-weight: 600;">✓ Fulfilled</span>`;
        }

        if (s === "cancelled") {
            return `<span style="font-size: 11px; color: var(--status-danger); font-weight: 600;">✕ Closed</span>`;
        }

        return "-";
    }

    function updateSummaryMetrics(summary) {
        if (!summary) return;
        state.summary = { ...summary };

        if (el.statTotalTrips) el.statTotalTrips.textContent = (summary.total || 0).toLocaleString();
        if (el.statStartedTrips) el.statStartedTrips.textContent = (summary.started || 0).toLocaleString();
        if (el.statCompletedTrips) el.statCompletedTrips.textContent = (summary.completed || 0).toLocaleString();
        if (el.statCancelledTrips) el.statCancelledTrips.textContent = (summary.cancelled || 0).toLocaleString();
    }

    // Render single trip table row
    function createTripRow(t) {
        const tr = document.createElement("tr");
        tr.id = `trip-row-${t.trip_id}`;
        tr.dataset.tripId = t.trip_id;
        tr.dataset.status = t.trip_status;

        // Payment status badge
        const payStatus = t.payment_status === "completed"
            ? `<span class="badge-pill badge-success" style="font-size: 10px;">Paid (${escapeHtml(t.payment_method || 'UPI')})</span>`
            : (t.payment_status ? `<span class="badge-pill badge-warning" style="font-size: 10px;">${escapeHtml(t.payment_status)}</span>` : "");

        tr.innerHTML = `
            <td>
                <strong>#${t.trip_id}</strong>
                <div style="font-size: 10px; color: var(--text-muted);">Req #${t.request_id}</div>
            </td>
            <td>
                <div class="driver-info-cell">
                    <span class="driver-name">${escapeHtml(t.passenger_name)}</span>
                    <span class="driver-sub">📞 ${escapeHtml(t.passenger_phone || 'N/A')}</span>
                    <span class="driver-sub">✉️ ${escapeHtml(t.passenger_email || 'N/A')}</span>
                </div>
            </td>
            <td>
                <div class="driver-info-cell">
                    <span class="driver-name">${escapeHtml(t.driver_name)}</span>
                    <span class="driver-sub">📞 ${escapeHtml(t.driver_phone || 'N/A')}</span>
                    <div>
                        <span class="vehicle-plate" style="font-size: 11px;">${escapeHtml(t.vehicle_number)}</span>
                        <small class="driver-sub">${escapeHtml(t.vehicle_type)}</small>
                    </div>
                </div>
            </td>
            <td>
                <div style="display: flex; flex-direction: column; gap: 4px; max-width: 260px;">
                    <div style="font-size: 12px; color: var(--status-success); font-weight: 600;">
                        🟢 ${escapeHtml(t.pickup_location)}
                    </div>
                    <div style="font-size: 12px; color: var(--status-danger); font-weight: 600;">
                        🔴 ${escapeHtml(t.destination)}
                    </div>
                </div>
            </td>
            <td>
                <div>
                    <strong>${formatCurrency(t.fare)}</strong>
                </div>
                <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">
                    ${t.distance_km} km
                </div>
                <div style="margin-top: 3px;">
                    ${payStatus}
                </div>
            </td>
            <td>
                <div style="font-size: 11px; color: var(--text-secondary); display: flex; flex-direction: column; gap: 2px;">
                    <div><strong style="color: var(--text-primary);">Req:</strong> ${escapeHtml(t.formatted_requested || 'N/A')}</div>
                    ${t.formatted_start ? `<div><strong style="color: var(--text-primary);">Start:</strong> ${escapeHtml(t.formatted_start)}</div>` : ''}
                    ${t.formatted_end ? `<div><strong style="color: var(--text-primary);">End:</strong> ${escapeHtml(t.formatted_end)}</div>` : ''}
                </div>
            </td>
            <td class="status-cell">
                ${getTripStatusBadge(t.trip_status)}
            </td>
            <td class="action-cell" style="text-align: center;">
                ${getActionButtonsHtml(t)}
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
            el.paginationInfo.textContent = "Showing 0 trips";
            el.paginationControls.innerHTML = "";
            return;
        }

        const startIdx = (page - 1) * limit + 1;
        const endIdx = Math.min(page * limit, total);
        el.paginationInfo.textContent = `Showing ${startIdx} to ${endIdx} of ${total} trip${total === 1 ? '' : 's'}`;

        let html = "";
        html += `
            <button type="button" class="pagination-btn" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""} aria-label="Previous page">
                ← Prev
            </button>
        `;

        for (let p = 1; p <= totalPages; p++) {
            if (p === 1 || p === totalPages || (p >= page - 1 && p <= page + 1)) {
                html += `
                    <button type="button" class="pagination-btn ${p === page ? 'active' : ''}" data-page="${p}" aria-label="Page ${p}">
                        ${p}
                    </button>
                `;
            } else if (p === page - 2 || p === page + 2) {
                html += `<span style="padding: 0 4px; color: var(--text-muted);">&hellip;</span>`;
            }
        }

        html += `
            <button type="button" class="pagination-btn" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""} aria-label="Next page">
                Next →
            </button>
        `;

        el.paginationControls.innerHTML = html;
    }

    // Load Trips via Fetch
    async function loadTrips() {
        if (state.isLoading) return;
        state.isLoading = true;

        if (el.refreshBtn) {
            el.refreshBtn.disabled = true;
            el.refreshBtn.innerHTML = `<span class="loading-spinner"></span> Loading…`;
        }

        el.tripsList.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state">
                    <span class="loading-spinner"></span> Loading bookings and trips from database…
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
            const response = await fetch(`${API_BASE}/api/admin/trips?${queryParams.toString()}`);
            if (!response.ok) throw new Error(`HTTP Error ${response.status}`);

            const data = await response.json();
            if (!data.success) throw new Error(data.message || "Failed to load trips");

            if (data.summary) updateSummaryMetrics(data.summary);

            const trips = data.trips || [];

            if (el.tripsSubtitle) {
                if (state.search || state.status !== "all") {
                    el.tripsSubtitle.textContent = `Found ${data.pagination.total} matching trip record(s).`;
                } else {
                    el.tripsSubtitle.textContent = `Total of ${data.pagination.total} trips recorded on RideNow.`;
                }
            }

            if (trips.length === 0) {
                el.tripsList.innerHTML = `
                    <tr>
                        <td colspan="8" class="empty-state">
                            <div style="font-size: 28px; margin-bottom: 8px;">🗺️</div>
                            <strong>No trips found</strong>
                            <p style="margin-top: 4px; color: var(--text-muted); font-size: 12px;">
                                ${state.search || state.status !== "all"
                                    ? "No bookings match your search or filter criteria. Try resetting filters."
                                    : "No trips recorded yet."}
                            </p>
                        </td>
                    </tr>
                `;
                renderPagination({ total: 0, page: 1, limit: state.limit, totalPages: 1 });
                return;
            }

            el.tripsList.innerHTML = "";
            const fragment = document.createDocumentFragment();
            trips.forEach(t => fragment.appendChild(createTripRow(t)));
            el.tripsList.appendChild(fragment);

            if (data.pagination) renderPagination(data.pagination);

        } catch (err) {
            console.error("Error fetching trips:", err);
            el.tripsList.innerHTML = `
                <tr>
                    <td colspan="8" class="empty-state" style="color: var(--status-danger);">
                        <div style="font-size: 24px; margin-bottom: 6px;">⚠️</div>
                        <strong>Failed to load trips</strong>
                        <p style="margin-top: 4px; font-size: 12px; color: var(--text-secondary);">${escapeHtml(err.message)}</p>
                        <button type="button" class="btn-secondary" style="margin-top: 12px;" onclick="window.RideNowTrips.reload()">Try Again</button>
                    </td>
                </tr>
            `;
            showToast(`Error: ${err.message}`, "danger");
        } finally {
            state.isLoading = false;
            if (el.refreshBtn) {
                el.refreshBtn.disabled = false;
                el.refreshBtn.innerHTML = `<span>🔄</span> Refresh`;
            }
        }
    }

    // Execute Trip Status Change
    async function updateTripStatus(tripId, targetStatus, btnElement) {
        if (targetStatus === "cancelled") {
            const ok = window.confirm(`Are you sure you want to CANCEL Trip #${tripId}?\nThis will mark the ride request as cancelled.`);
            if (!ok) return;
        }

        const originalText = btnElement.textContent;
        btnElement.disabled = true;
        btnElement.innerHTML = `<span class="loading-spinner"></span>`;

        try {
            const res = await fetch(`${API_BASE}/api/admin/trips/${tripId}/status`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: targetStatus })
            });

            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || `Failed to update status to ${targetStatus}`);

            showToast(data.message, "success");
            loadTrips();
        } catch (err) {
            console.error("Trip status update error:", err);
            btnElement.disabled = false;
            btnElement.textContent = originalText;
            showToast(err.message, "danger");
        }
    }

    function checkAdminSession() {
        try {
            const storedUser = localStorage.getItem("ridenow_user");
            if (storedUser) {
                const user = JSON.parse(storedUser);
                if (el.adminUserName && user.name) {
                    el.adminUserName.textContent = `${user.name} (${user.role ? user.role.toUpperCase() : "Admin"})`;
                }
                if (el.adminUserAvatar && user.name) {
                    const initials = user.name.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase();
                    el.adminUserAvatar.textContent = initials || "AD";
                }
            }
        } catch (e) { }
    }

    // Attach Event Listeners
    function setupEventListeners() {
        // Table Action Delegation
        el.tripsList.addEventListener("click", function (e) {
            const btn = e.target.closest(".btn-trip-action");
            if (!btn || btn.disabled) return;

            const tripId = btn.dataset.tripId;
            const targetStatus = btn.dataset.status;
            if (tripId && targetStatus) {
                updateTripStatus(tripId, targetStatus, btn);
            }
        });

        // Search Input debounced
        let searchDebounceTimer = null;
        el.searchInput.addEventListener("input", function (e) {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                state.search = e.target.value.trim();
                state.page = 1;
                loadTrips();
            }, 300);
        });

        el.searchInput.addEventListener("search", function (e) {
            state.search = e.target.value.trim();
            state.page = 1;
            loadTrips();
        });

        // Status Filter
        el.statusFilter.addEventListener("change", function (e) {
            state.status = e.target.value;
            state.page = 1;
            loadTrips();
        });

        // Limit Filter
        el.limitFilter.addEventListener("change", function (e) {
            state.limit = parseInt(e.target.value, 10) || 10;
            state.page = 1;
            loadTrips();
        });

        // Reset
        el.resetFiltersBtn.addEventListener("click", function () {
            state.search = "";
            state.status = "all";
            state.page = 1;
            el.searchInput.value = "";
            el.statusFilter.value = "all";
            loadTrips();
        });

        el.refreshBtn.addEventListener("click", loadTrips);

        // Pagination Delegation
        el.paginationControls.addEventListener("click", function (e) {
            const btn = e.target.closest(".pagination-btn");
            if (!btn || btn.disabled || btn.classList.contains("active")) return;
            const targetPage = parseInt(btn.dataset.page, 10);
            if (targetPage && targetPage >= 1 && targetPage <= state.totalPages) {
                state.page = targetPage;
                loadTrips();
            }
        });

        // Logout
        if (el.logoutBtn) {
            el.logoutBtn.addEventListener("click", function () {
                localStorage.removeItem("ridenow_user");
            });
        }
    }

    window.RideNowTrips = {
        reload: loadTrips
    };

    document.addEventListener("DOMContentLoaded", function () {
        checkAdminSession();
        setupEventListeners();
        loadTrips();
    });

})();

