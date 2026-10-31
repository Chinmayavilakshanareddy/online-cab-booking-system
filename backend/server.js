
const http = require("node:http");
const { URL } = require("node:url");
const bcrypt = require("bcryptjs");
const pool = require("./db");

const PORT = 3000;

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
        if (body.length > 10_000) {
            throw new Error("Request body too large");
        }
    }

    return JSON.parse(body);
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "OPTIONS") {
        res.writeHead(204, {
            "Access-Control-Allow-Origin": "http://localhost:5500",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        });
        return res.end();
    }

    res.setHeader("Access-Control-Allow-Origin", "http://localhost:5500");
    res.setHeader("Content-Type", "application/json; charset=utf-8");

    if (req.method === "GET" && url.pathname === "/api/health") {
        return sendJson(res, 200, {
            success: true,
            message: "RideNow backend is running"
        });
    }

    if (req.method === "POST" && url.pathname === "/api/customers/register") {
        try {
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

            const passwordHash = await bcrypt.hash(password, 12);

            const connection = await pool.getConnection();

            try {
                await connection.beginTransaction();

                const [result] = await connection.execute(
                    `INSERT INTO users
                     (full_name, email, phone, password_hash, role)
                     VALUES (?, ?, ?, ?, 'customer')`,
                    [name.trim(), email.trim().toLowerCase(), phone.trim(), passwordHash]
                );

                await connection.execute(
                    "INSERT INTO passenger_profiles (user_id) VALUES (?)",
                    [result.insertId]
                );

                await connection.commit();

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

                console.error("Registration database error:", error.message);
                return sendJson(res, 500, {
                    success: false,
                    message: "Registration failed. Please try again."
                });
            } finally {
                connection.release();
            }
        } catch (error) {
            return sendJson(res, 400, {
                success: false,
                message: "Invalid request body."
            });
        }
    }

    return sendJson(res, 404, {
        success: false,
        message: "Route not found"
    });
});

server.listen(PORT, () => {
    console.log(`RideNow backend running at http://localhost:${PORT}`);
});
