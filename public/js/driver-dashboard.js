// =====================================
// RideNow - Driver Dashboard Controller
// Simple, clean DOM and Fetch script
// =====================================

const hostname = window.location.hostname || "localhost";
const API_BASE = `http://${hostname}:3000/api`;

// Helper to construct authorized request headers
function getAuthHeaders(extraHeaders = {}) {
    const headers = { ...extraHeaders };
    const token = localStorage.getItem("session_token");
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
}

// Current driver state cache
let currentDriver = null;
let isDriverOnline = true;

// ========================================
// 1. LOAD DRIVER PROFILE & SESSION
// ========================================

async function loadDriverProfile() {
    try {
        const response = await fetch(`${API_BASE}/drivers/me`, {
            method: "GET",
            headers: getAuthHeaders(),
            credentials: "include"
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            localStorage.removeItem("session_token");
            localStorage.removeItem("driver");
            window.location.replace("login.html");
            return;
        }

        currentDriver = result.driver;
        isDriverOnline = Boolean(result.driver.is_online);

        // Populate profile text elements
        const welcomeEl = document.getElementById("welcomeHeading");
        const nameEl = document.getElementById("driverName");
        const emailEl = document.getElementById("driverEmail");
        const phoneEl = document.getElementById("driverPhone");
        const licenseEl = document.getElementById("driverLicense");
        const expiryEl = document.getElementById("driverLicenseExpiry");
        const verifEl = document.getElementById("driverVerification");
        const ratingEl = document.getElementById("driverRating");

        if (welcomeEl) welcomeEl.textContent = `Welcome, ${currentDriver.name}!`;
        if (nameEl) nameEl.textContent = currentDriver.name;
        if (emailEl) emailEl.textContent = currentDriver.email;
        if (phoneEl) phoneEl.textContent = currentDriver.mobile;
        if (licenseEl) licenseEl.textContent = currentDriver.license_no || "Not provided";
        if (expiryEl) expiryEl.textContent = currentDriver.license_expiry || "Not provided";
        if (verifEl) {
            verifEl.textContent = (currentDriver.verification_status || "Approved").toUpperCase();
            verifEl.className = `status-badge ${currentDriver.verification_status === 'approved' ? 'status-online' : 'status-assigned'}`;
        }
        if (ratingEl) ratingEl.textContent = `⭐ ${parseFloat(currentDriver.rating || 5.0).toFixed(1)} / 5.0`;

        updateAvailabilityUI();

    } catch (error) {
        console.error("Failed to load driver profile:", error);
    }
}

// ========================================
// 2. AVAILABILITY TOGGLE (ONLINE / OFFLINE)
// ========================================

function updateAvailabilityUI() {
    const badge = document.getElementById("availabilityBadge");
    const btn = document.getElementById("toggleAvailabilityBtn");

    if (badge && btn) {
        if (isDriverOnline) {
            badge.textContent = "ONLINE";
            badge.className = "status-badge status-online";
            btn.textContent = "Go Offline";
            btn.className = "btn-secondary";
        } else {
            badge.textContent = "OFFLINE";
            badge.className = "status-badge status-offline";
            btn.textContent = "Go Online";
            btn.className = "btn-green";
        }
    }
}

async function toggleAvailability() {
    try {
        const newStatus = !isDriverOnline;
        const response = await fetch(`${API_BASE}/drivers/toggle-availability`, {
            method: "POST",
            headers: getAuthHeaders({ "Content-Type": "application/json" }),
            credentials: "include",
            body: JSON.stringify({ isOnline: newStatus })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            isDriverOnline = newStatus;
            updateAvailabilityUI();
            loadAvailableRequests();
        } else {
            alert(result.message || "Failed to update availability status.");
        }
    } catch (error) {
        console.error("Availability toggle error:", error);
        alert("Unable to toggle availability. Check server connection.");
    }
}

// ========================================
// 3. VEHICLE MANAGEMENT
// ========================================

async function loadVehicle() {
    try {
        const response = await fetch(`${API_BASE}/drivers/vehicle`, {
            method: "GET",
            headers: getAuthHeaders(),
            credentials: "include"
        });

        const result = await response.json();

        if (response.ok && result.success && result.vehicle) {
            const v = result.vehicle;
            document.getElementById("vehModelTitle").textContent = `${v.model} (${v.vehicle_type})`;
            document.getElementById("vehNumber").textContent = v.vehicle_number;
            document.getElementById("vehType").textContent = v.vehicle_type;
            document.getElementById("vehModel").textContent = v.model;
            document.getElementById("vehCapacity").textContent = v.capacity;

            // Pre-fill edit form
            const numInput = document.getElementById("updateVehNumber");
            const typeInput = document.getElementById("updateVehType");
            const modelInput = document.getElementById("updateVehModel");
            const capInput = document.getElementById("updateVehCapacity");

            if (numInput) numInput.value = v.vehicle_number;
            if (typeInput) typeInput.value = v.vehicle_type;
            if (modelInput) modelInput.value = v.model;
            if (capInput) capInput.value = v.capacity;
        } else {
            document.getElementById("vehModelTitle").textContent = "No vehicle added yet";
            document.getElementById("vehNumber").textContent = "None";
        }
    } catch (error) {
        console.error("Failed to load vehicle details:", error);
    }
}

async function handleVehicleUpdate(event) {
    event.preventDefault();
    const msgEl = document.getElementById("vehicleFormMsg");

    const vehicleNumber = document.getElementById("updateVehNumber")?.value.trim();
    const vehicleType = document.getElementById("updateVehType")?.value;
    const model = document.getElementById("updateVehModel")?.value.trim();
    const capacity = parseInt(document.getElementById("updateVehCapacity")?.value, 10);

    if (!vehicleNumber || !vehicleType || !model || !capacity) {
        if (msgEl) {
            msgEl.textContent = "Please fill in all vehicle fields.";
            msgEl.style.color = "#c62828";
        }
        return;
    }

    try {
        if (msgEl) {
            msgEl.textContent = "Saving vehicle details...";
            msgEl.style.color = "#555555";
        }

        const response = await fetch(`${API_BASE}/drivers/vehicle`, {
            method: "POST",
            headers: getAuthHeaders({ "Content-Type": "application/json" }),
            credentials: "include",
            body: JSON.stringify({ vehicleNumber, vehicleType, model, capacity })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            if (msgEl) {
                msgEl.textContent = "Vehicle details saved successfully!";
                msgEl.style.color = "#2e7d32";
            }
            loadVehicle();
        } else {
            if (msgEl) {
                msgEl.textContent = result.message || "Failed to save vehicle details.";
                msgEl.style.color = "#c62828";
            }
        }
    } catch (error) {
        console.error("Vehicle update error:", error);
        if (msgEl) {
            msgEl.textContent = "Error saving vehicle.";
            msgEl.style.color = "#c62828";
        }
    }
}

// ========================================
// 4. AVAILABLE RIDE REQUESTS
// ========================================

async function loadAvailableRequests() {
    const container = document.getElementById("requestsContainer");
    if (!container) return;

    if (!isDriverOnline) {
        container.innerHTML = `
            <div style="padding: 18px; background-color: #fafafa; border: 1px dashed #cccccc; text-align: center; border-radius: 4px;">
                <p style="margin: 0; color: #666666;">
                    🔒 You are currently <strong>Offline</strong>. Click <strong>Go Online</strong> at the top to receive incoming customer ride requests.
                </p>
            </div>
        `;
        return;
    }

    container.innerHTML = "<p>Checking for ride requests...</p>";

    try {
        const response = await fetch(`${API_BASE}/drivers/available-requests`, {
            method: "GET",
            headers: getAuthHeaders(),
            credentials: "include"
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            container.innerHTML = `<p style="color: #c62828;">${result.message || "Unable to fetch ride requests."}</p>`;
            return;
        }

        const requests = result.requests || [];

        if (requests.length === 0) {
            container.innerHTML = `
                <div style="padding: 16px; background-color: #fafafa; border: 1px solid #eeeeee; text-align: center; border-radius: 4px;">
                    <p style="margin: 0; color: #666666;">No pending ride requests at the moment. Click <strong>Refresh Requests</strong> to check again.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = "";

        requests.forEach(req => {
            const card = document.createElement("div");
            card.className = "driver-card";

            card.innerHTML = `
                <div class="driver-card-info">
                    <h4>Request #${req.request_id} &bull; ${escapeHtml(req.passenger_name)}</h4>
                    <p><strong>Pickup:</strong> ${escapeHtml(req.pickup_location)}</p>
                    <p><strong>Destination:</strong> ${escapeHtml(req.destination)}</p>
                    <p><strong>Vehicle Required:</strong> ${escapeHtml(req.vehicle_type || "Any")} &bull; <strong>Contact:</strong> ${escapeHtml(req.passenger_phone || "-")}</p>
                    <p><strong>Estimated Fare:</strong> ₹${parseFloat(req.estimated_fare).toFixed(2)} &bull; <strong>Scheduled:</strong> ${escapeHtml(req.scheduled_at || "Immediate")}</p>
                </div>
                <div class="driver-card-actions">
                    <button type="button" class="btn-green accept-btn" data-id="${req.request_id}">Accept Ride</button>
                </div>
            `;

            container.appendChild(card);
        });

        // Attach event listeners to all accept buttons
        container.querySelectorAll(".accept-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const reqId = btn.getAttribute("data-id");
                acceptRide(reqId);
            });
        });

    } catch (error) {
        console.error("Failed to load requests:", error);
        container.innerHTML = "<p style='color: #c62828;'>Unable to connect to the server.</p>";
    }
}

async function acceptRide(requestId) {
    if (!confirm(`Do you want to accept Ride Request #${requestId}?`)) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/drivers/accept-ride`, {
            method: "POST",
            headers: getAuthHeaders({ "Content-Type": "application/json" }),
            credentials: "include",
            body: JSON.stringify({ requestId })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            alert("Ride accepted successfully! Check your Active Trip section below.");
            loadAvailableRequests();
            loadActiveTrip();
            // Scroll to active trip
            document.getElementById("active-trip")?.scrollIntoView({ behavior: "smooth" });
        } else {
            alert(result.message || "Could not accept ride.");
        }
    } catch (error) {
        console.error("Accept ride error:", error);
        alert("Failed to accept ride. Please check network connection.");
    }
}

// ========================================
// 5. CURRENT ACTIVE TRIP
// ========================================

async function loadActiveTrip() {
    const container = document.getElementById("activeTripContainer");
    if (!container) return;

    try {
        const response = await fetch(`${API_BASE}/drivers/active-trip`, {
            method: "GET",
            headers: getAuthHeaders(),
            credentials: "include"
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            container.innerHTML = "<p>No active trip right now.</p>";
            return;
        }

        const trip = result.trip;

        if (!trip) {
            container.innerHTML = `
                <div style="padding: 16px; background-color: #fafafa; border: 1px solid #eeeeee; border-radius: 4px;">
                    <p style="margin: 0; color: #666666;">You currently have no ongoing trips. Accept a ride above to begin.</p>
                </div>
            `;
            return;
        }

        const isStarted = trip.trip_status === "started";

        container.innerHTML = `
            <div class="active-trip-box">
                <div class="active-trip-header">
                    <h4 style="margin: 0; font-size: 16px;">Trip #${trip.trip_id} &bull; Passenger: ${escapeHtml(trip.passenger_name)}</h4>
                    <span class="status-badge ${isStarted ? 'status-started' : 'status-assigned'}">
                        ${isStarted ? "IN PROGRESS" : "ASSIGNED"}
                    </span>
                </div>

                <p><strong>Passenger Contact:</strong> <a href="tel:${escapeHtml(trip.passenger_phone)}" style="color: #2b2b2b; font-weight: bold;">${escapeHtml(trip.passenger_phone || "-")}</a></p>
                <p><strong>Pickup Location:</strong> ${escapeHtml(trip.pickup_location)}</p>
                <p><strong>Destination:</strong> ${escapeHtml(trip.destination)}</p>
                <p><strong>Estimated Fare:</strong> ₹${parseFloat(trip.fare).toFixed(2)}</p>
                <p><strong>Vehicle:</strong> ${escapeHtml(trip.vehicle_number || "-")} (${escapeHtml(trip.vehicle_type || "-")})</p>

                <div class="active-trip-actions">
                    ${!isStarted ? `
                        <button type="button" id="startTripBtn" class="btn-green" data-trip-id="${trip.trip_id}">
                            ▶ Start Trip (Passenger Picked Up)
                        </button>
                    ` : `
                        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                            <label for="distanceInput" style="margin: 0; font-size: 13px;">Distance Travelled (km):</label>
                            <input type="number" id="distanceInput" value="${parseFloat(trip.distance_km || 5.0).toFixed(1)}" step="0.1" min="0.1" style="width: 100px;">
                            <button type="button" id="completeTripBtn" class="primary-btn" data-trip-id="${trip.trip_id}">
                                ✓ Complete Trip & Settle Fare
                            </button>
                        </div>
                    `}
                </div>
            </div>
        `;

        // Event listener for Start Trip
        const startBtn = document.getElementById("startTripBtn");
        if (startBtn) {
            startBtn.addEventListener("click", () => {
                startTrip(trip.trip_id);
            });
        }

        // Event listener for Complete Trip
        const completeBtn = document.getElementById("completeTripBtn");
        if (completeBtn) {
            completeBtn.addEventListener("click", () => {
                const distanceVal = parseFloat(document.getElementById("distanceInput")?.value || "5.0");
                completeTrip(trip.trip_id, distanceVal);
            });
        }

    } catch (error) {
        console.error("Active trip error:", error);
        container.innerHTML = "<p style='color: #c62828;'>Failed to load active trip details.</p>";
    }
}

async function startTrip(tripId) {
    if (!confirm("Start this trip? Make sure passenger is on board.")) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/drivers/start-trip`, {
            method: "POST",
            headers: getAuthHeaders({ "Content-Type": "application/json" }),
            credentials: "include",
            body: JSON.stringify({ tripId })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            alert("Trip started! Drive safely.");
            loadActiveTrip();
        } else {
            alert(result.message || "Failed to start trip.");
        }
    } catch (error) {
        console.error("Start trip error:", error);
        alert("Unable to start trip. Check connection.");
    }
}

async function completeTrip(tripId, distanceKm) {
    if (!confirm(`Complete Trip #${tripId} with recorded distance of ${distanceKm} km?`)) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/drivers/complete-trip`, {
            method: "POST",
            headers: getAuthHeaders({ "Content-Type": "application/json" }),
            credentials: "include",
            body: JSON.stringify({ tripId, distanceKm })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            alert(`Trip completed! Final fare: ₹${parseFloat(result.fare || 0).toFixed(2)}.`);
            loadActiveTrip();
            loadTripHistoryAndEarnings();
            loadAvailableRequests();
        } else {
            alert(result.message || "Failed to complete trip.");
        }
    } catch (error) {
        console.error("Complete trip error:", error);
        alert("Unable to complete trip. Check connection.");
    }
}

// ========================================
// 6. TRIP HISTORY & EARNINGS
// ========================================

async function loadTripHistoryAndEarnings() {
    const container = document.getElementById("historyContainer");
    const countEl = document.getElementById("totalTripsCount");
    const earningsEl = document.getElementById("totalEarningsAmount");

    if (!container) return;

    try {
        const response = await fetch(`${API_BASE}/drivers/my-trips`, {
            method: "GET",
            headers: getAuthHeaders(),
            credentials: "include"
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            container.innerHTML = "<p>No trip history available.</p>";
            return;
        }

        const trips = result.trips || [];
        const totalEarnings = parseFloat(result.total_earnings || 0);

        if (countEl) countEl.textContent = trips.length;
        if (earningsEl) earningsEl.textContent = `₹${totalEarnings.toFixed(2)}`;

        if (trips.length === 0) {
            container.innerHTML = "<p style='color: #666666;'>No completed trips yet. Start accepting rides to build your earnings!</p>";
            return;
        }

        let tableHtml = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Trip #</th>
                        <th>Passenger</th>
                        <th>Pickup</th>
                        <th>Destination</th>
                        <th>Distance</th>
                        <th>Fare</th>
                        <th>Date & Time</th>
                    </tr>
                </thead>
                <tbody>
        `;

        trips.forEach(t => {
            tableHtml += `
                <tr>
                    <td><strong>#${t.trip_id}</strong></td>
                    <td>${escapeHtml(t.passenger_name || "-")}</td>
                    <td>${escapeHtml(t.pickup_location)}</td>
                    <td>${escapeHtml(t.destination)}</td>
                    <td>${parseFloat(t.distance_km || 0).toFixed(1)} km</td>
                    <td><strong style="color: #2e7d32;">₹${parseFloat(t.fare || 0).toFixed(2)}</strong></td>
                    <td>${escapeHtml(t.formatted_end_time || t.end_time || "-")}</td>
                </tr>
            `;
        });

        tableHtml += "</tbody></table>";
        container.innerHTML = tableHtml;

    } catch (error) {
        console.error("Trip history error:", error);
        container.innerHTML = "<p style='color: #c62828;'>Failed to load trip history.</p>";
    }
}

// ========================================
// 7. DRIVER LOGOUT
// ========================================

async function logoutDriver() {
    try {
        const logoutBtn = document.getElementById("logoutButton");
        if (logoutBtn) {
            logoutBtn.disabled = true;
            logoutBtn.textContent = "Logging out...";
        }

        await fetch(`${API_BASE}/drivers/logout`, {
            method: "POST",
            headers: getAuthHeaders(),
            credentials: "include"
        });

        localStorage.removeItem("session_token");
        localStorage.removeItem("driver");
        window.location.replace("login.html");

    } catch (error) {
        console.error("Logout error:", error);
        localStorage.removeItem("session_token");
        localStorage.removeItem("driver");
        window.location.replace("login.html");
    }
}

// Utility to escape HTML and prevent XSS
function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ========================================
// 8. INITIALIZE DRIVER DASHBOARD
// ========================================

document.addEventListener("DOMContentLoaded", () => {
    // Attach buttons
    document.getElementById("logoutButton")?.addEventListener("click", logoutDriver);
    document.getElementById("toggleAvailabilityBtn")?.addEventListener("click", toggleAvailability);
    document.getElementById("vehicleForm")?.addEventListener("submit", handleVehicleUpdate);
    document.getElementById("refreshRequestsBtn")?.addEventListener("click", loadAvailableRequests);
    document.getElementById("refreshHistoryBtn")?.addEventListener("click", loadTripHistoryAndEarnings);

    // Initial data load
    loadDriverProfile();
    loadVehicle();
    loadAvailableRequests();
    loadActiveTrip();
    loadTripHistoryAndEarnings();
});
