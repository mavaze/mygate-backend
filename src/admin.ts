import type { Env } from "./env";
import { ApiError } from "./errors";
import { audit } from "./db";

export async function requirePlatformAdmin(env: Env, userId: string) {
  const row = await env.DB.prepare(`
    SELECT 1
    FROM society_users
    WHERE user_id = ? AND role = 'PLATFORM_ADMIN'
    LIMIT 1
  `).bind(userId).first();

  if (!row) {
    throw new ApiError(403, "PLATFORM_ADMIN_REQUIRED", "Platform administrator access is required");
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, "INVALID_REQUEST", `${field} is required`);
  }
  return value.trim();
}

export async function createLicensePlan(
  env: Env,
  actorUserId: string,
  body: any
) {
  const code = requiredString(body.code, "code").toUpperCase();
  const displayName = requiredString(body.displayName, "displayName");
  const description = typeof body.description === "string" ? body.description.trim() : null;
  const now = new Date().toISOString();

  try {
    await env.DB.prepare(`
      INSERT INTO license_plans (code, display_name, description, status, created_at, updated_at)
      VALUES (?, ?, ?, 'ACTIVE', ?, ?)
    `).bind(code, displayName, description, now, now).run();
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      throw new ApiError(409, "PLAN_EXISTS", "A license plan with this code already exists");
    }
    throw error;
  }

  await audit(env, "LICENSE_PLAN_CREATED", actorUserId, null, null, { code, displayName });
  return { code, displayName, description, status: "ACTIVE" };
}

export async function setPlanCapability(
  env: Env,
  actorUserId: string,
  planCode: string,
  capabilityCode: string,
  config: Record<string, unknown> = {}
) {
  const plan = await env.DB.prepare("SELECT code FROM license_plans WHERE code = ?").bind(planCode).first();
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "License plan not found");

  const capability = await env.DB.prepare("SELECT code FROM capabilities WHERE code = ? AND status = 'ACTIVE'").bind(capabilityCode).first();
  if (!capability) throw new ApiError(404, "CAPABILITY_NOT_FOUND", "Capability not found");

  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO license_plan_capabilities (plan_code, capability_code, config_json, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(plan_code, capability_code) DO UPDATE SET config_json = excluded.config_json
  `).bind(planCode, capabilityCode, JSON.stringify(config), now).run();

  await audit(env, "LICENSE_PLAN_CAPABILITY_CHANGED", actorUserId, null, null, {
    planCode,
    capabilityCode,
    config
  });

  return { planCode, capabilityCode, config };
}

export async function createSociety(
  env: Env,
  actorUserId: string,
  body: any
) {
  const name = requiredString(body.name, "name");
  const societyId = typeof body.id === "string" && body.id.trim()
    ? body.id.trim()
    : crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO societies (id, name, status, created_at)
    VALUES (?, ?, 'ACTIVE', ?)
  `).bind(societyId, name, now).run();

  await audit(env, "SOCIETY_CREATED", actorUserId, societyId, null, { name });
  return { id: societyId, name, status: "ACTIVE", createdAt: now };
}

export async function createLicense(
  env: Env,
  actorUserId: string,
  body: any
) {
  const societyId = requiredString(body.societyId, "societyId");
  const planCode = requiredString(body.planCode, "planCode").toUpperCase();
  const licenseType = body.licenseType;
  if (licenseType !== "PILOT" && licenseType !== "PRODUCTION") {
    throw new ApiError(400, "INVALID_LICENSE_TYPE", "licenseType must be PILOT or PRODUCTION");
  }
  const startsAt = requiredString(body.startsAt, "startsAt");
  const expiresAt = requiredString(body.expiresAt, "expiresAt");
  const deviceLimit = Number(body.deviceLimit ?? 1);
  if (!Number.isInteger(deviceLimit) || deviceLimit < 1) {
    throw new ApiError(400, "INVALID_DEVICE_LIMIT", "deviceLimit must be a positive integer");
  }
  if (!Number.isFinite(Date.parse(startsAt)) || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.parse(startsAt)) {
    throw new ApiError(400, "INVALID_LICENSE_DATES", "expiresAt must be after startsAt");
  }

  const [society, plan] = await Promise.all([
    env.DB.prepare("SELECT id FROM societies WHERE id = ?").bind(societyId).first(),
    env.DB.prepare("SELECT code FROM license_plans WHERE code = ? AND status = 'ACTIVE'").bind(planCode).first()
  ]);
  if (!society) throw new ApiError(404, "SOCIETY_NOT_FOUND", "Society not found");
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "Active license plan not found");

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO licenses
      (id, society_id, license_type, plan_code, status, starts_at, expires_at, device_limit, created_at)
    VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)
  `).bind(id, societyId, licenseType, planCode, startsAt, expiresAt, deviceLimit, now).run();

  await audit(env, "LICENSE_CREATED", actorUserId, societyId, null, {
    licenseId: id,
    licenseType,
    planCode,
    expiresAt,
    deviceLimit
  });

  return { id, societyId, licenseType, planCode, status: "ACTIVE", startsAt, expiresAt, deviceLimit };
}
