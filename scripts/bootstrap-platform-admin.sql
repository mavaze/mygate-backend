-- Run once after the first platform admin has signed in with Google/Firebase.
-- Replace the two placeholders with the Firebase UID and Gmail address.
-- If the user has already called /v1/me, the users row already exists; the INSERT below is idempotent.
-- npx wrangler d1 execute mygate-control --remote --file=./scripts/bootstrap-platform-admin.sql

INSERT OR IGNORE INTO users (id, firebase_uid, email, display_name, status, created_at)
VALUES ('9FC4F722-ABD4-48AF-8A06-BCC2F6BA747B', '03cIifMTYGOg2Uis11NfwvZldoG2', 'mayuresh.vaze@gmail.com', 'Platform Admin', 'ACTIVE', datetime('now'));

INSERT OR IGNORE INTO platform_admins (user_id, status, created_at)
SELECT id, 'ACTIVE', datetime('now') FROM users WHERE firebase_uid = '03cIifMTYGOg2Uis11NfwvZldoG2';
