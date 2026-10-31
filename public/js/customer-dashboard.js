// Backend API URL - auto-adapts to local development host
const API_BASE = (window.location.protocol === "http:" || window.location.protocol === "https:") && window.location.hostname
    ? `${window.location.protocol}//${window.location.hostname}:3000/api`
    : "http://localhost:3000/api";

// Get dashboard elements
const welcomeMessage = document.getElementById("welcomeMessage");
const customerName = document.getElementById("customerName");
const customerEmail = document.getElementById("customerEmail");
const customerId = document.getElementById("customerId");
const logoutButton = document.getElementById("logoutButton");

// ========================================
// 1. VERIFY CUSTOMER SESSION
// ========================================
async function loadCustomerDashboard() {
    try {
        const token = localStorage.getItem("session_token");
        const headers = {};
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        const response = await fetch(`${API_BASE}/customers/me`, {
            method: "GET",
            headers,
            credentials: "include"
        });

        const result = await response.json();

        // Redirect if the session is invalid
        if (!response.ok) {
            localStorage.removeItem("session_token");
            localStorage.removeItem("customer");
            window.location.replace("login.html");
            return;
        }

        // Display customer information
        const customer = result.customer;

        if (welcomeMessage) welcomeMessage.textContent = `Welcome, ${customer.name}!`;
        if (customerName) customerName.textContent = customer.name;
        if (customerEmail) customerEmail.textContent = customer.email;
        if (customerId) customerId.textContent = customer.id;

    } catch (error) {
        console.error("Dashboard error:", error);

        if (welcomeMessage) welcomeMessage.textContent = "Unable to connect to the server.";
        if (customerName) customerName.textContent = "Unavailable";
        if (customerEmail) customerEmail.textContent = "Unavailable";
        if (customerId) customerId.textContent = "Unavailable";
    }
}

// ========================================
// 2. CUSTOMER LOGOUT
// ========================================
if (logoutButton) {
    logoutButton.addEventListener("click", async function () {
        try {
            logoutButton.disabled = true;
            logoutButton.textContent = "Logging out...";

            const token = localStorage.getItem("session_token");
            const headers = {};
            if (token) {
                headers["Authorization"] = `Bearer ${token}`;
            }

            const response = await fetch(`${API_BASE}/customers/logout`, {
                method: "POST",
                headers,
                credentials: "include"
            });

            // Clear local storage regardless of backend response
            localStorage.removeItem("session_token");
            localStorage.removeItem("customer");

            window.location.replace("login.html");

        } catch (error) {
            console.error("Logout error:", error);
            localStorage.removeItem("session_token");
            localStorage.removeItem("customer");
            alert("Unable to log out from server, cleared local session.");
            window.location.replace("login.html");
        }
    });
}

// ========================================
// 3. LOAD DASHBOARD WHEN PAGE OPENS
// ========================================
loadCustomerDashboard();
