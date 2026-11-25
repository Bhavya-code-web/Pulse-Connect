-- Pulse Connect schema (MySQL 8 / MariaDB 10.5+). Safe to re-run.
CREATE DATABASE IF NOT EXISTS pulseconnect CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE pulseconnect;

CREATE TABLE IF NOT EXISTS donors (
  donor_id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name            VARCHAR(50)  NOT NULL,
  blood_group     ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-') NOT NULL,
  age             TINYINT UNSIGNED NOT NULL,
  location        VARCHAR(100) NOT NULL,
  phone           VARCHAR(20)  NOT NULL,
  status          ENUM('Available','Unavailable') NOT NULL DEFAULT 'Available',
  registered_date DATE NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (donor_id),
  UNIQUE KEY uq_donors_phone (phone),
  KEY idx_donors_group_status (blood_group, status),
  KEY idx_donors_location (location),
  CONSTRAINT chk_donors_age CHECK (age BETWEEN 18 AND 65)
) ENGINE=InnoDB AUTO_INCREMENT=1001 DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS emergency_requests (
  request_id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  patient_name    VARCHAR(50)  NOT NULL,
  blood_group     ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-') NOT NULL,
  units           TINYINT UNSIGNED NOT NULL,
  hospital        VARCHAR(100) NOT NULL,
  city            VARCHAR(100) NOT NULL,
  urgency         ENUM('Critical','Urgent','Standard') NOT NULL,
  contact_phone   VARCHAR(20)  NOT NULL,
  matched_donors  INT UNSIGNED NOT NULL DEFAULT 0,
  status          ENUM('Open','Fulfilled','Cancelled') NOT NULL DEFAULT 'Open',
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (request_id),
  KEY idx_requests_status_created (status, created_at),
  CONSTRAINT chk_requests_units CHECK (units BETWEEN 1 AND 10)
) ENGINE=InnoDB AUTO_INCREMENT=5001 DEFAULT CHARSET=utf8mb4;
