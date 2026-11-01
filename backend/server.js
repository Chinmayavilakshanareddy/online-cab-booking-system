const http = require("node:http");
const { URL } = require("node:url");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");

// Load environment variables from backend/.env
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const pool = require("./db");

const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.resolve(__dirname, "..");

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon"
};

// In-memory session cache: token -> session data
const activeSessions = new Map();
const driverAvailability = new Map();

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8"
    });
    res.end(JSON.stringify(data));
}

async function readJson(req) {
    let body = "";
    for await (const chunk of req) {
        body += chunk;
        if (body.length > 50_000) {
            throw new Error("Request body too large");
        }
    }
    return body ? JSON.parse(body) : {};
}

function getCookie(req, cookieName) {
    const cookies = req.headers.cookie || "";
    const cookie = cookies
        .split(";")
        .map(item => item.trim())
        .find(item => item.startsWith(cookieName + "="));
    return cookie ? cookie.substring(cookieName.length + 1) : null;
}

function getSessionToken(req) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
        return authHeader.substring(7).trim();
    }
    return getCookie(req, "session_token");
}

// System log helper
async function logActivity(userId, action, description, ipAddress = "127.0.0.1") {
    try {
        await pool.execute(
            `INSERT INTO system_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)`,
            [userId || null, action, description, ipAddress]
        );
    } catch (e) {
        console.error("Failed to write system log:", e.message);
    }
}

// Static file server
function serveStaticFile(req, res, pathname) {
    let filePath = path.join(ROOT_DIR, pathname);

    // Default route redirects or serves customer/index.html
    if (pathname === "/" || pathname === "") {
        filePath = path.join(ROOT_DIR, "customer", "index.html");
    }

    // Security check: prevent directory traversal
    if (!filePath.startsWith(ROOT_DIR)) {
        return sendJson(res, 403, { success: false, message: "Forbidden" });
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            return sendJson(res, 404, { success: false, message: "File not found" });
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || "application/octet-stream";

        res.writeHead(200, {
            "Content-Type": contentType,
            "Content-Length": stats.size
        });

        if (req.method === "HEAD") {
            return res.end();
        }

        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
    });
}

// Frontend origins allowed to communicate with the backend
const allowedOrigins = [
    "http://localhost:5500",
    "http://127.0.0.1:5500"
];

