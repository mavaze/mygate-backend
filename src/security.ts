import { SignJWT, importPKCS8 } from "jose";
import type { Env } from "./env";
import { ApiError } from "./errors";
import type { LicenseCapability } from "./licensing";

export interface EntitlementPayload {
  schemaVersion: 1;

  societyId: string;
  userId: string;
  deviceId: string;

  /**
   * SHA-256 hash of the Android installation identifier.
   *
   * The installation ID itself is not secret. The hash binds the
   * entitlement cryptographically to the installation without placing
   * the raw installation identifier in the JWT.
   */
  installationHash: string;

  licenseId: string;
  licenseType: "PILOT" | "PRODUCTION";
  licenseStatus: "ACTIVE";

  planCode: string;

  capabilities: LicenseCapability[];

  /**
   * Actual D1 license expiration.
   * This is different from JWT exp, which is intentionally short-lived.
   */
  licenseExpiresAt: string;

  serverTime: string;
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function createInstallationHash(
  installationId: string
): Promise<string> {
  return sha256Hex(installationId);
}

export async function signEntitlement(
  payload: EntitlementPayload,
  env: Env
): Promise<string> {
  if (!env.ENTITLEMENT_SIGNING_PRIVATE_KEY) {
    throw new ApiError(
      500,
      "SIGNING_NOT_CONFIGURED",
      "Entitlement signing key is not configured"
    );
  }

  const licenseExpirySeconds = Math.floor(
    new Date(payload.licenseExpiresAt).getTime() / 1000
  );

  if (!Number.isFinite(licenseExpirySeconds)) {
    throw new ApiError(
      500,
      "INVALID_LICENSE_EXPIRY",
      "License expiry is invalid"
    );
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  if (licenseExpirySeconds <= nowSeconds) {
    throw new ApiError(
      403,
      "LICENSE_INACTIVE",
      "License has expired"
    );
  }

  const jwtExpirySeconds = Math.min(
    nowSeconds + 15 * 60,
    licenseExpirySeconds
  );

  const key = await importPKCS8(
    env.ENTITLEMENT_SIGNING_PRIVATE_KEY,
    "RS256"
  );

  return new SignJWT(
    payload as unknown as Record<string, unknown>
  )
    .setProtectedHeader({
      alg: "RS256",
      typ: "JWT",
      kid: env.ENTITLEMENT_SIGNING_KEY_ID
    })
    .setIssuedAt(nowSeconds)
    .setExpirationTime(jwtExpirySeconds)
    .sign(key);
}
