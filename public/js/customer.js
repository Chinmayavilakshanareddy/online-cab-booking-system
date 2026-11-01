// RideNow - Customer Home Page

(function () {
    "use strict";

    const bookCabBtn = document.getElementById("bookCabBtn");
    const loginBtn   = document.getElementById("loginBtn");

    // ── Session check: show logged-in state in navbar ──
    const storedUser = localStorage.getItem("ridenow_user");
    let currentUser = null;
    try {
        if (storedUser) currentUser = JSON.parse(storedUser);
    } catch (e) { /* ignore */ }

    if (currentUser && loginBtn) {
        loginBtn.textContent = currentUser.name ? `Hi, ${currentUser.name.split(" ")[0]}` : "My Account";
        loginBtn.addEventListener("click", function () {
            // If admin/super_admin, go to admin dashboard; else stay on home
            if (currentUser.role === "admin" || currentUser.role === "super_admin") {
                window.location.href = "../admin/admin-dashboard.html";
            }
        });
    } else if (loginBtn) {
        loginBtn.addEventListener("click", function () {
            window.location.href = "login.html";
        });
    }

    // ── Book a Cab: prevent blocked passengers ──
    if (bookCabBtn) {
        bookCabBtn.addEventListener("click", function () {
            if (!currentUser) {
                // Not logged in – redirect to login
                window.location.href = "login.html";
                return;
            }

            if (currentUser.status === "blocked") {
                alert("⚠️ Your account has been blocked and you cannot book rides.\n\nPlease contact RideNow support for assistance.");
                return;
            }

            // Passenger is active – booking feature coming next
            alert("Cab booking feature is coming next!");
        });
    }

})();
