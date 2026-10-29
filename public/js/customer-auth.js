const registerForm = document.getElementById("registerForm");
const loginForm = document.getElementById("loginForm");

// Customer registration
if (registerForm) {
    registerForm.addEventListener("submit", function (event) {
        event.preventDefault();
        const name = document.getElementById("name").value.trim();
        const email = document.getElementById("email").value.trim();
        const phone = document.getElementById("phone").value.trim();
        const password = document.getElementById("password").value;
        const message = document.getElementById("registerMessage");
        if (!name || !email || !phone || !password) {
            message.textContent = "Please fill in all fields.";
            return;
        }
        if (!/^[0-9]{10}$/.test(phone)) {
            message.textContent = "Enter a valid 10-digit phone number.";
            return;
        }
        if (password.length < 8) {
            message.textContent = "Password must be at least 8 characters.";
            return;
        }
        message.textContent =
            "Form validation successful! Backend registration comes next.";
    });
}

// Customer login
if (loginForm) {
    loginForm.addEventListener("submit", function (event) {
        event.preventDefault();
        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;
        const message = document.getElementById("loginMessage");

        if (!email || !password) {
            message.textContent = "Please enter your email and password.";
            return;
        }

        message.textContent =
            "Form validation successful! Backend login comes next.";
    });
}
