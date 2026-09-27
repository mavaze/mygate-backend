import type { Env } from "./env";
import { ApiError } from "./errors";

export interface ContextRecord {
  userId: string;
  firebaseUid: string;
  societyId: string;
  role: "PLATFORM_ADMIN" | "SOCIETY_ADMIN" | "WATCHMAN";
  deviceId: string;
  licenseId: string;
  licenseType: "PILOT" | "PRODUCTION";
  licenseStatus: "ACTIVE";
  planCode: string;
  expiresAt: string;
}

export async function getOrCreateUser(
  env: Env,
  firebaseUid: string,
  email?: string,
  displayName?: string
) {
  const existing = await env.DB.prepare(
    "SELECT id, firebase_uid, email, display_name, status FROM users WHERE firebase_uid = ?"
  ).bind(firebaseUid).first<any>();

  if (existing) return existing;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO users (id, firebase_uid, email, display_name, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(id, firebaseUid, email ?? null, displayName ?? null, now).run();

  return { id, firebase_uid: firebaseUid, email, display_name: displayName, status: "ACTIVE" };
}

export async function resolveContext(
  env: Env,
  userId: string,
  installationId: string
): Promise<ContextRecord> {
  const row = await env.DB.prepare(`
    SELECT
      u.id user_id, u.firebase_uid, su.society_id, su.role,
      d.id device_id,
      l.id license_id, l.license_type, l.status license_status,
      l.plan_code, l.starts_at, l.expires_at
    FROM users u
    JOIN society_users su ON su.user_id = u.id
    JOIN devices d ON d.user_id = u.id AND d.society_id = su.society_id
    JOIN licenses l ON l.society_id = su.society_id
    JOIN societies s ON s.id = su.society_id
    WHERE u.id = ?
      AND d.installation_id = ?
      AND d.status = 'ACTIVE'
      AND u.status = 'ACTIVE'
      AND s.status = 'ACTIVE'
    ORDER BY l.created_at DESC
    LIMIT 1
  `).bind(userId, installationId).first<any>();

  if (!row) {
    throw new ApiError(403, "DEVICE_NOT_AUTHORIZED", "User/device is not authorized");
  }

  const now = Date.now();
  if (row.license_status !== "ACTIVE" || Date.parse(row.expires_at) <= now || Date.parse(row.starts_at ?? "1970-01-01T00:00:00.000Z") > now) {
    throw new ApiError(403, "LICENSE_INACTIVE", "License is not active");
  }

  return {
    userId: row.user_id,
    firebaseUid: row.firebase_uid,
    societyId: row.society_id,
    role: row.role,
    deviceId: row.device_id,
    licenseId: row.license_id,
    licenseType: row.license_type,
    licenseStatus: "ACTIVE",
    planCode: row.plan_code,
    expiresAt: row.expires_at
  };
}

export async function registerDevice(
  env: Env,
  userId: string,
  societyId: string,
  installationId: string,
  appVersion: string | null
): Promise<string> {
  const existing = await env.DB.prepare(
    "SELECT id FROM devices WHERE society_id = ? AND installation_id = ?"
  ).bind(societyId, installationId).first<any>();

  const now = new Date().toISOString();

  if (existing) {
    await env.DB.prepare(
      "UPDATE devices SET user_id = ?, app_version = ?, status = 'ACTIVE', last_seen_at = ? WHERE id = ?"
    ).bind(userId, appVersion, now, existing.id).run();
    return existing.id;
  }

  const license = await env.DB.prepare(`
    SELECT l.device_limit,
           (SELECT COUNT(*) FROM devices d WHERE d.society_id = l.society_id AND d.status = 'ACTIVE') active_devices
    FROM licenses l
    WHERE l.society_id = ? AND l.status = 'ACTIVE' AND l.expires_at > ?
    ORDER BY l.created_at DESC LIMIT 1
  `).bind(societyId, now).first<any>();

  if (!license) throw new ApiError(403, "LICENSE_INACTIVE", "No active license");

  if (Number(license.active_devices) >= Number(license.device_limit)) {
    throw new ApiError(409, "DEVICE_LIMIT_REACHED", "Device limit reached");
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO devices
      (id, society_id, user_id, installation_id, platform, app_version, registered_at, last_seen_at)
    VALUES (?, ?, ?, ?, 'ANDROID', ?, ?, ?)
  `).bind(id, societyId, userId, installationId, appVersion, now, now).run();

  return id;
}

export async function audit(
  env: Env,
  eventType: string,
  actorUserId: string | null,
  societyId: string | null,
  deviceId: string | null,
  details: Record<string, unknown> = {}
) {
  await env.DB.prepare(`
    INSERT INTO audit_events
      (id, occurred_at, actor_user_id, society_id, device_id, event_type, details_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    new Date().toISOString(),
    actorUserId,
    societyId,
    deviceId,
    eventType,
    JSON.stringify(details)
  ).run();
}
