import { SignJWT, importPKCS8 } from "jose";
import type { Env } from "./env";
import type { LicenseCapability } from "./licensing";
import { ApiError } from "./errors";

export interface EntitlementPayload {
  schemaVersion: 1;
  societyId: string;
  userId: string;
  deviceId: string;
  installationHash: string;
  licenseId: string;
  licenseType: "PILOT" | "PRODUCTION";
  licenseStatus: "ACTIVE";
  planCode: string;
  capabilities: LicenseCapability[];
  licenseExpiresAt: string;
  serverTime: string;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createInstallationHash(installationId: string) { return sha256Hex(installationId); }

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8 || password.length > 128) throw new ApiError(400, "INVALID_PASSWORD", "Password must be 8 to 128 characters");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 120000 }, key, 256);
  return `pbkdf2_sha256$120000$${bytesToBase64Url(salt)}$${bytesToBase64Url(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 500000) return false;
  const salt = base64UrlToBytes(parts[2]);
  const expected = base64UrlToBytes(parts[3]);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, expected.length * 8);
  const actual = new Uint8Array(bits);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

export async function hashSessionToken(token: string) { return sha256Hex(token); }

export async function createWatchmanSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64Url(bytes);
}

export async function signEntitlement(payload: EntitlementPayload, env: Env): Promise<string> {
  if (!env.ENTITLEMENT_SIGNING_PRIVATE_KEY) throw new ApiError(500, "SIGNING_NOT_CONFIGURED", "Entitlement signing key is not configured");
  const licenseExpirySeconds = Math.floor(new Date(payload.licenseExpiresAt).getTime() / 1000);
  if (!Number.isFinite(licenseExpirySeconds)) throw new ApiError(500, "INVALID_LICENSE_EXPIRY", "License expiry is invalid");
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (licenseExpirySeconds <= nowSeconds) throw new ApiError(403, "LICENSE_INACTIVE", "License has expired");
  const jwtExpirySeconds = Math.min(nowSeconds + 15 * 60, licenseExpirySeconds);
  const key = await importPKCS8(env.ENTITLEMENT_SIGNING_PRIVATE_KEY, "RS256");
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: env.ENTITLEMENT_SIGNING_KEY_ID })
    .setIssuedAt(nowSeconds).setExpirationTime(jwtExpirySeconds).sign(key);
}
