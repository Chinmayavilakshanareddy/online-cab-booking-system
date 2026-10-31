const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const http = require("node:http");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const pool = require("./db");

const PORT = process.env.PORT || 3000;

// Frontend origins allowed to communicate with the backend
const allowedOrigins = [
    "http://localhost:5500",
    "http://127.0.0.1:5500"
];

// Helper to check if origin is permitted (supports any localhost/127.0.0.1 port for local dev)
function isAllowedOrigin(origin) {
    if (!origin) return false;
    if (allowedOrigins.includes(origin)) return true;
    try {
        const parsed = new URL(origin);
        return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    } catch {
        return false;
    }
}

// Read JSON data sent by the frontend
function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";

        req.on("data", chunk => {
            body += chunk;

            if (body.length > 10000) {
                reject(new Error("Request body too large"));
                req.destroy();
            }
        });

        req.on("end", () => {
            try {
                resolve(JSON.parse(body));
            } catch {
                reject(new Error("Invalid JSON"));
            }
        });

        req.on("error", reject);
    });
}

// Read a cookie from an incoming request
function getCookie(req, cookieName) {
    const cookies = req.headers.cookie || "";

    const cookie = cookies
        .split(";")
        .map(item => item.trim())
        .find(item => item.startsWith(cookieName + "="));

    return cookie
        ? cookie.substring(cookieName.length + 1)
        : null;
}

// Read session token from cookie or Authorization header
function getSessionToken(req) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
        return authHeader.substring(7).trim();
    }
    return getCookie(req, "session_token");
}

