// RideNow Admin - Reports & Analytics Engine (Vanilla JS + DOM + Fetch + CSV Export)

(function () {
    "use strict";

    const API_BASE = window.location.origin.includes("3000")
        ? window.location.origin
        : "http://localhost:3000";

    const state = {
        filter: {
            startDate: "",
            endDate: "",
            preset: "all"
        },
        drivers: [],
        driverSearch: "",
        passengers: [],
        passengerSearch: "",
        analytics: null,
        isLoading: false
    };

    // DOM Elements Cache
    const el = {
        adminUserName: document.getElementById("adminUserName"),
        adminUserAvatar: document.getElementById("adminUserAvatar"),
        logoutBtn: document.getElementById("logoutBtn"),
        toastContainer: document.getElementById("toastContainer"),

        // Filter elements
        startDateInput: document.getElementById("startDate"),
        endDateInput: document.getElementById("endDate"),
        applyFilterBtn: document.getElementById("applyFilterBtn"),
        resetFilterBtn: document.getElementById("resetFilterBtn"),
        filterStatusText: document.getElementById("filterStatusText"),
        presetButtons: document.querySelectorAll(".btn-preset"),

        // Export & Print
        exportDriversBtn: document.getElementById("exportDriversBtn"),
        exportDriversBtnTable: document.getElementById("exportDriversBtnTable"),
        exportPassengersBtn: document.getElementById("exportPassengersBtn"),
        exportPassengersBtnTable: document.getElementById("exportPassengersBtnTable"),
        printReportBtn: document.getElementById("printReportBtn"),

        // KPI Elements
        statGrossRevenue: document.getElementById("statGrossRevenue"),
        statAvgFareBadge: document.getElementById("statAvgFareBadge"),
        statCancellationRevenue: document.getElementById("statCancellationRevenue"),
        statCompletedTrips: document.getElementById("statCompletedTrips"),
        statCompletionRate: document.getElementById("statCompletionRate"),
        statTotalTripsMeta: document.getElementById("statTotalTripsMeta"),
        statCancelledTrips: document.getElementById("statCancelledTrips"),
        statCancellationRate: document.getElementById("statCancellationRate"),
        statTotalPassengers: document.getElementById("statTotalPassengers"),
        statActivePassengers: document.getElementById("statActivePassengers"),
        statTotalDrivers: document.getElementById("statTotalDrivers"),
        statApprovedDrivers: document.getElementById("statApprovedDrivers"),
        statPendingDrivers: document.getElementById("statPendingDrivers"),
        statTotalDistance: document.getElementById("statTotalDistance"),
        statAvgDistance: document.getElementById("statAvgDistance"),

        // Breakdowns
        vehicleBreakdownContainer: document.getElementById("vehicleBreakdownContainer"),
        paymentBreakdownContainer: document.getElementById("paymentBreakdownContainer"),
        vehicleCountBadge: document.getElementById("vehicleCountBadge"),
        paymentCountBadge: document.getElementById("paymentCountBadge"),

        // Tables & Counts
        driverSearchInput: document.getElementById("driverSearchInput"),
        driverReportCount: document.getElementById("driverReportCount"),
        driverReportTableBody: document.getElementById("driverReportTableBody"),

        passengerSearchInput: document.getElementById("passengerSearchInput"),
        passengerReportCount: document.getElementById("passengerReportCount"),
        passengerReportTableBody: document.getElementById("passengerReportTableBody")
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
        } catch (e) {
            console.error("Session parse error:", e);
        }
    }

    // ========================================================
    // 1. DATE PRESET LOGIC
    // ========================================================
    function formatDateIso(dateObj) {
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, "0");
        const d = String(dateObj.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    }

    function applyPreset(presetName) {
        state.filter.preset = presetName;
        el.presetButtons.forEach(btn => {
            if (btn.dataset.preset === presetName) {
                btn.classList.add("active");
            } else {
                btn.classList.remove("active");
            }
        });

        const today = new Date();

        if (presetName === "all") {
            state.filter.startDate = "";
            state.filter.endDate = "";
            el.startDateInput.value = "";
            el.endDateInput.value = "";
            el.filterStatusText.textContent = "Showing all-time database metrics";
        } else if (presetName === "today") {
            const iso = formatDateIso(today);
            state.filter.startDate = iso;
            state.filter.endDate = iso;
            el.startDateInput.value = iso;
            el.endDateInput.value = iso;
            el.filterStatusText.textContent = `Filtered for Today (${iso})`;
        } else if (presetName === "7d") {
            const past7 = new Date();
            past7.setDate(today.getDate() - 7);
            const startIso = formatDateIso(past7);
            const endIso = formatDateIso(today);
            state.filter.startDate = startIso;
            state.filter.endDate = endIso;
            el.startDateInput.value = startIso;
            el.endDateInput.value = endIso;
            el.filterStatusText.textContent = `Filtered for Last 7 Days (${startIso} to ${endIso})`;
        } else if (presetName === "30d") {
            const past30 = new Date();
            past30.setDate(today.getDate() - 30);
            const startIso = formatDateIso(past30);
            const endIso = formatDateIso(today);
            state.filter.startDate = startIso;
            state.filter.endDate = endIso;
            el.startDateInput.value = startIso;
            el.endDateInput.value = endIso;
            el.filterStatusText.textContent = `Filtered for Last 30 Days (${startIso} to ${endIso})`;
        } else if (presetName === "month") {
            const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            const startIso = formatDateIso(startOfMonth);
            const endIso = formatDateIso(today);
            state.filter.startDate = startIso;
            state.filter.endDate = endIso;
            el.startDateInput.value = startIso;
            el.endDateInput.value = endIso;
            el.filterStatusText.textContent = `Filtered for This Month (${startIso} to ${endIso})`;
        }

        loadAllReports();
    }

    function buildQueryString() {
        const params = new URLSearchParams();
        if (state.filter.startDate) params.append("startDate", state.filter.startDate);
        if (state.filter.endDate) params.append("endDate", state.filter.endDate);
        const qs = params.toString();
        return qs ? `?${qs}` : "";
    }

    // ========================================================
    // 2. LOAD ANALYTICS & SUMMARY METRICS
    // ========================================================
    async function loadAnalyticsSummary() {
        try {
            const qs = buildQueryString();
            const res = await fetch(`${API_BASE}/api/admin/reports/analytics${qs}`, {
                headers: { "Content-Type": "application/json" }
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.message || "Failed to load analytics metrics");
            }

            state.analytics = data;
            renderAnalytics(data);
        } catch (err) {
            console.error("Analytics summary error:", err);
            showToast("Failed to load analytics summary: " + err.message, "danger");
        }
    }

    function renderAnalytics(data) {
        const rev = data.revenue || {};
        const trips = data.trips || {};
        const pass = data.passengers || {};
        const driv = data.drivers || {};

        // KPIs
        el.statGrossRevenue.textContent = formatCurrency(rev.gross_revenue || 0);
        el.statAvgFareBadge.textContent = `Avg Fare: ${formatCurrency(rev.average_fare || 0)}`;
        el.statCancellationRevenue.textContent = `${formatCurrency(rev.cancellation_revenue || 0)} cancel fees`;

        el.statCompletedTrips.textContent = trips.completed || 0;
        el.statCompletionRate.textContent = `${trips.completion_rate || 0}%`;
        el.statTotalTripsMeta.textContent = `of ${trips.total || 0} total trips`;

        el.statCancelledTrips.textContent = trips.cancelled || 0;
        el.statCancellationRate.textContent = `${trips.cancellation_rate || 0}%`;

        el.statTotalPassengers.textContent = pass.total || 0;
        el.statActivePassengers.textContent = `${pass.active || 0} Active`;

        el.statTotalDrivers.textContent = driv.total || 0;
        el.statApprovedDrivers.textContent = `${driv.approved || 0} Approved`;
        el.statPendingDrivers.textContent = `${driv.pending || 0} pending`;

        el.statTotalDistance.textContent = `${(trips.total_distance_km || 0).toFixed(1)} km`;
        el.statAvgDistance.textContent = `Avg: ${(trips.average_distance_km || 0).toFixed(1)} km / completed ride`;

        // Render Vehicle Distribution Breakdown
        const vDist = data.vehicle_distribution || [];
        el.vehicleCountBadge.textContent = `${vDist.length} Categories`;
        if (vDist.length === 0) {
            el.vehicleBreakdownContainer.innerHTML = `
                <div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px;">
                    No vehicle ride data recorded in this period.
                </div>
            `;
        } else {
            const maxRev = Math.max(...vDist.map(v => v.revenue), 1);
            el.vehicleBreakdownContainer.innerHTML = vDist.map(v => {
                const pct = Math.min(100, Math.round((v.revenue / maxRev) * 100));
                const vTypeKey = (v.vehicle_type || "").toLowerCase();
                let fillClass = "fill-other";
                if (vTypeKey.includes("sedan")) fillClass = "fill-sedan";
                else if (vTypeKey.includes("suv")) fillClass = "fill-suv";
                else if (vTypeKey.includes("hatchback") || vTypeKey.includes("mini")) fillClass = "fill-hatchback";
                else if (vTypeKey.includes("auto")) fillClass = "fill-auto";
                else if (vTypeKey.includes("bike")) fillClass = "fill-bike";

                return `
                    <div class="progress-item">
                        <div class="progress-header">
                            <span>${escapeHtml(v.vehicle_type)} <span class="progress-meta">(${v.trip_count} rides)</span></span>
                            <span>${formatCurrency(v.revenue)}</span>
                        </div>
                        <div class="progress-track">
                            <div class="progress-fill ${fillClass}" style="width: ${pct}%;"></div>
                        </div>
                    </div>
                `;
            }).join("");
        }

        // Render Payment Breakdown
        const pDist = data.payment_distribution || [];
        el.paymentCountBadge.textContent = `${pDist.length} Channels`;
        if (pDist.length === 0) {
            el.paymentBreakdownContainer.innerHTML = `
                <div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px;">
                    No payment transaction records in this period.
                </div>
            `;
        } else {
            const maxAmt = Math.max(...pDist.map(p => p.amount), 1);
            el.paymentBreakdownContainer.innerHTML = pDist.map(p => {
                const pct = Math.min(100, Math.round((p.amount / maxAmt) * 100));
                return `
                    <div class="progress-item">
                        <div class="progress-header">
                            <span style="text-transform: uppercase;">💳 ${escapeHtml(p.method)} <span class="progress-meta">(${p.count} txns)</span></span>
                            <span>${formatCurrency(p.amount)}</span>
                        </div>
                        <div class="progress-track">
                            <div class="progress-fill fill-sedan" style="width: ${pct}%;"></div>
                        </div>
                    </div>
                `;
            }).join("");
        }
    }

    // ========================================================
    // 3. LOAD DRIVER PERFORMANCE REPORT
    // ========================================================
    async function loadDriverReport() {
        el.driverReportTableBody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state-cell">
                    <span class="loading-spinner"></span> Loading driver performance records...
                </td>
            </tr>
        `;

        try {
            const qs = buildQueryString();
            const res = await fetch(`${API_BASE}/api/admin/reports/drivers${qs}`, {
                headers: { "Content-Type": "application/json" }
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.message || "Failed to load driver report");
            }

            state.drivers = data.drivers || [];
            renderDriverReport();
        } catch (err) {
            console.error("Driver report load error:", err);
            el.driverReportTableBody.innerHTML = `
                <tr>
                    <td colspan="8" class="empty-state-cell" style="color: var(--status-danger);">
                        ✕ Unable to load driver report: ${escapeHtml(err.message)}
                    </td>
                </tr>
            `;
            el.driverReportCount.textContent = "Error loading report";
        }
    }

    function renderDriverReport() {
        const tbody = el.driverReportTableBody;
        const q = state.driverSearch.toLowerCase().trim();

        const filtered = state.drivers.filter(d => {
            if (!q) return true;
            return (d.name && d.name.toLowerCase().includes(q)) ||
                   (d.mobile && d.mobile.includes(q)) ||
                   (d.email && d.email.toLowerCase().includes(q)) ||
                   (d.license_no && d.license_no.toLowerCase().includes(q)) ||
                   (d.vehicle_number && d.vehicle_number.toLowerCase().includes(q));
        });

        el.driverReportCount.textContent = `Showing ${filtered.length} of ${state.drivers.length} drivers`;

        if (filtered.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="empty-state-cell">
                        No driver records found matching filter.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = filtered.map(d => {
            const statusClass = d.verification_status === "approved" ? "badge-success" : (d.verification_status === "pending" ? "badge-warning" : "badge-danger");
            return `
                <tr>
                    <td>
                        <div style="font-weight: 650; color: var(--text-primary); font-size: 14px;">${escapeHtml(d.name)}</div>
                        <div style="font-size: 12px; color: var(--text-secondary);">${escapeHtml(d.mobile)}</div>
                    </td>
                    <td>
                        <div style="font-family: monospace; font-size: 12px; font-weight: 600;">${escapeHtml(d.license_no)}</div>
                        <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(d.vehicle_number)} (${escapeHtml(d.vehicle_type)})</div>
                    </td>
                    <td style="text-align: center; font-weight: 650;">${d.total_trips}</td>
                    <td style="text-align: center; color: #166534; font-weight: 600;">${d.completed_trips}</td>
                    <td style="text-align: center; color: #b91c1c; font-weight: 600;">${d.cancelled_trips}</td>
                    <td style="text-align: right; font-weight: 600;">${(d.total_distance_km || 0).toFixed(1)} km</td>
                    <td style="text-align: right; font-weight: 700; color: #166534;">${formatCurrency(d.total_earnings)}</td>
                    <td style="text-align: center;">
                        <span class="rating-badge">★ ${(d.rating || 5).toFixed(1)}</span>
                    </td>
                </tr>
            `;
        }).join("");
    }

    // ========================================================
    // 4. LOAD PASSENGER ACTIVITY REPORT
    // ========================================================
    async function loadPassengerReport() {
        el.passengerReportTableBody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state-cell">
                    <span class="loading-spinner"></span> Loading passenger activity records...
                </td>
            </tr>
        `;

        try {
            const qs = buildQueryString();
            const res = await fetch(`${API_BASE}/api/admin/reports/passengers${qs}`, {
                headers: { "Content-Type": "application/json" }
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.message || "Failed to load passenger report");
            }

            state.passengers = data.passengers || [];
            renderPassengerReport();
        } catch (err) {
            console.error("Passenger report load error:", err);
            el.passengerReportTableBody.innerHTML = `
                <tr>
                    <td colspan="8" class="empty-state-cell" style="color: var(--status-danger);">
                        ✕ Unable to load passenger report: ${escapeHtml(err.message)}
                    </td>
                </tr>
            `;
            el.passengerReportCount.textContent = "Error loading report";
        }
    }

    function renderPassengerReport() {
        const tbody = el.passengerReportTableBody;
        const q = state.passengerSearch.toLowerCase().trim();

        const filtered = state.passengers.filter(p => {
            if (!q) return true;
            return (p.name && p.name.toLowerCase().includes(q)) ||
                   (p.mobile && p.mobile.includes(q)) ||
                   (p.email && p.email.toLowerCase().includes(q));
        });

        el.passengerReportCount.textContent = `Showing ${filtered.length} of ${state.passengers.length} passengers`;

        if (filtered.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="empty-state-cell">
                        No passenger records found matching filter.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = filtered.map(p => {
            const statusBadge = p.status === "active"
                ? `<span class="badge-pill badge-success">Active</span>`
                : `<span class="badge-pill badge-danger">${escapeHtml(p.status)}</span>`;

            return `
                <tr>
                    <td>
                        <div style="font-weight: 650; color: var(--text-primary); font-size: 14px;">${escapeHtml(p.name)}</div>
                        <div style="font-size: 11px; color: var(--text-muted);">ID: #${p.passenger_id}</div>
                    </td>
                    <td>
                        <div style="font-size: 12px; font-weight: 500;">${escapeHtml(p.email)}</div>
                        <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(p.mobile)}</div>
                    </td>
                    <td style="text-align: center; font-weight: 650;">${p.total_requests}</td>
                    <td style="text-align: center; color: #166534; font-weight: 600;">${p.completed_rides}</td>
                    <td style="text-align: center; color: #b91c1c; font-weight: 600;">${p.cancelled_rides}</td>
                    <td style="text-align: right; font-weight: 700; color: #166534;">${formatCurrency(p.total_spend)}</td>
                    <td style="text-align: center;">${statusBadge}</td>
                    <td style="font-size: 12px; color: var(--text-secondary);">${escapeHtml(p.member_since || "N/A")}</td>
                </tr>
            `;
        }).join("");
    }

    // ========================================================
    // 5. CSV EXPORT UTILITIES
    // ========================================================
    function downloadCsv(filename, rows) {
        const processRow = (row) => {
            return row.map(val => {
                if (val === null || val === undefined) return '""';
                let stringVal = String(val).replace(/"/g, '""');
                return `"${stringVal}"`;
            }).join(",");
        };

        const csvContent = "data:text/csv;charset=utf-8," + rows.map(processRow).join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function exportDriversCsv() {
        if (!state.drivers || state.drivers.length === 0) {
            showToast("No driver data available to export.", "warning");
            return;
        }

        const headers = [
            "Driver ID", "Driver Name", "Mobile", "Email", "License No",
            "Vehicle Number", "Vehicle Type", "Total Rides", "Completed Rides",
            "Cancelled Rides", "Distance (km)", "Total Earnings (INR)", "Rating", "Status"
        ];

        const rows = [headers];
        state.drivers.forEach(d => {
            rows.push([
                d.driver_id,
                d.name,
                d.mobile,
                d.email,
                d.license_no,
                d.vehicle_number,
                d.vehicle_type,
                d.total_trips,
                d.completed_trips,
                d.cancelled_trips,
                d.total_distance_km,
                d.total_earnings,
                d.rating,
                d.verification_status
            ]);
        });

        const dateSuffix = state.filter.startDate ? `_${state.filter.startDate}_to_${state.filter.endDate || 'now'}` : "_all_time";
        downloadCsv(`ridenow_driver_performance_report${dateSuffix}.csv`, rows);
        showToast("Driver performance report downloaded successfully!", "success");
    }

    function exportPassengersCsv() {
        if (!state.passengers || state.passengers.length === 0) {
            showToast("No passenger data available to export.", "warning");
            return;
        }

        const headers = [
            "Passenger ID", "Passenger Name", "Mobile", "Email",
            "Total Requests", "Completed Rides", "Cancelled Rides",
            "Total Spend (INR)", "Status", "Member Since"
        ];

        const rows = [headers];
        state.passengers.forEach(p => {
            rows.push([
                p.passenger_id,
                p.name,
                p.mobile,
                p.email,
                p.total_requests,
                p.completed_rides,
                p.cancelled_rides,
                p.total_spend,
                p.status,
                p.member_since
            ]);
        });

        const dateSuffix = state.filter.startDate ? `_${state.filter.startDate}_to_${state.filter.endDate || 'now'}` : "_all_time";
        downloadCsv(`ridenow_passenger_activity_report${dateSuffix}.csv`, rows);
        showToast("Passenger activity report downloaded successfully!", "success");
    }

    function loadAllReports() {
        loadAnalyticsSummary();
        loadDriverReport();
        loadPassengerReport();
    }

    // ========================================================
    // 6. EVENT LISTENERS
    // ========================================================
    function setupEventListeners() {
        // Preset clicks
        el.presetButtons.forEach(btn => {
            btn.addEventListener("click", () => {
                applyPreset(btn.dataset.preset);
            });
        });

        // Apply Custom Date Range
        el.applyFilterBtn.addEventListener("click", () => {
            const startVal = el.startDateInput.value.trim();
            const endVal = el.endDateInput.value.trim();

            if (startVal && endVal && startVal > endVal) {
                showToast("Start date cannot be after end date.", "warning");
                return;
            }

            state.filter.startDate = startVal;
            state.filter.endDate = endVal;
            state.filter.preset = "custom";
            el.presetButtons.forEach(b => b.classList.remove("active"));

            let desc = "Filtered for custom range: ";
            if (startVal && endVal) desc += `${startVal} to ${endVal}`;
            else if (startVal) desc += `From ${startVal} onwards`;
            else if (endVal) desc += `Up to ${endVal}`;
            else desc = "Showing all-time database metrics";
            el.filterStatusText.textContent = desc;

            loadAllReports();
            showToast("Date-range filter applied", "info");
        });

        // Reset Filter
        el.resetFilterBtn.addEventListener("click", () => {
            applyPreset("all");
            showToast("Date filters reset to All-Time", "info");
        });

        // Search inputs
        let driverDebounce = null;
        el.driverSearchInput.addEventListener("input", (e) => {
            clearTimeout(driverDebounce);
            driverDebounce = setTimeout(() => {
                state.driverSearch = e.target.value;
                renderDriverReport();
            }, 200);
        });

        let passDebounce = null;
        el.passengerSearchInput.addEventListener("input", (e) => {
            clearTimeout(passDebounce);
            passDebounce = setTimeout(() => {
                state.passengerSearch = e.target.value;
                renderPassengerReport();
            }, 200);
        });

        // Exports & Print
        el.exportDriversBtn.addEventListener("click", exportDriversCsv);
        el.exportDriversBtnTable.addEventListener("click", exportDriversCsv);
        el.exportPassengersBtn.addEventListener("click", exportPassengersCsv);
        el.exportPassengersBtnTable.addEventListener("click", exportPassengersCsv);
        el.printReportBtn.addEventListener("click", () => window.print());

        // Logout
        if (el.logoutBtn) {
            el.logoutBtn.addEventListener("click", () => {
                localStorage.removeItem("ridenow_user");
            });
        }
    }

    // Initialize on page load
    document.addEventListener("DOMContentLoaded", () => {
        checkAdminSession();
        setupEventListeners();
        loadAllReports();
    });

    window.RideNowReports = {
        reload: loadAllReports,
        applyPreset: applyPreset,
        exportDrivers: exportDriversCsv,
        exportPassengers: exportPassengersCsv
    };

})();

