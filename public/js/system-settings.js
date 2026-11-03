// RideNow System Settings Module (Vanilla JS + DOM + Fetch)

(function () {
    "use strict";

    const API_BASE = window.location.origin.includes("3000")
        ? window.location.origin
        : "http://localhost:3000";

    const state = {
        settings: {},
        originalSettings: {},
        changeHistory: [],
        isLoading: false
    };

    // DOM Elements Cache
    const el = {
        adminUserName: document.getElementById("adminUserName"),
        adminUserAvatar: document.getElementById("adminUserAvatar"),
        logoutBtn: document.getElementById("logoutBtn"),
        refreshSettingsBtn: document.getElementById("refreshSettingsBtn"),
        resetBtn: document.getElementById("resetBtn"),
        toastContainer: document.getElementById("toastContainer"),

        // Banner
        maintenanceBanner: document.getElementById("maintenanceBanner"),
        disableMaintenanceQuickBtn: document.getElementById("disableMaintenanceQuickBtn"),

        // Form & Inputs
        settingsForm: document.getElementById("settingsForm"),
        saveSettingsBtn: document.getElementById("saveSettingsBtn"),

        platformName: document.getElementById("platformName"),
        supportEmail: document.getElementById("supportEmail"),
        bookingEnabled: document.getElementById("bookingEnabled"),
        driverRegEnabled: document.getElementById("driverRegEnabled"),
        maintenanceMode: document.getElementById("maintenanceMode"),

        maxBookingDays: document.getElementById("maxBookingDays"),
        cancelWindow: document.getElementById("cancelWindow"),
        defaultVehicleType: document.getElementById("defaultVehicleType"),
        minFareAmount: document.getElementById("minFareAmount"),
        surgeMultiplierMax: document.getElementById("surgeMultiplierMax"),

        // Errors
        errPlatformName: document.getElementById("errPlatformName"),
        errSupportEmail: document.getElementById("errSupportEmail"),
        errMaxBookingDays: document.getElementById("errMaxBookingDays"),
        errCancelWindow: document.getElementById("errCancelWindow"),
        errMinFareAmount: document.getElementById("errMinFareAmount"),
        errSurgeMultiplierMax: document.getElementById("errSurgeMultiplierMax"),

        // History
        historyTableBody: document.getElementById("historyTableBody")
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
    // 1. FETCH & POPULATE SETTINGS
    // ========================================================
    async function loadSettings() {
        state.isLoading = true;
        if (el.refreshSettingsBtn) {
            el.refreshSettingsBtn.disabled = true;
            el.refreshSettingsBtn.innerHTML = `<span class="loading-spinner"></span> Loading...`;
        }

        try {
            const res = await fetch(`${API_BASE}/api/admin/settings`, {
                headers: { "Content-Type": "application/json" }
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.message || "Failed to load system settings");
            }

            state.settings = data.flat || {};
            state.originalSettings = { ...data.flat };
            state.changeHistory = data.change_history || [];

            populateForm(state.settings);
            renderHistoryTable(state.changeHistory);
            updateMaintenanceBanner(state.settings.maintenance_mode === "true");
        } catch (err) {
            console.error("Load settings error:", err);
            showToast("Failed to load settings: " + err.message, "danger");
        } finally {
            state.isLoading = false;
            if (el.refreshSettingsBtn) {
                el.refreshSettingsBtn.disabled = false;
                el.refreshSettingsBtn.textContent = "Refresh";
            }
        }
    }

    function populateForm(s) {
        if (el.platformName) el.platformName.value = s.platform_name || "RideNow";
        if (el.supportEmail) el.supportEmail.value = s.support_email || "support@ridenow.com";
        if (el.bookingEnabled) el.bookingEnabled.checked = s.booking_enabled !== "false";
        if (el.driverRegEnabled) el.driverRegEnabled.checked = s.driver_registration_enabled !== "false";
        if (el.maintenanceMode) el.maintenanceMode.checked = s.maintenance_mode === "true";

        if (el.maxBookingDays) el.maxBookingDays.value = s.max_booking_days_ahead || "30";
        if (el.cancelWindow) el.cancelWindow.value = s.cancellation_window_minutes || "60";
        if (el.defaultVehicleType) el.defaultVehicleType.value = s.default_vehicle_type || "Sedan";
        if (el.minFareAmount) el.minFareAmount.value = parseFloat(s.min_fare_amount || "50");
        if (el.surgeMultiplierMax) el.surgeMultiplierMax.value = parseFloat(s.surge_multiplier_max || "2.5");

        clearValidationErrors();
    }

    function updateMaintenanceBanner(isMaintenanceActive) {
        if (el.maintenanceBanner) {
            el.maintenanceBanner.style.display = isMaintenanceActive ? "flex" : "none";
        }
    }

    function clearValidationErrors() {
        const errorEls = [
            el.errPlatformName,
            el.errSupportEmail,
            el.errMaxBookingDays,
            el.errCancelWindow,
            el.errMinFareAmount,
            el.errSurgeMultiplierMax
        ];
        errorEls.forEach(elem => {
            if (elem) {
                elem.style.display = "none";
                elem.textContent = "";
            }
        });
    }

    // ========================================================
    // 2. FORM VALIDATION
    // ========================================================
    function validateForm() {
        clearValidationErrors();
        let isValid = true;

        // Platform Name
        const name = (el.platformName ? el.platformName.value : "").trim();
        if (!name || name.length < 2 || name.length > 100) {
            if (el.errPlatformName) {
                el.errPlatformName.textContent = "Platform name must be between 2 and 100 characters.";
                el.errPlatformName.style.display = "block";
            }
            isValid = false;
        }

        // Support Email
        const email = (el.supportEmail ? el.supportEmail.value : "").trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            if (el.errSupportEmail) {
                el.errSupportEmail.textContent = "Please provide a valid support email address.";
                el.errSupportEmail.style.display = "block";
            }
            isValid = false;
        }

        // Max Booking Days
        const maxDays = parseInt(el.maxBookingDays ? el.maxBookingDays.value : "0", 10);
        if (isNaN(maxDays) || maxDays < 1 || maxDays > 365) {
            if (el.errMaxBookingDays) {
                el.errMaxBookingDays.textContent = "Advance booking days must be between 1 and 365 days.";
                el.errMaxBookingDays.style.display = "block";
            }
            isValid = false;
        }

        // Cancellation Window
        const cancelMin = parseInt(el.cancelWindow ? el.cancelWindow.value : "-1", 10);
        if (isNaN(cancelMin) || cancelMin < 0 || cancelMin > 1440) {
            if (el.errCancelWindow) {
                el.errCancelWindow.textContent = "Cancellation window must be between 0 and 1440 minutes (24 hours).";
                el.errCancelWindow.style.display = "block";
            }
            isValid = false;
        }

        // Min Fare Amount
        const minFare = parseFloat(el.minFareAmount ? el.minFareAmount.value : "-1");
        if (isNaN(minFare) || minFare < 0 || minFare > 10000) {
            if (el.errMinFareAmount) {
                el.errMinFareAmount.textContent = "Minimum fare floor must be between ₹0 and ₹10,000.";
                el.errMinFareAmount.style.display = "block";
            }
            isValid = false;
        }

        // Surge Multiplier
        const surge = parseFloat(el.surgeMultiplierMax ? el.surgeMultiplierMax.value : "0");
        if (isNaN(surge) || surge < 1.0 || surge > 5.0) {
            if (el.errSurgeMultiplierMax) {
                el.errSurgeMultiplierMax.textContent = "Maximum surge multiplier must be between 1.0x and 5.0x.";
                el.errSurgeMultiplierMax.style.display = "block";
            }
            isValid = false;
        }

        return isValid;
    }

    // ========================================================
    // 3. SAVE SETTINGS
    // ========================================================
    async function handleSaveSettings(e) {
        if (e) e.preventDefault();

        if (!validateForm()) {
            showToast("Please correct the validation errors before saving.", "warning");
            return;
        }

        const payload = {
            settings: {
                platform_name: el.platformName.value.trim(),
                support_email: el.supportEmail.value.trim(),
                booking_enabled: el.bookingEnabled.checked ? "true" : "false",
                driver_registration_enabled: el.driverRegEnabled.checked ? "true" : "false",
                maintenance_mode: el.maintenanceMode.checked ? "true" : "false",

                max_booking_days_ahead: el.maxBookingDays.value.trim(),
                cancellation_window_minutes: el.cancelWindow.value.trim(),
                default_vehicle_type: el.defaultVehicleType.value.trim(),
                min_fare_amount: el.minFareAmount.value.trim(),
                surge_multiplier_max: el.surgeMultiplierMax.value.trim()
            }
        };

        el.saveSettingsBtn.disabled = true;
        el.saveSettingsBtn.innerHTML = `<span class="loading-spinner"></span> Validating &amp; Saving...`;

        try {
            const res = await fetch(`${API_BASE}/api/admin/settings`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.message || "Failed to update system settings");
            }

            showToast(data.message || "Settings verified and saved successfully!", "success");
            loadSettings();
        } catch (err) {
            console.error("Save settings error:", err);
            showToast("Error saving settings: " + err.message, "danger");
        } finally {
            el.saveSettingsBtn.disabled = false;
            el.saveSettingsBtn.textContent = "Save and Apply All Settings";
        }
    }

    // Quick Disable Maintenance
    async function disableMaintenanceQuick() {
        if (!confirm("Are you sure you want to disable maintenance mode and resume full passenger ride dispatch?")) {
            return;
        }

        el.disableMaintenanceQuickBtn.disabled = true;
        el.disableMaintenanceQuickBtn.textContent = "Disabling...";

        try {
            const res = await fetch(`${API_BASE}/api/admin/settings`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    settings: {
                        maintenance_mode: "false"
                    }
                })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.message || "Failed to disable maintenance mode");
            }

            showToast("Maintenance mode has been disabled. Normal operations resumed.", "success");
            loadSettings();
        } catch (err) {
            console.error("Disable maintenance error:", err);
            showToast("Error: " + err.message, "danger");
        } finally {
            el.disableMaintenanceQuickBtn.disabled = false;
            el.disableMaintenanceQuickBtn.textContent = "Disable Maintenance";
        }
    }

    // ========================================================
    // 4. RENDER SETTINGS AUDIT HISTORY
    // ========================================================
    function renderHistoryTable(logs) {
        if (!el.historyTableBody) return;

        if (!logs || logs.length === 0) {
            el.historyTableBody.innerHTML = `
                <tr>
                    <td colspan="5" class="empty-state-cell">
                        No previous settings changes recorded in the audit log.
                    </td>
                </tr>
            `;
            return;
        }

        const rowsHtml = logs.map(log => {
            return `
                <tr>
                    <td style="font-weight: 700; color: var(--text-secondary); font-size: 13px;">
                        #${log.log_id}
                    </td>
                    <td style="font-size: 12px; color: var(--text-secondary); white-space: nowrap;">
                        ${escapeHtml(log.formatted_time)}
                    </td>
                    <td>
                        <strong style="color: var(--text-primary); font-size: 13px;">${escapeHtml(log.user_name || 'Administrator')}</strong>
                    </td>
                    <td style="font-size: 13px; color: var(--text-primary); line-height: 1.4;">
                        ${escapeHtml(log.description)}
                    </td>
                    <td style="text-align: right;">
                        <span style="font-family: monospace; font-size: 12px; color: var(--text-secondary); background: #f8fafc; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color);">${escapeHtml(log.ip_address || '127.0.0.1')}</span>
                    </td>
                </tr>
            `;
        }).join("");

        el.historyTableBody.innerHTML = rowsHtml;
    }

    // ========================================================
    // 5. EVENT LISTENERS
    // ========================================================
    function setupEventListeners() {
        if (el.settingsForm) {
            el.settingsForm.addEventListener("submit", handleSaveSettings);
        }

        if (el.refreshSettingsBtn) {
            el.refreshSettingsBtn.addEventListener("click", loadSettings);
        }

        if (el.resetBtn) {
            el.resetBtn.addEventListener("click", () => {
                populateForm(state.originalSettings);
                showToast("Form reset to currently active settings.", "info");
            });
        }

        if (el.disableMaintenanceQuickBtn) {
            el.disableMaintenanceQuickBtn.addEventListener("click", disableMaintenanceQuick);
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
    loadSettings();

})();

