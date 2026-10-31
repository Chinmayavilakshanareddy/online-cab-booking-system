
const pool = require("./db");

async function testConnection() {
    try {
        const [rows] = await pool.query(
            "SELECT DATABASE() AS database_name"
        );

        console.log("MySQL connected successfully!");
        console.log("Database:", rows[0].database_name);
    } catch (error) {
        console.error("MySQL connection failed:", error.message);
    } finally {
        await pool.end();
    }
}

testConnection();
