-- Online Cab Booking System - Database Schema
-- Meets all specifications from Section 8 of the project rubric

CREATE DATABASE IF NOT EXISTS ridenow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ridenow;

-- 1. users
CREATE TABLE IF NOT EXISTS users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(160) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    mobile VARCHAR(20) NOT NULL UNIQUE,
    role ENUM('passenger', 'driver', 'admin', 'super_admin') NOT NULL DEFAULT 'passenger',
    status ENUM('active', 'inactive', 'blocked', 'pending') NOT NULL DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. passenger_profiles
CREATE TABLE IF NOT EXISTS passenger_profiles (
    passenger_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    default_address VARCHAR(255) DEFAULT NULL,
    emergency_contact VARCHAR(20) DEFAULT NULL,
    CONSTRAINT fk_passenger_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. driver_profiles
CREATE TABLE IF NOT EXISTS driver_profiles (
    driver_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    license_no VARCHAR(50) NOT NULL UNIQUE,
    license_expiry DATE NOT NULL,
    verification_status ENUM('pending', 'approved', 'rejected', 'suspended') NOT NULL DEFAULT 'pending',
    rating DECIMAL(3, 2) NOT NULL DEFAULT 5.00,
    CONSTRAINT fk_driver_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. vehicles
CREATE TABLE IF NOT EXISTS vehicles (
    vehicle_id INT AUTO_INCREMENT PRIMARY KEY,
    driver_id INT NOT NULL,
    vehicle_number VARCHAR(30) NOT NULL UNIQUE,
    vehicle_type ENUM('Sedan', 'SUV', 'Hatchback', 'Auto', 'Bike', 'Premium') NOT NULL,
    model VARCHAR(100) NOT NULL,
    capacity INT NOT NULL DEFAULT 4,
    status ENUM('active', 'inactive', 'under_maintenance') NOT NULL DEFAULT 'active',
    CONSTRAINT fk_vehicle_driver FOREIGN KEY (driver_id) REFERENCES driver_profiles(driver_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. service_areas
CREATE TABLE IF NOT EXISTS service_areas (
    area_id INT AUTO_INCREMENT PRIMARY KEY,
    area_name VARCHAR(100) NOT NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NOT NULL,
    status ENUM('active', 'inactive') NOT NULL DEFAULT 'active'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6. fare_rules
CREATE TABLE IF NOT EXISTS fare_rules (
    fare_id INT AUTO_INCREMENT PRIMARY KEY,
    vehicle_type VARCHAR(50) NOT NULL,
    base_fare DECIMAL(10, 2) NOT NULL,
    per_km_rate DECIMAL(10, 2) NOT NULL,
    per_minute_rate DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    cancellation_fee DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    status ENUM('active', 'inactive') NOT NULL DEFAULT 'active'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. ride_requests
CREATE TABLE IF NOT EXISTS ride_requests (
    request_id INT AUTO_INCREMENT PRIMARY KEY,
    passenger_id INT NOT NULL,
    pickup_location VARCHAR(255) NOT NULL,
    destination VARCHAR(255) NOT NULL,
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    estimated_fare DECIMAL(10, 2) NOT NULL,
    status ENUM('pending', 'accepted', 'completed', 'cancelled') NOT NULL DEFAULT 'pending',
    CONSTRAINT fk_request_passenger FOREIGN KEY (passenger_id) REFERENCES passenger_profiles(passenger_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 8. trips
CREATE TABLE IF NOT EXISTS trips (
    trip_id INT AUTO_INCREMENT PRIMARY KEY,
    request_id INT NOT NULL UNIQUE,
    passenger_id INT NOT NULL,
    driver_id INT NOT NULL,
    vehicle_id INT NOT NULL,
    start_time DATETIME DEFAULT NULL,
    end_time DATETIME DEFAULT NULL,
    distance_km DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
    fare DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    trip_status ENUM('assigned', 'started', 'completed', 'cancelled') NOT NULL DEFAULT 'assigned',
    CONSTRAINT fk_trip_request FOREIGN KEY (request_id) REFERENCES ride_requests(request_id) ON DELETE CASCADE,
    CONSTRAINT fk_trip_passenger FOREIGN KEY (passenger_id) REFERENCES passenger_profiles(passenger_id) ON DELETE CASCADE,
    CONSTRAINT fk_trip_driver FOREIGN KEY (driver_id) REFERENCES driver_profiles(driver_id) ON DELETE CASCADE,
    CONSTRAINT fk_trip_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 9. payments
CREATE TABLE IF NOT EXISTS payments (
    payment_id INT AUTO_INCREMENT PRIMARY KEY,
    trip_id INT NOT NULL UNIQUE,
    passenger_id INT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    payment_method ENUM('cash', 'card', 'upi', 'wallet') NOT NULL DEFAULT 'upi',
    payment_status ENUM('pending', 'completed', 'failed', 'refunded') NOT NULL DEFAULT 'pending',
    paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_payment_trip FOREIGN KEY (trip_id) REFERENCES trips(trip_id) ON DELETE CASCADE,
    CONSTRAINT fk_payment_passenger FOREIGN KEY (passenger_id) REFERENCES passenger_profiles(passenger_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 10. ratings_reviews
CREATE TABLE IF NOT EXISTS ratings_reviews (
    review_id INT AUTO_INCREMENT PRIMARY KEY,
    trip_id INT NOT NULL,
    reviewer_id INT NOT NULL,
    reviewed_user_id INT NOT NULL,
    rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_review_trip FOREIGN KEY (trip_id) REFERENCES trips(trip_id) ON DELETE CASCADE,
    CONSTRAINT fk_review_reviewer FOREIGN KEY (reviewer_id) REFERENCES users(user_id) ON DELETE CASCADE,
    CONSTRAINT fk_review_reviewed FOREIGN KEY (reviewed_user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 11. admin_permissions
CREATE TABLE IF NOT EXISTS admin_permissions (
    permission_id INT AUTO_INCREMENT PRIMARY KEY,
    admin_id INT NOT NULL,
    permission_name VARCHAR(100) NOT NULL,
    CONSTRAINT fk_permission_admin FOREIGN KEY (admin_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 12. system_logs
CREATE TABLE IF NOT EXISTS system_logs (
    log_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT DEFAULT NULL,
    action VARCHAR(100) NOT NULL,
    description TEXT DEFAULT NULL,
    ip_address VARCHAR(45) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_log_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


