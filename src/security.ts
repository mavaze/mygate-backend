import { SignJWT, importPKCS8 } from "jose";
import type { Env } from "./env";
import { ApiError } from "./errors";

export interface EntitlementPayload {
  schemaVersion: 1;
  societyId: string;
  userId: string;
  deviceId: string;
  licenseType: "PILOT" | "PRODUCTION";
  licenseStatus: "ACTIVE";
  expiresAt: string;
  serverTime: string;
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

  const key = await importPKCS8(env.ENTITLEMENT_SIGNING_PRIVATE_KEY, "RS256");
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({
      alg: "RS256",
      typ: "JWT",
      kid: env.ENTITLEMENT_SIGNING_KEY_ID
    })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(key);
}
