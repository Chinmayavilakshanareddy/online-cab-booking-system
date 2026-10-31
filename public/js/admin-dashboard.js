// RideNow Admin Dashboard - Pure Vanilla JavaScript + DOM + AJAX/Fetch

(function () {
    // Determine API Host: if loaded on localhost:3000 use origin, else fallback to http://localhost:3000
    const API_BASE = window.location.origin.includes("3000")
        ? window.location.origin
        : "http://localhost:3000";

    // DOM Elements Cache
    const el = {
        totalPassengers: document.getElementById("statPassengers"),
        totalDrivers: document.getElementById("statDrivers"),
        driversApprovedMeta: document.getElementById("statDriversApprovedMeta"),
        pendingDriversBadge: document.getElementById("statPendingBadge"),
        pendingDriversCount: document.getElementById("statPendingCount"),
        sidebarPendingBadge: document.getElementById("sidebarPendingBadge"),
        
        totalTrips: document.getElementById("statTotalTrips"),
        activeTrips: document.getElementById("statActiveTrips"),
        completedTrips: document.getElementById("statCompletedTrips"),
        cancelledTrips: document.getElementById("statCancelledTrips"),
        
        totalBookings: document.getElementById("statTotalBookings"),
        totalRevenue: document.getElementById("statTotalRevenue"),
        totalVehicles: document.getElementById("statTotalVehicles"),

        tripsBarActive: document.getElementById("barActive"),
        tripsBarCompleted: document.getElementById("barCompleted"),
        tripsBarCancelled: document.getElementById("barCancelled"),
        pctActive: document.getElementById("pctActive"),
        pctCompleted: document.getElementById("pctCompleted"),
        pctCancelled: document.getElementById("pctCancelled"),

        pendingDriversTableBody: document.getElementById("pendingDriversTableBody"),
        recentTripsTableBody: document.getElementById("recentTripsTableBody"),
        activityList: document.getElementById("activityList"),
        
        refreshBtn: document.getElementById("refreshBtn"),
        adminUserName: document.getElementById("adminUserName"),
        logoutBtn: document.getElementById("logoutBtn")
    };

    // Show Toast Notification
    function showToast(message, type = "success") {
        let container = document.getElementById("toastContainer");
        if (!container) {
            container = document.createElement("div");
            container.id = "toastContainer";
            document.body.appendChild(container);
        }

        const toast = document.createElement("div");
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `<span>${type === "success" ? "✓" : "⚠"}</span> <div>${message}</div>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = "0";
            toast.style.transform = "translateX(100%)";
            toast.style.transition = "all 0.3s ease";
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // Format Currency (INR)
    function formatCurrency(val) {
        return new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency: "INR",
            maximumFractionDigits: 2
        }).format(val || 0);
    }

    // Format Number
    function formatNum(val) {
        return new Intl.NumberFormat("en-IN").format(val || 0);
    }

    // Fetch and populate Dashboard Statistics
    async function fetchDashboardStats() {
        if (el.refreshBtn) {
            el.refreshBtn.disabled = true;
            el.refreshBtn.innerHTML = `<span class="loading-spinner"></span> Loading...`;
        }

        try {
            const response = await fetch(`${API_BASE}/api/admin/dashboard/stats`, {
                headers: { "Content-Type": "application/json" }
            });

            if (!response.ok) {
                throw new Error(`HTTP error ${response.status}`);
            }

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.message || "Failed to load statistics");
            }

            // Update DOM with statistics
            renderStats(data.stats);
            renderPendingDrivers(data.pending_drivers);
            renderRecentTrips(data.recent_trips);
            renderActivityLogs(data.recent_logs);

        } catch (error) {
            console.error("Dashboard statistics fetch error:", error);
            showToast("Failed to fetch live statistics from server.", "danger");
        } finally {
            if (el.refreshBtn) {
                el.refreshBtn.disabled = false;
                el.refreshBtn.innerHTML = `<span>⟳</span> Refresh`;
            }
        }
    }

    // Render Metric Cards and Progress Bars
    function renderStats(stats) {
        if (!stats) return;

        // 1. Passengers
        if (el.totalPassengers) {
            el.totalPassengers.textContent = formatNum(stats.passengers.total);
        }

        // 2. Drivers
        if (el.totalDrivers) {
            el.totalDrivers.textContent = formatNum(stats.drivers.total);
        }
        if (el.driversApprovedMeta) {
            el.driversApprovedMeta.innerHTML = `<strong>${stats.drivers.approved}</strong> Approved active drivers`;
        }

        // 3. Pending Driver Approvals
        const pendingCount = stats.drivers.pending_approval || 0;
        if (el.pendingDriversCount) {
            el.pendingDriversCount.textContent = formatNum(pendingCount);
        }
        if (el.pendingDriversBadge) {
            el.pendingDriversBadge.textContent = `${pendingCount} Pending`;
            el.pendingDriversBadge.className = pendingCount > 0 ? "badge-pill badge-warning" : "badge-pill badge-success";
        }
        if (el.sidebarPendingBadge) {
            el.sidebarPendingBadge.textContent = pendingCount;
            el.sidebarPendingBadge.style.display = pendingCount > 0 ? "inline-block" : "none";
        }

        // 4. Trips & Bookings
        if (el.totalTrips) el.totalTrips.textContent = formatNum(stats.trips.total);
        if (el.activeTrips) el.activeTrips.textContent = formatNum(stats.trips.active);
        if (el.completedTrips) el.completedTrips.textContent = formatNum(stats.trips.completed);
        if (el.cancelledTrips) el.cancelledTrips.textContent = formatNum(stats.trips.cancelled);
        if (el.totalBookings) el.totalBookings.textContent = formatNum(stats.bookings.total);

        // 5. Financials & Fleet
        if (el.totalRevenue) el.totalRevenue.textContent = formatCurrency(stats.financials.total_revenue);
        if (el.totalVehicles) el.totalVehicles.textContent = `${stats.vehicles.active} / ${stats.vehicles.total}`;

        // 6. Trip Visual Progress Breakdown
        const total = stats.trips.total || 1;
        const activePct = Math.round((stats.trips.active / total) * 100);
        const compPct = Math.round((stats.trips.completed / total) * 100);
        const cancPct = Math.round((stats.trips.cancelled / total) * 100);

        if (el.tripsBarActive) el.tripsBarActive.style.width = `${activePct}%`;
        if (el.tripsBarCompleted) el.tripsBarCompleted.style.width = `${compPct}%`;
        if (el.tripsBarCancelled) el.tripsBarCancelled.style.width = `${cancPct}%`;

        if (el.pctActive) el.pctActive.textContent = `${stats.trips.active} (${activePct}%)`;
        if (el.pctCompleted) el.pctCompleted.textContent = `${stats.trips.completed} (${compPct}%)`;
        if (el.pctCancelled) el.pctCancelled.textContent = `${stats.trips.cancelled} (${cancPct}%)`;
    }

    // Render Pending Drivers Table
    function renderPendingDrivers(drivers) {
        if (!el.pendingDriversTableBody) return;

        if (!drivers || drivers.length === 0) {
            el.pendingDriversTableBody.innerHTML = `
                <tr>
                    <td colspan="5" class="empty-state">
                        ✓ All driver applications have been reviewed. No pending approvals!
                    </td>
                </tr>
            `;
            return;
        }

        el.pendingDriversTableBody.innerHTML = drivers.map(d => `
            <tr id="driver-row-${d.driver_id}">
                <td>
                    <div class="driver-info-cell">
                        <span class="driver-name">${escapeHtml(d.name)}</span>
                        <span class="driver-sub">${escapeHtml(d.email)} • ${escapeHtml(d.mobile)}</span>
                    </div>
                </td>
                <td>
                    <div><strong>${escapeHtml(d.license_no)}</strong></div>
                    <small class="driver-sub">Exp: ${escapeHtml(d.license_expiry)}</small>
                </td>
                <td>
                    ${d.vehicle_number ? `
                        <div><strong>${escapeHtml(d.model || '')}</strong> (${escapeHtml(d.vehicle_type || '')})</div>
                        <small class="driver-sub">${escapeHtml(d.vehicle_number)}</small>
                    ` : `<span class="badge-pill badge-warning">No vehicle linked</span>`}
                </td>
                <td>
                    <span class="badge-pill badge-warning">Pending Review</span>
                </td>
                <td>
                    <div class="table-actions">
                        <button class="btn-table-action btn-approve" data-id="${d.driver_id}" data-action="approve" title="Approve driver">
                            Approve
                        </button>
                        <button class="btn-table-action btn-reject" data-id="${d.driver_id}" data-action="reject" title="Reject driver">
                            Reject
                        </button>
                    </div>
                </td>
            </tr>
        `).join("");
    }

    // Render Recent Trips Table
    function renderRecentTrips(trips) {
        if (!el.recentTripsTableBody) return;

        if (!trips || trips.length === 0) {
            el.recentTripsTableBody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-state">No recent trips found.</td>
                </tr>
            `;
            return;
        }

        el.recentTripsTableBody.innerHTML = trips.map(t => {
            let statusBadge = "badge-info";
            if (t.trip_status === "completed") statusBadge = "badge-success";
            else if (t.trip_status === "cancelled") statusBadge = "badge-danger";

            return `
                <tr>
                    <td><strong>#${t.trip_id}</strong></td>
                    <td>
                        <div class="driver-info-cell">
                            <span class="driver-name">${escapeHtml(t.passenger_name)}</span>
                            <span class="driver-sub">Driver: ${escapeHtml(t.driver_name)}</span>
                        </div>
                    </td>
                    <td>
                        <div style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(t.pickup_location)} → ${escapeHtml(t.destination)}">
                            ${escapeHtml(t.pickup_location)} → ${escapeHtml(t.destination)}
                        </div>
                    </td>
                    <td>
                        <strong>${formatCurrency(t.fare)}</strong>
                        <div class="driver-sub">${t.distance_km} km</div>
                    </td>
                    <td>
                        <span class="badge-pill ${statusBadge}">${capitalize(t.trip_status)}</span>
                    </td>
                    <td><small class="driver-sub">${escapeHtml(t.formatted_time || '')}</small></td>
                </tr>
            `;
        }).join("");
    }

    // Render Activity Logs
    function renderActivityLogs(logs) {
        if (!el.activityList) return;

        if (!logs || logs.length === 0) {
            el.activityList.innerHTML = `<li class="empty-state">No recent system activity recorded.</li>`;
            return;
        }

        el.activityList.innerHTML = logs.map(l => `
            <li class="activity-item">
                <div class="activity-bullet"></div>
                <div class="activity-content">
                    <div class="activity-text">
                        <strong>${escapeHtml(l.actor_name)}</strong> (${escapeHtml(l.actor_role)}):
                        ${escapeHtml(l.description || l.action)}
                    </div>
                    <div class="activity-time">${escapeHtml(l.time_ago || '')}</div>
                </div>
            </li>
        `).join("");
    }

    // Handle Driver Approval or Rejection Action via AJAX
    async function handleDriverApproval(driverId, action) {
        const row = document.getElementById(`driver-row-${driverId}`);
        const actionBtn = row ? row.querySelector(`[data-action="${action}"]`) : null;

        if (actionBtn) {
            actionBtn.disabled = true;
            actionBtn.textContent = action === "approve" ? "Approving..." : "Rejecting...";
        }

        try {
            const response = await fetch(`${API_BASE}/api/admin/drivers/${driverId}/${action}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" }
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.message || `Failed to ${action} driver`);
            }

            showToast(result.message, action === "approve" ? "success" : "warning");

            // Dynamically update DOM without reloading the full page
            if (row) {
                row.style.transition = "all 0.4s ease";
                row.style.opacity = "0";
                row.style.transform = "translateX(30px)";
                setTimeout(() => {
                    row.remove();
                    // If table is now empty, display empty message
                    if (el.pendingDriversTableBody.children.length === 0) {
                        el.pendingDriversTableBody.innerHTML = `
                            <tr>
                                <td colspan="5" class="empty-state">
                                    ✓ All driver applications have been reviewed. No pending approvals!
                                </td>
                            </tr>
                        `;
                    }
                }, 400);
            }

            // Refresh statistics counter in background
            fetchDashboardStats();

        } catch (err) {
            console.error("Driver action error:", err);
            showToast(err.message, "danger");
            if (actionBtn) {
                actionBtn.disabled = false;
                actionBtn.textContent = action === "approve" ? "Approve" : "Reject";
            }
        }
    }

    // Event Delegation for Table Actions
    if (el.pendingDriversTableBody) {
        el.pendingDriversTableBody.addEventListener("click", function (e) {
            const btn = e.target.closest("button[data-action]");
            if (!btn) return;

            const driverId = btn.getAttribute("data-id");
            const action = btn.getAttribute("data-action");

            if (action === "reject") {
                if (!confirm("Are you sure you want to reject this driver application?")) {
                    return;
                }
            }

            handleDriverApproval(driverId, action);
        });
    }

    // Refresh Button Listener
    if (el.refreshBtn) {
        el.refreshBtn.addEventListener("click", fetchDashboardStats);
    }

    // User authentication / info loader
    function checkUserSession() {
        const storedUser = localStorage.getItem("ridenow_user");
        if (storedUser) {
            try {
                const u = JSON.parse(storedUser);
                if (el.adminUserName) el.adminUserName.textContent = u.name || "Admin User";
            } catch (e) {
                // Ignore parse error
            }
        }
    }

    // Logout
    if (el.logoutBtn) {
        el.logoutBtn.addEventListener("click", function () {
            localStorage.removeItem("ridenow_user");
            window.location.href = "../customer/login.html";
        });
    }

    // Helper functions
    function escapeHtml(str) {
        if (!str) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function capitalize(str) {
        if (!str) return "";
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    // Initial page load
    document.addEventListener("DOMContentLoaded", function () {
        checkUserSession();
        fetchDashboardStats();
    });

})();

