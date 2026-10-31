
const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const mysql = require("mysql2/promise");

const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "YOUR_NEW_PASSWORD",
    database: process.env.DB_NAME || "ridenow",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

module.exports = pool;
