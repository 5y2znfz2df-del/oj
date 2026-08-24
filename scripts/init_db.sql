-- =============================================
-- 比特 OJ - MySQL 初始化脚本
-- 用法: mysql -u root -p < scripts/init_db.sql
-- =============================================
CREATE DATABASE IF NOT EXISTS oj DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE oj;

-- 会话表（token 持久化，避免重启后用户掉线）
CREATE TABLE IF NOT EXISTS sessions (
  token       VARCHAR(64) PRIMARY KEY,
  username    VARCHAR(64) NOT NULL,
  role        VARCHAR(20) NOT NULL,
  created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (username),
  INDEX idx_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 用户表（admin 账号由服务启动时自动创建）
CREATE TABLE IF NOT EXISTS users (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  username     VARCHAR(64)  NOT NULL UNIQUE,
  password     CHAR(64)     NOT NULL COMMENT 'SHA256 哈希',
  role         ENUM('user','admin','class_admin') NOT NULL DEFAULT 'user',
  points       INT          NOT NULL DEFAULT 0,
  solved_count INT          NOT NULL DEFAULT 0,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 提交记录表
CREATE TABLE IF NOT EXISTS submissions (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT          NOT NULL,
  problem_id INT          NOT NULL,
  code       MEDIUMTEXT   NOT NULL,
  status     VARCHAR(16)  NOT NULL DEFAULT 'Pending' COMMENT 'AC/WA/TLE/MLE/RE/CE',
  time_ms    INT          NOT NULL DEFAULT 0,
  memory_kb  INT          NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user  (user_id),
  KEY idx_prob (problem_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 商城购买记录表
CREATE TABLE IF NOT EXISTS purchases (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT          NOT NULL,
  item_id    INT          NOT NULL,
  item_name  VARCHAR(128) NOT NULL,
  price      INT          NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;