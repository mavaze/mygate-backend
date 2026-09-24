PRAGMA foreign_keys = ON;

CREATE TABLE societies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','SUSPENDED')),
  created_at TEXT NOT NULL
);

CREATE TABLE licenses (
  id TEXT PRIMARY KEY,
  society_id TEXT NOT NULL,
  license_type TEXT NOT NULL
    CHECK (license_type IN ('PILOT','PRODUCTION')),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','SUSPENDED','EXPIRED')),
  starts_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  device_limit INTEGER NOT NULL DEFAULT 5 CHECK (device_limit > 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE RESTRICT
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  firebase_uid TEXT NOT NULL UNIQUE,
  email TEXT,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','SUSPENDED')),
  created_at TEXT NOT NULL
);

CREATE TABLE society_users (
  society_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('PLATFORM_ADMIN','SOCIETY_ADMIN','WATCHMAN')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (society_id, user_id),
  FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  society_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'ANDROID',
  app_version TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','REVOKED')),
  registered_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (society_id, installation_id)
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  actor_user_id TEXT,
  society_id TEXT,
  device_id TEXT,
  event_type TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE app_releases (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'ANDROID',
  version_name TEXT NOT NULL,
  min_supported_version TEXT NOT NULL,
  latest_recommended_version TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','RETIRED')),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_licenses_society ON licenses(society_id);
CREATE INDEX idx_society_users_user ON society_users(user_id);
CREATE INDEX idx_devices_user ON devices(user_id);
CREATE INDEX idx_devices_society ON devices(society_id);
CREATE INDEX idx_audit_society_time ON audit_events(society_id, occurred_at);
