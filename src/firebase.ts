import { jwtVerify, createRemoteJWKSet, type JWTPayload } from "jose";
import { ApiError } from "./errors";
import type { Env } from "./env";

interface FirebaseClaims extends JWTPayload {
  user_id?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

export async function verifyFirebaseIdToken(
  request: Request,
  env: Env
): Promise<FirebaseClaims> {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new ApiError(401, "AUTH_REQUIRED", "Firebase ID token is required");
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) throw new ApiError(401, "AUTH_REQUIRED", "Bearer token is empty");

  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId || projectId.startsWith("REPLACE_")) {
    throw new ApiError(500, "SERVER_AUTH_NOT_CONFIGURED", "Firebase project is not configured");
  }

  const jwks = createRemoteJWKSet(
    new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
  );

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId
    });
    const claims = payload as FirebaseClaims;
    if (!claims.sub) throw new Error("Missing subject");
    return claims;
  } catch {
    throw new ApiError(401, "INVALID_AUTH_TOKEN", "Invalid Firebase ID token");
  }
}
