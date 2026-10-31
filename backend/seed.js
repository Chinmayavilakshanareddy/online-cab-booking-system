const fs = require("node:fs");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const pool = require("./db");

async function seed() {
    console.log("Starting database seeding for RideNow...");
    const connection = await pool.getConnection();

    try {
        // Read and execute schema
        const schemaPath = path.join(__dirname, "schema.sql");
        let schemaSql = fs.readFileSync(schemaPath, "utf-8");
        schemaSql = schemaSql.replace(/--.*$/gm, ""); // strip SQL line comments
        const statements = schemaSql
            .split(";")
            .map(s => s.trim())
            .filter(Boolean);

        for (const statement of statements) {
            await connection.query(statement);
        }
        console.log("Schema applied successfully.");

        // Clear existing seed data if any (in correct foreign key order)
        await connection.query("SET FOREIGN_KEY_CHECKS = 0;");
        const tables = [
            "system_logs", "admin_permissions", "ratings_reviews", "payments",
            "trips", "ride_requests", "fare_rules", "service_areas",
            "vehicles", "driver_profiles", "passenger_profiles", "users"
        ];
        for (const tbl of tables) {
            await connection.query(`TRUNCATE TABLE ${tbl};`);
        }
        await connection.query("SET FOREIGN_KEY_CHECKS = 1;");
        console.log("Cleaned existing tables.");

        // Create Passwords
        const superAdminPw = await bcrypt.hash("SuperAdmin@123", 10);
        const adminPw = await bcrypt.hash("Admin@123", 10);
        const userPw = await bcrypt.hash("Password@123", 10);

        // 1. Insert Users
        const usersData = [
            // Super Admin
            ["Eleanor Vance (Super Admin)", "superadmin@ridenow.com", superAdminPw, "9990000001", "super_admin", "active"],
            // Admin
            ["Arthur Dent (Admin)", "admin@ridenow.com", adminPw, "9990000002", "admin", "active"],
            // Passengers
            ["Priya Sharma", "priya@example.com", userPw, "9876543210", "passenger", "active"],
            ["Rahul Verma", "rahul@example.com", userPw, "9876543211", "passenger", "active"],
            ["Sneha Patel", "sneha@example.com", userPw, "9876543212", "passenger", "active"],
            ["Amit Kumar", "amit@example.com", userPw, "9876543213", "passenger", "active"],
            // Drivers
            ["Ramesh Gowda", "ramesh@driver.com", userPw, "9880011221", "driver", "active"],
            ["Sunil Shetty", "sunil@driver.com", userPw, "9880011222", "driver", "active"],
            ["Mohammed Zayd", "zayd@driver.com", userPw, "9880011223", "driver", "active"],
            ["Kavita Reddy", "kavita@driver.com", userPw, "9880011224", "driver", "pending"], // Pending driver
            ["Vikram Rathore", "vikram@driver.com", userPw, "9880011225", "driver", "pending"] // Pending driver
        ];

        const userIds = {};
        for (const [name, email, pw, mobile, role, status] of usersData) {
            const [res] = await connection.execute(
                `INSERT INTO users (name, email, password, mobile, role, status) VALUES (?, ?, ?, ?, ?, ?)`,
                [name, email, pw, mobile, role, status]
            );
            userIds[email] = res.insertId;
        }
        console.log("Users seeded.");

        // 2. Admin Permissions
        const adminPerms = [
            "manage_passengers", "manage_drivers", "manage_vehicles",
            "manage_trips", "manage_fares", "view_reports"
        ];
        for (const perm of adminPerms) {
            await connection.execute(
                `INSERT INTO admin_permissions (admin_id, permission_name) VALUES (?, ?)`,
                [userIds["admin@ridenow.com"], perm]
            );
        }
        console.log("Admin permissions seeded.");

        // 3. Passenger Profiles
        const passengerProfiles = [
            [userIds["priya@example.com"], "Indiranagar, Bangalore", "9876500001"],
            [userIds["rahul@example.com"], "Koramangala, Bangalore", "9876500002"],
            [userIds["sneha@example.com"], "HSR Layout, Bangalore", "9876500003"],
            [userIds["amit@example.com"], "Whitefield, Bangalore", "9876500004"]
        ];
        const passengerIds = {};
        for (const [uid, addr, contact] of passengerProfiles) {
            const [res] = await connection.execute(
                `INSERT INTO passenger_profiles (user_id, default_address, emergency_contact) VALUES (?, ?, ?)`,
                [uid, addr, contact]
            );
            passengerIds[uid] = res.insertId;
        }

        // 4. Driver Profiles
        const driverProfiles = [
            [userIds["ramesh@driver.com"], "KA01-2022001122", "2029-05-10", "approved", 4.9],
            [userIds["sunil@driver.com"], "KA03-2021005544", "2028-11-20", "approved", 4.8],
            [userIds["zayd@driver.com"], "KA05-2023009988", "2030-01-15", "approved", 4.7],
            [userIds["kavita@driver.com"], "KA02-2024003311", "2031-08-30", "pending", 5.0],
            [userIds["vikram@driver.com"], "KA04-2024007766", "2032-03-25", "pending", 5.0]
        ];
        const driverIds = {};
        for (const [uid, lic, exp, status, rating] of driverProfiles) {
            const [res] = await connection.execute(
                `INSERT INTO driver_profiles (user_id, license_no, license_expiry, verification_status, rating) VALUES (?, ?, ?, ?, ?)`,
                [uid, lic, exp, status, rating]
            );
            driverIds[uid] = res.insertId;
        }
        console.log("Profiles seeded.");

        // 5. Vehicles
        const vehiclesData = [
            [driverIds[userIds["ramesh@driver.com"]], "KA-01-MJ-1234", "Sedan", "Honda City", 4, "active"],
            [driverIds[userIds["sunil@driver.com"]], "KA-03-AB-5678", "SUV", "Toyota Innova", 6, "active"],
            [driverIds[userIds["zayd@driver.com"]], "KA-05-CD-9012", "Hatchback", "Maruti Swift", 4, "active"],
            [driverIds[userIds["kavita@driver.com"]], "KA-02-EF-3456", "Sedan", "Hyundai Verna", 4, "inactive"],
            [driverIds[userIds["vikram@driver.com"]], "KA-04-GH-7890", "Auto", "Bajaj RE Compact", 3, "inactive"]
        ];
        const vehicleIds = [];
        for (const [did, vnum, vtype, model, cap, status] of vehiclesData) {
            const [res] = await connection.execute(
                `INSERT INTO vehicles (driver_id, vehicle_number, vehicle_type, model, capacity, status) VALUES (?, ?, ?, ?, ?, ?)`,
                [did, vnum, vtype, model, cap, status]
            );
            vehicleIds.push(res.insertId);
        }

        // 6. Service Areas
        const areas = [
            ["Central Business District", "Bangalore", "Karnataka", "active"],
            ["Indiranagar & Koramangala", "Bangalore", "Karnataka", "active"],
            ["Whitefield Tech Hub", "Bangalore", "Karnataka", "active"],
            ["Electronic City", "Bangalore", "Karnataka", "active"],
            ["Kempegowda Int. Airport Zone", "Bangalore", "Karnataka", "active"]
        ];
        for (const [name, city, state, st] of areas) {
            await connection.execute(
                `INSERT INTO service_areas (area_name, city, state, status) VALUES (?, ?, ?, ?)`,
                [name, city, state, st]
            );
        }

        // 7. Fare Rules
        const fares = [
            ["Hatchback", 50.00, 12.00, 1.50, 25.00, "active"],
            ["Sedan", 70.00, 15.00, 2.00, 35.00, "active"],
            ["SUV", 100.00, 20.00, 3.00, 50.00, "active"],
            ["Auto", 30.00, 9.00, 1.00, 15.00, "active"],
            ["Bike", 20.00, 6.00, 0.50, 10.00, "active"]
        ];
        for (const [vtype, base, km, min, cancel, st] of fares) {
            await connection.execute(
                `INSERT INTO fare_rules (vehicle_type, base_fare, per_km_rate, per_minute_rate, cancellation_fee, status) VALUES (?, ?, ?, ?, ?, ?)`,
                [vtype, base, km, min, cancel, st]
            );
        }

        // 8. Ride Requests & Trips
        const p1 = passengerIds[userIds["priya@example.com"]];
        const p2 = passengerIds[userIds["rahul@example.com"]];
        const p3 = passengerIds[userIds["sneha@example.com"]];
        const p4 = passengerIds[userIds["amit@example.com"]];

        const d1 = driverIds[userIds["ramesh@driver.com"]];
        const d2 = driverIds[userIds["sunil@driver.com"]];
        const d3 = driverIds[userIds["zayd@driver.com"]];

        // Completed Trip 1
        const [r1] = await connection.execute(
            `INSERT INTO ride_requests (passenger_id, pickup_location, destination, requested_at, estimated_fare, status) VALUES (?, ?, ?, NOW() - INTERVAL 4 HOUR, ?, 'completed')`,
            [p1, "Indiranagar 100ft Rd", "MG Road Metro", 210.00]
        );
        const [t1] = await connection.execute(
            `INSERT INTO trips (request_id, passenger_id, driver_id, vehicle_id, start_time, end_time, distance_km, fare, trip_status) VALUES (?, ?, ?, ?, NOW() - INTERVAL 4 HOUR, NOW() - INTERVAL 3 HOUR, 8.5, 215.00, 'completed')`,
            [r1.insertId, p1, d1, vehicleIds[0]]
        );
        await connection.execute(
            `INSERT INTO payments (trip_id, passenger_id, amount, payment_method, payment_status, paid_at) VALUES (?, ?, 215.00, 'upi', 'completed', NOW() - INTERVAL 3 HOUR)`,
            [t1.insertId, p1]
        );
        await connection.execute(
            `INSERT INTO ratings_reviews (trip_id, reviewer_id, reviewed_user_id, rating, comment) VALUES (?, ?, ?, 5, 'Smooth ride and very polite driver!')`,
            [t1.insertId, userIds["priya@example.com"], userIds["ramesh@driver.com"]]
        );

        // Completed Trip 2
        const [r2] = await connection.execute(
            `INSERT INTO ride_requests (passenger_id, pickup_location, destination, requested_at, estimated_fare, status) VALUES (?, ?, ?, NOW() - INTERVAL 2 HOUR, ?, 'completed')`,
            [p2, "Koramangala 5th Block", "Bangalore Airport (BLR)", 950.00]
        );
        const [t2] = await connection.execute(
            `INSERT INTO trips (request_id, passenger_id, driver_id, vehicle_id, start_time, end_time, distance_km, fare, trip_status) VALUES (?, ?, ?, ?, NOW() - INTERVAL 2 HOUR, NOW() - INTERVAL 1 HOUR, 42.0, 980.00, 'completed')`,
            [r2.insertId, p2, d2, vehicleIds[1]]
        );
        await connection.execute(
            `INSERT INTO payments (trip_id, passenger_id, amount, payment_method, payment_status, paid_at) VALUES (?, ?, 980.00, 'card', 'completed', NOW() - INTERVAL 1 HOUR)`,
            [t2.insertId, p2]
        );
        await connection.execute(
            `INSERT INTO ratings_reviews (trip_id, reviewer_id, reviewed_user_id, rating, comment) VALUES (?, ?, ?, 5, 'Very clean SUV and timely arrival.')`,
            [t2.insertId, userIds["rahul@example.com"], userIds["sunil@driver.com"]]
        );

        // Active / In-progress Trip 3
        const [r3] = await connection.execute(
            `INSERT INTO ride_requests (passenger_id, pickup_location, destination, requested_at, estimated_fare, status) VALUES (?, ?, ?, NOW() - INTERVAL 20 MINUTE, ?, 'accepted')`,
            [p3, "HSR Layout Sector 2", "Bellandur Ecospace", 160.00]
        );
        await connection.execute(
            `INSERT INTO trips (request_id, passenger_id, driver_id, vehicle_id, start_time, distance_km, fare, trip_status) VALUES (?, ?, ?, ?, NOW() - INTERVAL 15 MINUTE, 6.2, 160.00, 'started')`,
            [r3.insertId, p3, d3, vehicleIds[2]]
        );

        // Cancelled Trip 4
        const [r4] = await connection.execute(
            `INSERT INTO ride_requests (passenger_id, pickup_location, destination, requested_at, estimated_fare, status) VALUES (?, ?, ?, NOW() - INTERVAL 5 HOUR, ?, 'cancelled')`,
            [p4, "Whitefield Main Rd", "Phoenix Marketcity", 180.00]
        );
        await connection.execute(
            `INSERT INTO trips (request_id, passenger_id, driver_id, vehicle_id, start_time, end_time, distance_km, fare, trip_status) VALUES (?, ?, ?, ?, NOW() - INTERVAL 5 HOUR, NOW() - INTERVAL 5 HOUR, 0, 35.00, 'cancelled')`,
            [r4.insertId, p4, d1, vehicleIds[0]]
        );

        // 9. System Logs
        const logs = [
            [userIds["superadmin@ridenow.com"], "SYSTEM_INIT", "Database initialized and seeded with baseline configuration", "127.0.0.1"],
            [userIds["admin@ridenow.com"], "DRIVER_VERIFY", "Approved driver profile for Ramesh Gowda (KA01-2022001122)", "127.0.0.1"],
            [userIds["admin@ridenow.com"], "FARE_UPDATE", "Updated base fare for Sedan category to ₹70.00", "127.0.0.1"]
        ];
        for (const [uid, action, desc, ip] of logs) {
            await connection.execute(
                `INSERT INTO system_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)`,
                [uid, action, desc, ip]
            );
        }

        console.log("Database seeded successfully with initial test data!");
    } catch (err) {
        console.error("Seeding failed:", err);
    } finally {
        connection.release();
        await pool.end();
    }
}

seed();
