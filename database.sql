
CREATE DATABASE IF NOT EXISTS closet_db
DEFAULT CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE closet_db;

-- 1. 상품 테이블
CREATE TABLE IF NOT EXISTS products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    price INT NOT NULL,
    image VARCHAR(255),
    description TEXT,
    stock INT NOT NULL DEFAULT 0,
    sizes JSON,
    colors JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. 회원 테이블
CREATE TABLE IF NOT EXISTS members (
    id INT AUTO_INCREMENT PRIMARY KEY,
    userid VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(50) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    phone VARCHAR(20),
    address VARCHAR(255),
    role VARCHAR(20) NOT NULL DEFAULT 'user',
    cart_json JSON,
    orders_json JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
