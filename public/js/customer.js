const API_BASE = `http://${window.location.hostname}:3000/api`;

const bookCabBtn = document.getElementById("bookCabBtn");
const loginBtn = document.getElementById("loginBtn");

// Open the customer login page
if (loginBtn) {
    loginBtn.addEventListener("click", function () {
        window.location.href = "login.html";
    });
}

// Check whether the customer is logged in before booking
if (bookCabBtn) {
    bookCabBtn.addEventListener("click", async function () {
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

            if (response.ok) {
                window.location.href = "dashboard.html#book-ride";
            } else {
                window.location.href = "login.html";
            }
        } catch (error) {
            console.error("Authentication check failed:", error);
            alert("Unable to connect to the server. Please try again.");
        }
    });
}
