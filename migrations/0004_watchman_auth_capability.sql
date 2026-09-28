PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO capabilities (code, display_name, description, status, created_at, updated_at)
VALUES ('WATCHMAN_AUTH', 'Watchman authentication', 'Controls whether watchman accounts authenticate locally on the console or centrally through MyGate Cloud.', 'ACTIVE', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO license_plan_capabilities (plan_code, capability_code, config_json, created_at)
VALUES ('CORE', 'WATCHMAN_AUTH', '{"mode":"LOCAL"}', datetime('now'));
