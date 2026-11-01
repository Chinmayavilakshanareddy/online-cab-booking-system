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

        // 5. Driver Management Actions API (Approve, Reject, Block, Unblock, Status Transitions)
        if ((req.method === "POST" || req.method === "PATCH") && pathname.startsWith("/api/admin/drivers/")) {
            const parts = pathname.split("/").filter(Boolean); // ['api', 'admin', 'drivers', ':id', 'status' | 'approve' | 'reject' | 'block' | 'unblock']
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

            // Determine target status
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

            // Validate status transitions
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

            // Compute database updates
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

            // Log action in system_logs
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

        // 5b. Get All Drivers API (Display all drivers, filter by status, search, pagination)
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

            // Total count
            const [countRows] = await pool.query(
                `SELECT COUNT(*) AS total 
                 FROM driver_profiles d 
                 JOIN users u ON d.user_id = u.user_id 
                 LEFT JOIN vehicles v ON d.driver_id = v.driver_id 
                 ${whereSql}`,
                params
            );
            const total = countRows[0].total;

            // Summary stats for KPI cards
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

            // Query drivers with license and vehicle details
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

        // 6. Admin Passengers List API (Search, Status Filter, Pagination)
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

            // Total matching count for pagination
            const [countRows] = await pool.query(
                `SELECT COUNT(*) AS total FROM users u ${whereSql}`,
                params
            );
            const total = countRows[0].total;

            // Summary stats for metric indicators
            const [summaryRows] = await pool.query(
                `SELECT 
                    COUNT(*) AS total,
                    COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active_count,
                    COALESCE(SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END), 0) AS blocked_count
                 FROM users
                 WHERE role IN ('passenger', 'customer')`
            );

            // Fetch passenger rows with profile details
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

        // 7. Admin Update Passenger Status (Block / Unblock / Change Status)
        if ((req.method === "PATCH" || req.method === "POST") && pathname.startsWith("/api/admin/passengers/")) {
            const parts = pathname.split("/").filter(Boolean); // ['api', 'admin', 'passengers', ':id', 'status' | 'block' | 'unblock']
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

            // Find passenger in users table
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

            // Update user status
            await pool.execute(
                `UPDATE users SET status = ? WHERE user_id = ?`,
                [newStatus, passenger.user_id]
            );

            // Record action in system_logs
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
                timeUpdateSql = ", end_time = COALESCE(end_time, NOW())";
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
