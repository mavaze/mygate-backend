import type { Env } from "./env";
import { ApiError } from "./errors";
import { audit } from "./db";

export async function requirePlatformAdmin(env: Env, userId: string) {
  const row = await env.DB.prepare(
    "SELECT 1 FROM platform_admins WHERE user_id = ? AND status = 'ACTIVE' LIMIT 1"
  ).bind(userId).first();
  if (!row) throw new ApiError(403, "PLATFORM_ADMIN_REQUIRED", "Platform administrator access is required");
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ApiError(400, "INVALID_REQUEST", `${field} is required`);
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseDate(value: unknown, field: string): string {
  const v = requiredString(value, field);
  if (!Number.isFinite(Date.parse(v))) throw new ApiError(400, "INVALID_REQUEST", `${field} must be a valid ISO date/time`);
  return new Date(v).toISOString();
}

function normalizeEmail(value: unknown, field = "email"): string {
  const email = requiredString(value, field).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "INVALID_EMAIL", `${field} must be a valid email address`);
  return email;
}

export async function createLicensePlan(env: Env, actorUserId: string, body: any) {
  const code = requiredString(body.code, "code").toUpperCase();
  if (!/^[A-Z0-9_]{2,64}$/.test(code)) throw new ApiError(400, "INVALID_PLAN_CODE", "code must contain only A-Z, 0-9 and underscore");
  const displayName = requiredString(body.displayName, "displayName");
  const description = optionalString(body.description);
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(`INSERT INTO license_plans (code, display_name, description, status, created_at, updated_at) VALUES (?, ?, ?, 'ACTIVE', ?, ?)`)
      .bind(code, displayName, description, now, now).run();
  } catch (error) {
    if (String(error).includes("UNIQUE")) throw new ApiError(409, "PLAN_EXISTS", "A license plan with this code already exists");
    throw error;
  }
  await audit(env, "LICENSE_PLAN_CREATED", actorUserId, null, null, { code, displayName });
  return { code, displayName, description, status: "ACTIVE" };
}

export async function updateLicensePlan(env: Env, actorUserId: string, code: string, body: any) {
  const displayName = requiredString(body.displayName, "displayName");
  const description = optionalString(body.description);
  const status = body.status === "RETIRED" ? "RETIRED" : body.status === "ACTIVE" ? "ACTIVE" : undefined;
  if (!status) throw new ApiError(400, "INVALID_STATUS", "status must be ACTIVE or RETIRED");
  const now = new Date().toISOString();
  const result = await env.DB.prepare("UPDATE license_plans SET display_name = ?, description = ?, status = ?, updated_at = ? WHERE code = ?")
    .bind(displayName, description, status, now, code).run();
  if (!result.meta.changes) throw new ApiError(404, "PLAN_NOT_FOUND", "License plan not found");
  await audit(env, "LICENSE_PLAN_UPDATED", actorUserId, null, null, { code, displayName, status });
  return { code, displayName, description, status };
}

