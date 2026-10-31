// Backend API URL - auto-adapts to local development host
const API_BASE = (window.location.protocol === "http:" || window.location.protocol === "https:") && window.location.hostname
    ? `${window.location.protocol}//${window.location.hostname}:3000/api`
    : "http://localhost:3000/api";

// Helper function to display messages
function displayStatusMessage(element, text, isError = false) {
    if (!element) return;
    element.textContent = text;
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

        const nameInput = document.getElementById("name");
        const emailInput = document.getElementById("email");
        const phoneInput = document.getElementById("phone");
        const passwordInput = document.getElementById("password");
        const messageEl = document.getElementById("registerMessage");
        const submitBtn = registerForm.querySelector("button[type='submit']");

        const name = nameInput ? nameInput.value.trim() : "";
        const email = emailInput ? emailInput.value.trim().toLowerCase() : "";
        const phone = phoneInput ? phoneInput.value.trim() : "";
        const password = passwordInput ? passwordInput.value : "";

        // Client-side validation
        if (!name || !email || !phone || !password) {
            displayStatusMessage(messageEl, "Please fill in all fields.", true);
            return;
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            displayStatusMessage(messageEl, "Please enter a valid email address.", true);
            return;
        }

        if (!/^[0-9]{10}$/.test(phone)) {
            displayStatusMessage(messageEl, "Enter a valid 10-digit phone number.", true);
            return;
        }

        if (password.length < 8) {
            displayStatusMessage(messageEl, "Password must be at least 8 characters.", true);
            return;
        }

        try {
            if (submitBtn) submitBtn.disabled = true;
            displayStatusMessage(messageEl, "Creating your account...", false);

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
                displayStatusMessage(messageEl, result.message || "Registration failed.", true);
                if (submitBtn) submitBtn.disabled = false;
                return;
            }

            displayStatusMessage(
                messageEl,
                result.message ? `${result.message} Redirecting to login...` : "Registration successful! Redirecting...",
                false
            );

            registerForm.reset();

            // Redirect to login page after successful registration
            setTimeout(() => {
                window.location.href = "login.html";
            }, 1200);

        } catch (error) {
            console.error("Registration error:", error);
            displayStatusMessage(messageEl, "Unable to connect to the server. Please check backend connection.", true);
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

        const emailInput = document.getElementById("email");
        const passwordInput = document.getElementById("password");
        const messageEl = document.getElementById("loginMessage");
        const submitBtn = loginForm.querySelector("button[type='submit']");

        const email = emailInput ? emailInput.value.trim().toLowerCase() : "";
        const password = passwordInput ? passwordInput.value : "";

        if (!email || !password) {
            displayStatusMessage(messageEl, "Please enter your email and password.", true);
            return;
        }

        try {
            if (submitBtn) submitBtn.disabled = true;
            displayStatusMessage(messageEl, "Logging in...", false);

            const response = await fetch(`${API_BASE}/customers/login`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                credentials: "include",
                body: JSON.stringify({ email, password })
            });

            const result = await response.json();

            if (!response.ok) {
                displayStatusMessage(messageEl, result.message || "Invalid credentials.", true);
                if (submitBtn) submitBtn.disabled = false;
                return;
            }

            // Save token and customer profile for session management
            if (result.token) {
                localStorage.setItem("session_token", result.token);
            }
            if (result.customer) {
                localStorage.setItem("customer", JSON.stringify(result.customer));
            }

            displayStatusMessage(messageEl, "Login successful! Redirecting...", false);

            setTimeout(() => {
                window.location.href = "dashboard.html";
            }, 800);

        } catch (error) {
            console.error("Login error:", error);
            displayStatusMessage(messageEl, "Unable to connect to the server. Please check backend connection.", true);
            if (submitBtn) submitBtn.disabled = false;
        }
    });
}