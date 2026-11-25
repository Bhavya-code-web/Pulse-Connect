-- Same model for the zero-install SQLite demo mode.
CREATE TABLE IF NOT EXISTS donors (
  donor_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL CHECK (length(name) BETWEEN 3 AND 50),
  blood_group     TEXT NOT NULL CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  age             INTEGER NOT NULL CHECK (age BETWEEN 18 AND 65),
  location        TEXT NOT NULL,
  phone           TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'Available' CHECK (status IN ('Available','Unavailable')),
  registered_date TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_donors_group_status ON donors (blood_group, status);
CREATE INDEX IF NOT EXISTS idx_donors_location ON donors (location);
CREATE TABLE IF NOT EXISTS emergency_requests (
  request_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_name    TEXT NOT NULL,
  blood_group     TEXT NOT NULL CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  units           INTEGER NOT NULL CHECK (units BETWEEN 1 AND 10),
  hospital        TEXT NOT NULL,
  city            TEXT NOT NULL,
  urgency         TEXT NOT NULL CHECK (urgency IN ('Critical','Urgent','Standard')),
  contact_phone   TEXT NOT NULL,
  matched_donors  INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Fulfilled','Cancelled')),
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO sqlite_sequence (name, seq) SELECT 'donors', 1000 WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'donors');
INSERT INTO sqlite_sequence (name, seq) SELECT 'emergency_requests', 5000 WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'emergency_requests');