export async function setPlanCapability(env: Env, actorUserId: string, planCode: string, capabilityCode: string, config: Record<string, unknown> = {}) {
  const plan = await env.DB.prepare("SELECT code FROM license_plans WHERE code = ?").bind(planCode).first();
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "License plan not found");
  const capability = await env.DB.prepare("SELECT code FROM capabilities WHERE code = ? AND status = 'ACTIVE'").bind(capabilityCode).first();
  if (!capability) throw new ApiError(404, "CAPABILITY_NOT_FOUND", "Capability not found");
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO license_plan_capabilities (plan_code, capability_code, config_json, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(plan_code, capability_code) DO UPDATE SET config_json = excluded.config_json`)
    .bind(planCode, capabilityCode, JSON.stringify(config ?? {}), now).run();
  await audit(env, "LICENSE_PLAN_CAPABILITY_CHANGED", actorUserId, null, null, { planCode, capabilityCode, config });
  return { planCode, capabilityCode, config: config ?? {} };
}

export async function removePlanCapability(env: Env, actorUserId: string, planCode: string, capabilityCode: string) {
  const result = await env.DB.prepare("DELETE FROM license_plan_capabilities WHERE plan_code = ? AND capability_code = ?")
    .bind(planCode, capabilityCode).run();
  if (!result.meta.changes) throw new ApiError(404, "PLAN_CAPABILITY_NOT_FOUND", "Capability is not assigned to this plan");
  await audit(env, "LICENSE_PLAN_CAPABILITY_REMOVED", actorUserId, null, null, { planCode, capabilityCode });
  return { planCode, capabilityCode, removed: true };
}

export async function createSociety(env: Env, actorUserId: string, body: any) {
  const name = requiredString(body.name, "name");
  const adminEmail = normalizeEmail(body.adminEmail, "adminEmail");
  const societyId = typeof body.id === "string" && body.id.trim() ? body.id.trim() : crypto.randomUUID();
  const now = new Date().toISOString();
  const existing = await env.DB.prepare("SELECT id FROM societies WHERE id = ?").bind(societyId).first();
  if (existing) throw new ApiError(409, "SOCIETY_EXISTS", "A society with this ID already exists");
  const emailUse = await env.DB.prepare("SELECT 1 FROM societies s WHERE lower(s.admin_email) = ? AND s.status != 'SUSPENDED' LIMIT 1").bind(adminEmail).first();
  if (emailUse) throw new ApiError(409, "SOCIETY_ADMIN_EMAIL_IN_USE", "That Gmail address is already assigned to a society");
  await env.DB.prepare("INSERT INTO societies (id, name, admin_email, status, created_at) VALUES (?, ?, ?, 'ACTIVE', ?)")
    .bind(societyId, name, adminEmail, now).run();
  await audit(env, "SOCIETY_CREATED", actorUserId, societyId, null, { name, adminEmail });
  return { id: societyId, name, adminEmail, status: "ACTIVE", createdAt: now };
}

export async function updateSociety(env: Env, actorUserId: string, societyId: string, body: any) {
  const existing = await env.DB.prepare("SELECT id, admin_email FROM societies WHERE id = ?").bind(societyId).first<any>();
  if (!existing) throw new ApiError(404, "SOCIETY_NOT_FOUND", "Society not found");
  const name = requiredString(body.name, "name");
  const adminEmail = normalizeEmail(body.adminEmail ?? existing.admin_email, "adminEmail");
  const status = body.status === "SUSPENDED" ? "SUSPENDED" : body.status === "ACTIVE" ? "ACTIVE" : undefined;
  if (!status) throw new ApiError(400, "INVALID_STATUS", "status must be ACTIVE or SUSPENDED");
  const collision = await env.DB.prepare("SELECT id FROM societies WHERE lower(admin_email) = ? AND id != ? LIMIT 1").bind(adminEmail, societyId).first();
  if (collision) throw new ApiError(409, "SOCIETY_ADMIN_EMAIL_IN_USE", "That Gmail address is already assigned to another society");
  const adminChanged = adminEmail !== String(existing.admin_email ?? '').toLowerCase();
  await env.DB.prepare("UPDATE societies SET name = ?, admin_email = ?, status = ? WHERE id = ?").bind(name, adminEmail, status, societyId).run();
  if (adminChanged) {
    await env.DB.prepare("DELETE FROM society_users WHERE society_id = ? AND role = 'SOCIETY_ADMIN'").bind(societyId).run();
  }
  await audit(env, "SOCIETY_UPDATED", actorUserId, societyId, null, { name, adminEmail, status, adminChanged });
  return { id: societyId, name, adminEmail, status };
}

export async function createLicense(env: Env, actorUserId: string, body: any) {
  const societyId = requiredString(body.societyId, "societyId");
  const planCode = requiredString(body.planCode, "planCode").toUpperCase();
  const licenseType = body.licenseType;
  if (licenseType !== "PILOT" && licenseType !== "PRODUCTION") throw new ApiError(400, "INVALID_LICENSE_TYPE", "licenseType must be PILOT or PRODUCTION");
  const startsAt = parseDate(body.startsAt, "startsAt");
  const expiresAt = parseDate(body.expiresAt, "expiresAt");
  if (Date.parse(expiresAt) <= Date.parse(startsAt)) throw new ApiError(400, "INVALID_LICENSE_DATES", "expiresAt must be after startsAt");
  const deviceLimit = Number(body.deviceLimit ?? 1);
  if (!Number.isInteger(deviceLimit) || deviceLimit < 1) throw new ApiError(400, "INVALID_DEVICE_LIMIT", "deviceLimit must be a positive integer");
  const [society, plan] = await Promise.all([
    env.DB.prepare("SELECT id FROM societies WHERE id = ?").bind(societyId).first(),
    env.DB.prepare("SELECT code FROM license_plans WHERE code = ? AND status = 'ACTIVE'").bind(planCode).first()
  ]);
  if (!society) throw new ApiError(404, "SOCIETY_NOT_FOUND", "Society not found");
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "Active license plan not found");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE licenses SET status = 'SUSPENDED' WHERE society_id = ? AND status = 'ACTIVE'").bind(societyId).run();
  await env.DB.prepare(`INSERT INTO licenses (id, society_id, license_type, plan_code, status, starts_at, expires_at, device_limit, created_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`)
    .bind(id, societyId, licenseType, planCode, startsAt, expiresAt, deviceLimit, now).run();
  await audit(env, "LICENSE_CREATED", actorUserId, societyId, null, { licenseId: id, licenseType, planCode, expiresAt, deviceLimit });
  return { id, societyId, licenseType, planCode, status: "ACTIVE", startsAt, expiresAt, deviceLimit };
}

export async function replaceLicense(env: Env, actorUserId: string, societyId: string, body: any) {
  await env.DB.prepare("UPDATE licenses SET status = 'SUSPENDED' WHERE society_id = ? AND status = 'ACTIVE'").bind(societyId).run();
  return createLicense(env, actorUserId, { ...body, societyId });
}

export async function setLicenseStatus(env: Env, actorUserId: string, licenseId: string, status: "ACTIVE" | "SUSPENDED" | "EXPIRED") {
  const license = await env.DB.prepare("SELECT id, society_id FROM licenses WHERE id = ?").bind(licenseId).first<any>();
  if (!license) throw new ApiError(404, "LICENSE_NOT_FOUND", "License not found");
  if (status === "ACTIVE") await env.DB.prepare("UPDATE licenses SET status = 'SUSPENDED' WHERE society_id = ? AND id != ? AND status = 'ACTIVE'").bind(license.society_id, licenseId).run();
  await env.DB.prepare("UPDATE licenses SET status = ? WHERE id = ?").bind(status, licenseId).run();
  await audit(env, "LICENSE_STATUS_CHANGED", actorUserId, license.society_id, null, { licenseId, status });
  return { licenseId, status };
}

export async function setPlatformAdminStatus(env: Env, actorUserId: string, targetUserId: string, status: "ACTIVE" | "DISABLED") {
  if (actorUserId === targetUserId && status === "DISABLED") throw new ApiError(400, "CANNOT_DISABLE_SELF", "You cannot disable your own platform admin account");
  const count = await env.DB.prepare("SELECT COUNT(*) count FROM platform_admins WHERE status = 'ACTIVE'").first<any>();
  if (status === "DISABLED" && Number(count?.count ?? 0) <= 1) throw new ApiError(409, "LAST_PLATFORM_ADMIN", "At least one active platform administrator is required");
  const result = await env.DB.prepare("UPDATE platform_admins SET status = ? WHERE user_id = ?").bind(status, targetUserId).run();
  if (!result.meta.changes) throw new ApiError(404, "PLATFORM_ADMIN_NOT_FOUND", "Platform administrator not found");
  await audit(env, "PLATFORM_ADMIN_STATUS_CHANGED", actorUserId, null, null, { targetUserId, status });
  return { userId: targetUserId, status };
}
