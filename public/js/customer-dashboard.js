
const API_BASE = `http://${window.location.hostname}:3000/api`;

// ========================================
// 1. LOAD CUSTOMER PROFILE
// ========================================

async function loadCustomerProfile() {
    try {
        const response = await fetch(`${API_BASE}/customers/me`, {
            method: "GET",
            credentials: "include"
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            window.location.href = "login.html";
            return;
        }

        const customer = result.customer || result.user;

        if (!customer) {
            throw new Error("Customer information was not returned.");
        }

        document.getElementById("welcomeMessage").textContent =
            `Welcome, ${customer.name || customer.full_name}!`;

        document.getElementById("customerName").textContent =
            customer.name || customer.full_name || "Not available";

        document.getElementById("customerEmail").textContent =
            customer.email || "Not available";

        document.getElementById("customerId").textContent =
            customer.user_id || customer.id || "Not available";

    } catch (error) {
        console.error("Profile loading error:", error);

        document.getElementById("welcomeMessage").textContent =
            "Unable to load your profile. Please try again.";
    }
}


// ========================================
// 2. LOGOUT CUSTOMER
// ========================================

async function logoutCustomer() {
    try {
        const response = await fetch(`${API_BASE}/customers/logout`, {
            method: "POST",
            credentials: "include"
        });

        const result = await response.json();

        if (response.ok && result.success) {
            window.location.href = "login.html";
        } else {
            alert(result.message || "Unable to log out.");
        }

    } catch (error) {
        console.error("Logout error:", error);
        alert("Could not connect to the server.");
    }
}


// ========================================
// 3. BOOK A RIDE
// ========================================

async function bookRide(event) {
    event.preventDefault();

    const bookingForm = document.getElementById("bookingForm");
    const bookingMessage = document.getElementById("bookingMessage");

    const submitButton = bookingForm.querySelector(
        'button[type="submit"]'
    );

    const pickup = document.getElementById("pickup").value.trim();
    const destination = document.getElementById("destination").value.trim();
    const rideDate = document.getElementById("rideDate").value;
    const rideTime = document.getElementById("rideTime").value;
    const vehicleType = document.getElementById("vehicleType").value;

    if (!pickup || !destination || !rideDate || !rideTime || !vehicleType) {
        bookingMessage.textContent =
            "Please complete all booking fields.";
        return;
    }

    if (pickup.toLowerCase() === destination.toLowerCase()) {
        bookingMessage.textContent =
            "Pickup and destination cannot be the same.";
        return;
    }

    const scheduledAt = new Date(`${rideDate}T${rideTime}`);

    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt <= new Date()) {
        bookingMessage.textContent =
            "Please select a future travel date and time.";
        return;
    }

    const bookingData = {
        pickup,
        destination,
        vehicleType,
        rideDate,
        rideTime
    };

    try {
        submitButton.disabled = true;
        submitButton.textContent = "Submitting...";

        bookingMessage.textContent =
            "Submitting your ride request...";

        const response = await fetch(`${API_BASE}/customers/book-ride`, {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(bookingData)
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(
                result.message || "Unable to book your ride."
            );
        }

        bookingMessage.textContent =
            result.message || "Your ride request was submitted successfully!";

        bookingForm.reset();

        // Refresh ride history after successful booking
        await loadRideHistory();

    } catch (error) {
        console.error("Booking error:", error);
        bookingMessage.textContent = error.message;

    } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Request a Ride";
    }
}


// ========================================
// 4. LOAD CUSTOMER RIDE HISTORY
// ========================================

async function loadRideHistory() {
    const ridesContainer = document.getElementById("ridesContainer");

    if (!ridesContainer) return;

    ridesContainer.textContent = "Loading your rides...";

    try {
        const response = await fetch(`${API_BASE}/customers/rides`, {
            method: "GET",
            credentials: "include"
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(
                result.message || "Unable to load rides."
            );
        }

        ridesContainer.replaceChildren();

        if (!result.rides || result.rides.length === 0) {
            const message = document.createElement("p");

            message.textContent = "You haven't booked any rides yet.";

            ridesContainer.appendChild(message);
            return;
        }

        result.rides.forEach(ride => {
            const rideCard = document.createElement("div");
            rideCard.className = "ride-card";

            const heading = document.createElement("h4");
            heading.textContent = `Ride #${ride.request_id}`;

            const pickup = document.createElement("p");
            pickup.textContent =
                `Pickup: ${ride.pickup_location}`;

            const destination = document.createElement("p");
            destination.textContent =
                `Destination: ${ride.destination}`;

            const vehicle = document.createElement("p");
            vehicle.textContent =
                `Vehicle: ${ride.vehicle_type}`;

            const date = document.createElement("p");
            date.textContent =
                `Scheduled: ${ride.scheduled_at || "Not available"}`;

            const fare = document.createElement("p");
            fare.textContent =
                `Estimated fare: ₹${ride.estimated_fare}`;

            const status = document.createElement("p");
            status.textContent =
                `Status: ${ride.status}`;

            rideCard.append(
                heading,
                pickup,
                destination,
                vehicle,
                date,
                fare,
                status
            );

            // Show cancellation button only for pending rides
            if (String(ride.status).toLowerCase() === "pending") {
                const cancelButton = document.createElement("button");

                cancelButton.type = "button";
                cancelButton.textContent = "Cancel Ride";

                cancelButton.addEventListener("click", () => {
                    cancelRide(ride.request_id);
                });

                rideCard.appendChild(cancelButton);
            }

            ridesContainer.appendChild(rideCard);
        });

    } catch (error) {
        console.error("Ride history error:", error);
        ridesContainer.textContent = error.message;
    }
}


// ========================================
// 5. CANCEL A RIDE
// ========================================

async function cancelRide(requestId) {
    const confirmed = confirm(
        "Are you sure you want to cancel this ride?"
    );

    if (!confirmed) return;

    try {
        const response = await fetch(`${API_BASE}/customers/cancel-ride`, {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ requestId })
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(
                result.message || "Unable to cancel ride."
            );
        }

        alert(result.message);

        // Refresh history to display updated status
        await loadRideHistory();

    } catch (error) {
        console.error("Ride cancellation error:", error);
        alert(error.message);
    }
}


// ========================================
// 6. ATTACH EVENT LISTENERS
// ========================================

// Logout button
document.getElementById("logoutButton")?.addEventListener(
    "click",
    logoutCustomer
);

// Booking form
document.getElementById("bookingForm")?.addEventListener(
    "submit",
    bookRide
);

// Refresh ride history button
document.getElementById("refreshRidesButton")?.addEventListener(
    "click",
    loadRideHistory
);


// ========================================
// 7. INITIALIZE CUSTOMER DASHBOARD
// ========================================

loadCustomerProfile();
loadRideHistory();
