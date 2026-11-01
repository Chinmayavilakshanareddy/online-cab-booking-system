// =====================================
// RideNow - Driver Authentication
// Simple, clean DOM and Fetch script
// =====================================

const hostname = window.location.hostname || "localhost";
const API_BASE = `http://${hostname}:3000/api`;

// Helper to display clean status messages
function displayStatusMessage(element, message, isError = false) {
    if (!element) return;
    element.textContent = message;
    element.style.color = isError ? "#c62828" : "#2e7d32";
    element.style.marginTop = "14px";
    element.style.fontSize = "14px";
    element.style.fontWeight = "600";
}

// ========================================
// 1. DRIVER REGISTRATION
// ========================================

const registerForm = document.getElementById("registerForm");

if (registerForm) {
    registerForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        const name = document.getElementById("name")?.value.trim() || "";
        const email = document.getElementById("email")?.value.trim().toLowerCase() || "";
        const phone = document.getElementById("phone")?.value.trim() || "";
        const password = document.getElementById("password")?.value || "";
        const licenseNo = document.getElementById("licenseNo")?.value.trim() || "";
        const licenseExpiry = document.getElementById("licenseExpiry")?.value || "";

        // Vehicle details
        const vehicleNumber = document.getElementById("vehicleNumber")?.value.trim() || "";
        const vehicleType = document.getElementById("vehicleType")?.value || "";
        const model = document.getElementById("model")?.value.trim() || "";
        const capacity = parseInt(document.getElementById("capacity")?.value, 10) || 4;

        const messageEl = document.getElementById("registerMessage");
        const submitBtn = registerForm.querySelector("button[type='submit']");

        // Basic validations
        if (!name || !email || !phone || !password || !licenseNo || !licenseExpiry) {
            displayStatusMessage(messageEl, "Please fill in all personal and driver fields.", true);
            return;
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            displayStatusMessage(messageEl, "Please enter a valid email address.", true);
            return;
        }

        if (!/^[0-9]{10}$/.test(phone)) {
            displayStatusMessage(messageEl, "Please enter a valid 10-digit phone number.", true);
            return;
        }

        if (password.length < 8) {
            displayStatusMessage(messageEl, "Password must be at least 8 characters long.", true);
            return;
        }

        if (!vehicleNumber || !vehicleType || !model) {
            displayStatusMessage(messageEl, "Please provide complete vehicle details.", true);
            return;
        }

        try {
            if (submitBtn) submitBtn.disabled = true;
            displayStatusMessage(messageEl, "Registering your driver account...", false);

            const response = await fetch(`${API_BASE}/drivers/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    name,
                    email,
                    phone,
                    password,
                    licenseNo,
                    licenseExpiry,
                    vehicleNumber,
                    vehicleType,
                    model,
                    capacity
                })
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                displayStatusMessage(messageEl, result.message || "Registration failed.", true);
                return;
            }

            displayStatusMessage(messageEl, "Registration successful! Redirecting to login...", false);
            registerForm.reset();

            setTimeout(() => {
                window.location.href = "login.html";
            }, 1200);

        } catch (error) {
            console.error("Driver registration error:", error);
            displayStatusMessage(messageEl, "Unable to connect to the server. Please verify the backend is running.", true);
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    });
}

// ========================================
// 2. DRIVER LOGIN
// ========================================

const loginForm = document.getElementById("loginForm");

if (loginForm) {
    loginForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        const email = document.getElementById("email")?.value.trim().toLowerCase() || "";
        const password = document.getElementById("password")?.value || "";

        const messageEl = document.getElementById("loginMessage");
        const submitBtn = loginForm.querySelector("button[type='submit']");

        if (!email || !password) {
            displayStatusMessage(messageEl, "Please enter your email and password.", true);
            return;
        }

        try {
            if (submitBtn) submitBtn.disabled = true;
            displayStatusMessage(messageEl, "Logging in...", false);

            const response = await fetch(`${API_BASE}/drivers/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ email, password })
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                displayStatusMessage(messageEl, result.message || "Invalid driver credentials.", true);
                return;
            }

            // Save session credentials
            if (result.token) {
                localStorage.setItem("session_token", result.token);
            }
            if (result.driver) {
                localStorage.setItem("driver", JSON.stringify(result.driver));
            }

            displayStatusMessage(messageEl, "Login successful! Redirecting to dashboard...", false);

            setTimeout(() => {
                window.location.href = "dashboard.html";
            }, 800);

        } catch (error) {
            console.error("Driver login error:", error);
            displayStatusMessage(messageEl, "Unable to connect to the server. Please verify the backend is running.", true);
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    });
}
