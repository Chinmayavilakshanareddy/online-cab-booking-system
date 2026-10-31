// Backend API URL - auto-adapts to local development host
const API_BASE = (window.location.protocol === "http:" || window.location.protocol === "https:") && window.location.hostname
    ? `${window.location.protocol}//${window.location.hostname}:3000/api`
    : "http://localhost:3000/api";

// Elements on index.html
const bookCabBtn = document.getElementById("bookCabBtn");
const loginBtn = document.getElementById("loginBtn");

if (loginBtn) {
    loginBtn.addEventListener("click", function () {
        window.location.href = "login.html";
    });
}

if (bookCabBtn) {
    bookCabBtn.addEventListener("click", function () {
        // If already logged in, navigate to dashboard book ride section, else login
        if (localStorage.getItem("session_token")) {
            window.location.href = "dashboard.html#book-ride";
        } else {
            window.location.href = "login.html";
        }
    });
}

// Fallback handlers if customer.js is referenced on auth pages
const registerForm = document.getElementById("registerForm");
const loginForm = document.getElementById("loginForm");

if (registerForm) {
    registerForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        const name = document.getElementById("name")?.value.trim();
        const email = document.getElementById("email")?.value.trim().toLowerCase();
        const phone = document.getElementById("phone")?.value.trim();
        const password = document.getElementById("password")?.value;
        const message = document.getElementById("registerMessage");

        if (!name || !email || !phone || !password) {
            if (message) {
                message.textContent = "Please fill in all fields.";
                message.style.color = "#c53030";
            }
            return;
        }

        try {
            if (message) {
                message.textContent = "Registering...";
                message.style.color = "#2f855a";
            }
            const response = await fetch(`${API_BASE}/customers/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ name, email, phone, password })
            });

            const result = await response.json();
            if (!response.ok) {
                if (message) {
                    message.textContent = result.message || "Registration failed.";
                    message.style.color = "#c53030";
                }
                return;
            }

            if (message) {
                message.textContent = result.message ? `${result.message} Redirecting...` : "Success!";
                message.style.color = "#2f855a";
            }
            registerForm.reset();
            setTimeout(() => { window.location.href = "login.html"; }, 1200);
        } catch (err) {
            console.error("Registration error:", err);
            if (message) {
                message.textContent = "Unable to connect to the server.";
                message.style.color = "#c53030";
            }
        }
    });
}

if (loginForm) {
    loginForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        const email = document.getElementById("email")?.value.trim().toLowerCase();
        const password = document.getElementById("password")?.value;
        const message = document.getElementById("loginMessage");

        if (!email || !password) {
            if (message) {
                message.textContent = "Please enter your email and password.";
                message.style.color = "#c53030";
            }
            return;
        }

        try {
            if (message) {
                message.textContent = "Logging in...";
                message.style.color = "#2f855a";
            }
            const response = await fetch(`${API_BASE}/customers/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ email, password })
            });

            const result = await response.json();
            if (!response.ok) {
                if (message) {
                    message.textContent = result.message || "Login failed.";
                    message.style.color = "#c53030";
                }
                return;
            }

            if (result.token) localStorage.setItem("session_token", result.token);
            if (result.customer) localStorage.setItem("customer", JSON.stringify(result.customer));

            if (message) {
                message.textContent = "Login successful! Redirecting...";
                message.style.color = "#2f855a";
            }
            setTimeout(() => { window.location.href = "dashboard.html"; }, 800);
        } catch (err) {
            console.error("Login error:", err);
            if (message) {
                message.textContent = "Unable to connect to the server.";
                message.style.color = "#c53030";
            }
        }
    });
}
