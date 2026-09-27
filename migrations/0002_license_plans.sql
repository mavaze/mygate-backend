PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS license_plans (
  code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','RETIRED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS capabilities (
  code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','RETIRED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS license_plan_capabilities (
  plan_code TEXT NOT NULL,
  capability_code TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY (plan_code, capability_code),
  FOREIGN KEY (plan_code) REFERENCES license_plans(code) ON DELETE CASCADE,
  FOREIGN KEY (capability_code) REFERENCES capabilities(code) ON DELETE RESTRICT
);

INSERT OR IGNORE INTO license_plans
  (code, display_name, description, status, created_at, updated_at)
VALUES
  ('CORE', 'Core', 'Initial My Gate feature bundle. The code is stable; the commercial display name can change later.', 'ACTIVE', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO capabilities (code, display_name, description, status, created_at, updated_at) VALUES
  ('VISITORS', 'Visitors', 'Visitor registration, visits and visitor history.', 'ACTIVE', datetime('now'), datetime('now')),
  ('RESIDENTS', 'Residents', 'Resident directory and member lookup.', 'ACTIVE', datetime('now'), datetime('now')),
  ('CALLING', 'Calling', 'Native visitor/member calling workflow.', 'ACTIVE', datetime('now'), datetime('now')),
  ('TASKS', 'Tasks', 'Watchman and administrator task management.', 'ACTIVE', datetime('now'), datetime('now')),
  ('VISITOR_PHOTOS', 'Visitor photos', 'Visitor photo capture and management.', 'ACTIVE', datetime('now'), datetime('now')),
  ('ADVANCED_REPORTING', 'Advanced reporting', 'Future advanced reporting features.', 'ACTIVE', datetime('now'), datetime('now')),
  ('MULTI_CONSOLE', 'Multiple consoles', 'More than one registered My Gate console/device.', 'ACTIVE', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO license_plan_capabilities
  (plan_code, capability_code, config_json, created_at)
SELECT 'CORE', code, '{}', datetime('now')
FROM capabilities
WHERE code IN ('VISITORS','RESIDENTS','CALLING','TASKS','VISITOR_PHOTOS');

ALTER TABLE licenses ADD COLUMN plan_code TEXT NOT NULL DEFAULT 'CORE';

CREATE INDEX IF NOT EXISTS idx_licenses_plan ON licenses(plan_code);
CREATE INDEX IF NOT EXISTS idx_plan_capabilities_capability ON license_plan_capabilities(capability_code);
