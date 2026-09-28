PRAGMA foreign_keys = ON;

-- Move platform administration out of society membership. A platform admin is global.
CREATE TABLE IF NOT EXISTS platform_admins (
  user_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO platform_admins (user_id, status, created_at)
SELECT user_id, 'ACTIVE', MIN(created_at)
FROM society_users
WHERE role = 'PLATFORM_ADMIN'
GROUP BY user_id;

-- The society admin identity is a single verified Gmail/Firebase identity per society.
ALTER TABLE societies ADD COLUMN admin_email TEXT;

-- Existing schema is rebuilt without the global PLATFORM_ADMIN role. Existing platform-admin rows remain represented above.
CREATE TABLE society_users_new (
  society_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('SOCIETY_ADMIN')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (society_id, user_id),
  FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
INSERT OR IGNORE INTO society_users_new (society_id, user_id, role, created_at)
SELECT society_id, user_id, 'SOCIETY_ADMIN', created_at
FROM society_users
WHERE role = 'SOCIETY_ADMIN';
DROP TABLE society_users;
ALTER TABLE society_users_new RENAME TO society_users;
CREATE INDEX IF NOT EXISTS idx_society_users_user ON society_users(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_society_one_admin ON society_users(society_id) WHERE role = 'SOCIETY_ADMIN';
CREATE UNIQUE INDEX IF NOT EXISTS uq_society_admin_user ON society_users(user_id) WHERE role = 'SOCIETY_ADMIN';
CREATE UNIQUE INDEX IF NOT EXISTS uq_society_admin_email ON societies(lower(admin_email)) WHERE admin_email IS NOT NULL;

CREATE TABLE IF NOT EXISTS watchman_accounts (
  id TEXT PRIMARY KEY,
  society_id TEXT NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED','DELETED')),
  auth_mode TEXT NOT NULL DEFAULT 'CENTRAL' CHECK (auth_mode IN ('CENTRAL','LOCAL')),
  credential_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE CASCADE,
  UNIQUE (society_id, username)
);
CREATE INDEX IF NOT EXISTS idx_watchman_accounts_society ON watchman_accounts(society_id);

CREATE TABLE IF NOT EXISTS watchman_sessions (
  id TEXT PRIMARY KEY,
  watchman_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  device_id TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (watchman_id) REFERENCES watchman_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_watchman_sessions_watchman ON watchman_sessions(watchman_id);
CREATE INDEX IF NOT EXISTS idx_watchman_sessions_expiry ON watchman_sessions(expires_at);
