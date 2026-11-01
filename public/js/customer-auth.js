// Backend API URL - auto-adapts to hostname, fallback to localhost for file:///
const hostname = window.location.hostname || "localhost";
const API_BASE = `http://${hostname}:3000/api`;

// Display success and error messages
function displayStatusMessage(element, message, isError = false) {
    if (!element) return;

    element.textContent = message;
    element.style.color = isError ? "#c53030" : "#2f855a";
    element.style.marginTop = "14px";
    element.style.fontSize = "14px";
    element.style.fontWeight = "600";
}

// ========================================
// 1. CUSTOMER REGISTRATION
// ========================================

const registerForm = document.getElementById("registerForm");

if (registerForm) {
    registerForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        const name = document.getElementById("name")?.value.trim() || "";
        const email = document.getElementById("email")?.value.trim().toLowerCase() || "";
        const phone = document.getElementById("phone")?.value.trim() || "";
        const password = document.getElementById("password")?.value || "";

        const messageEl = document.getElementById("registerMessage");
        const submitBtn = registerForm.querySelector("button[type='submit']");

        // Validate inputs
        if (!name || !email || !phone || !password) {
            displayStatusMessage(messageEl, "Please fill in all fields.", true);
            return;
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            displayStatusMessage(messageEl, "Enter a valid email address.", true);
            return;
        }

        if (!/^[0-9]{10}$/.test(phone)) {
            displayStatusMessage(messageEl, "Enter a valid 10-digit phone number.", true);
            return;
        }

        if (password.length < 8) {
            displayStatusMessage(messageEl, "Password must contain at least 8 characters.", true);
            return;
        }

        try {
            if (submitBtn) submitBtn.disabled = true;

            displayStatusMessage(
                messageEl,
                "Creating your account..."
            );

            const response = await fetch(`${API_BASE}/customers/register`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                credentials: "include",
                body: JSON.stringify({
                    name,
                    email,
                    phone,
                    password
                })
            });

            const result = await response.json();

            if (!response.ok) {
                displayStatusMessage(
                    messageEl,
                    result.message || "Registration failed.",
                    true
                );
                return;
            }

            displayStatusMessage(
                messageEl,
                "Registration successful! Redirecting to login..."
            );

            registerForm.reset();

            setTimeout(() => {
                window.location.href = "login.html";
            }, 1200);

        } catch (error) {
            console.error("Registration error:", error);

            displayStatusMessage(
                messageEl,
                "Unable to connect to the backend server. Make sure it is running on port 3000.",
                true
            );

        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    });
}

// ========================================
// 2. CUSTOMER LOGIN
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
            displayStatusMessage(
                messageEl,
                "Please enter your email and password.",
                true
            );
            return;
        }

        try {
            if (submitBtn) submitBtn.disabled = true;

            displayStatusMessage(messageEl, "Logging in...");

            const response = await fetch(`${API_BASE}/customers/login`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                credentials: "include",
                body: JSON.stringify({
                    email,
                    password
                })
            });

            const result = await response.json();

            if (!response.ok) {
                displayStatusMessage(
                    messageEl,
                    result.message || "Invalid email or password.",
                    true
                );
                return;
            }

            // Save token and customer info for session management on dashboard
            if (result.token) {
                localStorage.setItem("session_token", result.token);
            }
            if (result.customer) {
                localStorage.setItem("customer", JSON.stringify(result.customer));
            }

            displayStatusMessage(
                messageEl,
                "Login successful! Redirecting..."
            );

            setTimeout(() => {
                window.location.href = "dashboard.html";
            }, 800);

        } catch (error) {
            console.error("Login error:", error);

            displayStatusMessage(
                messageEl,
                "Unable to connect to the backend server. Make sure it is running on port 3000.",
                true
            );

        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    });
}