// Create the HTTP server
const server = http.createServer(async (req, res) => {

    // CORS configuration
    const origin = req.headers.origin;

    if (origin && isAllowedOrigin(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
    } else if (!origin) {
        res.setHeader("Access-Control-Allow-Origin", "*");
    }

    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS"
    );
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
    );
    res.setHeader("Content-Type", "application/json");

    // Handle browser preflight requests
    if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
    }

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    // ------------------------------------
    // 1. BACKEND HEALTH CHECK
    // ------------------------------------

    if (req.method === "GET" &&
        url.pathname === "/api/health") {

        res.writeHead(200);

        return res.end(JSON.stringify({
            success: true,
            message: "RideNow backend is running"
        }));
    }

    // ------------------------------------
    // 2. CUSTOMER REGISTRATION
    // ------------------------------------

    if (req.method === "POST" &&
        url.pathname === "/api/customers/register") {

        let connection;
        let transactionStarted = false;

        try {
            const { name, email, phone, password } =
                await readRequestBody(req);

            // Validate required fields
            if (
                typeof name !== "string" ||
                typeof email !== "string" ||
                typeof phone !== "string" ||
                typeof password !== "string" ||
                !name.trim() ||
                !email.trim() ||
                !phone.trim() ||
                !password
            ) {
                res.writeHead(400);

                return res.end(JSON.stringify({
                    success: false,
                    message: "All fields are required"
                }));
            }

            const cleanName = name.trim();
            const cleanEmail = email.trim().toLowerCase();
            const cleanPhone = phone.trim();

            // Validate email
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
                res.writeHead(400);

                return res.end(JSON.stringify({
                    success: false,
                    message: "Invalid email address"
                }));
            }

            // Validate phone
            if (!/^[0-9]{10}$/.test(cleanPhone)) {
                res.writeHead(400);

                return res.end(JSON.stringify({
                    success: false,
                    message: "Enter a valid 10-digit phone number"
                }));
            }

            // Validate password
            if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
                res.writeHead(400);

                return res.end(JSON.stringify({
                    success: false,
                    message: "Password must contain 8 to 72 bytes"
                }));
            }

            // Hash password
            const passwordHash = await bcrypt.hash(password, 12);

            // Start database transaction
            connection = await pool.getConnection();

            await connection.beginTransaction();
            transactionStarted = true;

            // Insert into users table
            const [userResult] = await connection.execute(
                `INSERT INTO users
                (full_name, email, phone, password_hash, role)
                VALUES (?, ?, ?, ?, 'customer')`,
                [cleanName, cleanEmail, cleanPhone, passwordHash]
            );

            const userId = userResult.insertId;

            // Insert into passenger_profiles table
            await connection.execute(
                `INSERT INTO passenger_profiles (user_id)
                VALUES (?)`,
                [userId]
            );

            // Save both insertions
            await connection.commit();
            transactionStarted = false;

            res.writeHead(201);

            return res.end(JSON.stringify({
                success: true,
                message: "Customer registered successfully",
                customerId: userId
            }));

        } catch (error) {

            if (connection && transactionStarted) {
                await connection.rollback();
            }

            console.error("Registration error:", error.message);

            if (error.code === "ER_DUP_ENTRY") {
                res.writeHead(409);

                return res.end(JSON.stringify({
                    success: false,
                    message: "Email or phone number already registered"
                }));
            }

            if (
                error.message === "Invalid JSON" ||
                error.message === "Request body too large"
            ) {
                res.writeHead(400);

                return res.end(JSON.stringify({
                    success: false,
                    message: error.message
                }));
            }

            if (!res.destroyed && !res.headersSent) {
                res.writeHead(500);

                return res.end(JSON.stringify({
                    success: false,
                    message: "Registration failed. Please try again."
                }));
            }

        } finally {
            if (connection) {
                connection.release();
            }
        }

        return;
    }

    // ------------------------------------
    // 3. CUSTOMER LOGIN
    // ------------------------------------

    if (req.method === "POST" &&
        url.pathname === "/api/customers/login") {

        let connection;

        try {
            const { email, password } = await readRequestBody(req);

            // Validate input
            if (
                typeof email !== "string" ||
                typeof password !== "string" ||
                !email.trim() ||
                !password
            ) {
                res.writeHead(400);

                return res.end(JSON.stringify({
                    success: false,
                    message: "Email and password are required"
                }));
            }

            const cleanEmail = email.trim().toLowerCase();

            // Find customer account
            const [users] = await pool.execute(
                `SELECT id, full_name, email, password_hash, role
                 FROM users
                 WHERE email = ? AND role = 'customer'`,
                [cleanEmail]
            );

            if (users.length === 0) {
                res.writeHead(401);

                return res.end(JSON.stringify({
                    success: false,
                    message: "Invalid email or password"
                }));
            }

            const user = users[0];

            // Verify password using bcrypt
            const passwordMatches = await bcrypt.compare(
                password,
                user.password_hash
            );

            if (!passwordMatches) {
                res.writeHead(401);

                return res.end(JSON.stringify({
                    success: false,
                    message: "Invalid email or password"
                }));
            }

            // Generate secure random session token
            const sessionToken = crypto
                .randomBytes(32)
                .toString("hex");

            // Hash session token before database storage
            const tokenHash = crypto
                .createHash("sha256")
                .update(sessionToken)
                .digest("hex");

            connection = await pool.getConnection();

            // Store session in MySQL
            await connection.execute(
                `INSERT INTO user_sessions
                (user_id, session_token_hash, expires_at)
                VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))`,
                [user.id, tokenHash]
            );

            // Send session token using HttpOnly cookie
            res.setHeader(
                "Set-Cookie",
                `session_token=${sessionToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`
            );

            res.writeHead(200);

            return res.end(JSON.stringify({
                success: true,
                message: "Login successful",
                token: sessionToken,
                customer: {
                    id: user.id,
                    name: user.full_name,
                    email: user.email
                }
            }));

        } catch (error) {

            console.error("Login error:", error.message);

            if (
                error.message === "Invalid JSON" ||
                error.message === "Request body too large"
            ) {
                res.writeHead(400);

                return res.end(JSON.stringify({
                    success: false,
                    message: error.message
                }));
            }

            if (!res.destroyed && !res.headersSent) {
                res.writeHead(500);

                return res.end(JSON.stringify({
                    success: false,
                    message: "Login failed. Please try again."
                }));
            }

        } finally {
            if (connection) {
                connection.release();
            }
        }

        return;
    }

    // ------------------------------------
    // 4. CUSTOMER SESSION VERIFICATION
    // ------------------------------------

    if (req.method === "GET" &&
        url.pathname === "/api/customers/me") {

        try {
            // Read session token from browser cookie or Authorization header
            const sessionToken = getSessionToken(req);

            if (!sessionToken) {
                res.writeHead(401);

                return res.end(JSON.stringify({
                    success: false,
                    message: "Please log in first"
                }));
            }

            // Hash the token before searching MySQL
            const tokenHash = crypto
                .createHash("sha256")
                .update(sessionToken)
                .digest("hex");

            // Find a valid, unexpired customer session
            const [sessions] = await pool.execute(
                `SELECT
                    u.id,
                    u.full_name,
                    u.email,
                    u.role
                 FROM user_sessions s
                 JOIN users u ON s.user_id = u.id
                 WHERE s.session_token_hash = ?
                 AND s.expires_at > NOW()
                 AND u.role = 'customer'`,
                [tokenHash]
            );

            if (sessions.length === 0) {
                res.writeHead(401);

                return res.end(JSON.stringify({
                    success: false,
                    message: "Session expired or invalid. Please log in again."
                }));
            }

            const customer = sessions[0];

            res.writeHead(200);

            return res.end(JSON.stringify({
                success: true,
                message: "Customer session is valid",
                customer: {
                    id: customer.id,
                    name: customer.full_name,
                    email: customer.email
                }
            }));

        } catch (error) {
            console.error("Session verification error:", error.message);

            res.writeHead(500);

            return res.end(JSON.stringify({
                success: false,
                message: "Unable to verify session"
            }));
        }
    }

    // ------------------------------------
    // 5. CUSTOMER LOGOUT
    // ------------------------------------

    if (req.method === "POST" &&
        url.pathname === "/api/customers/logout") {

        try {
            const sessionToken = getSessionToken(req);

            if (sessionToken) {
                // Hash the token to find its database record
                const tokenHash = crypto
                    .createHash("sha256")
                    .update(sessionToken)
                    .digest("hex");

                // Delete the current session
                await pool.execute(
                    `DELETE FROM user_sessions
                     WHERE session_token_hash = ?`,
                    [tokenHash]
                );
            }

            // Clear the browser cookie
            res.setHeader(
                "Set-Cookie",
                "session_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
            );

            res.writeHead(200);

            return res.end(JSON.stringify({
                success: true,
                message: "Logged out successfully"
            }));

        } catch (error) {
            console.error("Logout error:", error.message);

            res.writeHead(500);

            return res.end(JSON.stringify({
                success: false,
                message: "Logout failed"
            }));
        }
    }

    // ------------------------------------
    // 6. UNKNOWN ROUTE
    // ------------------------------------

    res.writeHead(404);

    return res.end(JSON.stringify({
        success: false,
        message: "Route not found"
    }));
});

// Start backend server
server.listen(PORT, () => {
    console.log(
        `RideNow backend running at http://localhost:${PORT}`
    );
});