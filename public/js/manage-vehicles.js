// RideNow Admin - Manage Vehicles (Vanilla JS + DOM + Fetch)

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
        type: "all",
        totalPages: 1,
        totalRecords: 0,
        isLoading: false,
        summary: {
            total: 0,
            active: 0,
            inactive: 0,
            under_maintenance: 0
        },
        drivers: []
    };

    // DOM Elements Cache
    const el = {
        vehiclesList: document.getElementById("vehiclesList"),
        searchInput: document.getElementById("searchInput"),
        statusFilter: document.getElementById("statusFilter"),
        typeFilter: document.getElementById("typeFilter"),
        limitFilter: document.getElementById("limitFilter"),
        resetFiltersBtn: document.getElementById("resetFiltersBtn"),
        refreshBtn: document.getElementById("refreshBtn"),
        addVehicleBtn: document.getElementById("addVehicleBtn"),
        paginationBar: document.getElementById("paginationBar"),
        paginationInfo: document.getElementById("paginationInfo"),
        paginationControls: document.getElementById("paginationControls"),
        statTotalVehicles: document.getElementById("statTotalVehicles"),
        statActiveVehicles: document.getElementById("statActiveVehicles"),
        statInactiveVehicles: document.getElementById("statInactiveVehicles"),
        statMaintenanceVehicles: document.getElementById("statMaintenanceVehicles"),
        vehiclesSubtitle: document.getElementById("vehiclesSubtitle"),
        adminUserName: document.getElementById("adminUserName"),
        adminUserAvatar: document.getElementById("adminUserAvatar"),
        logoutBtn: document.getElementById("logoutBtn"),
        toastContainer: document.getElementById("toastContainer"),

        // Modal
        vehicleModal: document.getElementById("vehicleModal"),
        modalTitle: document.getElementById("modalTitle"),
        modalCloseBtn: document.getElementById("modalCloseBtn"),
        modalCancelBtn: document.getElementById("modalCancelBtn"),
        vehicleForm: document.getElementById("vehicleForm"),
        editVehicleId: document.getElementById("editVehicleId"),
        fVehicleNumber: document.getElementById("fVehicleNumber"),
        fVehicleType: document.getElementById("fVehicleType"),
        fModel: document.getElementById("fModel"),
        fCapacity: document.getElementById("fCapacity"),
        fDriverId: document.getElementById("fDriverId"),
        fStatus: document.getElementById("fStatus"),
        formError: document.getElementById("formError"),
        formSubmitBtn: document.getElementById("formSubmitBtn")
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

    function getStatusBadge(status) {
        const s = (status || "").toLowerCase();
        let badgeClass = "badge-info";
        let label = "Unknown";

        switch (s) {
            case "active":
                badgeClass = "badge-success";
                label = "Active";
                break;
            case "inactive":
                badgeClass = "badge-warning";
                label = "Inactive";
                break;
            case "under_maintenance":
                badgeClass = "badge-danger";
                label = "Maintenance";
                break;
            default:
                badgeClass = "badge-info";
                label = status ? status.charAt(0).toUpperCase() + status.slice(1) : "Unknown";
        }

        return `<span class="badge-pill ${badgeClass}">${label}</span>`;
    }

    function updateSummaryMetrics(summary) {
        if (!summary) return;
        state.summary = { ...summary };

        if (el.statTotalVehicles) el.statTotalVehicles.textContent = (summary.total || 0).toLocaleString();
        if (el.statActiveVehicles) el.statActiveVehicles.textContent = (summary.active || 0).toLocaleString();
        if (el.statInactiveVehicles) el.statInactiveVehicles.textContent = (summary.inactive || 0).toLocaleString();
        if (el.statMaintenanceVehicles) el.statMaintenanceVehicles.textContent = (summary.under_maintenance || 0).toLocaleString();
    }

    // Create Vehicle Table Row
    function createVehicleRow(v) {
        const tr = document.createElement("tr");
        tr.id = `vehicle-row-${v.vehicle_id}`;
        tr.dataset.vehicleId = v.vehicle_id;
        tr.dataset.status = v.status;

        const s = v.status;
        const quickStatusBtn = s === "active"
            ? `<button type="button" class="btn-table-action btn-block btn-status-toggle" data-action="inactive" title="Set to Inactive">Deactivate</button>`
            : `<button type="button" class="btn-table-action btn-unblock btn-status-toggle" data-action="active" title="Set to Active">Activate</button>`;

        const maintenanceBtn = s === "under_maintenance"
            ? `<button type="button" class="btn-table-action btn-unblock btn-status-toggle" data-action="active" title="Mark Maintenance Complete">Done Repaired</button>`
            : `<button type="button" class="btn-table-action btn-reject btn-status-toggle" data-action="under_maintenance" title="Send to Maintenance">🔧 Service</button>`;

        tr.innerHTML = `
            <td>
                <span class="vehicle-plate">${escapeHtml(v.vehicle_number)}</span>
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 3px;">ID #${v.vehicle_id}</div>
            </td>
            <td>
                <span class="badge-pill badge-info">${escapeHtml(v.vehicle_type)}</span>
            </td>
            <td>
                <strong>${escapeHtml(v.model)}</strong>
            </td>
            <td>
                <span>${v.capacity} seats</span>
            </td>
            <td>
                <div class="driver-info-cell">
                    <span class="driver-name">${escapeHtml(v.driver_name)}</span>
                    <span class="driver-sub">📞 ${escapeHtml(v.driver_phone || 'N/A')}</span>
                    <span class="driver-sub">Lic: ${escapeHtml(v.license_no || 'N/A')}</span>
                </div>
            </td>
            <td>
                <span style="font-weight: 600;">${v.total_trips} ${v.total_trips === 1 ? 'trip' : 'trips'}</span>
            </td>
            <td class="status-cell">
                ${getStatusBadge(v.status)}
            </td>
            <td class="action-cell" style="text-align: center;">
                <div class="table-actions" style="justify-content: center; gap: 4px;">
                    <button type="button" class="btn-table-action btn-edit-vehicle btn-secondary" title="Edit Vehicle Details">✏️ Edit</button>
                    ${quickStatusBtn}
                    ${maintenanceBtn}
                </div>
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
            el.paginationInfo.textContent = "Showing 0 vehicles";
            el.paginationControls.innerHTML = "";
            return;
        }

        const startIdx = (page - 1) * limit + 1;
        const endIdx = Math.min(page * limit, total);
        el.paginationInfo.textContent = `Showing ${startIdx} to ${endIdx} of ${total} vehicle${total === 1 ? '' : 's'}`;

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

    // Fetch Drivers for assignment dropdown
    async function loadDriverOptions() {
        try {
            const res = await fetch(`${API_BASE}/api/admin/drivers?limit=100`);
            const data = await res.json();
            if (data.success && data.drivers) {
                state.drivers = data.drivers;
                el.fDriverId.innerHTML = `<option value="">— Select Driver —</option>` +
                    data.drivers.map(d => `<option value="${d.driver_id}">${escapeHtml(d.name)} (${escapeHtml(d.license_no)}) - ${d.status}</option>`).join("");
            }
        } catch (e) {
            console.error("Failed to load driver options:", e);
        }
    }

    // Load Vehicles
    async function loadVehicles() {
        if (state.isLoading) return;
        state.isLoading = true;

        if (el.refreshBtn) {
            el.refreshBtn.disabled = true;
            el.refreshBtn.innerHTML = `<span class="loading-spinner"></span> Loading…`;
        }

        el.vehiclesList.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state">
                    <span class="loading-spinner"></span> Loading vehicles from database…
                </td>
            </tr>
        `;

        const queryParams = new URLSearchParams({
            page: state.page,
            limit: state.limit,
            status: state.status,
            type: state.type,
            search: state.search
        });

        try {
            const response = await fetch(`${API_BASE}/api/admin/vehicles?${queryParams.toString()}`);
            if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
            const data = await response.json();
            if (!data.success) throw new Error(data.message || "Failed to load vehicles");

            if (data.summary) updateSummaryMetrics(data.summary);

            const vehicles = data.vehicles || [];

            if (el.vehiclesSubtitle) {
                if (state.search || state.status !== "all" || state.type !== "all") {
                    el.vehiclesSubtitle.textContent = `Found ${data.pagination.total} matching vehicle(s).`;
                } else {
                    el.vehiclesSubtitle.textContent = `Total of ${data.pagination.total} registered vehicles in platform fleet.`;
                }
            }

            if (vehicles.length === 0) {
                el.vehiclesList.innerHTML = `
                    <tr>
                        <td colspan="8" class="empty-state">
                            <div style="font-size: 28px; margin-bottom: 8px;">🚗</div>
                            <strong>No vehicles found</strong>
                            <p style="margin-top: 4px; color: var(--text-muted); font-size: 12px;">
                                ${state.search || state.status !== "all" || state.type !== "all"
                                    ? "No vehicles match the active filters. Try resetting filters."
                                    : "No vehicles registered yet. Click 'Add Vehicle' to register one."}
                            </p>
                        </td>
                    </tr>
                `;
                renderPagination({ total: 0, page: 1, limit: state.limit, totalPages: 1 });
                return;
            }

            el.vehiclesList.innerHTML = "";
            const fragment = document.createDocumentFragment();
            vehicles.forEach(v => {
                const tr = createVehicleRow(v);
                tr._vehicleData = v;
                fragment.appendChild(tr);
            });
            el.vehiclesList.appendChild(fragment);

            if (data.pagination) renderPagination(data.pagination);

        } catch (err) {
            console.error("Error fetching vehicles:", err);
            el.vehiclesList.innerHTML = `
                <tr>
                    <td colspan="8" class="empty-state" style="color: var(--status-danger);">
                        <div style="font-size: 24px; margin-bottom: 6px;">⚠️</div>
                        <strong>Failed to load vehicles</strong>
                        <p style="margin-top: 4px; font-size: 12px; color: var(--text-secondary);">${escapeHtml(err.message)}</p>
                        <button type="button" class="btn-secondary" style="margin-top: 12px;" onclick="window.RideNowVehicles.reload()">Try Again</button>
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

    // Toggle vehicle status
    async function updateVehicleStatus(vehicleId, targetStatus, btnElement) {
        const row = document.getElementById(`vehicle-row-${vehicleId}`);
        const originalText = btnElement.textContent;
        btnElement.disabled = true;
        btnElement.innerHTML = `<span class="loading-spinner"></span>`;

        try {
            const res = await fetch(`${API_BASE}/api/admin/vehicles/${vehicleId}/status`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: targetStatus })
            });

            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || "Failed to update status");

            showToast(data.message, "success");
            loadVehicles();
        } catch (e) {
            console.error("Status update error:", e);
            btnElement.disabled = false;
            btnElement.textContent = originalText;
            showToast(e.message, "danger");
        }
    }

    // Modal Operations
    function openModal(isEdit = false, vehicleData = null) {
        el.formError.style.display = "none";
        el.formError.textContent = "";

        if (isEdit && vehicleData) {
            el.modalTitle.textContent = `Edit Vehicle: ${vehicleData.vehicle_number}`;
            el.editVehicleId.value = vehicleData.vehicle_id;
            el.fVehicleNumber.value = vehicleData.vehicle_number;
            el.fVehicleType.value = vehicleData.vehicle_type;
            el.fModel.value = vehicleData.model;
            el.fCapacity.value = vehicleData.capacity;
            el.fDriverId.value = vehicleData.driver_id;
            el.fStatus.value = vehicleData.status;
            el.formSubmitBtn.textContent = "Save Changes";
        } else {
            el.modalTitle.textContent = "Register New Vehicle";
            el.editVehicleId.value = "";
            el.vehicleForm.reset();
            el.fStatus.value = "active";
            el.formSubmitBtn.textContent = "Register Vehicle";
        }

        el.vehicleModal.style.display = "flex";
    }

    function closeModal() {
        el.vehicleModal.style.display = "none";
        el.vehicleForm.reset();
    }

    // Submit form (Create / Update)
    async function handleFormSubmit(e) {
        e.preventDefault();
        el.formError.style.display = "none";

        const vehicleId = el.editVehicleId.value;
        const isEdit = Boolean(vehicleId);

        const vehicle_number = el.fVehicleNumber.value.trim().toUpperCase();
        const vehicle_type = el.fVehicleType.value;
        const model = el.fModel.value.trim();
        const capacity = parseInt(el.fCapacity.value, 10);
        const driver_id = parseInt(el.fDriverId.value, 10);
        const status = el.fStatus.value;

        // Validations
        if (!vehicle_number) {
            showFormError("Vehicle registration number is required.");
            return;
        }
        if (!/^[A-Z0-9- ]{4,20}$/i.test(vehicle_number)) {
            showFormError("Enter a valid vehicle plate (e.g. KA-01-MJ-1234).");
            return;
        }
        if (!vehicle_type) {
            showFormError("Please select a vehicle category.");
            return;
        }
        if (!model) {
            showFormError("Model name is required (e.g. Honda City).");
            return;
        }
        if (isNaN(capacity) || capacity < 1 || capacity > 20) {
            showFormError("Capacity must be between 1 and 20 seats.");
            return;
        }
        if (isNaN(driver_id) || driver_id <= 0) {
            showFormError("Please select an assigned driver.");
            return;
        }

        const payload = {
            vehicle_number,
            vehicle_type,
            model,
            capacity,
            driver_id,
            status
        };

        const submitBtn = el.formSubmitBtn;
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span class="loading-spinner"></span> Saving…`;

        try {
            const url = isEdit ? `${API_BASE}/api/admin/vehicles/${vehicleId}` : `${API_BASE}/api/admin/vehicles`;
            const method = isEdit ? "PATCH" : "POST";

            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || "Failed to save vehicle");

            showToast(data.message, "success");
            closeModal();
            loadVehicles();
        } catch (err) {
            console.error("Save vehicle error:", err);
            showFormError(err.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = isEdit ? "Save Changes" : "Register Vehicle";
        }
    }

    function showFormError(msg) {
        el.formError.textContent = msg;
        el.formError.style.display = "block";
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
        // Table actions delegation
        el.vehiclesList.addEventListener("click", function (e) {
            const row = e.target.closest("tr");
            if (!row || !row._vehicleData) return;
            const v = row._vehicleData;

            // Status toggle
            const statusBtn = e.target.closest(".btn-status-toggle");
            if (statusBtn && !statusBtn.disabled) {
                const targetAction = statusBtn.dataset.action;
                updateVehicleStatus(v.vehicle_id, targetAction, statusBtn);
                return;
            }

            // Edit
            const editBtn = e.target.closest(".btn-edit-vehicle");
            if (editBtn) {
                openModal(true, v);
                return;
            }
        });

        // Search debounced
        let searchDebounceTimer = null;
        el.searchInput.addEventListener("input", function (e) {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                state.search = e.target.value.trim();
                state.page = 1;
                loadVehicles();
            }, 300);
        });

        el.searchInput.addEventListener("search", function (e) {
            state.search = e.target.value.trim();
            state.page = 1;
            loadVehicles();
        });

        // Filters
        el.statusFilter.addEventListener("change", function (e) {
            state.status = e.target.value;
            state.page = 1;
            loadVehicles();
        });

        el.typeFilter.addEventListener("change", function (e) {
            state.type = e.target.value;
            state.page = 1;
            loadVehicles();
        });

        el.limitFilter.addEventListener("change", function (e) {
            state.limit = parseInt(e.target.value, 10) || 10;
            state.page = 1;
            loadVehicles();
        });

        el.resetFiltersBtn.addEventListener("click", function () {
            state.search = "";
            state.status = "all";
            state.type = "all";
            state.page = 1;
            el.searchInput.value = "";
            el.statusFilter.value = "all";
            el.typeFilter.value = "all";
            loadVehicles();
        });

        el.refreshBtn.addEventListener("click", loadVehicles);

        // Pagination delegation
        el.paginationControls.addEventListener("click", function (e) {
            const btn = e.target.closest(".pagination-btn");
            if (!btn || btn.disabled || btn.classList.contains("active")) return;
            const targetPage = parseInt(btn.dataset.page, 10);
            if (targetPage && targetPage >= 1 && targetPage <= state.totalPages) {
                state.page = targetPage;
                loadVehicles();
            }
        });

        // Modal triggers
        el.addVehicleBtn.addEventListener("click", () => openModal(false));
        el.modalCloseBtn.addEventListener("click", closeModal);
        el.modalCancelBtn.addEventListener("click", closeModal);
        el.vehicleModal.addEventListener("click", function (e) {
            if (e.target === el.vehicleModal) closeModal();
        });

        el.vehicleForm.addEventListener("submit", handleFormSubmit);

        // Logout
        if (el.logoutBtn) {
            el.logoutBtn.addEventListener("click", function () {
                localStorage.removeItem("ridenow_user");
            });
        }
    }

    window.RideNowVehicles = {
        reload: loadVehicles,
        openModal: openModal
    };

    document.addEventListener("DOMContentLoaded", function () {
        checkAdminSession();
        setupEventListeners();
        loadDriverOptions();
        loadVehicles();
    });

})();