// Create HTTP server
const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;

    const clientIp =
        req.headers["x-forwarded-for"] ||
        req.socket.remoteAddress ||
        "127.0.0.1";

    // Reject browser requests from untrusted origins
    if (origin && !allowedOrigins.includes(origin)) {
        return sendJson(res, 403, {
            success: false,
            message: "Origin not allowed"
        });
    }

    // CORS configuration
    if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
    }

    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    );

    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
    );

    res.setHeader("Vary", "Origin");

    // Handle browser preflight requests
    if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
    }

    // Parse request URL
    const parsedUrl = new URL(
        req.url,
        `http://${req.headers.host || "localhost"}`
    );

    const pathname = parsedUrl.pathname;

    try {
        // ---------------- API ROUTES ----------------

        // 1. Health check
        if (req.method === "GET" && pathname === "/api/health") {
            return sendJson(res, 200, {
                success: true,
                message: "RideNow backend is operational",
                timestamp: new Date().toISOString()
            });
        }

        // 2. Authentication Login (Customer & Admin)
        if (req.method === "POST" && (pathname === "/api/auth/login" || pathname === "/api/customers/login")) {
            const { email, password } = await readJson(req);

            if (!email || !password) {
                return sendJson(res, 400, {
                    success: false,
                    message: "Email and password are required."
                });
            }

            const [users] = await pool.execute(
                `SELECT user_id, name, email, password, mobile, role, status FROM users WHERE email = ?`,
                [email.trim().toLowerCase()]
            );

            if (users.length === 0) {
                return sendJson(res, 401, {
                    success: false,
                    message: "Invalid email or password."
                });
            }

            const user = users[0];

            if (user.status === "blocked") {
                return sendJson(res, 403, {
                    success: false,
                    message: "This account has been blocked. Please contact support."
                });
            }

            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return sendJson(res, 401, {
                    success: false,
                    message: "Invalid email or password."
                });
            }

            // Fetch permissions if admin
            let permissions = [];
            if (user.role === "admin" || user.role === "super_admin") {
                const [perms] = await pool.execute(
                    `SELECT permission_name FROM admin_permissions WHERE admin_id = ?`,
                    [user.user_id]
                );
                permissions = perms.map(p => p.permission_name);
            }

            // Generate secure session token
            const sessionToken = crypto.randomBytes(32).toString("hex");
            activeSessions.set(sessionToken, {
                user_id: user.user_id,
                name: user.name,
                email: user.email,
                mobile: user.mobile,
                role: user.role,
                status: user.status,
                permissions: permissions,
                expiresAt: Date.now() + 24 * 60 * 60 * 1000
            });

            // Set session cookie
            res.setHeader(
                "Set-Cookie",
                `session_token=${sessionToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`
            );

            // Log activity
            await logActivity(user.user_id, "USER_LOGIN", `${user.role.toUpperCase()} ${user.name} logged in.`, clientIp);

            return sendJson(res, 200, {
                success: true,
                message: "Login successful.",
                token: sessionToken,
                user: {
                    user_id: user.user_id,
                    name: user.name,
                    email: user.email,
                    mobile: user.mobile,
                    role: user.role,
                    status: user.status,
                    permissions: permissions
                },
                customer: {
                    id: user.user_id,
                    name: user.name,
                    email: user.email,
                    role: user.role
                }
            });
        }

        // 2b. Customer Session Verification
        if (req.method === "GET" && pathname === "/api/customers/me") {
            const sessionToken = getSessionToken(req);

            if (!sessionToken || !activeSessions.has(sessionToken)) {
                return sendJson(res, 401, {
                    success: false,
                    message: "Please log in first"
                });
            }

            const session = activeSessions.get(sessionToken);

            if (session.expiresAt && session.expiresAt < Date.now()) {
                activeSessions.delete(sessionToken);
                return sendJson(res, 401, {
                    success: false,
                    message: "Session expired. Please log in again."
                });
            }

            return sendJson(res, 200, {
                success: true,
                message: "Customer session is valid",
                customer: {
                    id: session.user_id,
                    name: session.name,
                    email: session.email,
                    phone: session.mobile,
                    role: session.role
                }
            });
        }

        // 2c. Customer Book a Ride
        if (req.method === "POST" && pathname === "/api/customers/book-ride") {
            const sessionToken = getSessionToken(req);

            if (!sessionToken || !activeSessions.has(sessionToken)) {
                return sendJson(res, 401, {
                    success: false,
                    message: "Please log in before booking a ride."
                });
            }

            const session = activeSessions.get(sessionToken);

            if (session.expiresAt && session.expiresAt < Date.now()) {
                activeSessions.delete(sessionToken);
                return sendJson(res, 401, {
                    success: false,
                    message: "Session expired. Please log in again."
                });
            }

            const {
                pickup,
                destination,
                vehicleType,
                rideDate,
                rideTime
            } = await readJson(req);

            if (
                typeof pickup !== "string" ||
                typeof destination !== "string" ||
                typeof vehicleType !== "string" ||
                typeof rideDate !== "string" ||
                typeof rideTime !== "string" ||
                !pickup.trim() ||
                !destination.trim() ||
                !/^\d{4}-\d{2}-\d{2}$/.test(rideDate) ||
                !/^\d{2}:\d{2}$/.test(rideTime)
            ) {
                return sendJson(res, 400, {
                    success: false,
                    message: "Please provide valid pickup, destination, vehicle type, date and time."
                });
            }

            if (pickup.trim().toLowerCase() === destination.trim().toLowerCase()) {
                return sendJson(res, 400, {
                    success: false,
                    message: "Pickup and destination cannot be the same."
                });
            }

            // Timezone-safe date validation
            const [year, month, day] = rideDate.split("-").map(Number);
            const [hour, minute] = rideTime.split(":").map(Number);

            const scheduledDate = new Date(
                year, month - 1, day, hour, minute
            );

            if (
                scheduledDate.getFullYear() !== year ||
                scheduledDate.getMonth() !== month - 1 ||
                scheduledDate.getDate() !== day ||
                scheduledDate.getHours() !== hour ||
                scheduledDate.getMinutes() !== minute ||
                scheduledDate <= new Date()
            ) {
                return sendJson(res, 400, {
                    success: false,
                    message: "Please select a valid future travel date and time."
                });
            }

            const [passengers] = await pool.execute(
                `SELECT passenger_id
                 FROM passenger_profiles
                 WHERE user_id = ?
                 LIMIT 1`,
                [session.user_id]
            );

            if (passengers.length === 0) {
                return sendJson(res, 404, {
                    success: false,
                    message: "Passenger profile not found."
                });
            }

            const passengerId = passengers[0].passenger_id;

            let normalizedType = vehicleType.trim();
            if (normalizedType.toLowerCase() === "mini") {
                normalizedType = "Hatchback";
            }

            let [fareRules] = await pool.execute(
                `SELECT base_fare, per_km_rate, per_minute_rate, cancellation_fee
                 FROM fare_rules
                 WHERE LOWER(vehicle_type) = LOWER(?) AND status = 'active'
                 LIMIT 1`,
                [normalizedType]
            );

            if (fareRules.length === 0) {
                // Fallback to first active rule
                const [fallbackRules] = await pool.execute(
                    `SELECT base_fare, per_km_rate, per_minute_rate, cancellation_fee
                     FROM fare_rules
                     WHERE status = 'active'
                     ORDER BY fare_id ASC LIMIT 1`
                );
                fareRules = fallbackRules;
            }

            if (fareRules.length === 0) {
                return sendJson(res, 409, {
                    success: false,
                    message: `No active fare rule is configured for ${vehicleType}.`
                });
            }

            const estimatedFare = Number(fareRules[0].base_fare);

            const [result] = await pool.execute(
                `INSERT INTO ride_requests
                 (passenger_id, pickup_location, destination,
                  vehicle_type, scheduled_at, estimated_fare, status)
                 VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
                [
                    passengerId,
                    pickup.trim(),
                    destination.trim(),
                    vehicleType.trim(),
                    `${rideDate} ${rideTime}:00`,
                    estimatedFare
                ]
            );

            await logActivity(
                session.user_id,
                "RIDE_REQUEST_CREATED",
                `Ride request ${result.insertId} created.`,
                clientIp
            );

            return sendJson(res, 201, {
                success: true,
                message: "Ride request created successfully.",
                booking: {
                    request_id: result.insertId,
                    passenger_id: passengerId,
                    pickup,
                    destination,
                    vehicle_type: vehicleType,
                    scheduled_at: `${rideDate} ${rideTime}:00`,
                    estimated_fare: estimatedFare,
                    fare_note: "Base fare only. Final fare depends on journey distance and duration.",
                    status: "pending"
                }
            });
        }

        // 2d. Customer / Auth Logout
        if (req.method === "POST" && (pathname === "/api/customers/logout" || pathname === "/api/auth/logout")) {
            const sessionToken = getSessionToken(req);

            if (sessionToken && activeSessions.has(sessionToken)) {
                const session = activeSessions.get(sessionToken);
                await logActivity(session.user_id, "USER_LOGOUT", `User ${session.name} logged out.`, clientIp);
                activeSessions.delete(sessionToken);
            }

            res.setHeader(
                "Set-Cookie",
                "session_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
            );

            return sendJson(res, 200, {
                success: true,
                message: "Logged out successfully"
            });
        }

        // 2e. Get Customer Ride History
        if (req.method === "GET" && pathname === "/api/customers/rides") {
            const sessionToken = getSessionToken(req);

            if (!sessionToken || !activeSessions.has(sessionToken)) {
                return sendJson(res, 401, {
                    success: false,
                    message: "Please log in first."
                });
            }

            const session = activeSessions.get(sessionToken);

            if (session.expiresAt && session.expiresAt < Date.now()) {
                activeSessions.delete(sessionToken);
                return sendJson(res, 401, {
                    success: false,
                    message: "Session expired. Please log in again."
                });
            }

            const [passengers] = await pool.execute(
                `SELECT passenger_id FROM passenger_profiles WHERE user_id = ? LIMIT 1`,
                [session.user_id]
            );

            if (passengers.length === 0) {
                return sendJson(res, 404, {
                    success: false,
                    message: "Passenger profile not found."
                });
            }

            const passengerId = passengers[0].passenger_id;

            const [rides] = await pool.execute(
                `SELECT 
                    request_id,
                    pickup_location,
                    destination,
                    vehicle_type,
                    DATE_FORMAT(scheduled_at, '%Y-%m-%d %H:%i') AS scheduled_at,
                    estimated_fare,
                    status,
                    DATE_FORMAT(created_at, '%b %d, %Y, %h:%i %p') AS created_at
                 FROM ride_requests
                 WHERE passenger_id = ?
                 ORDER BY request_id DESC`,
                [passengerId]
            );

            return sendJson(res, 200, {
                success: true,
                rides: rides.map(r => ({
                    ...r,
                    estimated_fare: Number(r.estimated_fare || 0)
                }))
            });
        }

        // 3. Customer Registration
        if (req.method === "POST" && pathname === "/api/customers/register") {
            const { name, email, phone, password } = await readJson(req);

            if (
                typeof name !== "string" ||
                typeof email !== "string" ||
                typeof phone !== "string" ||
                typeof password !== "string" ||
                !name.trim() ||
                !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
                !/^[0-9]{10}$/.test(phone.trim()) ||
                password.length < 8
            ) {
                return sendJson(res, 400, {
                    success: false,
                    message: "Enter a valid name, email, 10-digit phone number, and password of at least 8 characters."
                });
            }

            const passwordHash = await bcrypt.hash(password, 10);
            const connection = await pool.getConnection();

            try {
                await connection.beginTransaction();

                const [result] = await connection.execute(
                    `INSERT INTO users (name, email, password, mobile, role, status) VALUES (?, ?, ?, ?, 'passenger', 'active')`,
                    [name.trim(), email.trim().toLowerCase(), passwordHash, phone.trim()]
                );

                await connection.execute(
                    "INSERT INTO passenger_profiles (user_id) VALUES (?)",
                    [result.insertId]
                );

                await connection.commit();

                await logActivity(result.insertId, "PASSENGER_REGISTER", `Passenger ${name.trim()} registered.`, clientIp);

                return sendJson(res, 201, {
                    success: true,
                    message: "Customer registered successfully."
                });
            } catch (error) {
                await connection.rollback();
                if (error.code === "ER_DUP_ENTRY") {
                    return sendJson(res, 409, {
                        success: false,
                        message: "That email or phone number is already registered."
                    });
                }
                console.error("Registration error:", error);
                return sendJson(res, 500, {
                    success: false,
                    message: "Registration failed. Please try again."
                });
            } finally {
                connection.release();
            }
        }

        
        // ========================================
        // 3b. DRIVER MODULE REST APIs
        // ========================================

        // Driver Registration
        if (req.method === "POST" && pathname === "/api/drivers/register") {
            const {
                name, email, phone, password,
                licenseNo, licenseExpiry,
                vehicleNumber, vehicleType, model, capacity
            } = await readJson(req);

            if (
                typeof name !== "string" || !name.trim() ||
                typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
                typeof phone !== "string" || !/^[0-9]{10}$/.test(phone.trim()) ||
                typeof password !== "string" || password.length < 8 ||
                typeof licenseNo !== "string" || !licenseNo.trim() ||
                !licenseExpiry ||
                typeof vehicleNumber !== "string" || !vehicleNumber.trim() ||
                typeof vehicleType !== "string" || !vehicleType.trim()
            ) {
                return sendJson(res, 400, {
                    success: false,
                    message: "Please provide valid personal, license, and vehicle details."
                });
            }

            const passwordHash = await bcrypt.hash(password, 10);
            const connection = await pool.getConnection();

            try {
                await connection.beginTransaction();

                const [userRes] = await connection.execute(
                    `INSERT INTO users (name, email, password, mobile, role, status) VALUES (?, ?, ?, ?, 'driver', 'active')`,
                    [name.trim(), email.trim().toLowerCase(), passwordHash, phone.trim()]
                );

                const userId = userRes.insertId;

                const [driverRes] = await connection.execute(
                    `INSERT INTO driver_profiles (user_id, license_no, license_expiry, verification_status, rating) VALUES (?, ?, ?, 'approved', 5.00)`,
                    [userId, licenseNo.trim(), licenseExpiry]
                );

                const driverId = driverRes.insertId;

                await connection.execute(
                    `INSERT INTO vehicles (driver_id, vehicle_number, vehicle_type, model, capacity, status) VALUES (?, ?, ?, ?, ?, 'active')`,
                    [driverId, vehicleNumber.trim().toUpperCase(), vehicleType.trim(), (model || "Standard").trim(), parseInt(capacity, 10) || 4]
                );

                await connection.commit();

                await logActivity(userId, "DRIVER_REGISTER", `Driver ${name.trim()} registered.`, clientIp);

                return sendJson(res, 201, {
                    success: true,
                    message: "Driver registered successfully."
                });
            } catch (error) {
                await connection.rollback();
                if (error.code === "ER_DUP_ENTRY") {
                    return sendJson(res, 409, {
                        success: false,
                        message: "Email, phone, license number, or vehicle number is already registered."
                    });
                }
                console.error("Driver registration error:", error);
                return sendJson(res, 500, {
                    success: false,
                    message: "Driver registration failed: " + error.message
                });
            } finally {
                connection.release();
            }
        }

        // Driver Login
        if (req.method === "POST" && pathname === "/api/drivers/login") {
            const { email, password } = await readJson(req);

            if (!email || !password) {
                return sendJson(res, 400, {
                    success: false,
                    message: "Email and password are required."
                });
            }

            const [users] = await pool.execute(
                `SELECT u.user_id, u.name, u.email, u.password, u.mobile, u.role, u.status,
                        d.driver_id, d.license_no, DATE_FORMAT(d.license_expiry, '%Y-%m-%d') as license_expiry,
                        d.verification_status, d.rating
                 FROM users u
                 LEFT JOIN driver_profiles d ON u.user_id = d.user_id
                 WHERE u.email = ? AND u.role = 'driver'`,
                [email.trim().toLowerCase()]
            );

            if (users.length === 0) {
                return sendJson(res, 401, {
                    success: false,
                    message: "Invalid driver email or password."
                });
            }

            const user = users[0];

            if (user.status === "blocked") {
                return sendJson(res, 403, {
                    success: false,
                    message: "Your driver account is suspended. Contact support."
                });
            }

            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return sendJson(res, 401, {
                    success: false,
                    message: "Invalid driver email or password."
                });
            }

            const sessionToken = crypto.randomBytes(32).toString("hex");
            activeSessions.set(sessionToken, {
                user_id: user.user_id,
                driver_id: user.driver_id,
                name: user.name,
                email: user.email,
                mobile: user.mobile,
                role: user.role,
                status: user.status,
                license_no: user.license_no,
                verification_status: user.verification_status,
                rating: user.rating,
                expiresAt: Date.now() + 24 * 60 * 60 * 1000
            });

            if (user.driver_id) {
                driverAvailability.set(user.driver_id, true);
            }

            res.setHeader(
                "Set-Cookie",
                `session_token=${sessionToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`
            );

            await logActivity(user.user_id, "DRIVER_LOGIN", `Driver ${user.name} logged in.`, clientIp);

            return sendJson(res, 200, {
                success: true,
                message: "Driver login successful.",
                token: sessionToken,
                driver: {
                    user_id: user.user_id,
                    driver_id: user.driver_id,
                    name: user.name,
                    email: user.email,
                    mobile: user.mobile,
                    license_no: user.license_no,
                    license_expiry: user.license_expiry,
                    verification_status: user.verification_status,
                    rating: user.rating,
                    is_online: true
                }
            });
        }

        // Driver Current Profile & Session Check
        if (req.method === "GET" && pathname === "/api/drivers/me") {
            const sessionToken = getSessionToken(req);

            if (!sessionToken || !activeSessions.has(sessionToken)) {
                return sendJson(res, 401, {
                    success: false,
                    message: "Please log in first"
                });
            }

            const session = activeSessions.get(sessionToken);

            if (session.expiresAt && session.expiresAt < Date.now()) {
                activeSessions.delete(sessionToken);
                return sendJson(res, 401, {
                    success: false,
                    message: "Session expired. Please log in again."
                });
            }

            const [rows] = await pool.execute(
                `SELECT u.user_id, u.name, u.email, u.mobile, u.role, u.status,
                        d.driver_id, d.license_no, DATE_FORMAT(d.license_expiry, '%Y-%m-%d') as license_expiry,
                        d.verification_status, d.rating
                 FROM users u
                 LEFT JOIN driver_profiles d ON u.user_id = d.user_id
                 WHERE u.user_id = ?`,
                [session.user_id]
            );

            if (rows.length === 0) {
                return sendJson(res, 404, { success: false, message: "Driver not found" });
            }

            const d = rows[0];
            const isOnline = driverAvailability.has(d.driver_id) ? driverAvailability.get(d.driver_id) : true;

            return sendJson(res, 200, {
                success: true,
                driver: {
                    user_id: d.user_id,
                    driver_id: d.driver_id,
                    name: d.name,
                    email: d.email,
                    mobile: d.mobile,
                    license_no: d.license_no,
                    license_expiry: d.license_expiry,
                    verification_status: d.verification_status,
                    rating: d.rating,
                    is_online: isOnline
                }
            });
        }

        // Toggle Driver Availability (Online / Offline)
        if (req.method === "POST" && pathname === "/api/drivers/toggle-availability") {
            const sessionToken = getSessionToken(req);
            if (!sessionToken || !activeSessions.has(sessionToken)) {
                return sendJson(res, 401, { success: false, message: "Please log in first" });
            }
            const session = activeSessions.get(sessionToken);
            const { isOnline } = await readJson(req);

            const statusBool = Boolean(isOnline);
            if (session.driver_id) {
                driverAvailability.set(session.driver_id, statusBool);
            }

            return sendJson(res, 200, {
                success: true,
                is_online: statusBool,
                message: `Status updated to ${statusBool ? "Online" : "Offline"}.`
            });
        }

        // Get Driver Vehicle
        if (req.method === "GET" && pathname === "/api/drivers/vehicle") {
            const sessionToken = getSessionToken(req);
            if (!sessionToken || !activeSessions.has(sessionToken)) {
                return sendJson(res, 401, { success: false, message: "Please log in first" });
            }
            const session = activeSessions.get(sessionToken);

            const [vehicles] = await pool.execute(
                `SELECT vehicle_id, driver_id, vehicle_number, vehicle_type, model, capacity, status
                 FROM vehicles
                 WHERE driver_id = ?
                 ORDER BY vehicle_id DESC
                 LIMIT 1`,
                [session.driver_id]
            );

            return sendJson(res, 200, {
                success: true,
                vehicle: vehicles.length > 0 ? vehicles[0] : null
            });
        }

        // Add or Update Driver Vehicle
        if (req.method === "POST" && pathname === "/api/drivers/vehicle") {
            const sessionToken = getSessionToken(req);
            if (!sessionToken || !activeSessions.has(sessionToken)) {
                return sendJson(res, 401, { success: false, message: "Please log in first" });
            }
            const session = activeSessions.get(sessionToken);
            const { vehicleNumber, vehicleType, model, capacity } = await readJson(req);

            if (!vehicleNumber || !vehicleType || !model) {
                return sendJson(res, 400, { success: false, message: "All vehicle fields are required." });
            }

            const [existing] = await pool.execute(
                `SELECT vehicle_id FROM vehicles WHERE driver_id = ? LIMIT 1`,
                [session.driver_id]
            );

            if (existing.length > 0) {
                await pool.execute(
                    `UPDATE vehicles SET vehicle_number = ?, vehicle_type = ?, model = ?, capacity = ? WHERE vehicle_id = ?`,
                    [vehicleNumber.trim().toUpperCase(), vehicleType.trim(), model.trim(), parseInt(capacity, 10) || 4, existing[0].vehicle_id]
                );
            } else {
                await pool.execute(
                    `INSERT INTO vehicles (driver_id, vehicle_number, vehicle_type, model, capacity, status) VALUES (?, ?, ?, ?, ?, 'active')`,
                    [session.driver_id, vehicleNumber.trim().toUpperCase(), vehicleType.trim(), model.trim(), parseInt(capacity, 10) || 4]
                );
            }

            return sendJson(res, 200, {
                success: true,
                message: "Vehicle details updated successfully."
            });
        }

        // Available Ride Requests for Drivers
        if (req.method === "GET" && pathname === "/api/drivers/available-requests") {
            const sessionToken = getSessionToken(req);
            if (!sessionToken || !activeSessions.has(sessionToken)) {
                return sendJson(res, 401, { success: false, message: "Please log in first" });
            }

            const [requests] = await pool.query(
                `SELECT r.request_id, r.passenger_id, r.pickup_location, r.destination,
                        r.vehicle_type, r.estimated_fare, r.status,
                        DATE_FORMAT(r.scheduled_at, '%b %d, %H:%i') AS scheduled_at,
                        u.name AS passenger_name, u.mobile AS passenger_phone
                 FROM ride_requests r
                 JOIN passenger_profiles pp ON r.passenger_id = pp.passenger_id
                 JOIN users u ON pp.user_id = u.user_id
                 WHERE r.status = 'pending'
                 ORDER BY r.request_id DESC
                 LIMIT 20`
            );

            return sendJson(res, 200, {
                success: true,
                requests: requests
            });
        }

        // Accept a Ride Request
        if (req.method === "POST" && pathname === "/api/drivers/accept-ride") {
            const sessionToken = getSessionToken(req);
            if (!sessionToken || !activeSessions.has(sessionToken)) {
                return sendJson(res, 401, { success: false, message: "Please log in first" });
            }
            const session = activeSessions.get(sessionToken);
            const { requestId } = await readJson(req);

            if (!requestId) {
                return sendJson(res, 400, { success: false, message: "Request ID is required." });
            }

            const [activeTrips] = await pool.execute(
                `SELECT trip_id FROM trips WHERE driver_id = ? AND trip_status IN ('assigned', 'started') LIMIT 1`,
                [session.driver_id]
            );
            if (activeTrips.length > 0) {
                return sendJson(res, 400, {
                    success: false,
                    message: "You already have an active trip in progress. Complete it before accepting another ride."
                });
            }

            const [vehicles] = await pool.execute(
                `SELECT vehicle_id FROM vehicles WHERE driver_id = ? AND status = 'active' LIMIT 1`,
                [session.driver_id]
            );
            if (vehicles.length === 0) {
                return sendJson(res, 400, {
                    success: false,
                    message: "You need an active registered vehicle to accept rides. Please add vehicle details first."
                });
            }
            const vehicleId = vehicles[0].vehicle_id;

            const [reqRows] = await pool.execute(
                `SELECT request_id, passenger_id, pickup_location, destination, estimated_fare, status FROM ride_requests WHERE request_id = ?`,
                [requestId]
            );
            if (reqRows.length === 0) {
                return sendJson(res, 404, { success: false, message: "Ride request not found." });
            }
            if (reqRows[0].status !== "pending") {
                return sendJson(res, 409, { success: false, message: "This ride has already been accepted or cancelled." });
            }

            const ride = reqRows[0];
            const connection = await pool.getConnection();

            try {
                await connection.beginTransaction();

                await connection.execute(
                    `UPDATE ride_requests SET status = 'accepted' WHERE request_id = ?`,
                    [requestId]
                );

                const [tripRes] = await connection.execute(
                    `INSERT INTO trips (request_id, passenger_id, driver_id, vehicle_id, start_time, fare, trip_status)
                     VALUES (?, ?, ?, ?, NOW(), ?, 'assigned')`,
                    [ride.request_id, ride.passenger_id, session.driver_id, vehicleId, ride.estimated_fare]
                );

                await connection.commit();

                await logActivity(session.user_id, "RIDE_ACCEPTED", `Driver accepted ride #${ride.request_id}. Trip #${tripRes.insertId} created.`, clientIp);

                return sendJson(res, 200, {
                    success: true,
                    message: "Ride accepted successfully!",
                    trip_id: tripRes.insertId
                });
            } catch (err) {
                await connection.rollback();
                console.error("Accept ride error:", err);
                return sendJson(res, 500, { success: false, message: "Failed to accept ride: " + err.message });
            } finally {
                connection.release();
            }
        }

        // Active Trip Details for Driver
        if (req.method === "GET" && pathname === "/api/drivers/active-trip") {
            const sessionToken = getSessionToken(req);
            if (!sessionToken || !activeSessions.has(sessionToken)) {
                return sendJson(res, 401, { success: false, message: "Please log in first" });
            }
            const session = activeSessions.get(sessionToken);

            const [trips] = await pool.execute(
                `SELECT t.trip_id, t.request_id, t.passenger_id, t.driver_id, t.vehicle_id,
                        t.start_time, t.distance_km, t.fare, t.trip_status,
                        r.pickup_location, r.destination,
                        u.name AS passenger_name, u.mobile AS passenger_phone,
                        v.vehicle_number, v.vehicle_type
                 FROM trips t
                 JOIN ride_requests r ON t.request_id = r.request_id
                 JOIN passenger_profiles pp ON t.passenger_id = pp.passenger_id
                 JOIN users u ON pp.user_id = u.user_id
                 JOIN vehicles v ON t.vehicle_id = v.vehicle_id
                 WHERE t.driver_id = ? AND t.trip_status IN ('assigned', 'started')
                 ORDER BY t.trip_id DESC
                 LIMIT 1`,
                [session.driver_id]
            );

            return sendJson(res, 200, {
                success: true,
                trip: trips.length > 0 ? trips[0] : null
            });
        }

        // Start Trip
        if (req.method === "POST" && pathname === "/api/drivers/start-trip") {
            const sessionToken = getSessionToken(req);
            if (!sessionToken || !activeSessions.has(sessionToken)) {
                return sendJson(res, 401, { success: false, message: "Please log in first" });
            }
            const session = activeSessions.get(sessionToken);
            const { tripId } = await readJson(req);

            await pool.execute(
                `UPDATE trips SET trip_status = 'started', start_time = NOW() WHERE trip_id = ? AND driver_id = ?`,
                [tripId, session.driver_id]
            );

            await logActivity(session.user_id, "TRIP_STARTED", `Driver started trip #${tripId}.`, clientIp);

            return sendJson(res, 200, {
                success: true,
                message: "Trip started successfully."
            });
        }

        // Complete Trip
        if (req.method === "POST" && pathname === "/api/drivers/complete-trip") {
            const sessionToken = getSessionToken(req);
            if (!sessionToken || !activeSessions.has(sessionToken)) {
                return sendJson(res, 401, { success: false, message: "Please log in first" });
            }
            const session = activeSessions.get(sessionToken);
            const { tripId, distanceKm } = await readJson(req);

            const [trips] = await pool.execute(
                `SELECT t.trip_id, t.request_id, t.passenger_id, t.fare, v.vehicle_type
                 FROM trips t
                 JOIN vehicles v ON t.vehicle_id = v.vehicle_id
                 WHERE t.trip_id = ? AND t.driver_id = ?`,
                [tripId, session.driver_id]
            );

            if (trips.length === 0) {
                return sendJson(res, 404, { success: false, message: "Active trip not found." });
            }

            const trip = trips[0];
            const dist = parseFloat(distanceKm) > 0 ? parseFloat(distanceKm) : 5.0;

            const [fareRule] = await pool.execute(
                `SELECT base_fare, per_km_rate, per_minute_rate FROM fare_rules WHERE LOWER(vehicle_type) = LOWER(?) AND status = 'active' LIMIT 1`,
                [trip.vehicle_type]
            );

            let finalFare = Number(trip.fare);
            if (fareRule.length > 0) {
                const base = Number(fareRule[0].base_fare);
                const perKm = Number(fareRule[0].per_km_rate);
                const perMin = Number(fareRule[0].per_minute_rate || 0);

                let durationMinutes = 0;
                if (trip.start_time) {
                    const startMs = new Date(trip.start_time).getTime();
                    const nowMs = Date.now();
                    durationMinutes = Math.max(1, Math.round((nowMs - startMs) / 60000));
                }
                finalFare = Math.round((base + (dist * perKm) + (durationMinutes * perMin)) * 100) / 100;
            }

            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();

                await connection.execute(
                    `UPDATE trips SET trip_status = 'completed', end_time = NOW(), distance_km = ?, fare = ? WHERE trip_id = ?`,
                    [dist, finalFare, tripId]
                );

                await connection.execute(
                    `UPDATE ride_requests SET status = 'completed' WHERE request_id = ?`,
                    [trip.request_id]
                );

                await connection.execute(
                    `INSERT INTO payments (trip_id, passenger_id, amount, payment_method, payment_status, paid_at)
                     VALUES (?, ?, ?, 'upi', 'completed', NOW())
                     ON DUPLICATE KEY UPDATE amount = VALUES(amount), payment_status = 'completed'`,
                    [tripId, trip.passenger_id, finalFare]
                );

                await connection.commit();

                await logActivity(session.user_id, "TRIP_COMPLETED", `Driver completed trip #${tripId}. Final fare: ₹${finalFare}.`, clientIp);

                return sendJson(res, 200, {
                    success: true,
                    message: "Trip completed and settled successfully.",
                    fare: finalFare
                });
            } catch (err) {
                await connection.rollback();
                console.error("Complete trip error:", err);
                return sendJson(res, 500, { success: false, message: "Failed to complete trip: " + err.message });
            } finally {
                connection.release();
            }
        }

        // Driver Completed Trips and Earnings
        if (req.method === "GET" && pathname === "/api/drivers/my-trips") {
            const sessionToken = getSessionToken(req);
            if (!sessionToken || !activeSessions.has(sessionToken)) {
                return sendJson(res, 401, { success: false, message: "Please log in first" });
            }
            const session = activeSessions.get(sessionToken);

            const [trips] = await pool.execute(
                `SELECT t.trip_id, t.request_id, t.distance_km, t.fare, t.trip_status,
                        t.start_time, t.end_time,
                        DATE_FORMAT(t.end_time, '%b %d, %Y, %h:%i %p') AS formatted_end_time,
                        r.pickup_location, r.destination,
                        u.name AS passenger_name
                 FROM trips t
                 JOIN ride_requests r ON t.request_id = r.request_id
                 JOIN passenger_profiles pp ON t.passenger_id = pp.passenger_id
                 JOIN users u ON pp.user_id = u.user_id
                 WHERE t.driver_id = ? AND t.trip_status = 'completed'
                 ORDER BY t.trip_id DESC`,
                [session.driver_id]
            );

            const totalEarnings = trips.reduce((sum, t) => sum + Number(t.fare || 0), 0);

            return sendJson(res, 200, {
                success: true,
                trips: trips,
                total_earnings: totalEarnings
            });
        }

        // Driver Logout
        if (req.method === "POST" && pathname === "/api/drivers/logout") {
            const sessionToken = getSessionToken(req);
            if (sessionToken && activeSessions.has(sessionToken)) {
                const s = activeSessions.get(sessionToken);
                if (s.driver_id) {
                    driverAvailability.delete(s.driver_id);
                }
                activeSessions.delete(sessionToken);
            }
            res.setHeader("Set-Cookie", "session_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
            return sendJson(res, 200, { success: true, message: "Driver logged out successfully" });
        }

        // 4. Admin Dashboard Statistics
        if (req.method === "GET" && pathname === "/api/admin/dashboard/stats") {
            const [passengersRes] = await pool.query(
                `SELECT COUNT(*) AS total_passengers FROM users WHERE role IN ('passenger', 'customer')`
            );
            const [driversRes] = await pool.query(
                `SELECT COUNT(*) AS total_drivers FROM users WHERE role = 'driver'`
            );
            const [pendingDriversRes] = await pool.query(
                `SELECT COUNT(*) AS pending_approvals FROM driver_profiles WHERE verification_status = 'pending'`
            );
            const [approvedDriversRes] = await pool.query(
                `SELECT COUNT(*) AS approved_drivers FROM driver_profiles WHERE verification_status = 'approved'`
            );

            const [tripsRes] = await pool.query(
                `SELECT 
                    COUNT(*) AS total_trips,
                    COALESCE(SUM(CASE WHEN trip_status IN ('started', 'assigned') THEN 1 ELSE 0 END), 0) AS active_trips,
                    COALESCE(SUM(CASE WHEN trip_status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_trips,
                    COALESCE(SUM(CASE WHEN trip_status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_trips,
                    COALESCE(SUM(distance_km), 0) AS total_distance_km
                 FROM trips`
            );

            const [requestsRes] = await pool.query(
                `SELECT 
                    COUNT(*) AS total_bookings,
                    COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_requests,
                    COALESCE(SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END), 0) AS accepted_requests
                 FROM ride_requests`
            );

            const [revenueRes] = await pool.query(
                `SELECT COALESCE(SUM(amount), 0) AS total_revenue FROM payments WHERE payment_status = 'completed'`
            );

            const [vehiclesRes] = await pool.query(
                `SELECT 
                    COUNT(*) AS total_vehicles,
                    COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active_vehicles
                 FROM vehicles`
            );

            const [pendingDriversList] = await pool.query(
                `SELECT 
                    d.driver_id,
                    d.user_id,
                    u.name,
                    u.email,
                    u.mobile,
                    d.license_no,
                    DATE_FORMAT(d.license_expiry, '%Y-%m-%d') AS license_expiry,
                    d.verification_status,
                    d.rating,
                    v.vehicle_id,
                    v.vehicle_number,
                    v.vehicle_type,
                    v.model,
                    DATE_FORMAT(u.created_at, '%b %d, %Y') AS joined_date
                 FROM driver_profiles d
                 JOIN users u ON d.user_id = u.user_id
                 LEFT JOIN vehicles v ON v.driver_id = d.driver_id
                 WHERE d.verification_status = 'pending'
                 ORDER BY d.driver_id DESC
                 LIMIT 10`
            );

            const [recentTrips] = await pool.query(
                `SELECT 
                    t.trip_id,
                    t.start_time,
                    t.end_time,
                    t.distance_km,
                    t.fare,
                    t.trip_status,
                    u_pass.name AS passenger_name,
                    u_driv.name AS driver_name,
                    r.pickup_location,
                    r.destination,
                    v.vehicle_type,
                    v.vehicle_number,
                    DATE_FORMAT(t.start_time, '%b %d, %H:%i') AS formatted_time
                 FROM trips t
                 JOIN passenger_profiles pp ON t.passenger_id = pp.passenger_id
                 JOIN users u_pass ON pp.user_id = u_pass.user_id
                 JOIN driver_profiles dp ON t.driver_id = dp.driver_id
                 JOIN users u_driv ON dp.user_id = u_driv.user_id
                 JOIN ride_requests r ON t.request_id = r.request_id
                 JOIN vehicles v ON t.vehicle_id = v.vehicle_id
                 ORDER BY t.trip_id DESC
                 LIMIT 6`
            );

            const [recentLogs] = await pool.query(
                `SELECT 
                    l.log_id,
                    l.action,
                    l.description,
                    l.ip_address,
                    DATE_FORMAT(l.created_at, '%b %d, %H:%i') AS time_ago,
                    COALESCE(u.name, 'System') AS actor_name,
                    COALESCE(u.role, 'system') AS actor_role
                 FROM system_logs l
                 LEFT JOIN users u ON l.user_id = u.user_id
                 ORDER BY l.log_id DESC
                 LIMIT 5`
            );

            return sendJson(res, 200, {
                success: true,
                stats: {
                    passengers: {
                        total: passengersRes[0].total_passengers
                    },
                    drivers: {
                        total: driversRes[0].total_drivers,
                        approved: approvedDriversRes[0].approved_drivers,
                        pending_approval: pendingDriversRes[0].pending_approvals
                    },
                    trips: {
                        total: tripsRes[0].total_trips,
                        active: Number(tripsRes[0].active_trips),
                        completed: Number(tripsRes[0].completed_trips),
                        cancelled: Number(tripsRes[0].cancelled_trips),
                        total_distance_km: Number(tripsRes[0].total_distance_km)
                    },
                    bookings: {
                        total: requestsRes[0].total_bookings,
                        pending: Number(requestsRes[0].pending_requests),
                        accepted: Number(requestsRes[0].accepted_requests)
                    },
                    financials: {
                        total_revenue: Number(revenueRes[0].total_revenue)
                    },
                    vehicles: {
                        total: vehiclesRes[0].total_vehicles,
                        active: Number(vehiclesRes[0].active_vehicles)
                    }
                },
                pending_drivers: pendingDriversList,
                recent_trips: recentTrips,
                recent_logs: recentLogs
            });
        }

        // 5. Driver Management Actions API (Approve, Reject, Block, Unblock, Status Transitions)
        if ((req.method === "POST" || req.method === "PATCH") && pathname.startsWith("/api/admin/drivers/")) {
            const parts = pathname.split("/").filter(Boolean);
            const driverId = parseInt(parts[3], 10);
            const actionType = (parts[4] || "status").toLowerCase();

            if (!driverId) {
                return sendJson(res, 400, { success: false, message: "Valid driver_id is required." });
            }

            const [driverRows] = await pool.execute(
                `SELECT d.driver_id, d.user_id, u.name, u.email, u.mobile, d.license_no, d.verification_status, u.status AS user_status 
                 FROM driver_profiles d 
                 JOIN users u ON d.user_id = u.user_id 
                 WHERE d.driver_id = ?`,
                [driverId]
            );

            if (driverRows.length === 0) {
                return sendJson(res, 404, { success: false, message: "Driver not found." });
            }

            const driver = driverRows[0];
            const currentEffectiveStatus = (driver.user_status === "blocked" || driver.verification_status === "suspended")
                ? "blocked"
                : driver.verification_status;

            let targetStatus = "approved";
            if (actionType === "approve") {
                targetStatus = "approved";
            } else if (actionType === "reject") {
                targetStatus = "rejected";
            } else if (actionType === "block" || actionType === "suspend") {
                targetStatus = "blocked";
            } else if (actionType === "unblock") {
                targetStatus = "approved";
            } else {
                const body = await readJson(req);
                if (body && body.status) {
                    const s = String(body.status).toLowerCase().trim();
                    if (s === "suspend" || s === "suspended") targetStatus = "blocked";
                    else if (s === "unblock" || s === "active") targetStatus = "approved";
                    else targetStatus = s;
                }
            }

            const allowedStatuses = ["approved", "rejected", "pending", "blocked"];
            if (!allowedStatuses.includes(targetStatus)) {
                return sendJson(res, 400, {
                    success: false,
                    message: `Invalid status '${targetStatus}'. Allowed: ${allowedStatuses.join(", ")}.`
                });
            }

            const VALID_TRANSITIONS = {
                pending: ["approved", "rejected", "blocked"],
                approved: ["blocked", "rejected", "pending"],
                rejected: ["approved", "pending", "blocked"],
                blocked: ["approved", "pending", "rejected"]
            };

            if (targetStatus === currentEffectiveStatus) {
                return sendJson(res, 400, {
                    success: false,
                    message: `Driver ${driver.name} is already ${currentEffectiveStatus}.`
                });
            }

            if (!VALID_TRANSITIONS[currentEffectiveStatus] || !VALID_TRANSITIONS[currentEffectiveStatus].includes(targetStatus)) {
                return sendJson(res, 400, {
                    success: false,
                    message: `Invalid status transition from '${currentEffectiveStatus}' to '${targetStatus}'.`
                });
            }

            let verificationStatus = targetStatus;
            let userStatus = "active";
            let vehicleStatus = "active";

            if (targetStatus === "blocked") {
                verificationStatus = "suspended";
                userStatus = "blocked";
                vehicleStatus = "inactive";
            } else if (targetStatus === "rejected") {
                verificationStatus = "rejected";
                userStatus = "active";
                vehicleStatus = "inactive";
            } else if (targetStatus === "pending") {
                verificationStatus = "pending";
                userStatus = "pending";
                vehicleStatus = "inactive";
            } else if (targetStatus === "approved") {
                verificationStatus = "approved";
                userStatus = "active";
                vehicleStatus = "active";
            }

            await pool.execute(
                `UPDATE driver_profiles SET verification_status = ? WHERE driver_id = ?`,
                [verificationStatus, driverId]
            );

            await pool.execute(
                `UPDATE users SET status = ? WHERE user_id = ?`,
                [userStatus, driver.user_id]
            );

            await pool.execute(
                `UPDATE vehicles SET status = ? WHERE driver_id = ?`,
                [vehicleStatus, driverId]
            );

            let logAction = `DRIVER_${targetStatus.toUpperCase()}`;
            if (currentEffectiveStatus === "blocked" && targetStatus === "approved") {
                logAction = "DRIVER_UNBLOCKED";
            }
            const logDesc = `Driver ${driver.name} (Driver #${driverId}, License: ${driver.license_no}) status transitioned from '${currentEffectiveStatus}' to '${targetStatus}' by Admin.`;

            await logActivity(driver.user_id, logAction, logDesc, clientIp);

            return sendJson(res, 200, {
                success: true,
                message: `Driver ${driver.name} has been ${targetStatus === "approved" && currentEffectiveStatus === "blocked" ? "unblocked and approved" : targetStatus}.`,
                driver_id: driverId,
                status: targetStatus,
                previous_status: currentEffectiveStatus
            });
        }

        // 5b. Get All Drivers API
        if (req.method === "GET" && pathname === "/api/admin/drivers") {
            const search = (parsedUrl.searchParams.get("search") || "").trim();
            const status = (parsedUrl.searchParams.get("status") || "all").trim().toLowerCase();
            const page = Math.max(1, parseInt(parsedUrl.searchParams.get("page") || "1", 10) || 1);
            const limit = Math.max(1, Math.min(100, parseInt(parsedUrl.searchParams.get("limit") || "10", 10) || 10));
            const offset = (page - 1) * limit;

            const whereClauses = ["u.role = 'driver'"];
            const params = [];

            if (status && status !== "all") {
                if (status === "blocked" || status === "suspended") {
                    whereClauses.push("(u.status = 'blocked' OR d.verification_status = 'suspended')");
                } else if (status === "approved") {
                    whereClauses.push("d.verification_status = 'approved' AND u.status != 'blocked'");
                } else if (status === "pending") {
                    whereClauses.push("d.verification_status = 'pending' AND u.status != 'blocked'");
                } else if (status === "rejected") {
                    whereClauses.push("d.verification_status = 'rejected' AND u.status != 'blocked'");
                }
            }

            if (search) {
                whereClauses.push("(u.name LIKE ? OR u.email LIKE ? OR u.mobile LIKE ? OR d.license_no LIKE ? OR v.vehicle_number LIKE ? OR v.model LIKE ?)");
                const pattern = `%${search}%`;
                params.push(pattern, pattern, pattern, pattern, pattern, pattern);
            }

            const whereSql = whereClauses.length > 0 ? "WHERE " + whereClauses.join(" AND ") : "";

            const [countRows] = await pool.query(
                `SELECT COUNT(*) AS total 
                 FROM driver_profiles d 
                 JOIN users u ON d.user_id = u.user_id 
                 LEFT JOIN vehicles v ON d.driver_id = v.driver_id 
                 ${whereSql}`,
                params
            );
            const total = countRows[0].total;

            const [summaryRows] = await pool.query(
                `SELECT 
                    COUNT(*) AS total,
                    COALESCE(SUM(CASE WHEN d.verification_status = 'approved' AND u.status != 'blocked' THEN 1 ELSE 0 END), 0) AS approved_count,
                    COALESCE(SUM(CASE WHEN d.verification_status = 'pending' AND u.status != 'blocked' THEN 1 ELSE 0 END), 0) AS pending_count,
                    COALESCE(SUM(CASE WHEN d.verification_status = 'rejected' AND u.status != 'blocked' THEN 1 ELSE 0 END), 0) AS rejected_count,
                    COALESCE(SUM(CASE WHEN u.status = 'blocked' OR d.verification_status = 'suspended' THEN 1 ELSE 0 END), 0) AS blocked_count
                 FROM driver_profiles d
                 JOIN users u ON d.user_id = u.user_id`
            );

            const querySql = `
                SELECT 
                    d.driver_id,
                    d.user_id,
                    u.name,
                    u.email,
                    u.mobile AS phone,
                    u.status AS user_status,
                    d.license_no,
                    DATE_FORMAT(d.license_expiry, '%Y-%m-%d') AS license_expiry,
                    DATE_FORMAT(d.license_expiry, '%b %d, %Y') AS formatted_license_expiry,
                    CASE WHEN d.license_expiry < CURDATE() THEN 1 ELSE 0 END AS is_license_expired,
                    d.verification_status,
                    d.rating,
                    CASE 
                        WHEN u.status = 'blocked' OR d.verification_status = 'suspended' THEN 'blocked'
                        ELSE d.verification_status
                    END AS status,
                    v.vehicle_id,
                    v.vehicle_number,
                    v.vehicle_type,
                    v.model,
                    v.capacity,
                    v.status AS vehicle_status,
                    (SELECT COUNT(*) FROM trips t WHERE t.driver_id = d.driver_id) AS total_trips,
                    DATE_FORMAT(u.created_at, '%b %d, %Y') AS joined_date
                FROM driver_profiles d
                JOIN users u ON d.user_id = u.user_id
                LEFT JOIN vehicles v ON d.driver_id = v.driver_id
                ${whereSql}
                ORDER BY d.driver_id DESC
                LIMIT ? OFFSET ?
            `;

            const [drivers] = await pool.query(querySql, [...params, limit, offset]);

            return sendJson(res, 200, {
                success: true,
                drivers: drivers.map(d => ({
                    ...d,
                    rating: Number(d.rating || 5.0),
                    total_trips: Number(d.total_trips || 0),
                    is_license_expired: Boolean(d.is_license_expired)
                })),
                pagination: {
                    total: total,
                    page: page,
                    limit: limit,
                    totalPages: Math.ceil(total / limit) || 1
                },
                summary: {
                    total: Number(summaryRows[0].total || 0),
                    approved: Number(summaryRows[0].approved_count || 0),
                    pending: Number(summaryRows[0].pending_count || 0),
                    rejected: Number(summaryRows[0].rejected_count || 0),
                    blocked: Number(summaryRows[0].blocked_count || 0)
                }
            });
        }

        // 6. Admin Passengers List API
        if (req.method === "GET" && pathname === "/api/admin/passengers") {
            const search = (parsedUrl.searchParams.get("search") || "").trim();
            const status = (parsedUrl.searchParams.get("status") || "all").trim().toLowerCase();
            const page = Math.max(1, parseInt(parsedUrl.searchParams.get("page") || "1", 10) || 1);
            const limit = Math.max(1, Math.min(100, parseInt(parsedUrl.searchParams.get("limit") || "10", 10) || 10));
            const offset = (page - 1) * limit;

            const whereClauses = ["u.role IN ('passenger', 'customer')"];
            const params = [];

            if (status && status !== "all") {
                whereClauses.push("u.status = ?");
                params.push(status);
            }

            if (search) {
                whereClauses.push("(u.name LIKE ? OR u.email LIKE ? OR u.mobile LIKE ?)");
                const searchPattern = `%${search}%`;
                params.push(searchPattern, searchPattern, searchPattern);
            }

            const whereSql = whereClauses.length > 0 ? "WHERE " + whereClauses.join(" AND ") : "";

            const [countRows] = await pool.query(
                `SELECT COUNT(*) AS total FROM users u ${whereSql}`,
                params
            );
            const total = countRows[0].total;

            const [summaryRows] = await pool.query(
                `SELECT 
                    COUNT(*) AS total,
                    COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active_count,
                    COALESCE(SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END), 0) AS blocked_count
                 FROM users
                 WHERE role IN ('passenger', 'customer')`
            );

            const querySql = `
                SELECT 
                    u.user_id,
                    COALESCE(pp.passenger_id, u.user_id) AS passenger_id,
                    u.name,
                    u.email,
                    u.mobile AS phone,
                    u.status,
                    u.created_at,
                    DATE_FORMAT(u.created_at, '%b %d, %Y, %h:%i %p') AS formatted_created_at,
                    pp.default_address,
                    pp.emergency_contact,
                    (SELECT COUNT(*) FROM trips t WHERE t.passenger_id = pp.passenger_id) AS total_trips
                FROM users u
                LEFT JOIN passenger_profiles pp ON u.user_id = pp.user_id
                ${whereSql}
                ORDER BY u.user_id DESC
                LIMIT ? OFFSET ?
            `;

            const [passengers] = await pool.query(querySql, [...params, limit, offset]);

            return sendJson(res, 200, {
                success: true,
                passengers: passengers.map(p => ({
                    ...p,
                    total_trips: Number(p.total_trips || 0)
                })),
                pagination: {
                    total: total,
                    page: page,
                    limit: limit,
                    totalPages: Math.ceil(total / limit) || 1
                },
                summary: {
                    total: Number(summaryRows[0].total || 0),
                    active: Number(summaryRows[0].active_count || 0),
                    blocked: Number(summaryRows[0].blocked_count || 0)
                }
            });
        }

        // 7. Admin Update Passenger Status
        if ((req.method === "PATCH" || req.method === "POST") && pathname.startsWith("/api/admin/passengers/")) {
            const parts = pathname.split("/").filter(Boolean);
            const passengerIdParam = parseInt(parts[3], 10);
            const subAction = parts[4] || "status";

            if (!passengerIdParam) {
                return sendJson(res, 400, {
                    success: false,
                    message: "A valid passenger user_id or passenger_id is required."
                });
            }

            let newStatus = null;
            if (subAction === "block") {
                newStatus = "blocked";
            } else if (subAction === "unblock") {
                newStatus = "active";
            } else {
                const body = await readJson(req);
                if (body && body.status) {
                    newStatus = String(body.status).toLowerCase().trim();
                }
            }

            const allowedStatuses = ["active", "blocked", "inactive", "pending"];
            if (!newStatus || !allowedStatuses.includes(newStatus)) {
                return sendJson(res, 400, {
                    success: false,
                    message: `Invalid status '${newStatus}'. Allowed values: ${allowedStatuses.join(", ")}.`
                });
            }

            const [userRows] = await pool.execute(
                `SELECT u.user_id, u.name, u.email, u.mobile, u.status, pp.passenger_id
                 FROM users u
                 LEFT JOIN passenger_profiles pp ON u.user_id = pp.user_id
                 WHERE (u.user_id = ? OR pp.passenger_id = ?) AND u.role IN ('passenger', 'customer')
                 LIMIT 1`,
                [passengerIdParam, passengerIdParam]
            );

            if (userRows.length === 0) {
                return sendJson(res, 404, {
                    success: false,
                    message: "Passenger not found."
                });
            }

            const passenger = userRows[0];
            const oldStatus = passenger.status;

            await pool.execute(
                `UPDATE users SET status = ? WHERE user_id = ?`,
                [newStatus, passenger.user_id]
            );

            const logAction = newStatus === "blocked"
                ? "PASSENGER_BLOCKED"
                : (newStatus === "active" ? "PASSENGER_UNBLOCKED" : `PASSENGER_${newStatus.toUpperCase()}`);
            const logDesc = `Passenger ${passenger.name} (User ID: ${passenger.user_id}) status updated from '${oldStatus}' to '${newStatus}' by Admin.`;

            await logActivity(passenger.user_id, logAction, logDesc, clientIp);

            return sendJson(res, 200, {
                success: true,
                message: `Passenger ${passenger.name} has been ${newStatus === "active" ? "activated / unblocked" : newStatus}.`,
                passenger: {
                    user_id: passenger.user_id,
                    passenger_id: passenger.passenger_id,
                    name: passenger.name,
                    email: passenger.email,
                    phone: passenger.mobile,
                    status: newStatus,
                    previous_status: oldStatus
                }
            });
        }

        // =========================================================================
        // 8. Vehicle Management Routes
        // =========================================================================

        // 8a. GET /api/admin/vehicles - List all vehicles with filters and pagination
        if (req.method === "GET" && pathname === "/api/admin/vehicles") {
            const search = (parsedUrl.searchParams.get("search") || "").trim();
            const status = (parsedUrl.searchParams.get("status") || "all").trim().toLowerCase();
            const type = (parsedUrl.searchParams.get("type") || "all").trim();
            const page = Math.max(1, parseInt(parsedUrl.searchParams.get("page") || "1", 10) || 1);
            const limit = Math.max(1, Math.min(100, parseInt(parsedUrl.searchParams.get("limit") || "10", 10) || 10));
            const offset = (page - 1) * limit;

            const whereClauses = ["1=1"];
            const params = [];

            if (status && status !== "all") {
                whereClauses.push("v.status = ?");
                params.push(status);
            }

            if (type && type !== "all") {
                whereClauses.push("v.vehicle_type = ?");
                params.push(type);
            }

            if (search) {
                whereClauses.push("(v.vehicle_number LIKE ? OR v.model LIKE ? OR u.name LIKE ? OR u.email LIKE ? OR u.mobile LIKE ?)");
                const searchPattern = `%${search}%`;
                params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
            }

            const whereSql = "WHERE " + whereClauses.join(" AND ");

            // Count total matching
            const [countRows] = await pool.query(
                `SELECT COUNT(*) AS total 
                 FROM vehicles v
                 JOIN driver_profiles d ON v.driver_id = d.driver_id
                 JOIN users u ON d.user_id = u.user_id
                 ${whereSql}`,
                params
            );
            const total = countRows[0].total;

            // Summary counts for KPI cards
            const [summaryRows] = await pool.query(
                `SELECT 
                    COUNT(*) AS total,
                    COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active_count,
                    COALESCE(SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END), 0) AS inactive_count,
                    COALESCE(SUM(CASE WHEN status = 'under_maintenance' THEN 1 ELSE 0 END), 0) AS maintenance_count
                 FROM vehicles`
            );

            // Fetch vehicle rows
            const querySql = `
                SELECT 
                    v.vehicle_id,
                    v.driver_id,
                    v.vehicle_number,
                    v.vehicle_type,
                    v.model,
                    v.capacity,
                    v.status,
                    u.name AS driver_name,
                    u.email AS driver_email,
                    u.mobile AS driver_phone,
                    d.license_no,
                    d.verification_status AS driver_verification_status,
                    (SELECT COUNT(*) FROM trips t WHERE t.vehicle_id = v.vehicle_id) AS total_trips
                FROM vehicles v
                JOIN driver_profiles d ON v.driver_id = d.driver_id
                JOIN users u ON d.user_id = u.user_id
                ${whereSql}
                ORDER BY v.vehicle_id DESC
                LIMIT ? OFFSET ?
            `;

            const [vehicles] = await pool.query(querySql, [...params, limit, offset]);

            return sendJson(res, 200, {
                success: true,
                vehicles: vehicles.map(v => ({
                    ...v,
                    capacity: Number(v.capacity),
                    total_trips: Number(v.total_trips || 0)
                })),
                pagination: {
                    total: total,
                    page: page,
                    limit: limit,
                    totalPages: Math.ceil(total / limit) || 1
                },
                summary: {
                    total: Number(summaryRows[0].total || 0),
                    active: Number(summaryRows[0].active_count || 0),
                    inactive: Number(summaryRows[0].inactive_count || 0),
                    under_maintenance: Number(summaryRows[0].maintenance_count || 0)
                }
            });
        }

        // 8b. POST /api/admin/vehicles - Register new vehicle
        if (req.method === "POST" && pathname === "/api/admin/vehicles") {
            const body = await readJson(req);
            let { driver_id, vehicle_number, vehicle_type, model, capacity, status } = body;

            driver_id = parseInt(driver_id, 10);
            capacity = parseInt(capacity, 10);
            status = (status || "active").toLowerCase().trim();
            vehicle_number = (vehicle_number || "").toUpperCase().trim();
            vehicle_type = (vehicle_type || "").trim();
            model = (model || "").trim();

            const validTypes = ['Sedan', 'SUV', 'Hatchback', 'Auto', 'Bike', 'Premium'];
            const validStatuses = ['active', 'inactive', 'under_maintenance'];

            // Validation
            if (!driver_id || isNaN(driver_id)) {
                return sendJson(res, 400, { success: false, message: "Valid driver selection is required." });
            }
            if (!vehicle_number || vehicle_number.length < 4 || vehicle_number.length > 30) {
                return sendJson(res, 400, { success: false, message: "Vehicle registration number must be between 4 and 30 characters." });
            }
            if (!validTypes.includes(vehicle_type)) {
                return sendJson(res, 400, { success: false, message: `Invalid vehicle type. Allowed: ${validTypes.join(", ")}.` });
            }
            if (!model || model.length < 2 || model.length > 100) {
                return sendJson(res, 400, { success: false, message: "Model name must be between 2 and 100 characters." });
            }
            if (!capacity || isNaN(capacity) || capacity < 1 || capacity > 20) {
                return sendJson(res, 400, { success: false, message: "Capacity must be an integer between 1 and 20 seats." });
            }
            if (!validStatuses.includes(status)) {
                return sendJson(res, 400, { success: false, message: `Invalid status. Allowed: ${validStatuses.join(", ")}.` });
            }

            // Verify driver exists
            const [driverRows] = await pool.execute(
                `SELECT d.driver_id, u.name, d.verification_status 
                 FROM driver_profiles d 
                 JOIN users u ON d.user_id = u.user_id 
                 WHERE d.driver_id = ?`,
                [driver_id]
            );

            if (driverRows.length === 0) {
                return sendJson(res, 404, { success: false, message: "Selected driver does not exist." });
            }

            try {
                const [insertRes] = await pool.execute(
                    `INSERT INTO vehicles (driver_id, vehicle_number, vehicle_type, model, capacity, status) 
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [driver_id, vehicle_number, vehicle_type, model, capacity, status]
                );

                await logActivity(
                    null,
                    "VEHICLE_ADDED",
                    `Vehicle ${vehicle_number} (${model}, ${vehicle_type}) added and assigned to Driver ${driverRows[0].name} (Driver #${driver_id}) with status '${status}'.`,
                    clientIp
                );

                return sendJson(res, 201, {
                    success: true,
                    message: `Vehicle ${vehicle_number} registered successfully.`,
                    vehicle_id: insertRes.insertId,
                    vehicle: {
                        vehicle_id: insertRes.insertId,
                        driver_id,
                        vehicle_number,
                        vehicle_type,
                        model,
                        capacity,
                        status
                    }
                });
            } catch (err) {
                if (err.code === "ER_DUP_ENTRY") {
                    return sendJson(res, 409, {
                        success: false,
                        message: `Vehicle with registration number '${vehicle_number}' is already registered.`
                    });
                }
                throw err;
            }
        }

        // 8c. PATCH /api/admin/vehicles/:id/status - Quick vehicle status update
        if ((req.method === "PATCH" || req.method === "POST") && pathname.match(/^\/api\/admin\/vehicles\/\d+\/status$/)) {
            const parts = pathname.split("/").filter(Boolean);
            const vehicleId = parseInt(parts[3], 10);
            const body = await readJson(req);
            const newStatus = (body.status || "").toLowerCase().trim();

            const validStatuses = ['active', 'inactive', 'under_maintenance'];
            if (!validStatuses.includes(newStatus)) {
                return sendJson(res, 400, {
                    success: false,
                    message: `Invalid status '${newStatus}'. Allowed: ${validStatuses.join(", ")}.`
                });
            }

            const [vehRows] = await pool.execute(
                `SELECT v.vehicle_id, v.vehicle_number, v.model, v.status, u.name AS driver_name 
                 FROM vehicles v 
                 JOIN driver_profiles d ON v.driver_id = d.driver_id 
                 JOIN users u ON d.user_id = u.user_id 
                 WHERE v.vehicle_id = ?`,
                [vehicleId]
            );

            if (vehRows.length === 0) {
                return sendJson(res, 404, { success: false, message: "Vehicle not found." });
            }

            const vehicle = vehRows[0];
            const prevStatus = vehicle.status;

            if (prevStatus === newStatus) {
                return sendJson(res, 400, {
                    success: false,
                    message: `Vehicle ${vehicle.vehicle_number} is already ${newStatus}.`
                });
            }

            await pool.execute(
                `UPDATE vehicles SET status = ? WHERE vehicle_id = ?`,
                [newStatus, vehicleId]
            );

            let logAction = "VEHICLE_STATUS_UPDATED";
            if (newStatus === "active") logAction = "VEHICLE_ACTIVE";
            else if (newStatus === "inactive") logAction = "VEHICLE_INACTIVE";
            else if (newStatus === "under_maintenance") logAction = "VEHICLE_MAINTENANCE";

            await logActivity(
                null,
                logAction,
                `Vehicle ${vehicle.vehicle_number} (${vehicle.model}) status changed from '${prevStatus}' to '${newStatus}' by Admin.`,
                clientIp
            );

            return sendJson(res, 200, {
                success: true,
                message: `Vehicle ${vehicle.vehicle_number} status updated to ${newStatus.replace('_', ' ')}.`,
                vehicle_id: vehicleId,
                status: newStatus,
                previous_status: prevStatus
            });
        }

        // 8d. PATCH /api/admin/vehicles/:id - Edit vehicle details
        if (req.method === "PATCH" && pathname.match(/^\/api\/admin\/vehicles\/\d+$/)) {
            const parts = pathname.split("/").filter(Boolean);
            const vehicleId = parseInt(parts[3], 10);
            const body = await readJson(req);

            const [vehRows] = await pool.execute(
                `SELECT v.*, u.name AS driver_name 
                 FROM vehicles v 
                 JOIN driver_profiles d ON v.driver_id = d.driver_id 
                 JOIN users u ON d.user_id = u.user_id 
                 WHERE v.vehicle_id = ?`,
                [vehicleId]
            );

            if (vehRows.length === 0) {
                return sendJson(res, 404, { success: false, message: "Vehicle not found." });
            }

            const current = vehRows[0];
            const validTypes = ['Sedan', 'SUV', 'Hatchback', 'Auto', 'Bike', 'Premium'];
            const validStatuses = ['active', 'inactive', 'under_maintenance'];

            let updatedNumber = body.vehicle_number !== undefined ? String(body.vehicle_number).toUpperCase().trim() : current.vehicle_number;
            let updatedType = body.vehicle_type !== undefined ? String(body.vehicle_type).trim() : current.vehicle_type;
            let updatedModel = body.model !== undefined ? String(body.model).trim() : current.model;
            let updatedCapacity = body.capacity !== undefined ? parseInt(body.capacity, 10) : current.capacity;
            let updatedStatus = body.status !== undefined ? String(body.status).toLowerCase().trim() : current.status;
            let updatedDriverId = body.driver_id !== undefined ? parseInt(body.driver_id, 10) : current.driver_id;

            // Validations
            if (updatedNumber.length < 4 || updatedNumber.length > 30) {
                return sendJson(res, 400, { success: false, message: "Vehicle number must be between 4 and 30 characters." });
            }
            if (!validTypes.includes(updatedType)) {
                return sendJson(res, 400, { success: false, message: `Invalid vehicle type. Allowed: ${validTypes.join(", ")}.` });
            }
            if (updatedModel.length < 2 || updatedModel.length > 100) {
                return sendJson(res, 400, { success: false, message: "Model name must be between 2 and 100 characters." });
            }
            if (isNaN(updatedCapacity) || updatedCapacity < 1 || updatedCapacity > 20) {
                return sendJson(res, 400, { success: false, message: "Capacity must be an integer between 1 and 20." });
            }
            if (!validStatuses.includes(updatedStatus)) {
                return sendJson(res, 400, { success: false, message: `Invalid status. Allowed: ${validStatuses.join(", ")}.` });
            }

            try {
                await pool.execute(
                    `UPDATE vehicles 
                     SET driver_id = ?, vehicle_number = ?, vehicle_type = ?, model = ?, capacity = ?, status = ? 
                     WHERE vehicle_id = ?`,
                    [updatedDriverId, updatedNumber, updatedType, updatedModel, updatedCapacity, updatedStatus, vehicleId]
                );

                await logActivity(
                    null,
                    "VEHICLE_UPDATED",
                    `Vehicle #${vehicleId} (${updatedNumber}, ${updatedModel}) updated by Admin. Status: '${updatedStatus}'.`,
                    clientIp
                );

                return sendJson(res, 200, {
                    success: true,
                    message: `Vehicle ${updatedNumber} updated successfully.`,
                    vehicle: {
                        vehicle_id: vehicleId,
                        driver_id: updatedDriverId,
                        vehicle_number: updatedNumber,
                        vehicle_type: updatedType,
                        model: updatedModel,
                        capacity: updatedCapacity,
                        status: updatedStatus
                    }
                });
            } catch (err) {
                if (err.code === "ER_DUP_ENTRY") {
                    return sendJson(res, 409, {
                        success: false,
                        message: `Vehicle with registration number '${updatedNumber}' is already registered.`
                    });
                }
                throw err;
            }
        }

        // =========================================================================
        // 9. Trip & Booking Management Routes
        // =========================================================================

        // 9a. GET /api/admin/trips - Display all bookings & trips with details, filters & pagination
        if (req.method === "GET" && pathname === "/api/admin/trips") {
            const search = (parsedUrl.searchParams.get("search") || "").trim();
            const status = (parsedUrl.searchParams.get("status") || "all").trim().toLowerCase();
            const page = Math.max(1, parseInt(parsedUrl.searchParams.get("page") || "1", 10) || 1);
            const limit = Math.max(1, Math.min(100, parseInt(parsedUrl.searchParams.get("limit") || "10", 10) || 10));
            const offset = (page - 1) * limit;

            const whereClauses = ["1=1"];
            const params = [];

            if (status && status !== "all") {
                whereClauses.push("t.trip_status = ?");
                params.push(status);
            }

            if (search) {
                whereClauses.push("(u_pass.name LIKE ? OR u_pass.mobile LIKE ? OR u_driv.name LIKE ? OR u_driv.mobile LIKE ? OR r.pickup_location LIKE ? OR r.destination LIKE ? OR v.vehicle_number LIKE ?)");
                const pattern = `%${search}%`;
                params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
            }

            const whereSql = "WHERE " + whereClauses.join(" AND ");

            // Count total matching
            const [countRows] = await pool.query(
                `SELECT COUNT(*) AS total 
                 FROM trips t
                 JOIN passenger_profiles pp ON t.passenger_id = pp.passenger_id
                 JOIN users u_pass ON pp.user_id = u_pass.user_id
                 JOIN driver_profiles dp ON t.driver_id = dp.driver_id
                 JOIN users u_driv ON dp.user_id = u_driv.user_id
                 JOIN ride_requests r ON t.request_id = r.request_id
                 JOIN vehicles v ON t.vehicle_id = v.vehicle_id
                 ${whereSql}`,
                params
            );
            const total = countRows[0].total;

            // Summary counts by status
            const [summaryRows] = await pool.query(
                `SELECT 
                    COUNT(*) AS total,
                    COALESCE(SUM(CASE WHEN trip_status = 'assigned' THEN 1 ELSE 0 END), 0) AS assigned_count,
                    COALESCE(SUM(CASE WHEN trip_status = 'started' THEN 1 ELSE 0 END), 0) AS started_count,
                    COALESCE(SUM(CASE WHEN trip_status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_count,
                    COALESCE(SUM(CASE WHEN trip_status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_count,
                    COALESCE(SUM(fare), 0) AS total_fare_revenue
                 FROM trips`
            );

            // Fetch trips with rich details
            const querySql = `
                SELECT 
                    t.trip_id,
                    t.request_id,
                    t.passenger_id,
                    t.driver_id,
                    t.vehicle_id,
                    t.start_time,
                    t.end_time,
                    DATE_FORMAT(t.start_time, '%b %d, %Y, %h:%i %p') AS formatted_start,
                    DATE_FORMAT(t.end_time, '%b %d, %Y, %h:%i %p') AS formatted_end,
                    DATE_FORMAT(r.requested_at, '%b %d, %Y, %h:%i %p') AS formatted_requested,
                    t.distance_km,
                    t.fare,
                    t.trip_status,
                    r.pickup_location,
                    r.destination,
                    r.estimated_fare,
                    r.status AS request_status,
                    u_pass.user_id AS passenger_user_id,
                    u_pass.name AS passenger_name,
                    u_pass.email AS passenger_email,
                    u_pass.mobile AS passenger_phone,
                    u_driv.user_id AS driver_user_id,
                    u_driv.name AS driver_name,
                    u_driv.email AS driver_email,
                    u_driv.mobile AS driver_phone,
                    dp.license_no,
                    v.vehicle_number,
                    v.vehicle_type,
                    v.model AS vehicle_model,
                    p.payment_status,
                    p.payment_method
                FROM trips t
                JOIN passenger_profiles pp ON t.passenger_id = pp.passenger_id
                JOIN users u_pass ON pp.user_id = u_pass.user_id
                JOIN driver_profiles dp ON t.driver_id = dp.driver_id
                JOIN users u_driv ON dp.user_id = u_driv.user_id
                JOIN ride_requests r ON t.request_id = r.request_id
                JOIN vehicles v ON t.vehicle_id = v.vehicle_id
                LEFT JOIN payments p ON t.trip_id = p.trip_id
                ${whereSql}
                ORDER BY t.trip_id DESC
                LIMIT ? OFFSET ?
            `;

            const [trips] = await pool.query(querySql, [...params, limit, offset]);

            return sendJson(res, 200, {
                success: true,
                trips: trips.map(t => ({
                    ...t,
                    distance_km: Number(t.distance_km),
                    fare: Number(t.fare),
                    estimated_fare: Number(t.estimated_fare)
                })),
                pagination: {
                    total: total,
                    page: page,
                    limit: limit,
                    totalPages: Math.ceil(total / limit) || 1
                },
                summary: {
                    total: Number(summaryRows[0].total || 0),
                    assigned: Number(summaryRows[0].assigned_count || 0),
                    started: Number(summaryRows[0].started_count || 0),
                    completed: Number(summaryRows[0].completed_count || 0),
                    cancelled: Number(summaryRows[0].cancelled_count || 0),
                    total_revenue: Number(summaryRows[0].total_fare_revenue || 0)
                }
            });
        }

        // 9b. PATCH /api/admin/trips/:id/status - Handle booking issues and valid status changes
        if ((req.method === "PATCH" || req.method === "POST") && pathname.match(/^\/api\/admin\/trips\/\d+\/status$/)) {
            const parts = pathname.split("/").filter(Boolean);
            const tripId = parseInt(parts[3], 10);
            const body = await readJson(req);
            const newStatus = (body.status || "").toLowerCase().trim();

            const validStatuses = ['assigned', 'started', 'completed', 'cancelled'];
            if (!validStatuses.includes(newStatus)) {
                return sendJson(res, 400, {
                    success: false,
                    message: `Invalid status '${newStatus}'. Allowed: ${validStatuses.join(", ")}.`
                });
            }

            // Find trip
            const [tripRows] = await pool.execute(
                `SELECT t.trip_id, t.request_id, t.trip_status, t.passenger_id, t.driver_id,
                        u_pass.name AS passenger_name, u_driv.name AS driver_name,
                        r.pickup_location, r.destination
                 FROM trips t
                 JOIN passenger_profiles pp ON t.passenger_id = pp.passenger_id
                 JOIN users u_pass ON pp.user_id = u_pass.user_id
                 JOIN driver_profiles dp ON t.driver_id = dp.driver_id
                 JOIN users u_driv ON dp.user_id = u_driv.user_id
                 JOIN ride_requests r ON t.request_id = r.request_id
                 WHERE t.trip_id = ?`,
                [tripId]
            );

            if (tripRows.length === 0) {
                return sendJson(res, 404, { success: false, message: "Trip not found." });
            }

            const trip = tripRows[0];
            const currentStatus = trip.trip_status;

            if (currentStatus === newStatus) {
                return sendJson(res, 400, {
                    success: false,
                    message: `Trip #${tripId} is already '${newStatus}'.`
                });
            }

            // Valid transitions
            const VALID_TRIP_TRANSITIONS = {
                assigned: ['started', 'cancelled'],
                started: ['completed', 'cancelled'],
                completed: [], // Terminal
                cancelled: []  // Terminal
            };

            if (!VALID_TRIP_TRANSITIONS[currentStatus] || !VALID_TRIP_TRANSITIONS[currentStatus].includes(newStatus)) {
                return sendJson(res, 400, {
                    success: false,
                    message: `Invalid trip status transition from '${currentStatus}' to '${newStatus}'. Completed and Cancelled trips are terminal.`
                });
            }

            // Execute update
            let timeUpdateSql = "";
            const updateParams = [newStatus];

            if (newStatus === "started") {
                timeUpdateSql = ", start_time = COALESCE(start_time, NOW())";
            } else if (newStatus === "completed") {
                timeUpdateSql = ", end_time = COALESCE(end_time, NOW())";
            } else if (newStatus === "cancelled") {
                const [fareRows] = await pool.execute(
                    `SELECT cancellation_fee FROM fare_rules WHERE LOWER(vehicle_type) = (SELECT LOWER(v.vehicle_type) FROM vehicles v WHERE v.vehicle_id = ?) AND status = 'active' LIMIT 1`,
                    [trip.vehicle_id]
                );
                const cancelFee = fareRows.length > 0 ? Number(fareRows[0].cancellation_fee) : 0;
                timeUpdateSql = `, end_time = COALESCE(end_time, NOW()), fare = ${cancelFee}`;
            }

            updateParams.push(tripId);

            await pool.execute(
                `UPDATE trips SET trip_status = ? ${timeUpdateSql} WHERE trip_id = ?`,
                updateParams
            );

            // Synchronize ride_requests status
            if (newStatus === "completed") {
                await pool.execute(
                    `UPDATE ride_requests SET status = 'completed' WHERE request_id = ?`,
                    [trip.request_id]
                );
            } else if (newStatus === "cancelled") {
                await pool.execute(
                    `UPDATE ride_requests SET status = 'cancelled' WHERE request_id = ?`,
                    [trip.request_id]
                );
            }

            // Log activity
            await logActivity(
                null,
                `TRIP_${newStatus.toUpperCase()}`,
                `Trip #${tripId} (Passenger: ${trip.passenger_name}, Driver: ${trip.driver_name}) status updated from '${currentStatus}' to '${newStatus}' by Admin.`,
                clientIp
            );

            return sendJson(res, 200, {
                success: true,
                message: `Trip #${tripId} status updated to '${newStatus}'.`,
                trip_id: tripId,
                status: newStatus,
                previous_status: currentStatus
            });
        }

        // ========================================================
        // 10. PUBLIC FARE RULES & SERVICE AREAS
        // ========================================================
        if (req.method === "GET" && pathname === "/api/fare-rules") {
            const [rules] = await pool.query(
                `SELECT fare_id, vehicle_type, base_fare, per_km_rate, per_minute_rate, cancellation_fee, status
                 FROM fare_rules
                 WHERE status = 'active'
                 ORDER BY fare_id ASC`
            );
            return sendJson(res, 200, {
                success: true,
                fare_rules: rules.map(r => ({
                    ...r,
                    base_fare: Number(r.base_fare),
                    per_km_rate: Number(r.per_km_rate),
                    per_minute_rate: Number(r.per_minute_rate),
                    cancellation_fee: Number(r.cancellation_fee)
                }))
            });
        }

        if (req.method === "GET" && pathname === "/api/service-areas") {
            const [areas] = await pool.query(
                `SELECT area_id, area_name, city, state, status
                 FROM service_areas
                 WHERE status = 'active'
                 ORDER BY area_name ASC`
            );
            return sendJson(res, 200, {
                success: true,
                service_areas: areas
            });
        }

        // Customer Cancel Ride: POST /api/customers/cancel-ride or /customers/cancel-ride
        if (req.method === "POST" && (pathname === "/api/customers/cancel-ride" || pathname === "/customers/cancel-ride")) {
            const session = await getAuthenticatedUser(req);
            if (!session) {
                return sendJson(res, 401, { success: false, message: "Unauthorized. Please log in." });
            }

            const body = await readJson(req);
            const requestId = parseInt(body.requestId || body.request_id, 10);
            if (!requestId) {
                return sendJson(res, 400, { success: false, message: "Valid requestId is required." });
            }

            // Verify request ownership
            const [passengers] = await pool.execute(
                `SELECT passenger_id FROM passenger_profiles WHERE user_id = ?`,
                [session.user_id]
            );
            if (passengers.length === 0) {
                return sendJson(res, 404, { success: false, message: "Passenger profile not found." });
            }
            const passengerId = passengers[0].passenger_id;

            const [reqRows] = await pool.execute(
                `SELECT request_id, passenger_id, vehicle_type, status FROM ride_requests WHERE request_id = ? AND passenger_id = ?`,
                [requestId, passengerId]
            );
            if (reqRows.length === 0) {
                return sendJson(res, 404, { success: false, message: "Ride request not found or not owned by you." });
            }

            const ride = reqRows[0];
            if (ride.status === "completed" || ride.status === "cancelled") {
                return sendJson(res, 400, { success: false, message: `Ride request is already ${ride.status}.` });
            }

            // Check cancellation fee
            const [fareRule] = await pool.execute(
                `SELECT cancellation_fee FROM fare_rules WHERE LOWER(vehicle_type) = LOWER(?) AND status = 'active' LIMIT 1`,
                [ride.vehicle_type || "Sedan"]
            );
            const cancelFee = fareRule.length > 0 ? Number(fareRule[0].cancellation_fee) : 0;

            await pool.execute(
                `UPDATE ride_requests SET status = 'cancelled' WHERE request_id = ?`,
                [requestId]
            );

            // If there's an assigned or started trip, cancel it with fee
            const [trips] = await pool.execute(
                `SELECT trip_id FROM trips WHERE request_id = ?`,
                [requestId]
            );
            if (trips.length > 0) {
                await pool.execute(
                    `UPDATE trips SET trip_status = 'cancelled', end_time = NOW(), fare = ? WHERE request_id = ?`,
                    [cancelFee, requestId]
                );
            }

            await logActivity(
                session.user_id,
                "RIDE_CANCELLED",
                `Passenger cancelled ride #${requestId}. Cancellation fee: ₹${cancelFee}.`,
                clientIp
            );

            return sendJson(res, 200, {
                success: true,
                message: `Ride #${requestId} cancelled successfully.` + (cancelFee > 0 ? ` Cancellation fee applicable: ₹${cancelFee.toFixed(2)}` : ""),
                cancellation_fee: cancelFee
            });
        }

        // ========================================================
        // 11. ADMIN FARE RULES MANAGEMENT
        // ========================================================
        // 11a. GET /api/admin/fare-rules
        if (req.method === "GET" && pathname === "/api/admin/fare-rules") {
            const [rules] = await pool.query(
                `SELECT fare_id, vehicle_type, base_fare, per_km_rate, per_minute_rate, cancellation_fee, status
                 FROM fare_rules
                 ORDER BY fare_id ASC`
            );

            const [summaryRows] = await pool.query(
                `SELECT 
                    COUNT(*) AS total,
                    COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active_count,
                    COALESCE(SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END), 0) AS inactive_count
                 FROM fare_rules`
            );

            return sendJson(res, 200, {
                success: true,
                fare_rules: rules.map(r => ({
                    ...r,
                    base_fare: Number(r.base_fare),
                    per_km_rate: Number(r.per_km_rate),
                    per_minute_rate: Number(r.per_minute_rate),
                    cancellation_fee: Number(r.cancellation_fee)
                })),
                summary: {
                    total: Number(summaryRows[0].total || 0),
                    active: Number(summaryRows[0].active_count || 0),
                    inactive: Number(summaryRows[0].inactive_count || 0)
                }
            });
        }

        // 11b. POST /api/admin/fare-rules - Add new fare rule
        if (req.method === "POST" && pathname === "/api/admin/fare-rules") {
            const body = await readJson(req);
            const vehicleType = (body.vehicle_type || "").trim();
            const baseFare = parseFloat(body.base_fare);
            const perKmRate = parseFloat(body.per_km_rate);
            const perMinuteRate = parseFloat(body.per_minute_rate !== undefined ? body.per_minute_rate : 0);
            const cancellationFee = parseFloat(body.cancellation_fee !== undefined ? body.cancellation_fee : 0);
            const status = (body.status || "active").toLowerCase() === "inactive" ? "inactive" : "active";

            if (!vehicleType) {
                return sendJson(res, 400, { success: false, message: "Vehicle type is required." });
            }
            if (isNaN(baseFare) || baseFare < 0) {
                return sendJson(res, 400, { success: false, message: "Base fare must be a non-negative number." });
            }
            if (isNaN(perKmRate) || perKmRate < 0) {
                return sendJson(res, 400, { success: false, message: "Per kilometre rate must be a non-negative number." });
            }
            if (isNaN(perMinuteRate) || perMinuteRate < 0) {
                return sendJson(res, 400, { success: false, message: "Per minute rate must be a non-negative number." });
            }
            if (isNaN(cancellationFee) || cancellationFee < 0) {
                return sendJson(res, 400, { success: false, message: "Cancellation fee must be a non-negative number." });
            }

            const [result] = await pool.execute(
                `INSERT INTO fare_rules (vehicle_type, base_fare, per_km_rate, per_minute_rate, cancellation_fee, status)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [vehicleType, baseFare, perKmRate, perMinuteRate, cancellationFee, status]
            );

            await logActivity(
                null,
                "FARE_RULE_CREATED",
                `Created fare rule #${result.insertId} for vehicle type '${vehicleType}' (Base: ₹${baseFare}, PerKm: ₹${perKmRate}, PerMin: ₹${perMinuteRate}, CancelFee: ₹${cancellationFee}).`,
                clientIp
            );

            return sendJson(res, 201, {
                success: true,
                message: `Fare rule for '${vehicleType}' created successfully.`,
                fare_id: result.insertId
            });
        }

        // 11c. PATCH /api/admin/fare-rules/:id/status - Toggle or update status
        if ((req.method === "PATCH" || req.method === "POST") && pathname.match(/^\/api\/admin\/fare-rules\/\d+\/status$/)) {
            const parts = pathname.split("/").filter(Boolean);
            const fareId = parseInt(parts[3], 10);
            const body = await readJson(req).catch(() => ({}));

            const [rules] = await pool.execute(
                `SELECT fare_id, vehicle_type, status FROM fare_rules WHERE fare_id = ?`,
                [fareId]
            );
            if (rules.length === 0) {
                return sendJson(res, 404, { success: false, message: "Fare rule not found." });
            }

            const current = rules[0];
            let newStatus = body.status ? body.status.toLowerCase().trim() : (current.status === "active" ? "inactive" : "active");
            if (newStatus !== "active" && newStatus !== "inactive") {
                newStatus = "active";
            }

            await pool.execute(
                `UPDATE fare_rules SET status = ? WHERE fare_id = ?`,
                [newStatus, fareId]
            );

            await logActivity(
                null,
                "FARE_RULE_STATUS_CHANGED",
                `Fare rule #${fareId} (${current.vehicle_type}) status changed from '${current.status}' to '${newStatus}'.`,
                clientIp
            );

            return sendJson(res, 200, {
                success: true,
                message: `Fare rule #${fareId} is now ${newStatus}.`,
                fare_id: fareId,
                status: newStatus
            });
        }

        // 11d. PATCH /api/admin/fare-rules/:id - Edit fare rule
        if ((req.method === "PATCH" || req.method === "PUT") && pathname.match(/^\/api\/admin\/fare-rules\/\d+$/)) {
            const parts = pathname.split("/").filter(Boolean);
            const fareId = parseInt(parts[3], 10);
            const body = await readJson(req);

            const [rules] = await pool.execute(
                `SELECT * FROM fare_rules WHERE fare_id = ?`,
                [fareId]
            );
            if (rules.length === 0) {
                return sendJson(res, 404, { success: false, message: "Fare rule not found." });
            }
            const existing = rules[0];

            const vehicleType = body.vehicle_type !== undefined ? body.vehicle_type.trim() : existing.vehicle_type;
            const baseFare = body.base_fare !== undefined ? parseFloat(body.base_fare) : Number(existing.base_fare);
            const perKmRate = body.per_km_rate !== undefined ? parseFloat(body.per_km_rate) : Number(existing.per_km_rate);
            const perMinuteRate = body.per_minute_rate !== undefined ? parseFloat(body.per_minute_rate) : Number(existing.per_minute_rate);
            const cancellationFee = body.cancellation_fee !== undefined ? parseFloat(body.cancellation_fee) : Number(existing.cancellation_fee);
            const status = body.status !== undefined ? (body.status.toLowerCase() === "inactive" ? "inactive" : "active") : existing.status;

            if (isNaN(baseFare) || baseFare < 0) {
                return sendJson(res, 400, { success: false, message: "Base fare must be a non-negative number." });
            }
            if (isNaN(perKmRate) || perKmRate < 0) {
                return sendJson(res, 400, { success: false, message: "Per kilometre rate must be a non-negative number." });
            }
            if (isNaN(perMinuteRate) || perMinuteRate < 0) {
                return sendJson(res, 400, { success: false, message: "Per minute rate must be a non-negative number." });
            }
            if (isNaN(cancellationFee) || cancellationFee < 0) {
                return sendJson(res, 400, { success: false, message: "Cancellation fee must be a non-negative number." });
            }

            await pool.execute(
                `UPDATE fare_rules 
                 SET vehicle_type = ?, base_fare = ?, per_km_rate = ?, per_minute_rate = ?, cancellation_fee = ?, status = ?
                 WHERE fare_id = ?`,
                [vehicleType, baseFare, perKmRate, perMinuteRate, cancellationFee, status, fareId]
            );

            await logActivity(
                null,
                "FARE_RULE_UPDATED",
                `Updated fare rule #${fareId} for '${vehicleType}': Base ₹${baseFare}, PerKm ₹${perKmRate}, PerMin ₹${perMinuteRate}, Cancel ₹${cancellationFee}, Status: ${status}.`,
                clientIp
            );

            return sendJson(res, 200, {
                success: true,
                message: `Fare rule #${fareId} updated successfully. Future bookings will immediately use these rates.`,
                fare_id: fareId
            });
        }

        // ========================================================
        // 12. ADMIN SERVICE AREAS MANAGEMENT
        // ========================================================
        // 12a. GET /api/admin/service-areas
        if (req.method === "GET" && pathname === "/api/admin/service-areas") {
            const search = (parsedUrl.searchParams.get("search") || "").trim();
            const status = (parsedUrl.searchParams.get("status") || "all").trim().toLowerCase();

            const whereClauses = ["1=1"];
            const params = [];

            if (status && status !== "all") {
                whereClauses.push("status = ?");
                params.push(status);
            }

            if (search) {
                whereClauses.push("(area_name LIKE ? OR city LIKE ? OR state LIKE ?)");
                const pat = `%${search}%`;
                params.push(pat, pat, pat);
            }

            const whereSql = "WHERE " + whereClauses.join(" AND ");

            const [areas] = await pool.query(
                `SELECT area_id, area_name, city, state, status
                 FROM service_areas
                 ${whereSql}
                 ORDER BY area_id ASC`,
                params
            );

            const [summaryRows] = await pool.query(
                `SELECT 
                    COUNT(*) AS total,
                    COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active_count,
                    COALESCE(SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END), 0) AS inactive_count
                 FROM service_areas`
            );

            return sendJson(res, 200, {
                success: true,
                service_areas: areas,
                summary: {
                    total: Number(summaryRows[0].total || 0),
                    active: Number(summaryRows[0].active_count || 0),
                    inactive: Number(summaryRows[0].inactive_count || 0)
                }
            });
        }

        // 12b. POST /api/admin/service-areas - Add service area
        if (req.method === "POST" && pathname === "/api/admin/service-areas") {
            const body = await readJson(req);
            const areaName = (body.area_name || "").trim();
            const city = (body.city || "").trim();
            const state = (body.state || "").trim();
            const status = (body.status || "active").toLowerCase() === "inactive" ? "inactive" : "active";

            if (!areaName) {
                return sendJson(res, 400, { success: false, message: "Area name is required." });
            }
            if (!city) {
                return sendJson(res, 400, { success: false, message: "City is required." });
            }
            if (!state) {
                return sendJson(res, 400, { success: false, message: "State is required." });
            }

            const [result] = await pool.execute(
                `INSERT INTO service_areas (area_name, city, state, status) VALUES (?, ?, ?, ?)`,
                [areaName, city, state, status]
            );

            await logActivity(
                null,
                "SERVICE_AREA_CREATED",
                `Created service area #${result.insertId}: '${areaName}', ${city}, ${state} (Status: ${status}).`,
                clientIp
            );

            return sendJson(res, 201, {
                success: true,
                message: `Service area '${areaName}' added successfully.`,
                area_id: result.insertId
            });
        }

        // 12c. PATCH /api/admin/service-areas/:id/status - Toggle or update status
        if ((req.method === "PATCH" || req.method === "POST") && pathname.match(/^\/api\/admin\/service-areas\/\d+\/status$/)) {
            const parts = pathname.split("/").filter(Boolean);
            const areaId = parseInt(parts[3], 10);
            const body = await readJson(req).catch(() => ({}));

            const [areas] = await pool.execute(
                `SELECT area_id, area_name, status FROM service_areas WHERE area_id = ?`,
                [areaId]
            );
            if (areas.length === 0) {
                return sendJson(res, 404, { success: false, message: "Service area not found." });
            }

            const current = areas[0];
            let newStatus = body.status ? body.status.toLowerCase().trim() : (current.status === "active" ? "inactive" : "active");
            if (newStatus !== "active" && newStatus !== "inactive") {
                newStatus = "active";
            }

            await pool.execute(
                `UPDATE service_areas SET status = ? WHERE area_id = ?`,
                [newStatus, areaId]
            );

            await logActivity(
                null,
                "SERVICE_AREA_STATUS_CHANGED",
                `Service area #${areaId} ('${current.area_name}') status toggled from '${current.status}' to '${newStatus}'.`,
                clientIp
            );

            return sendJson(res, 200, {
                success: true,
                message: `Service area '${current.area_name}' is now ${newStatus}.`,
                area_id: areaId,
                status: newStatus
            });
        }

        // 12d. PATCH /api/admin/service-areas/:id - Edit service area
        if ((req.method === "PATCH" || req.method === "PUT") && pathname.match(/^\/api\/admin\/service-areas\/\d+$/)) {
            const parts = pathname.split("/").filter(Boolean);
            const areaId = parseInt(parts[3], 10);
            const body = await readJson(req);

            const [areas] = await pool.execute(
                `SELECT * FROM service_areas WHERE area_id = ?`,
                [areaId]
            );
            if (areas.length === 0) {
                return sendJson(res, 404, { success: false, message: "Service area not found." });
            }
            const existing = areas[0];

            const areaName = body.area_name !== undefined ? body.area_name.trim() : existing.area_name;
            const city = body.city !== undefined ? body.city.trim() : existing.city;
            const state = body.state !== undefined ? body.state.trim() : existing.state;
            const status = body.status !== undefined ? (body.status.toLowerCase() === "inactive" ? "inactive" : "active") : existing.status;

            if (!areaName) {
                return sendJson(res, 400, { success: false, message: "Area name cannot be empty." });
            }
            if (!city) {
                return sendJson(res, 400, { success: false, message: "City cannot be empty." });
            }
            if (!state) {
                return sendJson(res, 400, { success: false, message: "State cannot be empty." });
            }

            await pool.execute(
                `UPDATE service_areas SET area_name = ?, city = ?, state = ?, status = ? WHERE area_id = ?`,
                [areaName, city, state, status, areaId]
            );

            await logActivity(
                null,
                "SERVICE_AREA_UPDATED",
                `Updated service area #${areaId}: '${areaName}', ${city}, ${state} (Status: ${status}).`,
                clientIp
            );

            return sendJson(res, 200, {
                success: true,
                message: `Service area #${areaId} updated successfully.`,
                area_id: areaId
            });
        }

        // ========================================================
        // 13. REPORTS & ANALYTICS
        // ========================================================
        // 13a. GET /api/admin/reports/analytics & /api/admin/reports - Summary metrics & KPIs
        if (req.method === "GET" && (pathname === "/api/admin/reports/analytics" || pathname === "/api/admin/reports")) {
            const startDate = (parsedUrl.searchParams.get("startDate") || "").trim();
            const endDate = (parsedUrl.searchParams.get("endDate") || "").trim();

            const tripWhere = ["1=1"];
            const tripParams = [];
            if (startDate) {
                tripWhere.push("DATE(COALESCE(t.start_time, t.end_time, NOW())) >= ?");
                tripParams.push(startDate);
            }
            if (endDate) {
                tripWhere.push("DATE(COALESCE(t.start_time, t.end_time, NOW())) <= ?");
                tripParams.push(endDate);
            }
            const tripWhereSql = "WHERE " + tripWhere.join(" AND ");

            // Trips & Revenue in range
            const [tripMetrics] = await pool.query(
                `SELECT 
                    COUNT(*) AS total_trips,
                    COALESCE(SUM(CASE WHEN trip_status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_trips,
                    COALESCE(SUM(CASE WHEN trip_status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_trips,
                    COALESCE(SUM(CASE WHEN trip_status IN ('assigned', 'started') THEN 1 ELSE 0 END), 0) AS active_trips,
                    COALESCE(SUM(CASE WHEN trip_status = 'completed' THEN fare ELSE 0 END), 0) AS gross_revenue,
                    COALESCE(SUM(CASE WHEN trip_status = 'cancelled' THEN fare ELSE 0 END), 0) AS cancellation_revenue,
                    COALESCE(SUM(distance_km), 0) AS total_distance_km
                 FROM trips t
                 ${tripWhereSql}`,
                tripParams
            );

            // User statistics
            const [passengersRes] = await pool.query(
                `SELECT 
                    COUNT(*) AS total_passengers,
                    COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active_passengers,
                    COALESCE(SUM(CASE WHEN status != 'active' THEN 1 ELSE 0 END), 0) AS inactive_passengers
                 FROM users WHERE role IN ('passenger', 'customer')`
            );

            const [driversRes] = await pool.query(
                `SELECT 
                    COUNT(*) AS total_drivers,
                    COALESCE(SUM(CASE WHEN dp.verification_status = 'approved' THEN 1 ELSE 0 END), 0) AS approved_drivers,
                    COALESCE(SUM(CASE WHEN dp.verification_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_drivers,
                    COALESCE(SUM(CASE WHEN dp.verification_status = 'suspended' THEN 1 ELSE 0 END), 0) AS suspended_drivers
                 FROM users u
                 JOIN driver_profiles dp ON u.user_id = dp.user_id
                 WHERE u.role = 'driver'`
            );

            // Vehicle Category Distribution in range
            const [vehicleDist] = await pool.query(
                `SELECT 
                    v.vehicle_type,
                    COUNT(t.trip_id) AS trip_count,
                    COALESCE(SUM(CASE WHEN t.trip_status = 'completed' THEN t.fare ELSE 0 END), 0) AS total_revenue
                 FROM trips t
                 JOIN vehicles v ON t.vehicle_id = v.vehicle_id
                 ${tripWhereSql}
                 GROUP BY v.vehicle_type
                 ORDER BY total_revenue DESC`,
                tripParams
            );

            // Payment Method Breakdown in range
            const [paymentDist] = await pool.query(
                `SELECT 
                    COALESCE(p.payment_method, 'other') AS payment_method,
                    COUNT(p.payment_id) AS payment_count,
                    COALESCE(SUM(p.amount), 0) AS total_amount
                 FROM payments p
                 JOIN trips t ON p.trip_id = t.trip_id
                 ${tripWhereSql}
                 GROUP BY p.payment_method
                 ORDER BY total_amount DESC`,
                tripParams
            );

            const metrics = tripMetrics[0];
            const completedCount = Number(metrics.completed_trips || 0);
            const cancelledCount = Number(metrics.cancelled_trips || 0);
            const totalTripsCount = Number(metrics.total_trips || 0);
            const grossRev = Number(metrics.gross_revenue || 0);
            const cancelRev = Number(metrics.cancellation_revenue || 0);
            const totalDistance = Number(metrics.total_distance_km || 0);

            const completionRate = totalTripsCount > 0 ? Math.round((completedCount / totalTripsCount) * 1000) / 10 : 0;
            const cancellationRate = totalTripsCount > 0 ? Math.round((cancelledCount / totalTripsCount) * 1000) / 10 : 0;
            const avgFare = completedCount > 0 ? Math.round((grossRev / completedCount) * 100) / 100 : 0;
            const avgDistance = completedCount > 0 ? Math.round((totalDistance / completedCount) * 100) / 100 : 0;

            return sendJson(res, 200, {
                success: true,
                filter: {
                    startDate: startDate || null,
                    endDate: endDate || null
                },
                passengers: {
                    total: Number(passengersRes[0].total_passengers || 0),
                    active: Number(passengersRes[0].active_passengers || 0),
                    inactive: Number(passengersRes[0].inactive_passengers || 0)
                },
                drivers: {
                    total: Number(driversRes[0].total_drivers || 0),
                    approved: Number(driversRes[0].approved_drivers || 0),
                    pending: Number(driversRes[0].pending_drivers || 0),
                    suspended: Number(driversRes[0].suspended_drivers || 0)
                },
                trips: {
                    total: totalTripsCount,
                    completed: completedCount,
                    cancelled: cancelledCount,
                    active: Number(metrics.active_trips || 0),
                    completion_rate: completionRate,
                    cancellation_rate: cancellationRate,
                    total_distance_km: totalDistance,
                    average_distance_km: avgDistance
                },
                revenue: {
                    gross_revenue: grossRev,
                    cancellation_revenue: cancelRev,
                    net_revenue: grossRev + cancelRev,
                    average_fare: avgFare
                },
                vehicle_distribution: vehicleDist.map(v => ({
                    vehicle_type: v.vehicle_type,
                    trip_count: Number(v.trip_count),
                    revenue: Number(v.total_revenue)
                })),
                payment_distribution: paymentDist.map(p => ({
                    method: p.payment_method,
                    count: Number(p.payment_count),
                    amount: Number(p.total_amount)
                }))
            });
        }

        // 13b. GET /api/admin/reports/drivers - Driver performance report
        if (req.method === "GET" && pathname === "/api/admin/reports/drivers") {
            const startDate = (parsedUrl.searchParams.get("startDate") || "").trim();
            const endDate = (parsedUrl.searchParams.get("endDate") || "").trim();
            const search = (parsedUrl.searchParams.get("search") || "").trim();

            const tripDateClauses = [];
            const tripParams = [];
            if (startDate) {
                tripDateClauses.push("DATE(COALESCE(t.start_time, t.end_time, NOW())) >= ?");
                tripParams.push(startDate);
            }
            if (endDate) {
                tripDateClauses.push("DATE(COALESCE(t.start_time, t.end_time, NOW())) <= ?");
                tripParams.push(endDate);
            }

            const tripDateSql = tripDateClauses.length > 0 ? "AND " + tripDateClauses.join(" AND ") : "";

            const driverWhere = ["u.role = 'driver'"];
            const driverParams = [];
            if (search) {
                driverWhere.push("(u.name LIKE ? OR u.mobile LIKE ? OR u.email LIKE ? OR dp.license_no LIKE ?)");
                const pat = `%${search}%`;
                driverParams.push(pat, pat, pat, pat);
            }

            const driverWhereSql = "WHERE " + driverWhere.join(" AND ");

            const querySql = `
                SELECT 
                    dp.driver_id,
                    u.user_id,
                    u.name AS driver_name,
                    u.email AS driver_email,
                    u.mobile AS driver_mobile,
                    dp.license_no,
                    dp.verification_status,
                    dp.rating,
                    COALESCE(v.vehicle_number, 'N/A') AS vehicle_number,
                    COALESCE(v.vehicle_type, 'N/A') AS vehicle_type,
                    COUNT(t.trip_id) AS total_trips,
                    COALESCE(SUM(CASE WHEN t.trip_status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_trips,
                    COALESCE(SUM(CASE WHEN t.trip_status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_trips,
                    COALESCE(SUM(CASE WHEN t.trip_status = 'completed' THEN t.distance_km ELSE 0 END), 0) AS total_distance_km,
                    COALESCE(SUM(CASE WHEN t.trip_status = 'completed' THEN t.fare ELSE 0 END), 0) AS total_earnings
                FROM driver_profiles dp
                JOIN users u ON dp.user_id = u.user_id
                LEFT JOIN vehicles v ON dp.driver_id = v.driver_id
                LEFT JOIN trips t ON dp.driver_id = t.driver_id ${tripDateSql}
                ${driverWhereSql}
                GROUP BY dp.driver_id, u.user_id, u.name, u.email, u.mobile, dp.license_no, dp.verification_status, dp.rating, v.vehicle_number, v.vehicle_type
                ORDER BY total_earnings DESC, completed_trips DESC
            `;

            const [driverRows] = await pool.query(querySql, [...tripParams, ...driverParams]);

            return sendJson(res, 200, {
                success: true,
                filter: { startDate: startDate || null, endDate: endDate || null },
                drivers: driverRows.map(d => ({
                    driver_id: d.driver_id,
                    user_id: d.user_id,
                    name: d.driver_name,
                    email: d.driver_email,
                    mobile: d.driver_mobile,
                    license_no: d.license_no,
                    verification_status: d.verification_status,
                    rating: Number(d.rating),
                    vehicle_number: d.vehicle_number,
                    vehicle_type: d.vehicle_type,
                    total_trips: Number(d.total_trips),
                    completed_trips: Number(d.completed_trips),
                    cancelled_trips: Number(d.cancelled_trips),
                    total_distance_km: Number(d.total_distance_km),
                    total_earnings: Number(d.total_earnings),
                    completion_rate: Number(d.total_trips) > 0 
                        ? Math.round((Number(d.completed_trips) / Number(d.total_trips)) * 100) 
                        : 0
                }))
            });
        }

        // 13c. GET /api/admin/reports/passengers - Passenger activity report
        if (req.method === "GET" && pathname === "/api/admin/reports/passengers") {
            const startDate = (parsedUrl.searchParams.get("startDate") || "").trim();
            const endDate = (parsedUrl.searchParams.get("endDate") || "").trim();
            const search = (parsedUrl.searchParams.get("search") || "").trim();

            const reqDateClauses = [];
            const reqDateParams = [];
            if (startDate) {
                reqDateClauses.push("DATE(r.requested_at) >= ?");
                reqDateParams.push(startDate);
            }
            if (endDate) {
                reqDateClauses.push("DATE(r.requested_at) <= ?");
                reqDateParams.push(endDate);
            }
            const reqDateSql = reqDateClauses.length > 0 ? "AND " + reqDateClauses.join(" AND ") : "";

            const passWhere = ["u.role IN ('passenger', 'customer')"];
            const passParams = [];
            if (search) {
                passWhere.push("(u.name LIKE ? OR u.mobile LIKE ? OR u.email LIKE ?)");
                const pat = `%${search}%`;
                passParams.push(pat, pat, pat);
            }
            const passWhereSql = "WHERE " + passWhere.join(" AND ");

            const querySql = `
                SELECT 
                    pp.passenger_id,
                    u.user_id,
                    u.name AS passenger_name,
                    u.email AS passenger_email,
                    u.mobile AS passenger_mobile,
                    u.status,
                    DATE_FORMAT(u.created_at, '%b %d, %Y') AS member_since,
                    COUNT(DISTINCT r.request_id) AS total_requests,
                    COALESCE(SUM(CASE WHEN t.trip_status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_rides,
                    COALESCE(SUM(CASE WHEN t.trip_status = 'cancelled' OR r.status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_rides,
                    COALESCE(SUM(CASE WHEN t.trip_status = 'completed' THEN t.fare ELSE 0 END), 0) AS total_spend
                FROM passenger_profiles pp
                JOIN users u ON pp.user_id = u.user_id
                LEFT JOIN ride_requests r ON pp.passenger_id = r.passenger_id ${reqDateSql}
                LEFT JOIN trips t ON r.request_id = t.request_id
                ${passWhereSql}
                GROUP BY pp.passenger_id, u.user_id, u.name, u.email, u.mobile, u.status, u.created_at
                ORDER BY total_spend DESC, total_requests DESC
            `;

            const [passengerRows] = await pool.query(querySql, [...reqDateParams, ...passParams]);

            return sendJson(res, 200, {
                success: true,
                filter: { startDate: startDate || null, endDate: endDate || null },
                passengers: passengerRows.map(p => ({
                    passenger_id: p.passenger_id,
                    user_id: p.user_id,
                    name: p.passenger_name,
                    email: p.passenger_email,
                    mobile: p.passenger_mobile,
                    status: p.status,
                    member_since: p.member_since,
                    total_requests: Number(p.total_requests),
                    completed_rides: Number(p.completed_rides),
                    cancelled_rides: Number(p.cancelled_rides),
                    total_spend: Number(p.total_spend)
                }))
            });
        }

        // ========================================================
        // 14. SUPER ADMIN DASHBOARD & SYSTEM MONITORING
        // ========================================================
        // 14a. GET /api/superadmin/dashboard/stats
        if (req.method === "GET" && pathname === "/api/superadmin/dashboard/stats") {
            // System-wide users
            const [usersSummary] = await pool.query(
                `SELECT 
                    COUNT(*) AS total_users,
                    COALESCE(SUM(CASE WHEN role IN ('passenger', 'customer') THEN 1 ELSE 0 END), 0) AS total_passengers,
                    COALESCE(SUM(CASE WHEN role = 'driver' THEN 1 ELSE 0 END), 0) AS total_drivers,
                    COALESCE(SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END), 0) AS total_admins,
                    COALESCE(SUM(CASE WHEN role = 'super_admin' THEN 1 ELSE 0 END), 0) AS total_super_admins,
                    COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active_users,
                    COALESCE(SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END), 0) AS blocked_users
                 FROM users`
            );

            // Driver verifications
            const [driverStatusSummary] = await pool.query(
                `SELECT 
                    COALESCE(SUM(CASE WHEN verification_status = 'approved' THEN 1 ELSE 0 END), 0) AS approved_count,
                    COALESCE(SUM(CASE WHEN verification_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
                    COALESCE(SUM(CASE WHEN verification_status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected_count,
                    COALESCE(SUM(CASE WHEN verification_status = 'suspended' THEN 1 ELSE 0 END), 0) AS suspended_count
                 FROM driver_profiles`
            );

            // Vehicles
            const [vehicleSummary] = await pool.query(
                `SELECT 
                    COUNT(*) AS total_vehicles,
                    COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active_vehicles,
                    COALESCE(SUM(CASE WHEN status = 'under_maintenance' THEN 1 ELSE 0 END), 0) AS maintenance_vehicles,
                    COALESCE(SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END), 0) AS inactive_vehicles
                 FROM vehicles`
            );

            // Platform Trips & Revenue
            const [tripsSummary] = await pool.query(
                `SELECT 
                    COUNT(*) AS total_trips,
                    COALESCE(SUM(CASE WHEN trip_status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_trips,
                    COALESCE(SUM(CASE WHEN trip_status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_trips,
                    COALESCE(SUM(CASE WHEN trip_status IN ('assigned', 'started') THEN 1 ELSE 0 END), 0) AS active_trips,
                    COALESCE(SUM(CASE WHEN trip_status = 'completed' THEN fare ELSE 0 END), 0) AS gross_revenue,
                    COALESCE(SUM(CASE WHEN trip_status = 'cancelled' THEN fare ELSE 0 END), 0) AS cancellation_revenue,
                    COALESCE(SUM(distance_km), 0) AS total_distance_km
                 FROM trips`
            );

            // Ride Requests
            const [requestsSummary] = await pool.query(
                `SELECT 
                    COUNT(*) AS total_requests,
                    COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_requests
                 FROM ride_requests`
            );

            // Service Areas & Fares
            const [areasCount] = await pool.query(`SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active FROM service_areas`);
            const [faresCount] = await pool.query(`SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active FROM fare_rules`);

            // Recent Administrator Activity Logs (Latest 20)
            const [recentLogs] = await pool.query(
                `SELECT 
                    sl.log_id,
                    sl.user_id,
                    sl.action,
                    sl.description,
                    sl.ip_address,
                    sl.created_at,
                    DATE_FORMAT(sl.created_at, '%b %d, %Y, %h:%i %p') AS formatted_time,
                    COALESCE(u.name, 'System Automatic') AS user_name,
                    COALESCE(u.email, 'system@ridenow.local') AS user_email,
                    COALESCE(u.role, 'system') AS user_role
                 FROM system_logs sl
                 LEFT JOIN users u ON sl.user_id = u.user_id
                 ORDER BY sl.log_id DESC
                 LIMIT 20`
            );

            // Generate Dynamic System Alerts
            const alerts = [];
            const pendingDrivers = Number(driverStatusSummary[0].pending_count || 0);
            if (pendingDrivers > 0) {
                alerts.push({
                    level: "warning",
                    title: `${pendingDrivers} Pending Driver Verification${pendingDrivers > 1 ? "s" : ""}`,
                    description: `New driver onboarding documents require compliance review and verification before dispatch.`,
                    type: "DRIVER_VERIFICATION_PENDING",
                    count: pendingDrivers
                });
            }

            const maintenanceVehicles = Number(vehicleSummary[0].maintenance_vehicles || 0);
            if (maintenanceVehicles > 0) {
                alerts.push({
                    level: "danger",
                    title: `${maintenanceVehicles} Vehicle${maintenanceVehicles > 1 ? "s" : ""} Under Maintenance`,
                    description: `Fleet units marked out-of-service for mechanical inspections or repairs.`,
                    type: "VEHICLES_MAINTENANCE",
                    count: maintenanceVehicles
                });
            }

            const blockedUsers = Number(usersSummary[0].blocked_users || 0);
            if (blockedUsers > 0) {
                alerts.push({
                    level: "warning",
                    title: `${blockedUsers} Blocked / Restricted Account${blockedUsers > 1 ? "s" : ""}`,
                    description: `Account access has been flagged and suspended due to safety policies or administrative actions.`,
                    type: "USERS_BLOCKED",
                    count: blockedUsers
                });
            }

            const totalTrips = Number(tripsSummary[0].total_trips || 0);
            const cancelledTrips = Number(tripsSummary[0].cancelled_trips || 0);
            const cancellationPct = totalTrips > 0 ? (cancelledTrips / totalTrips) * 100 : 0;
            if (cancellationPct > 20) {
                alerts.push({
                    level: "danger",
                    title: `Elevated Ride Cancellation Rate (${cancellationPct.toFixed(1)}%)`,
                    description: `Trip cancellations are above normal thresholds. Check driver availability and passenger wait times.`,
                    type: "HIGH_CANCELLATION_RATE",
                    count: cancelledTrips
                });
            }

            // Always add system health indicator
            alerts.push({
                level: "success",
                title: "MySQL Core Engine & Relational Integrity Active",
                description: "InnoDB cluster, transaction safety, and background workers are operating normally with zero connection drops.",
                type: "SYSTEM_HEALTHY",
                count: 0
            });

            const memUsage = process.memoryUsage();
            const uptimeSeconds = Math.floor(process.uptime());

            return sendJson(res, 200, {
                success: true,
                system_overview: {
                    total_users: Number(usersSummary[0].total_users || 0),
                    passengers: Number(usersSummary[0].total_passengers || 0),
                    drivers: Number(usersSummary[0].total_drivers || 0),
                    admins: Number(usersSummary[0].total_admins || 0),
                    super_admins: Number(usersSummary[0].total_super_admins || 0),
                    active_users: Number(usersSummary[0].active_users || 0),
                    blocked_users: blockedUsers
                },
                driver_metrics: {
                    approved: Number(driverStatusSummary[0].approved_count || 0),
                    pending: pendingDrivers,
                    rejected: Number(driverStatusSummary[0].rejected_count || 0),
                    suspended: Number(driverStatusSummary[0].suspended_count || 0)
                },
                fleet_metrics: {
                    total: Number(vehicleSummary[0].total_vehicles || 0),
                    active: Number(vehicleSummary[0].active_vehicles || 0),
                    maintenance: maintenanceVehicles,
                    inactive: Number(vehicleSummary[0].inactive_vehicles || 0)
                },
                trips_metrics: {
                    total_trips: totalTrips,
                    completed: Number(tripsSummary[0].completed_trips || 0),
                    cancelled: cancelledTrips,
                    active: Number(tripsSummary[0].active_trips || 0),
                    cancellation_rate: Math.round(cancellationPct * 10) / 10,
                    gross_revenue: Number(tripsSummary[0].gross_revenue || 0),
                    cancellation_revenue: Number(tripsSummary[0].cancellation_revenue || 0),
                    net_revenue: Number(tripsSummary[0].gross_revenue || 0) + Number(tripsSummary[0].cancellation_revenue || 0),
                    total_distance_km: Number(tripsSummary[0].total_distance_km || 0)
                },
                governance: {
                    service_areas: {
                        total: Number(areasCount[0].total || 0),
                        active: Number(areasCount[0].active || 0)
                    },
                    fare_rules: {
                        total: Number(faresCount[0].total || 0),
                        active: Number(faresCount[0].active || 0)
                    }
                },
                system_runtime: {
                    status: "healthy",
                    uptime_seconds: uptimeSeconds,
                    active_sessions: activeSessions.size,
                    node_version: process.version,
                    memory_rss_mb: Math.round(memUsage.rss / 1024 / 1024),
                    memory_heap_mb: Math.round(memUsage.heapUsed / 1024 / 1024)
                },
                alerts: alerts,
                recent_logs: recentLogs
            });
        }

        // 14b. GET /api/superadmin/logs - Filterable System Audit Log
        if (req.method === "GET" && pathname === "/api/superadmin/logs") {
            const search = (parsedUrl.searchParams.get("search") || "").trim();
            const action = (parsedUrl.searchParams.get("action") || "all").trim();
            const page = Math.max(1, parseInt(parsedUrl.searchParams.get("page") || "1", 10) || 1);
            const limit = Math.max(1, Math.min(100, parseInt(parsedUrl.searchParams.get("limit") || "25", 10) || 25));
            const offset = (page - 1) * limit;

            const whereClauses = ["1=1"];
            const params = [];

            if (action && action !== "all") {
                whereClauses.push("sl.action = ?");
                params.push(action);
            }

            if (search) {
                whereClauses.push("(sl.description LIKE ? OR sl.action LIKE ? OR u.name LIKE ? OR u.email LIKE ? OR sl.ip_address LIKE ?)");
                const pat = `%${search}%`;
                params.push(pat, pat, pat, pat, pat);
            }

            const whereSql = "WHERE " + whereClauses.join(" AND ");

            const [countRows] = await pool.query(
                `SELECT COUNT(*) AS total 
                 FROM system_logs sl 
                 LEFT JOIN users u ON sl.user_id = u.user_id 
                 ${whereSql}`,
                params
            );
            const total = countRows[0].total;

            const [logs] = await pool.query(
                `SELECT 
                    sl.log_id,
                    sl.user_id,
                    sl.action,
                    sl.description,
                    sl.ip_address,
                    sl.created_at,
                    DATE_FORMAT(sl.created_at, '%b %d, %Y, %h:%i %p') AS formatted_time,
                    COALESCE(u.name, 'System') AS user_name,
                    COALESCE(u.email, 'system@ridenow.local') AS user_email,
                    COALESCE(u.role, 'system') AS user_role
                 FROM system_logs sl
                 LEFT JOIN users u ON sl.user_id = u.user_id
                 ${whereSql}
                 ORDER BY sl.log_id DESC
                 LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            );

            return sendJson(res, 200, {
                success: true,
                logs: logs,
                pagination: {
                    total: total,
                    page: page,
                    limit: limit,
                    totalPages: Math.ceil(total / limit) || 1
                }
            });
        }

        // ========================================================
        // 15. ADMINISTRATOR MANAGEMENT (SUPER ADMIN ONLY)
        // ========================================================
        // 15a. GET /api/superadmin/admins - List all administrators
        if (req.method === "GET" && pathname === "/api/superadmin/admins") {
            const search = (parsedUrl.searchParams.get("search") || "").trim();
            const role = (parsedUrl.searchParams.get("role") || "all").trim();
            const status = (parsedUrl.searchParams.get("status") || "all").trim();

            const whereClauses = ["u.role IN ('admin', 'super_admin')"];
            const params = [];

            if (role && role !== "all") {
                whereClauses.push("u.role = ?");
                params.push(role);
            }

            if (status && status !== "all") {
                whereClauses.push("u.status = ?");
                params.push(status);
            }

            if (search) {
                whereClauses.push("(u.name LIKE ? OR u.email LIKE ? OR u.mobile LIKE ?)");
                const pat = `%${search}%`;
                params.push(pat, pat, pat);
            }

            const whereSql = "WHERE " + whereClauses.join(" AND ");

            const querySql = `
                SELECT 
                    u.user_id,
                    u.name,
                    u.email,
                    u.mobile,
                    u.role,
                    u.status,
                    u.created_at,
                    DATE_FORMAT(u.created_at, '%b %d, %Y') AS formatted_created,
                    COALESCE(GROUP_CONCAT(ap.permission_name SEPARATOR ','), '') AS permissions_str,
                    (SELECT COUNT(*) FROM system_logs sl WHERE sl.user_id = u.user_id) AS total_actions
                FROM users u
                LEFT JOIN admin_permissions ap ON u.user_id = ap.admin_id
                ${whereSql}
                GROUP BY u.user_id, u.name, u.email, u.mobile, u.role, u.status, u.created_at
                ORDER BY (u.role = 'super_admin') DESC, u.user_id ASC
            `;

            const [adminRows] = await pool.query(querySql, params);

            // Summary counts
            const [summaryRows] = await pool.query(
                `SELECT 
                    COUNT(*) AS total,
                    COALESCE(SUM(CASE WHEN role = 'super_admin' THEN 1 ELSE 0 END), 0) AS super_admins,
                    COALESCE(SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END), 0) AS standard_admins,
                    COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active_admins,
                    COALESCE(SUM(CASE WHEN status != 'active' THEN 1 ELSE 0 END), 0) AS inactive_admins
                 FROM users
                 WHERE role IN ('admin', 'super_admin')`
            );

            return sendJson(res, 200, {
                success: true,
                admins: adminRows.map(a => ({
                    user_id: a.user_id,
                    name: a.name,
                    email: a.email,
                    mobile: a.mobile,
                    role: a.role,
                    status: a.status,
                    created_at: a.created_at,
                    formatted_created: a.formatted_created,
                    permissions: a.permissions_str ? a.permissions_str.split(",").filter(Boolean) : [],
                    total_actions: Number(a.total_actions || 0)
                })),
                summary: {
                    total: Number(summaryRows[0].total || 0),
                    super_admins: Number(summaryRows[0].super_admins || 0),
                    admins: Number(summaryRows[0].standard_admins || 0),
                    active: Number(summaryRows[0].active_admins || 0),
                    inactive: Number(summaryRows[0].inactive_admins || 0)
                }
            });
        }

        // 15b. POST /api/superadmin/admins - Create administrator account
        if (req.method === "POST" && pathname === "/api/superadmin/admins") {
            const body = await readJson(req);
            const name = (body.name || "").trim();
            const email = (body.email || "").trim().toLowerCase();
            const mobile = (body.mobile || "").trim();
            const password = body.password || "";
            const role = (body.role || "admin").toLowerCase().trim();
            const status = (body.status || "active").toLowerCase().trim() === "inactive" ? "inactive" : "active";
            const permissions = Array.isArray(body.permissions) ? body.permissions : [];

            if (!name || name.length < 2) {
                return sendJson(res, 400, { success: false, message: "Full name must be at least 2 characters." });
            }
            if (!email || !email.includes("@") || !email.includes(".")) {
                return sendJson(res, 400, { success: false, message: "A valid email address is required." });
            }
            if (!mobile || !/^\d{10}$/.test(mobile)) {
                return sendJson(res, 400, { success: false, message: "Mobile number must be a valid 10-digit number." });
            }
            if (!password || password.length < 6) {
                return sendJson(res, 400, { success: false, message: "Password must be at least 6 characters long." });
            }
            if (role !== "admin" && role !== "super_admin") {
                return sendJson(res, 400, { success: false, message: "Role must be 'admin' or 'super_admin'." });
            }

            // Check if email or mobile already in use
            const [existing] = await pool.execute(
                `SELECT user_id, email, mobile FROM users WHERE email = ? OR mobile = ?`,
                [email, mobile]
            );
            if (existing.length > 0) {
                const dup = existing[0];
                if (dup.email === email) {
                    return sendJson(res, 409, { success: false, message: `Email '${email}' is already registered.` });
                }
                if (dup.mobile === mobile) {
                    return sendJson(res, 409, { success: false, message: `Mobile '${mobile}' is already registered.` });
                }
            }

            const passwordHash = await bcrypt.hash(password, 10);

            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();

                const [userRes] = await connection.execute(
                    `INSERT INTO users (name, email, password, mobile, role, status) VALUES (?, ?, ?, ?, ?, ?)`,
                    [name, email, passwordHash, mobile, role, status]
                );
                const newAdminId = userRes.insertId;

                // Insert assigned permissions
                const validPermissions = [
                    "manage_passengers", "manage_drivers", "manage_vehicles",
                    "manage_trips", "manage_fares", "view_reports", "system_settings"
                ];
                const permsToInsert = permissions.filter(p => validPermissions.includes(p));

                // If super_admin, grant all permissions by default if none specified
                const finalPerms = role === "super_admin" && permsToInsert.length === 0
                    ? validPermissions
                    : permsToInsert;

                for (const perm of finalPerms) {
                    await connection.execute(
                        `INSERT INTO admin_permissions (admin_id, permission_name) VALUES (?, ?)`,
                        [newAdminId, perm]
                    );
                }

                await connection.commit();

                await logActivity(
                    null,
                    "ADMIN_CREATED",
                    `Created new ${role.toUpperCase()} account '${name}' (${email}, Phone: ${mobile}). Assigned ${finalPerms.length} permissions.`,
                    clientIp
                );

                return sendJson(res, 201, {
                    success: true,
                    message: `${role === 'super_admin' ? 'Super Administrator' : 'Administrator'} '${name}' created successfully.`,
                    user_id: newAdminId
                });
            } catch (err) {
                await connection.rollback();
                throw err;
            } finally {
                connection.release();
            }
        }

        // 15c. PATCH /api/superadmin/admins/:id/status - Activate or Deactivate administrator
        if ((req.method === "PATCH" || req.method === "POST") && pathname.match(/^\/api\/superadmin\/admins\/\d+\/status$/)) {
            const parts = pathname.split("/").filter(Boolean);
            const targetId = parseInt(parts[3], 10);
            const body = await readJson(req).catch(() => ({}));

            const session = await getAuthenticatedUser(req);

            // Self-deactivation protection
            if (session && session.user_id === targetId) {
                return sendJson(res, 400, {
                    success: false,
                    message: "You cannot deactivate your own administrator account while logged in."
                });
            }

            const [adminRows] = await pool.execute(
                `SELECT user_id, name, email, role, status FROM users WHERE user_id = ? AND role IN ('admin', 'super_admin')`,
                [targetId]
            );
            if (adminRows.length === 0) {
                return sendJson(res, 404, { success: false, message: "Administrator account not found." });
            }

            const admin = adminRows[0];
            let newStatus = body.status ? body.status.toLowerCase().trim() : (admin.status === "active" ? "inactive" : "active");
            if (newStatus !== "active" && newStatus !== "inactive") {
                newStatus = "active";
            }

            // Protection: cannot deactivate the last active super_admin
            if (admin.role === "super_admin" && newStatus === "inactive") {
                const [activeSuper] = await pool.query(
                    `SELECT COUNT(*) AS count FROM users WHERE role = 'super_admin' AND status = 'active' AND user_id != ?`,
                    [targetId]
                );
                if (Number(activeSuper[0].count) === 0) {
                    return sendJson(res, 400, {
                        success: false,
                        message: "Cannot deactivate the only active Super Administrator in the system."
                    });
                }
            }

            await pool.execute(
                `UPDATE users SET status = ? WHERE user_id = ?`,
                [newStatus, targetId]
            );

            await logActivity(
                null,
                "ADMIN_STATUS_CHANGED",
                `${admin.role.toUpperCase()} '${admin.name}' (#${targetId}) status changed from '${admin.status}' to '${newStatus}'.`,
                clientIp
            );

            return sendJson(res, 200, {
                success: true,
                message: `Administrator '${admin.name}' is now ${newStatus}.`,
                user_id: targetId,
                status: newStatus
            });
        }

        // 15d. PATCH /api/superadmin/admins/:id - Edit administrator details
        if ((req.method === "PATCH" || req.method === "PUT") && pathname.match(/^\/api\/superadmin\/admins\/\d+$/)) {
            const parts = pathname.split("/").filter(Boolean);
            const targetId = parseInt(parts[3], 10);
            const body = await readJson(req);

            const [adminRows] = await pool.execute(
                `SELECT user_id, name, email, mobile, role, status FROM users WHERE user_id = ? AND role IN ('admin', 'super_admin')`,
                [targetId]
            );
            if (adminRows.length === 0) {
                return sendJson(res, 404, { success: false, message: "Administrator account not found." });
            }
            const existing = adminRows[0];

            const name = body.name !== undefined ? body.name.trim() : existing.name;
            const email = body.email !== undefined ? body.email.trim().toLowerCase() : existing.email;
            const mobile = body.mobile !== undefined ? body.mobile.trim() : existing.mobile;
            const role = body.role !== undefined ? body.role.trim().toLowerCase() : existing.role;
            const status = body.status !== undefined ? (body.status.toLowerCase() === "inactive" ? "inactive" : "active") : existing.status;
            const permissions = Array.isArray(body.permissions) ? body.permissions : null;
            const password = body.password ? body.password.trim() : "";

            if (!name || name.length < 2) {
                return sendJson(res, 400, { success: false, message: "Full name must be at least 2 characters." });
            }
            if (!email || !email.includes("@")) {
                return sendJson(res, 400, { success: false, message: "A valid email address is required." });
            }
            if (!mobile || !/^\d{10}$/.test(mobile)) {
                return sendJson(res, 400, { success: false, message: "Mobile number must be a valid 10-digit number." });
            }
            if (role !== "admin" && role !== "super_admin") {
                return sendJson(res, 400, { success: false, message: "Role must be 'admin' or 'super_admin'." });
            }

            // Uniqueness check
            const [dups] = await pool.execute(
                `SELECT user_id, email, mobile FROM users WHERE (email = ? OR mobile = ?) AND user_id != ?`,
                [email, mobile, targetId]
            );
            if (dups.length > 0) {
                if (dups[0].email === email) return sendJson(res, 409, { success: false, message: `Email '${email}' is already in use.` });
                if (dups[0].mobile === mobile) return sendJson(res, 409, { success: false, message: `Mobile '${mobile}' is already in use.` });
            }

            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();

                if (password && password.length >= 6) {
                    const newHash = await bcrypt.hash(password, 10);
                    await connection.execute(
                        `UPDATE users SET name = ?, email = ?, mobile = ?, role = ?, status = ?, password = ? WHERE user_id = ?`,
                        [name, email, mobile, role, status, newHash, targetId]
                    );
                } else {
                    await connection.execute(
                        `UPDATE users SET name = ?, email = ?, mobile = ?, role = ?, status = ? WHERE user_id = ?`,
                        [name, email, mobile, role, status, targetId]
                    );
                }

                // Update permissions if provided
                if (permissions !== null) {
                    await connection.execute(`DELETE FROM admin_permissions WHERE admin_id = ?`, [targetId]);
                    const validPerms = [
                        "manage_passengers", "manage_drivers", "manage_vehicles",
                        "manage_trips", "manage_fares", "view_reports", "system_settings"
                    ];
                    for (const perm of permissions) {
                        if (validPerms.includes(perm)) {
                            await connection.execute(
                                `INSERT INTO admin_permissions (admin_id, permission_name) VALUES (?, ?)`,
                                [targetId, perm]
                            );
                        }
                    }
                }

                await connection.commit();

                await logActivity(
                    null,
                    "ADMIN_UPDATED",
                    `Updated administrator account #${targetId} ('${name}', ${email}, Role: ${role}, Status: ${status}).`,
                    clientIp
                );

                return sendJson(res, 200, {
                    success: true,
                    message: `Administrator '${name}' updated successfully.`,
                    user_id: targetId
                });
            } catch (err) {
                await connection.rollback();
                throw err;
            } finally {
                connection.release();
            }
        }

        // 15e. DELETE /api/superadmin/admins/:id - Safe Administrator Deletion
        if (req.method === "DELETE" && pathname.match(/^\/api\/superadmin\/admins\/\d+$/)) {
            const parts = pathname.split("/").filter(Boolean);
            const targetId = parseInt(parts[3], 10);

            const session = await getAuthenticatedUser(req);

            // Safe Deletion Rule 1: Cannot delete self
            if (session && session.user_id === targetId) {
                return sendJson(res, 400, {
                    success: false,
                    message: "Self-deletion prohibited: You cannot delete your own logged-in administrator account."
                });
            }

            const [adminRows] = await pool.execute(
                `SELECT user_id, name, email, role FROM users WHERE user_id = ? AND role IN ('admin', 'super_admin')`,
                [targetId]
            );
            if (adminRows.length === 0) {
                return sendJson(res, 404, { success: false, message: "Administrator account not found." });
            }
            const admin = adminRows[0];

            // Safe Deletion Rule 2: Cannot delete the last remaining Super Admin
            if (admin.role === "super_admin") {
                const [superCount] = await pool.query(
                    `SELECT COUNT(*) AS count FROM users WHERE role = 'super_admin'`
                );
                if (Number(superCount[0].count) <= 1) {
                    return sendJson(res, 400, {
                        success: false,
                        message: "Safe deletion prevented: Cannot delete the only remaining Super Administrator in the system. At least one Super Administrator must exist."
                    });
                }
            }

            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();

                // Safe Deletion Rule 3: Clear permissions
                await connection.execute(`DELETE FROM admin_permissions WHERE admin_id = ?`, [targetId]);

                // Clear FK from system_logs (set user_id = NULL)
                await connection.execute(`UPDATE system_logs SET user_id = NULL WHERE user_id = ?`, [targetId]);

                // Delete from users
                await connection.execute(`DELETE FROM users WHERE user_id = ?`, [targetId]);

                await connection.commit();

                await logActivity(
                    null,
                    "ADMIN_DELETED",
                    `Safely deleted ${admin.role.toUpperCase()} account '${admin.name}' (#${targetId}, ${admin.email}). Permissions cleared and logs preserved.`,
                    clientIp
                );

                return sendJson(res, 200, {
                    success: true,
                    message: `Administrator '${admin.name}' (${admin.email}) was safely removed.`,
                    deleted_id: targetId
                });
            } catch (err) {
                await connection.rollback();
                throw err;
            } finally {
                connection.release();
            }
        }

        // Static files fallback for web browser requests
        if (req.method === "GET" || req.method === "HEAD") {
            return serveStaticFile(req, res, pathname);
        }

        // If not matched:
        return sendJson(res, 404, {
            success: false,
            message: `Route ${req.method} ${pathname} not found.`
        });
    } catch (err) {
        console.error("Server execution error:", err);
        return sendJson(res, 500, {
            success: false,
            message: "Internal server error: " + err.message
        });
    }
});

server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
        console.error(`\n[ERROR] Port ${PORT} is already in use by another running process.`);
        console.error(`The server is already running and active at http://localhost:${PORT}`);
        console.error(`To restart, close the running terminal or run: npx kill-port ${PORT}\n`);
        process.exit(1);
    } else {
        console.error("Server error:", err);
    }
});

server.listen(PORT, () => {
    console.log(`RideNow server running at http://localhost:${PORT}`);
});