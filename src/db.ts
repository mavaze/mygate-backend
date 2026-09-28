import type { Env } from "./env";
import { ApiError } from "./errors";
import { getActivePlanCapabilities } from "./licensing";

export interface ContextRecord {
  userId: string;
  firebaseUid: string;
  societyId: string;
  role: "SOCIETY_ADMIN";
  deviceId: string;
  licenseId: string;
  licenseType: "PILOT" | "PRODUCTION";
  licenseStatus: "ACTIVE";
  planCode: string;
  expiresAt: string;
}

export async function getOrCreateUser(env: Env, firebaseUid: string, email?: string, displayName?: string) {
  const normalizedEmail = email?.trim().toLowerCase() || null;
  const existing = await env.DB.prepare("SELECT id, firebase_uid, email, display_name, status FROM users WHERE firebase_uid = ?")
    .bind(firebaseUid).first<any>();
  if (existing) {
    if (existing.status !== "ACTIVE") throw new ApiError(403, "USER_DISABLED", "User account is disabled");
    if (normalizedEmail && normalizedEmail !== existing.email) {
      await env.DB.prepare("UPDATE users SET email = ?, display_name = COALESCE(?, display_name) WHERE id = ?")
        .bind(normalizedEmail, displayName ?? null, existing.id).run();
      existing.email = normalizedEmail;
    }
    return existing;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users (id, firebase_uid, email, display_name, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, firebaseUid, normalizedEmail, displayName ?? null, now).run();

  // A society has exactly one Google/Firebase identity. A first login from the configured
  // society admin Gmail automatically creates the society membership.
  if (normalizedEmail) {
    const society = await env.DB.prepare("SELECT id FROM societies WHERE lower(admin_email) = ? AND status = 'ACTIVE'")
      .bind(normalizedEmail).first<any>();
    if (society) {
      const existingAdmin = await env.DB.prepare("SELECT user_id FROM society_users WHERE society_id = ?")
        .bind(society.id).first<any>();
      if (existingAdmin && existingAdmin.user_id !== id) {
        throw new ApiError(409, "SOCIETY_ADMIN_ALREADY_ASSIGNED", "This society already has its administrator identity assigned");
      }
      await env.DB.prepare("INSERT OR IGNORE INTO society_users (society_id, user_id, role, created_at) VALUES (?, ?, 'SOCIETY_ADMIN', ?)")
        .bind(society.id, id, now).run();
    }
  }

  return { id, firebase_uid: firebaseUid, email: normalizedEmail, display_name: displayName ?? null, status: "ACTIVE" };
}

export async function requireSocietyAdmin(env: Env, userId: string, societyId?: string) {
  const row = await env.DB.prepare(`
    SELECT su.society_id societyId, s.name societyName, s.admin_email adminEmail, s.status societyStatus
    FROM society_users su JOIN societies s ON s.id = su.society_id
    WHERE su.user_id = ? AND su.role = 'SOCIETY_ADMIN'
      AND (? IS NULL OR su.society_id = ?)
    LIMIT 1
  `).bind(userId, societyId ?? null, societyId ?? null).first<any>();
  if (!row) throw new ApiError(403, "SOCIETY_ADMIN_REQUIRED", "Society administrator access is required");
  if (row.societyStatus !== "ACTIVE") throw new ApiError(403, "SOCIETY_SUSPENDED", "Society is suspended");
  return row;
}

export async function resolveContext(env: Env, userId: string, installationId: string): Promise<ContextRecord> {
  const row = await env.DB.prepare(`
    SELECT u.id user_id, u.firebase_uid, su.society_id, su.role,
      d.id device_id, d.status device_status,
      l.id license_id, l.license_type, l.status license_status,
      l.plan_code, l.starts_at, l.expires_at, s.status society_status
    FROM users u
    JOIN society_users su ON su.user_id = u.id AND su.role = 'SOCIETY_ADMIN'
    JOIN devices d ON d.user_id = u.id AND d.society_id = su.society_id
    JOIN societies s ON s.id = su.society_id
    JOIN licenses l ON l.society_id = su.society_id
    WHERE u.id = ? AND d.installation_id = ? AND d.status = 'ACTIVE' AND u.status = 'ACTIVE' AND s.status = 'ACTIVE'
    ORDER BY l.created_at DESC LIMIT 1
  `).bind(userId, installationId).first<any>();

  if (!row) throw new ApiError(403, "DEVICE_NOT_AUTHORIZED", "User/device is not authorized");
  const now = Date.now();
  if (row.license_status !== "ACTIVE" || Date.parse(row.expires_at) <= now || Date.parse(row.starts_at) > now) {
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

export async function registerDevice(env: Env, userId: string, societyId: string, installationId: string, appVersion: string | null): Promise<string> {
  const existing = await env.DB.prepare("SELECT id, user_id, status FROM devices WHERE society_id = ? AND installation_id = ?")
    .bind(societyId, installationId).first<any>();
  const now = new Date().toISOString();
  if (existing) {
    if (existing.user_id !== userId) throw new ApiError(409, "DEVICE_ALREADY_REGISTERED", "This installation is already registered to another user");
    if (existing.status === "REVOKED") throw new ApiError(403, "DEVICE_REVOKED", "This device has been revoked");
    await env.DB.prepare("UPDATE devices SET app_version = ?, status = 'ACTIVE', last_seen_at = ? WHERE id = ?")
      .bind(appVersion, now, existing.id).run();
    return existing.id;
  }

  const license = await env.DB.prepare(`SELECT l.device_limit, (SELECT COUNT(*) FROM devices d WHERE d.society_id = l.society_id AND d.status = 'ACTIVE') active_devices FROM licenses l WHERE l.society_id = ? AND l.status = 'ACTIVE' AND l.starts_at <= ? AND l.expires_at > ? ORDER BY l.created_at DESC LIMIT 1`)
    .bind(societyId, now, now).first<any>();
  if (!license) throw new ApiError(403, "LICENSE_INACTIVE", "No active license");
  if (Number(license.active_devices) >= Number(license.device_limit)) throw new ApiError(409, "DEVICE_LIMIT_REACHED", "Device limit reached");

  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO devices (id, society_id, user_id, installation_id, platform, app_version, registered_at, last_seen_at) VALUES (?, ?, ?, ?, 'ANDROID', ?, ?, ?)`)
    .bind(id, societyId, userId, installationId, appVersion, now, now).run();
  return id;
}

export async function getSocietyForAdmin(env: Env, userId: string) {
  return requireSocietyAdmin(env, userId);
}

export async function requireWatchmanCentralMode(env: Env, societyId: string) {
  const license = await env.DB.prepare(`SELECT plan_code, id license_id, status, starts_at, expires_at FROM licenses WHERE society_id = ? ORDER BY created_at DESC LIMIT 1`).bind(societyId).first<any>();
  if (!license || license.status !== "ACTIVE" || Date.parse(license.starts_at) > Date.now() || Date.parse(license.expires_at) <= Date.now()) {
    throw new ApiError(403, "LICENSE_INACTIVE", "Society does not have an active license");
  }
  const capabilities = await getActivePlanCapabilities(env, license.plan_code);
  const auth = capabilities.find((c) => c.code === "WATCHMAN_AUTH");
  const mode = auth?.config?.mode;
  if (mode !== "CENTRAL") throw new ApiError(403, "CENTRAL_WATCHMAN_AUTH_NOT_ENABLED", "This society's license uses local watchman authentication");
  return { licenseId: license.license_id, planCode: license.plan_code, capabilities };
}

export async function audit(env: Env, eventType: string, actorUserId: string | null, societyId: string | null, deviceId: string | null, details: Record<string, unknown> = {}) {
  await env.DB.prepare(`INSERT INTO audit_events (id, occurred_at, actor_user_id, society_id, device_id, event_type, details_json) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), new Date().toISOString(), actorUserId, societyId, deviceId, eventType, JSON.stringify(details)).run();
}
