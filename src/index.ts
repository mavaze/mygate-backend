import type { Env } from "./env";
import { ApiError, jsonError } from "./errors";
import { verifyFirebaseIdToken } from "./firebase";
import { audit, getOrCreateUser, registerDevice, resolveContext } from "./db";
import { signEntitlement } from "./security";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function requireInstallationId(request: Request): string {
  const value = request.headers.get("X-MyGate-Installation-Id")?.trim();
  if (!value || value.length < 16 || value.length > 128) {
    throw new ApiError(400, "INSTALLATION_ID_REQUIRED", "A valid installation ID is required");
  }
  return value;
}

async function authenticated(
  request: Request,
  env: Env
) {
  const claims = await verifyFirebaseIdToken(request, env);
  const user = await getOrCreateUser(
    env,
    claims.sub!,
    typeof claims.email === "string" ? claims.email : undefined,
    typeof claims.name === "string" ? claims.name : undefined
  );
  return { claims, user };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Authorization, Content-Type, X-MyGate-Installation-Id, X-MyGate-App-Version",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
          }
        });
      }

      const url = new URL(request.url);
      if (!url.pathname.startsWith("/v1/")) {
        return ok({ service: "mygate-control", status: "ok" });
      }

      if (url.pathname === "/v1/health" && request.method === "GET") {
        return ok({ status: "ok", serverTime: new Date().toISOString() });
      }

      const { user } = await authenticated(request, env);

      if (url.pathname === "/v1/me" && request.method === "GET") {
        const memberships = await env.DB.prepare(`
          SELECT su.society_id societyId, s.name societyName, su.role,
                 l.license_type licenseType, l.status licenseStatus, l.expires_at expiresAt
          FROM society_users su
          JOIN societies s ON s.id = su.society_id
          LEFT JOIN licenses l ON l.society_id = s.id
          WHERE su.user_id = ?
          ORDER BY l.created_at DESC
        `).bind(user.id).all();

        return ok({
          user: {
            id: user.id,
            firebaseUid: user.firebase_uid,
            email: user.email,
            displayName: user.display_name,
            status: user.status
          },
          memberships: memberships.results
        });
      }

      if (url.pathname === "/v1/devices/register" && request.method === "POST") {
        const installationId = requireInstallationId(request);
        const body = await request.json().catch(() => ({})) as any;
        const societyId = typeof body.societyId === "string" ? body.societyId : "";
        const appVersion = request.headers.get("X-MyGate-App-Version");

        if (!societyId) {
          throw new ApiError(400, "SOCIETY_REQUIRED", "societyId is required");
        }

        const membership = await env.DB.prepare(
          "SELECT role FROM society_users WHERE society_id = ? AND user_id = ?"
        ).bind(societyId, user.id).first<any>();

        if (!membership) {
          throw new ApiError(403, "SOCIETY_ACCESS_DENIED", "User is not a member of this society");
        }

        const deviceId = await registerDevice(
          env,
          user.id,
          societyId,
          installationId,
          appVersion
        );

        await audit(env, "DEVICE_REGISTERED", user.id, societyId, deviceId, {
          installationId,
          appVersion
        });

        return ok({ deviceId, status: "ACTIVE" }, 201);
      }

      if (url.pathname === "/v1/entitlement" && request.method === "GET") {
        const installationId = requireInstallationId(request);
        const context = await resolveContext(env, user.id, installationId);

        const serverTime = new Date().toISOString();
        const entitlement = await signEntitlement({
          schemaVersion: 1,
          societyId: context.societyId,
          userId: context.userId,
          deviceId: context.deviceId,
          licenseType: context.licenseType,
          licenseStatus: "ACTIVE",
          expiresAt: context.expiresAt,
          serverTime
        }, env);

        await env.DB.prepare(
          "UPDATE devices SET last_seen_at = ? WHERE id = ?"
        ).bind(serverTime, context.deviceId).run();

        return ok({
          entitlement,
          serverTime,
          expiresAt: context.expiresAt
        });
      }

      if (url.pathname === "/v1/devices/heartbeat" && request.method === "POST") {
        const installationId = requireInstallationId(request);
        const context = await resolveContext(env, user.id, installationId);
        const now = new Date().toISOString();

        await env.DB.prepare(
          "UPDATE devices SET last_seen_at = ?, app_version = ? WHERE id = ?"
        ).bind(now, request.headers.get("X-MyGate-App-Version"), context.deviceId).run();

        return ok({ status: "ACTIVE", serverTime: now, expiresAt: context.expiresAt });
      }

      throw new ApiError(404, "NOT_FOUND", "Endpoint not found");
    } catch (error) {
      return jsonError(error);
    }
  }
} satisfies ExportedHandler<Env>;
