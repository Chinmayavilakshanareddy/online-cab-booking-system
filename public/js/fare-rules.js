// RideNow Admin - Fare Rules & Service Areas Management (Vanilla JS + DOM + Fetch)

(function () {
    "use strict";

    const API_BASE = window.location.origin.includes("3000")
        ? window.location.origin
        : "http://localhost:3000";

    const state = {
        activeTab: "fareRules", // 'fareRules' | 'serviceAreas'
        fareRules: [],
        serviceAreas: [],
        fareFilter: {
            search: "",
            status: "all"
        },
        areaFilter: {
            search: "",
            status: "all"
        },
        isLoadingFares: false,
        isLoadingAreas: false
    };

    // DOM Elements Cache
    const el = {
        adminUserName: document.getElementById("adminUserName"),
        adminUserAvatar: document.getElementById("adminUserAvatar"),
        logoutBtn: document.getElementById("logoutBtn"),
        refreshBtn: document.getElementById("refreshBtn"),
        toastContainer: document.getElementById("toastContainer"),

        // Stats
        statActiveRules: document.getElementById("statActiveRules"),
        statActiveRulesPct: document.getElementById("statActiveRulesPct"),
        statInactiveRulesMeta: document.getElementById("statInactiveRulesMeta"),
        statActiveAreas: document.getElementById("statActiveAreas"),
        statTotalAreasMeta: document.getElementById("statTotalAreasMeta"),

        // Tabs
        tabBtnFareRules: document.getElementById("tabBtnFareRules"),
        tabBtnServiceAreas: document.getElementById("tabBtnServiceAreas"),
        sectionFareRules: document.getElementById("sectionFareRules"),
        sectionServiceAreas: document.getElementById("sectionServiceAreas"),

        // Topbar buttons
        addFareRuleBtn: document.getElementById("addFareRuleBtn"),
        addServiceAreaBtn: document.getElementById("addServiceAreaBtn"),

        // Fare Rules Controls & Table
        fareSearchInput: document.getElementById("fareSearchInput"),
        fareStatusFilter: document.getElementById("fareStatusFilter"),
        resetFareFiltersBtn: document.getElementById("resetFareFiltersBtn"),
        fareRulesCount: document.getElementById("fareRulesCount"),
        fareRulesTableBody: document.getElementById("fareRulesTableBody"),

        // Service Areas Controls & Table
        areaSearchInput: document.getElementById("areaSearchInput"),
        areaStatusFilter: document.getElementById("areaStatusFilter"),
        resetAreaFiltersBtn: document.getElementById("resetAreaFiltersBtn"),
        serviceAreasCount: document.getElementById("serviceAreasCount"),
        serviceAreasTableBody: document.getElementById("serviceAreasTableBody"),

        // Fare Modal
        fareModal: document.getElementById("fareModal"),
        fareModalTitle: document.getElementById("fareModalTitle"),
        fareModalCloseBtn: document.getElementById("fareModalCloseBtn"),
        fareModalCancelBtn: document.getElementById("fareModalCancelBtn"),
        fareRuleForm: document.getElementById("fareRuleForm"),
        editFareId: document.getElementById("editFareId"),
        fVehicleType: document.getElementById("fVehicleType"),
        fBaseFare: document.getElementById("fBaseFare"),
        fPerKmRate: document.getElementById("fPerKmRate"),
        fPerMinuteRate: document.getElementById("fPerMinuteRate"),
        fCancellationFee: document.getElementById("fCancellationFee"),
        fFareStatus: document.getElementById("fFareStatus"),
        fareFormError: document.getElementById("fareFormError"),
        fareFormSubmitBtn: document.getElementById("fareFormSubmitBtn"),

        // Service Area Modal
        areaModal: document.getElementById("areaModal"),
        areaModalTitle: document.getElementById("areaModalTitle"),
        areaModalCloseBtn: document.getElementById("areaModalCloseBtn"),
        areaModalCancelBtn: document.getElementById("areaModalCancelBtn"),
        serviceAreaForm: document.getElementById("serviceAreaForm"),
        editAreaId: document.getElementById("editAreaId"),
        fAreaName: document.getElementById("fAreaName"),
        fCity: document.getElementById("fCity"),
        fState: document.getElementById("fState"),
        fAreaStatus: document.getElementById("fAreaStatus"),
        areaFormError: document.getElementById("areaFormError"),
        areaFormSubmitBtn: document.getElementById("areaFormSubmitBtn")
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
    // TAB SWITCHING
    // ========================================================
    function switchTab(target) {
        state.activeTab = target;
        if (target === "fareRules") {
            el.tabBtnFareRules.classList.add("active");
            el.tabBtnServiceAreas.classList.remove("active");
            el.sectionFareRules.style.display = "block";
            el.sectionServiceAreas.style.display = "none";
        } else {
            el.tabBtnServiceAreas.classList.add("active");
            el.tabBtnFareRules.classList.remove("active");
            el.sectionServiceAreas.style.display = "block";
            el.sectionFareRules.style.display = "none";
        }
    }

    // ========================================================
    // 1. FARE RULES LOGIC
    // ========================================================
    async function loadFareRules() {
        state.isLoadingFares = true;
        el.fareRulesTableBody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-state-cell">
                    <span class="loading-spinner"></span> Loading fare rules from database...
                </td>
            </tr>
        `;

        try {
            const res = await fetch(`${API_BASE}/api/admin/fare-rules`, {
                headers: { "Content-Type": "application/json" }
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.message || "Failed to load fare rules");
            }

            state.fareRules = data.fare_rules || [];
            updateStats(data.summary, null);
            renderFareRules();
        } catch (err) {
            console.error("Fare rules load error:", err);
            el.fareRulesTableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-state-cell" style="color: var(--status-danger);">
                        ✕ Unable to connect to server: ${escapeHtml(err.message)}
                    </td>
                </tr>
            `;
            el.fareRulesCount.textContent = "Error loading rate cards";
        } finally {
            state.isLoadingFares = false;
        }
    }

    function renderFareRules() {
        const tbody = el.fareRulesTableBody;
        const q = state.fareFilter.search.toLowerCase();
        const st = state.fareFilter.status;

        const filtered = state.fareRules.filter(r => {
            const matchesSearch = !q || (r.vehicle_type && r.vehicle_type.toLowerCase().includes(q));
            const matchesStatus = st === "all" || r.status === st;
            return matchesSearch && matchesStatus;
        });

        el.fareRulesCount.textContent = `Showing ${filtered.length} of ${state.fareRules.length} rate cards`;

        if (filtered.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-state-cell">
                        No fare rules found matching filter criteria.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = filtered.map(rule => {
            const isActive = rule.status === "active";
            const statusBadge = isActive
                ? `<span class="badge-pill badge-success">Active</span>`
                : `<span class="badge-pill badge-danger">Inactive</span>`;

            const toggleActionText = isActive ? "Deactivate" : "Activate";
            const toggleBtnClass = isActive ? "btn-reject" : "btn-approve";

            return `
                <tr data-fare-id="${rule.fare_id}">
                    <td>
                        <strong style="color: var(--text-primary); font-size: 14px;">${escapeHtml(rule.vehicle_type)}</strong>
                    </td>
                    <td><span style="font-weight: 650; color: #166534;">${formatCurrency(rule.base_fare)}</span></td>
                    <td>${formatCurrency(rule.per_km_rate)} / km</td>
                    <td>${formatCurrency(rule.per_minute_rate)} / min</td>
                    <td><span style="color: #b91c1c; font-weight: 600;">${formatCurrency(rule.cancellation_fee)}</span></td>
                    <td>${statusBadge}</td>
                    <td style="text-align: center;">
                        <div class="table-actions" style="justify-content: center; gap: 6px;">
                            <button type="button" class="btn-table-action btn-view btn-edit-fare" data-fare-id="${rule.fare_id}" title="Edit fare rule">
                                ✏️ Edit
                            </button>
                            <button type="button" class="btn-table-action ${toggleBtnClass} btn-toggle-fare" data-fare-id="${rule.fare_id}" data-current-status="${rule.status}">
                                ${toggleActionText}
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join("");
    }

    async function toggleFareStatus(fareId, currentStatus, btn) {
        btn.disabled = true;
        const newStatus = currentStatus === "active" ? "inactive" : "active";

        try {
            const res = await fetch(`${API_BASE}/api/admin/fare-rules/${fareId}/status`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: newStatus })
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.message || "Failed to update fare rule status");
            }

            showToast(data.message || `Fare rule status changed to ${newStatus}`, "success");
            await loadFareRules();
        } catch (err) {
            console.error("Toggle fare status error:", err);
            showToast(err.message, "danger");
            btn.disabled = false;
        }
    }

    function openFareModal(isEdit = false, fare = null) {
        el.fareFormError.style.display = "none";
        el.fareRuleForm.reset();

        if (isEdit && fare) {
            el.fareModalTitle.textContent = `Edit Rate Card: ${fare.vehicle_type}`;
            el.editFareId.value = fare.fare_id;
            el.fVehicleType.value = fare.vehicle_type;
            el.fBaseFare.value = fare.base_fare;
            el.fPerKmRate.value = fare.per_km_rate;
            el.fPerMinuteRate.value = fare.per_minute_rate;
            el.fCancellationFee.value = fare.cancellation_fee;
            el.fFareStatus.value = fare.status;
            el.fareFormSubmitBtn.textContent = "Save Changes";
        } else {
            el.fareModalTitle.textContent = "Add Vehicle Fare Rule";
            el.editFareId.value = "";
            el.fBaseFare.value = "50.00";
            el.fPerKmRate.value = "12.00";
            el.fPerMinuteRate.value = "1.50";
            el.fCancellationFee.value = "25.00";
            el.fFareStatus.value = "active";
            el.fareFormSubmitBtn.textContent = "Add Fare Rule";
        }

        el.fareModal.style.display = "flex";
        setTimeout(() => el.fVehicleType.focus(), 50);
    }

    function closeFareModal() {
        el.fareModal.style.display = "none";
        el.fareRuleForm.reset();
        el.editFareId.value = "";
    }

    async function handleFareSubmit(e) {
        e.preventDefault();
        el.fareFormError.style.display = "none";

        const fareId = el.editFareId.value.trim();
        const isEdit = Boolean(fareId);

        const vehicleType = el.fVehicleType.value.trim();
        const baseFare = parseFloat(el.fBaseFare.value);
        const perKmRate = parseFloat(el.fPerKmRate.value);
        const perMinuteRate = parseFloat(el.fPerMinuteRate.value);
        const cancellationFee = parseFloat(el.fCancellationFee.value);
        const status = el.fFareStatus.value;

        if (!vehicleType) {
            showFareFormError("Please enter a vehicle category.");
            el.fVehicleType.focus();
            return;
        }
        if (isNaN(baseFare) || baseFare < 0) {
            showFareFormError("Base fare must be a valid non-negative number.");
            el.fBaseFare.focus();
            return;
        }
        if (isNaN(perKmRate) || perKmRate < 0) {
            showFareFormError("Per-kilometre rate must be a valid non-negative number.");
            el.fPerKmRate.focus();
            return;
        }
        if (isNaN(perMinuteRate) || perMinuteRate < 0) {
            showFareFormError("Per-minute rate must be a valid non-negative number.");
            el.fPerMinuteRate.focus();
            return;
        }
        if (isNaN(cancellationFee) || cancellationFee < 0) {
            showFareFormError("Cancellation fee must be a valid non-negative number.");
            el.fCancellationFee.focus();
            return;
        }

        const payload = {
            vehicle_type: vehicleType,
            base_fare: baseFare,
            per_km_rate: perKmRate,
            per_minute_rate: perMinuteRate,
            cancellation_fee: cancellationFee,
            status: status
        };

        const submitBtn = el.fareFormSubmitBtn;
        submitBtn.disabled = true;
        submitBtn.textContent = "Saving...";

        try {
            const url = isEdit
                ? `${API_BASE}/api/admin/fare-rules/${fareId}`
                : `${API_BASE}/api/admin/fare-rules`;
            const method = isEdit ? "PATCH" : "POST";

            const res = await fetch(url, {
                method: method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.message || "Failed to save fare rule");
            }

            closeFareModal();
            showToast(data.message || (isEdit ? "Fare rule updated successfully!" : "Fare rule created successfully!"), "success");
            await loadFareRules();
        } catch (err) {
            console.error("Fare save error:", err);
            showFareFormError(err.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = isEdit ? "Save Changes" : "Add Fare Rule";
        }
    }

    function showFareFormError(msg) {
        el.fareFormError.textContent = msg;
        el.fareFormError.style.display = "block";
    }

    // ========================================================
    // 2. SERVICE AREAS LOGIC
    // ========================================================
    async function loadServiceAreas() {
        state.isLoadingAreas = true;
        el.serviceAreasTableBody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-state-cell">
                    <span class="loading-spinner"></span> Loading service areas from database...
                </td>
            </tr>
        `;

        try {
            const res = await fetch(`${API_BASE}/api/admin/service-areas`, {
                headers: { "Content-Type": "application/json" }
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.message || "Failed to load service areas");
            }

            state.serviceAreas = data.service_areas || [];
            updateStats(null, data.summary);
            renderServiceAreas();
        } catch (err) {
            console.error("Service areas load error:", err);
            el.serviceAreasTableBody.innerHTML = `
                <tr>
                    <td colspan="5" class="empty-state-cell" style="color: var(--status-danger);">
                        ✕ Unable to connect to server: ${escapeHtml(err.message)}
                    </td>
                </tr>
            `;
            el.serviceAreasCount.textContent = "Error loading service areas";
        } finally {
            state.isLoadingAreas = false;
        }
    }

    function renderServiceAreas() {
        const tbody = el.serviceAreasTableBody;
        const q = state.areaFilter.search.toLowerCase();
        const st = state.areaFilter.status;

        const filtered = state.serviceAreas.filter(a => {
            const matchesSearch = !q ||
                (a.area_name && a.area_name.toLowerCase().includes(q)) ||
                (a.city && a.city.toLowerCase().includes(q)) ||
                (a.state && a.state.toLowerCase().includes(q));
            const matchesStatus = st === "all" || a.status === st;
            return matchesSearch && matchesStatus;
        });

        el.serviceAreasCount.textContent = `Showing ${filtered.length} of ${state.serviceAreas.length} service areas`;

        if (filtered.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="empty-state-cell">
                        No service areas found matching search criteria.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = filtered.map(area => {
            const isActive = area.status === "active";
            const statusBadge = isActive
                ? `<span class="badge-pill badge-success">Active</span>`
                : `<span class="badge-pill badge-danger">Inactive</span>`;

            const toggleActionText = isActive ? "Deactivate" : "Activate";
            const toggleBtnClass = isActive ? "btn-reject" : "btn-approve";

            return `
                <tr data-area-id="${area.area_id}">
                    <td>
                        <strong style="color: var(--text-primary); font-size: 14px;">📍 ${escapeHtml(area.area_name)}</strong>
                    </td>
                    <td>${escapeHtml(area.city)}</td>
                    <td>${escapeHtml(area.state)}</td>
                    <td>${statusBadge}</td>
                    <td style="text-align: center;">
                        <div class="table-actions" style="justify-content: center; gap: 6px;">
                            <button type="button" class="btn-table-action btn-view btn-edit-area" data-area-id="${area.area_id}" title="Edit service area">
                                ✏️ Edit
                            </button>
                            <button type="button" class="btn-table-action ${toggleBtnClass} btn-toggle-area" data-area-id="${area.area_id}" data-current-status="${area.status}">
                                ${toggleActionText}
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join("");
    }

    async function toggleAreaStatus(areaId, currentStatus, btn) {
        btn.disabled = true;
        const newStatus = currentStatus === "active" ? "inactive" : "active";

        try {
            const res = await fetch(`${API_BASE}/api/admin/service-areas/${areaId}/status`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: newStatus })
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.message || "Failed to update service area status");
            }

            showToast(data.message || `Service area status changed to ${newStatus}`, "success");
            await loadServiceAreas();
        } catch (err) {
            console.error("Toggle area status error:", err);
            showToast(err.message, "danger");
            btn.disabled = false;
        }
    }

    function openAreaModal(isEdit = false, area = null) {
        el.areaFormError.style.display = "none";
        el.serviceAreaForm.reset();

        if (isEdit && area) {
            el.areaModalTitle.textContent = `Edit Service Area #${area.area_id}`;
            el.editAreaId.value = area.area_id;
            el.fAreaName.value = area.area_name;
            el.fCity.value = area.city;
            el.fState.value = area.state;
            el.fAreaStatus.value = area.status;
            el.areaFormSubmitBtn.textContent = "Save Changes";
        } else {
            el.areaModalTitle.textContent = "Add New Service Area";
            el.editAreaId.value = "";
            el.fCity.value = "Bangalore";
            el.fState.value = "Karnataka";
            el.fAreaStatus.value = "active";
            el.areaFormSubmitBtn.textContent = "Add Service Area";
        }

        el.areaModal.style.display = "flex";
        setTimeout(() => el.fAreaName.focus(), 50);
    }

    function closeAreaModal() {
        el.areaModal.style.display = "none";
        el.serviceAreaForm.reset();
        el.editAreaId.value = "";
    }

    async function handleAreaSubmit(e) {
        e.preventDefault();
        el.areaFormError.style.display = "none";

        const areaId = el.editAreaId.value.trim();
        const isEdit = Boolean(areaId);

        const areaName = el.fAreaName.value.trim();
        const city = el.fCity.value.trim();
        const stateName = el.fState.value.trim();
        const status = el.fAreaStatus.value;

        if (!areaName) {
            showAreaFormError("Area name is required.");
            el.fAreaName.focus();
            return;
        }
        if (!city) {
            showAreaFormError("City is required.");
            el.fCity.focus();
            return;
        }
        if (!stateName) {
            showAreaFormError("State is required.");
            el.fState.focus();
            return;
        }

        const payload = {
            area_name: areaName,
            city: city,
            state: stateName,
            status: status
        };

        const submitBtn = el.areaFormSubmitBtn;
        submitBtn.disabled = true;
        submitBtn.textContent = "Saving...";

        try {
            const url = isEdit
                ? `${API_BASE}/api/admin/service-areas/${areaId}`
                : `${API_BASE}/api/admin/service-areas`;
            const method = isEdit ? "PATCH" : "POST";

            const res = await fetch(url, {
                method: method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.message || "Failed to save service area");
            }

            closeAreaModal();
            showToast(data.message || (isEdit ? "Service area updated successfully!" : "Service area added successfully!"), "success");
            await loadServiceAreas();
        } catch (err) {
            console.error("Area save error:", err);
            showAreaFormError(err.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = isEdit ? "Save Changes" : "Add Service Area";
        }
    }

    function showAreaFormError(msg) {
        el.areaFormError.textContent = msg;
        el.areaFormError.style.display = "block";
    }

    // ========================================================
    // 3. STATS UPDATE
    // ========================================================
    function updateStats(fareSummary, areaSummary) {
        if (fareSummary) {
            if (el.statActiveRules) el.statActiveRules.textContent = fareSummary.active || 0;
            if (el.statActiveRulesPct) el.statActiveRulesPct.textContent = `${fareSummary.active || 0} Active`;
            if (el.statInactiveRulesMeta) el.statInactiveRulesMeta.textContent = `${fareSummary.inactive || 0} Inactive / ${fareSummary.total || 0} Total`;
        }
        if (areaSummary) {
            if (el.statActiveAreas) el.statActiveAreas.textContent = areaSummary.active || 0;
            if (el.statTotalAreasMeta) el.statTotalAreasMeta.textContent = `${areaSummary.total || 0} Total Zones`;
        }
    }

    // ========================================================
    // 4. EVENT LISTENERS
    // ========================================================
    function setupEventListeners() {
        // Tab switching
        el.tabBtnFareRules.addEventListener("click", () => switchTab("fareRules"));
        el.tabBtnServiceAreas.addEventListener("click", () => switchTab("serviceAreas"));

        // Refresh
        el.refreshBtn.addEventListener("click", () => {
            loadFareRules();
            loadServiceAreas();
            showToast("Reloaded fare rules and service areas", "info");
        });

        // Fare rules search & filter
        let fareDebounce = null;
        el.fareSearchInput.addEventListener("input", (e) => {
            clearTimeout(fareDebounce);
            fareDebounce = setTimeout(() => {
                state.fareFilter.search = e.target.value.trim();
                renderFareRules();
            }, 250);
        });

        el.fareStatusFilter.addEventListener("change", (e) => {
            state.fareFilter.status = e.target.value;
            renderFareRules();
        });

        el.resetFareFiltersBtn.addEventListener("click", () => {
            state.fareFilter.search = "";
            state.fareFilter.status = "all";
            el.fareSearchInput.value = "";
            el.fareStatusFilter.value = "all";
            renderFareRules();
        });

        // Area search & filter
        let areaDebounce = null;
        el.areaSearchInput.addEventListener("input", (e) => {
            clearTimeout(areaDebounce);
            areaDebounce = setTimeout(() => {
                state.areaFilter.search = e.target.value.trim();
                renderServiceAreas();
            }, 250);
        });

        el.areaStatusFilter.addEventListener("change", (e) => {
            state.areaFilter.status = e.target.value;
            renderServiceAreas();
        });

        el.resetAreaFiltersBtn.addEventListener("click", () => {
            state.areaFilter.search = "";
            state.areaFilter.status = "all";
            el.areaSearchInput.value = "";
            el.areaStatusFilter.value = "all";
            renderServiceAreas();
        });

        // Table event delegation for Fare Rules
        el.fareRulesTableBody.addEventListener("click", (e) => {
            const editBtn = e.target.closest(".btn-edit-fare");
            if (editBtn) {
                const fareId = parseInt(editBtn.dataset.fareId, 10);
                const fare = state.fareRules.find(f => f.fare_id === fareId);
                if (fare) openFareModal(true, fare);
                return;
            }

            const toggleBtn = e.target.closest(".btn-toggle-fare");
            if (toggleBtn) {
                const fareId = parseInt(toggleBtn.dataset.fareId, 10);
                const currentStatus = toggleBtn.dataset.currentStatus;
                toggleFareStatus(fareId, currentStatus, toggleBtn);
                return;
            }
        });

        // Table event delegation for Service Areas
        el.serviceAreasTableBody.addEventListener("click", (e) => {
            const editBtn = e.target.closest(".btn-edit-area");
            if (editBtn) {
                const areaId = parseInt(editBtn.dataset.areaId, 10);
                const area = state.serviceAreas.find(a => a.area_id === areaId);
                if (area) openAreaModal(true, area);
                return;
            }

            const toggleBtn = e.target.closest(".btn-toggle-area");
            if (toggleBtn) {
                const areaId = parseInt(toggleBtn.dataset.areaId, 10);
                const currentStatus = toggleBtn.dataset.currentStatus;
                toggleAreaStatus(areaId, currentStatus, toggleBtn);
                return;
            }
        });

        // Modal triggers
        el.addFareRuleBtn.addEventListener("click", () => {
            switchTab("fareRules");
            openFareModal(false);
        });

        el.addServiceAreaBtn.addEventListener("click", () => {
            switchTab("serviceAreas");
            openAreaModal(false);
        });

        el.fareModalCloseBtn.addEventListener("click", closeFareModal);
        el.fareModalCancelBtn.addEventListener("click", closeFareModal);
        el.fareModal.addEventListener("click", (e) => {
            if (e.target === el.fareModal) closeFareModal();
        });
        el.fareRuleForm.addEventListener("submit", handleFareSubmit);

        el.areaModalCloseBtn.addEventListener("click", closeAreaModal);
        el.areaModalCancelBtn.addEventListener("click", closeAreaModal);
        el.areaModal.addEventListener("click", (e) => {
            if (e.target === el.areaModal) closeAreaModal();
        });
        el.serviceAreaForm.addEventListener("submit", handleAreaSubmit);

        // Logout
        if (el.logoutBtn) {
            el.logoutBtn.addEventListener("click", () => {
                localStorage.removeItem("ridenow_user");
            });
        }
    }

    // Initialize
    document.addEventListener("DOMContentLoaded", () => {
        checkAdminSession();
        setupEventListeners();
        loadFareRules();
        loadServiceAreas();
    });

    window.RideNowFareRules = {
        loadFares: loadFareRules,
        loadAreas: loadServiceAreas,
        openFareModal,
        openAreaModal
    };

})();

