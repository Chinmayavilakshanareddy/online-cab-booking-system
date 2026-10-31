const http = require("node:http");
const { URL } = require("node:url");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
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

const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || "*";
    const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1";

    // Set CORS headers
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Credentials", "true");

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
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

        // 2. Authentication Login (All roles)
        if (req.method === "POST" && pathname === "/api/auth/login") {
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
            if (user.role === "admin") {
                const [perms] = await pool.execute(
                    `SELECT permission_name FROM admin_permissions WHERE admin_id = ?`,
                    [user.user_id]
                );
                permissions = perms.map(p => p.permission_name);
            }

            // Log activity
            await logActivity(user.user_id, "USER_LOGIN", `${user.role.toUpperCase()} ${user.name} logged in.`, clientIp);

            return sendJson(res, 200, {
                success: true,
                message: "Login successful.",
                user: {
                    user_id: user.user_id,
                    name: user.name,
                    email: user.email,
                    mobile: user.mobile,
                    role: user.role,
                    status: user.status,
                    permissions: permissions
                }
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

        // 4. Admin Dashboard Statistics
        if (req.method === "GET" && pathname === "/api/admin/dashboard/stats") {
            // Run parallel aggregate queries for maximum performance
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

            // Fetch list of drivers awaiting approval
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

            // Fetch recent trips
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

            // Fetch recent system activity
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

        // 5. Driver Approval / Rejection API (Admin Action)
        if ((req.method === "POST" || req.method === "PATCH") && pathname.startsWith("/api/admin/drivers/")) {
            const parts = pathname.split("/").filter(Boolean); // ['api', 'admin', 'drivers', ':id', 'status' | 'approve' | 'reject']
            const driverId = parseInt(parts[3], 10);
            const actionType = parts[4]; // optional: 'status', 'approve', 'reject'

            if (!driverId) {
                return sendJson(res, 400, { success: false, message: "Valid driver_id is required." });
            }

            let newStatus = "approved";
            if (actionType === "reject") {
                newStatus = "rejected";
            } else if (actionType === "approve") {
                newStatus = "approved";
            } else {
                const body = await readJson(req);
                if (body.status && ["approved", "rejected", "pending", "suspended"].includes(body.status)) {
                    newStatus = body.status;
                }
            }

            const [driverRows] = await pool.execute(
                `SELECT d.driver_id, d.user_id, u.name FROM driver_profiles d JOIN users u ON d.user_id = u.user_id WHERE d.driver_id = ?`,
                [driverId]
            );

            if (driverRows.length === 0) {
                return sendJson(res, 404, { success: false, message: "Driver not found." });
            }

            const driver = driverRows[0];

            await pool.execute(
                `UPDATE driver_profiles SET verification_status = ? WHERE driver_id = ?`,
                [newStatus, driverId]
            );

            // Also update vehicle status if approved
            if (newStatus === "approved") {
                await pool.execute(
                    `UPDATE vehicles SET status = 'active' WHERE driver_id = ?`,
                    [driverId]
                );
            }

            await logActivity(
                driver.user_id,
                `DRIVER_${newStatus.toUpperCase()}`,
                `Driver ${driver.name} verification status set to ${newStatus}.`,
                clientIp
            );

            return sendJson(res, 200, {
                success: true,
                message: `Driver ${driver.name} has been ${newStatus}.`,
                driver_id: driverId,
                status: newStatus
            });
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

server.listen(PORT, () => {
    console.log(`RideNow server running at http://localhost:${PORT}`);
});
