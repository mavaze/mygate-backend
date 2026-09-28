import type { Env } from "./env";
import { ApiError, jsonError } from "./errors";
import { verifyFirebaseIdToken } from "./firebase";
import { audit, getOrCreateUser, registerDevice, resolveContext, requireSocietyAdmin } from "./db";
import { signEntitlement, createInstallationHash } from "./security";
import { getActivePlanCapabilities } from "./licensing";
import {
  createLicense, createLicensePlan, createSociety, requirePlatformAdmin, setPlanCapability,
  removePlanCapability, updateLicensePlan, updateSociety, replaceLicense, setLicenseStatus,
  setPlatformAdminStatus
} from "./admin";
import {
  listWatchmen, createWatchman, updateWatchman, deleteWatchman, resetWatchmanPassword,
  watchmanLogin, authenticateWatchmanSession, changeWatchmanPassword, logoutWatchman
} from "./watchmen";

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function ok(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: jsonHeaders }); }
function requireInstallationId(request: Request): string {
  const value = request.headers.get("X-MyGate-Installation-Id")?.trim();
  if (!value || value.length < 16 || value.length > 128) throw new ApiError(400, "INSTALLATION_ID_REQUIRED", "A valid installation ID is required");
  return value;
}
async function parseBody(request: Request): Promise<any> { return await request.json().catch(() => ({})); }
async function authenticated(request: Request, env: Env) {
  const claims = await verifyFirebaseIdToken(request, env);
  const user = await getOrCreateUser(env, claims.sub!, typeof claims.email === "string" ? claims.email : undefined, typeof claims.name === "string" ? claims.name : undefined);
  return { claims, user };
}
function routeId(pathname: string, prefix: string) {
  return decodeURIComponent(pathname.slice(prefix.length));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
        "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type, X-MyGate-Installation-Id, X-MyGate-App-Version",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS"
      }});

      const url = new URL(request.url);
      if (!url.pathname.startsWith("/v1/")) return ok({ service: "mygate-control", status: "ok" });

      if (url.pathname === "/v1/health" && request.method === "GET") return ok({ status: "ok", serverTime: new Date().toISOString() });


      if (url.pathname === "/v1/watchmen/login" && request.method === "POST") {
        const body = await parseBody(request);
        const societyId = typeof body.societyId === "string" ? body.societyId.trim() : "";
        if (!societyId) throw new ApiError(400, "SOCIETY_REQUIRED", "societyId is required");
        return ok(await watchmanLogin(env, societyId, body.username, body.password, request));
      }

      if (url.pathname.startsWith("/v1/watchmen/session/") && request.method === "POST") {
        const action = url.pathname.slice("/v1/watchmen/session/".length);
        const session = await authenticateWatchmanSession(env, request);
        if (action === "logout") return ok(await logoutWatchman(env, session));
        if (action === "change-password") {
          const body = await parseBody(request);
          return ok(await changeWatchmanPassword(env, session, String(body.currentPassword ?? ""), String(body.newPassword ?? "")));
        }
      }

      const { user } = await authenticated(request, env);

      if (url.pathname === "/v1/me" && request.method === "GET") {
        const memberships = await env.DB.prepare(`SELECT su.society_id societyId, s.name societyName, s.admin_email adminEmail, su.role, l.id licenseId, l.license_type licenseType, l.status licenseStatus, l.plan_code planCode, l.expires_at expiresAt FROM society_users su JOIN societies s ON s.id = su.society_id LEFT JOIN licenses l ON l.society_id = s.id WHERE su.user_id = ? ORDER BY l.created_at DESC`).bind(user.id).all();
        const platformAdmin = await env.DB.prepare("SELECT status FROM platform_admins WHERE user_id = ?").bind(user.id).first<any>();
        return ok({ user: { id: user.id, firebaseUid: user.firebase_uid, email: user.email, displayName: user.display_name, status: user.status }, roles: { platformAdmin: platformAdmin?.status === "ACTIVE" }, memberships: memberships.results });
      }

      if (url.pathname === "/v1/devices/register" && request.method === "POST") {
        const installationId = requireInstallationId(request);
        const body = await parseBody(request);
        const societyId = typeof body.societyId === "string" ? body.societyId : "";
        const appVersion = request.headers.get("X-MyGate-App-Version");
        if (!societyId) throw new ApiError(400, "SOCIETY_REQUIRED", "societyId is required");
        await requireSocietyAdmin(env, user.id, societyId);
        const deviceId = await registerDevice(env, user.id, societyId, installationId, appVersion);
        await audit(env, "DEVICE_REGISTERED", user.id, societyId, deviceId, { installationId, appVersion });
        return ok({ deviceId, status: "ACTIVE" }, 201);
      }

      if (url.pathname === "/v1/entitlement" && request.method === "GET") {
        const installationId = requireInstallationId(request);
        const context = await resolveContext(env, user.id, installationId);
        const [installationHash, capabilities] = await Promise.all([createInstallationHash(installationId), getActivePlanCapabilities(env, context.planCode)]);
        const serverTime = new Date().toISOString();
        const entitlement = await signEntitlement({ schemaVersion: 1, societyId: context.societyId, userId: context.userId, deviceId: context.deviceId, installationHash, licenseId: context.licenseId, licenseType: context.licenseType, licenseStatus: "ACTIVE", planCode: context.planCode, capabilities, licenseExpiresAt: context.expiresAt, serverTime }, env);
        await env.DB.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").bind(serverTime, context.deviceId).run();
        return ok({ entitlement });
      }

      if (url.pathname === "/v1/devices/heartbeat" && request.method === "POST") {
        const installationId = requireInstallationId(request);
        const context = await resolveContext(env, user.id, installationId);
        const now = new Date().toISOString();
        await env.DB.prepare("UPDATE devices SET last_seen_at = ?, app_version = ? WHERE id = ?").bind(now, request.headers.get("X-MyGate-App-Version"), context.deviceId).run();
        return ok({ status: "ACTIVE", serverTime: now, expiresAt: context.expiresAt });
      }

      if (url.pathname === "/v1/society/me" && request.method === "GET") {
        const society = await requireSocietyAdmin(env, user.id);
        const license = await env.DB.prepare("SELECT id licenseId, license_type licenseType, status licenseStatus, plan_code planCode, starts_at startsAt, expires_at expiresAt, device_limit deviceLimit FROM licenses WHERE society_id = ? ORDER BY created_at DESC LIMIT 1").bind(society.societyId).first();
        const devices = await env.DB.prepare("SELECT id, installation_id installationId, platform, app_version appVersion, status, registered_at registeredAt, last_seen_at lastSeenAt FROM devices WHERE society_id = ? ORDER BY registered_at DESC").bind(society.societyId).all();
        const capabilities = license ? await getActivePlanCapabilities(env, String((license as any).planCode)) : [];
        return ok({ society, license, capabilities, devices: devices.results });
      }

      if (url.pathname === "/v1/society/watchmen" && request.method === "GET") {
        const society = await requireSocietyAdmin(env, user.id);
        return ok({ watchmen: await listWatchmen(env, society.societyId) });
      }
      if (url.pathname === "/v1/society/watchmen" && request.method === "POST") {
        const society = await requireSocietyAdmin(env, user.id);
        return ok(await createWatchman(env, user.id, society.societyId, await parseBody(request)), 201);
      }
      if (url.pathname.startsWith("/v1/society/watchmen/") && url.pathname.endsWith("/password") && request.method === "POST") {
        const society = await requireSocietyAdmin(env, user.id);
        const watchmanId = routeId(url.pathname, "/v1/society/watchmen/").replace(/\/password$/, "");
        const body = await parseBody(request);
        return ok(await resetWatchmanPassword(env, user.id, society.societyId, watchmanId, String(body.password ?? "")));
      }
      if (url.pathname.startsWith("/v1/society/watchmen/") && request.method === "PATCH") {
        const society = await requireSocietyAdmin(env, user.id);
        const watchmanId = routeId(url.pathname, "/v1/society/watchmen/");
        return ok(await updateWatchman(env, user.id, society.societyId, watchmanId, await parseBody(request)));
      }
      if (url.pathname.startsWith("/v1/society/watchmen/") && request.method === "DELETE") {
        const society = await requireSocietyAdmin(env, user.id);
        const watchmanId = routeId(url.pathname, "/v1/society/watchmen/");
        return ok(await deleteWatchman(env, user.id, society.societyId, watchmanId));
      }

      if (url.pathname === "/v1/admin/overview" && request.method === "GET") {
        await requirePlatformAdmin(env, user.id);
        const [societies, licenses, devices, activeLicenses] = await Promise.all([
          env.DB.prepare("SELECT COUNT(*) count FROM societies").first<any>(),
          env.DB.prepare("SELECT COUNT(*) count FROM licenses").first<any>(),
          env.DB.prepare("SELECT COUNT(*) count FROM devices WHERE status = 'ACTIVE'").first<any>(),
          env.DB.prepare("SELECT COUNT(*) count FROM licenses WHERE status = 'ACTIVE' AND starts_at <= ? AND expires_at > ?").bind(new Date().toISOString(), new Date().toISOString()).first<any>()
        ]);
        return ok({ societies: Number(societies?.count ?? 0), licenses: Number(licenses?.count ?? 0), activeLicenses: Number(activeLicenses?.count ?? 0), activeDevices: Number(devices?.count ?? 0) });
      }
      if (url.pathname === "/v1/admin/societies" && request.method === "GET") {
        await requirePlatformAdmin(env, user.id);
        const rows = await env.DB.prepare(`SELECT s.id, s.name, s.admin_email adminEmail, s.status, s.created_at createdAt, su.user_id adminUserId, l.id licenseId, l.license_type licenseType, l.status licenseStatus, l.plan_code planCode, l.starts_at startsAt, l.expires_at expiresAt, l.device_limit deviceLimit FROM societies s LEFT JOIN society_users su ON su.society_id = s.id AND su.role = 'SOCIETY_ADMIN' LEFT JOIN licenses l ON l.society_id = s.id AND l.id = (SELECT id FROM licenses lx WHERE lx.society_id = s.id ORDER BY lx.created_at DESC LIMIT 1) ORDER BY s.name`).all();
        return ok({ societies: rows.results });
      }
      if (url.pathname === "/v1/admin/societies" && request.method === "POST") {
        await requirePlatformAdmin(env, user.id);
        return ok(await createSociety(env, user.id, await parseBody(request)), 201);
      }
      if (url.pathname.startsWith("/v1/admin/societies/") && request.method === "PATCH") {
        await requirePlatformAdmin(env, user.id);
        return ok(await updateSociety(env, user.id, routeId(url.pathname, "/v1/admin/societies/"), await parseBody(request)));
      }
      if (url.pathname === "/v1/admin/licenses" && request.method === "GET") {
        await requirePlatformAdmin(env, user.id);
        const rows = await env.DB.prepare(`SELECT l.id, l.society_id societyId, s.name societyName, l.license_type licenseType, l.status, l.plan_code planCode, l.starts_at startsAt, l.expires_at expiresAt, l.device_limit deviceLimit, l.created_at createdAt FROM licenses l JOIN societies s ON s.id = l.society_id ORDER BY l.created_at DESC`).all();
        return ok({ licenses: rows.results });
      }
      if (url.pathname === "/v1/admin/licenses" && request.method === "POST") {
        await requirePlatformAdmin(env, user.id);
        return ok(await createLicense(env, user.id, await parseBody(request)), 201);
      }
      if (url.pathname.startsWith("/v1/admin/licenses/") && url.pathname.endsWith("/status") && request.method === "POST") {
        await requirePlatformAdmin(env, user.id);
        const licenseId = routeId(url.pathname, "/v1/admin/licenses/").replace(/\/status$/, "");
        const body = await parseBody(request);
        if (!["ACTIVE", "SUSPENDED", "EXPIRED"].includes(body.status)) throw new ApiError(400, "INVALID_STATUS", "status must be ACTIVE, SUSPENDED or EXPIRED");
        return ok(await setLicenseStatus(env, user.id, licenseId, body.status));
      }
      if (url.pathname.startsWith("/v1/admin/licenses/") && url.pathname.endsWith("/replace") && request.method === "POST") {
        await requirePlatformAdmin(env, user.id);
        const licenseId = routeId(url.pathname, "/v1/admin/licenses/").replace(/\/replace$/, "");
        const old = await env.DB.prepare("SELECT society_id FROM licenses WHERE id = ?").bind(licenseId).first<any>();
        if (!old) throw new ApiError(404, "LICENSE_NOT_FOUND", "License not found");
        return ok(await replaceLicense(env, user.id, old.society_id, await parseBody(request)), 201);
      }
      if (url.pathname === "/v1/admin/plans" && request.method === "GET") {
        await requirePlatformAdmin(env, user.id);
        const plans = await env.DB.prepare(`SELECT code, display_name displayName, description, status, created_at createdAt, updated_at updatedAt FROM license_plans ORDER BY code`).all();
        const result = [];
        for (const plan of plans.results as any[]) result.push({ ...plan, capabilities: (await getActivePlanCapabilities(env, plan.code)).filter((c) => c.code) });
        return ok({ plans: result });
      }
      if (url.pathname === "/v1/admin/plans" && request.method === "POST") {
        await requirePlatformAdmin(env, user.id);
        return ok(await createLicensePlan(env, user.id, await parseBody(request)), 201);
      }
      if (url.pathname.startsWith("/v1/admin/plans/") && url.pathname.endsWith("/capabilities") && request.method === "POST") {
        await requirePlatformAdmin(env, user.id);
        const planCode = decodeURIComponent(url.pathname.slice("/v1/admin/plans/".length, -"/capabilities".length)).toUpperCase();
        const body = await parseBody(request);
        const capabilityCode = typeof body.capabilityCode === "string" ? body.capabilityCode.trim().toUpperCase() : "";
        if (!capabilityCode) throw new ApiError(400, "INVALID_REQUEST", "capabilityCode is required");
        return ok(await setPlanCapability(env, user.id, planCode, capabilityCode, body.config ?? {}));
      }
      if (url.pathname.startsWith("/v1/admin/plans/") && url.pathname.endsWith("/capabilities") && request.method === "DELETE") {
        await requirePlatformAdmin(env, user.id);
        const planCode = decodeURIComponent(url.pathname.slice("/v1/admin/plans/".length, -"/capabilities".length)).toUpperCase();
        const capabilityCode = url.searchParams.get("capabilityCode")?.trim().toUpperCase();
        if (!capabilityCode) throw new ApiError(400, "INVALID_REQUEST", "capabilityCode query parameter is required");
        return ok(await removePlanCapability(env, user.id, planCode, capabilityCode));
      }
      if (url.pathname.startsWith("/v1/admin/plans/") && request.method === "PATCH") {
        await requirePlatformAdmin(env, user.id);
        return ok(await updateLicensePlan(env, user.id, decodeURIComponent(url.pathname.slice("/v1/admin/plans/".length)).toUpperCase(), await parseBody(request)));
      }
      if (url.pathname === "/v1/admin/capabilities" && request.method === "GET") {
        await requirePlatformAdmin(env, user.id);
        const capabilities = await env.DB.prepare(`SELECT code, display_name displayName, description, status, created_at createdAt, updated_at updatedAt FROM capabilities ORDER BY code`).all();
        return ok({ capabilities: capabilities.results });
      }
      if (url.pathname === "/v1/admin/platform-admins" && request.method === "GET") {
        await requirePlatformAdmin(env, user.id);
        const rows = await env.DB.prepare(`SELECT u.id userId, u.firebase_uid firebaseUid, u.email, u.display_name displayName, pa.status, pa.created_at createdAt FROM platform_admins pa JOIN users u ON u.id = pa.user_id ORDER BY u.email`).all();
        return ok({ platformAdmins: rows.results });
      }
      if (url.pathname.startsWith("/v1/admin/platform-admins/") && url.pathname.endsWith("/status") && request.method === "POST") {
        await requirePlatformAdmin(env, user.id);
        const targetUserId = routeId(url.pathname, "/v1/admin/platform-admins/").replace(/\/status$/, "");
        const body = await parseBody(request);
        if (body.status !== "ACTIVE" && body.status !== "DISABLED") throw new ApiError(400, "INVALID_STATUS", "status must be ACTIVE or DISABLED");
        return ok(await setPlatformAdminStatus(env, user.id, targetUserId, body.status));
      }

      throw new ApiError(404, "NOT_FOUND", "Endpoint not found");
    } catch (error) {
      return jsonError(error);
    }
  }
} satisfies ExportedHandler<Env>;
