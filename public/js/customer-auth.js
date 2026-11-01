// RideNow - Customer Auth (Register & Login) connected to backend API

(function () {
    "use strict";

    const API_BASE = window.location.origin.includes("3000")
        ? window.location.origin
        : "http://localhost:3000";

    // ───────────── REGISTRATION ─────────────
    const registerForm = document.getElementById("registerForm");

    if (registerForm) {
        registerForm.addEventListener("submit", async function (event) {
            event.preventDefault();

            const name     = document.getElementById("name").value.trim();
            const email    = document.getElementById("email").value.trim();
            const phone    = document.getElementById("phone").value.trim();
            const password = document.getElementById("password").value;
            const msgEl    = document.getElementById("registerMessage");
            const submitBtn = registerForm.querySelector("button[type='submit']");

            // Client-side validation
            if (!name || !email || !phone || !password) {
                showMsg(msgEl, "Please fill in all fields.", "error");
                return;
            }
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
                showMsg(msgEl, "Enter a valid email address.", "error");
                return;
            }
            if (!/^[0-9]{10}$/.test(phone)) {
                showMsg(msgEl, "Enter a valid 10-digit phone number.", "error");
                return;
            }
            if (password.length < 8) {
                showMsg(msgEl, "Password must be at least 8 characters.", "error");
                return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = "Creating account…";
            showMsg(msgEl, "", "");

            try {
                const response = await fetch(`${API_BASE}/api/customers/register`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name, email, phone, password })
                });

                const data = await response.json();

                if (response.ok && data.success) {
                    showMsg(msgEl,
                        "✓ Account created successfully! Redirecting to login…",
                        "success");
                    setTimeout(() => {
                        window.location.href = "login.html";
                    }, 1800);
                } else {
                    showMsg(msgEl, data.message || "Registration failed. Please try again.", "error");
                    submitBtn.disabled = false;
                    submitBtn.textContent = "Create account";
                }

            } catch (err) {
                console.error("Registration network error:", err);
                showMsg(msgEl,
                    "Could not connect to the server. Please make sure the backend is running.",
                    "error");
                submitBtn.disabled = false;
                submitBtn.textContent = "Create account";
            }
        });
    }

    // ───────────── LOGIN ─────────────
    const loginForm = document.getElementById("loginForm");

    if (loginForm) {
        loginForm.addEventListener("submit", async function (event) {
            event.preventDefault();

            const email    = document.getElementById("email").value.trim();
            const password = document.getElementById("password").value;
            const msgEl    = document.getElementById("loginMessage");
            const submitBtn = loginForm.querySelector("button[type='submit']");

            if (!email || !password) {
                showMsg(msgEl, "Please enter your email and password.", "error");
                return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = "Logging in…";
            showMsg(msgEl, "", "");

            try {
                const response = await fetch(`${API_BASE}/api/auth/login`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email, password })
                });

                const data = await response.json();

                if (response.ok && data.success) {
                    const user = data.user;

                    // ── Block check: server already rejects blocked users with 403,
                    //    but we handle it gracefully here too.
                    if (user.status === "blocked") {
                        showMsg(msgEl,
                            "🚫 Your account has been blocked. Please contact support.",
                            "error");
                        submitBtn.disabled = false;
                        submitBtn.textContent = "Log in";
                        return;
                    }

                    // Persist session in localStorage
                    localStorage.setItem("ridenow_user", JSON.stringify(user));

                    // Role-based redirect
                    if (user.role === "admin" || user.role === "super_admin") {
                        showMsg(msgEl, "✓ Welcome back, Admin! Redirecting…", "success");
                        setTimeout(() => {
                            window.location.href = "../admin/admin-dashboard.html";
                        }, 900);
                    } else if (user.role === "passenger" || user.role === "customer") {
                        showMsg(msgEl, `✓ Welcome back, ${user.name}! Redirecting…`, "success");
                        setTimeout(() => {
                            window.location.href = "index.html";
                        }, 900);
                    } else {
                        // driver or other – land on home for now
                        showMsg(msgEl, `✓ Logged in as ${user.role}.`, "success");
                        setTimeout(() => {
                            window.location.href = "index.html";
                        }, 900);
                    }

                } else {
                    // 403 = blocked, 401 = bad credentials
                    if (response.status === 403) {
                        showMsg(msgEl,
                            "🚫 Your account has been blocked. Please contact RideNow support.",
                            "error");
                    } else {
                        showMsg(msgEl, data.message || "Invalid email or password.", "error");
                    }
                    submitBtn.disabled = false;
                    submitBtn.textContent = "Log in";
                }

            } catch (err) {
                console.error("Login network error:", err);
                showMsg(msgEl,
                    "Could not connect to the server. Please make sure the backend is running.",
                    "error");
                submitBtn.disabled = false;
                submitBtn.textContent = "Log in";
            }
        });
    }

    // ───────────── HELPERS ─────────────

    /**
     * Show a styled status message inside an element.
     * @param {HTMLElement} el   - The <p> element for messages
     * @param {string}      text - Message text
     * @param {"success"|"error"|""}  type
     */
    function showMsg(el, text, type) {
        if (!el) return;
        el.textContent = text;
        el.style.marginTop = "14px";
        el.style.padding   = text ? "10px 14px" : "0";
        el.style.borderRadius = "8px";
        el.style.fontSize  = "14px";
        el.style.fontWeight = "500";

        if (type === "error") {
            el.style.color      = "#b91c1c";
            el.style.background = "#fee2e2";
            el.style.border     = "1px solid #fca5a5";
        } else if (type === "success") {
            el.style.color      = "#15803d";
            el.style.background = "#dcfce7";
            el.style.border     = "1px solid #86efac";
        } else {
            el.style.color      = "";
            el.style.background = "";
            el.style.border     = "";
            el.style.padding    = "0";
        }
    }

})();
