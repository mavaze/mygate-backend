import type { Env } from "./env";
import { ApiError } from "./errors";
import { audit, requireWatchmanCentralMode } from "./db";
import { createWatchmanSessionToken, hashPassword, hashSessionToken, verifyPassword } from "./security";

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new ApiError(400, "INVALID_REQUEST", `${field} is required`);
  return value.trim();
}

function normalizeUsername(value: unknown) {
  const username = requiredString(value, "username").toLowerCase();
  if (!/^[a-z0-9._-]{3,64}$/.test(username)) throw new ApiError(400, "INVALID_USERNAME", "username must be 3-64 characters using letters, numbers, dot, underscore or hyphen");
  return username;
}

function installationIdFrom(request: Request) {
  const value = request.headers.get("X-MyGate-Installation-Id")?.trim();
  if (!value || value.length < 16 || value.length > 128) throw new ApiError(400, "INSTALLATION_ID_REQUIRED", "A valid installation ID is required");
  return value;
}

export async function listWatchmen(env: Env, societyId: string) {
  await requireWatchmanCentralMode(env, societyId);
  const rows = await env.DB.prepare(`SELECT id, username, display_name displayName, status, auth_mode authMode, created_at createdAt, updated_at updatedAt FROM watchman_accounts WHERE society_id = ? AND status != 'DELETED' ORDER BY display_name, username`)
    .bind(societyId).all();
  return rows.results;
}

export async function createWatchman(env: Env, actorUserId: string, societyId: string, body: any) {
  await requireWatchmanCentralMode(env, societyId);
  const username = normalizeUsername(body.username);
  const displayName = requiredString(body.displayName, "displayName");
  const password = requiredString(body.password, "password");
  const existing = await env.DB.prepare("SELECT id FROM watchman_accounts WHERE society_id = ? AND username = ? AND status != 'DELETED'")
    .bind(societyId, username).first();
  if (existing) throw new ApiError(409, "WATCHMAN_EXISTS", "A watchman with this username already exists");
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  await env.DB.prepare(`INSERT INTO watchman_accounts (id, society_id, username, display_name, password_hash, status, auth_mode, credential_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'ACTIVE', 'CENTRAL', 1, ?, ?)`)
    .bind(id, societyId, username, displayName, passwordHash, now, now).run();
  await audit(env, "WATCHMAN_CREATED", actorUserId, societyId, null, { watchmanId: id, username });
  return { id, username, displayName, status: "ACTIVE", authMode: "CENTRAL", createdAt: now };
}

export async function updateWatchman(env: Env, actorUserId: string, societyId: string, watchmanId: string, body: any) {
  await requireWatchmanCentralMode(env, societyId);
  const existing = await env.DB.prepare("SELECT id, username FROM watchman_accounts WHERE id = ? AND society_id = ? AND status != 'DELETED'").bind(watchmanId, societyId).first<any>();
  if (!existing) throw new ApiError(404, "WATCHMAN_NOT_FOUND", "Watchman not found");
  const displayName = body.displayName === undefined ? undefined : requiredString(body.displayName, "displayName");
  const status = body.status === undefined ? undefined : body.status === "ACTIVE" || body.status === "DISABLED" ? body.status : undefined;
  if (body.status !== undefined && !status) throw new ApiError(400, "INVALID_STATUS", "status must be ACTIVE or DISABLED");
  if (displayName === undefined && status === undefined) throw new ApiError(400, "INVALID_REQUEST", "Nothing to update");
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE watchman_accounts SET display_name = COALESCE(?, display_name), status = COALESCE(?, status), credential_version = credential_version + CASE WHEN ? = 'DISABLED' THEN 1 ELSE 0 END, updated_at = ? WHERE id = ?")
    .bind(displayName ?? null, status ?? null, status ?? "", now, watchmanId).run();
  if (status === "DISABLED") await env.DB.prepare("UPDATE watchman_sessions SET revoked_at = ? WHERE watchman_id = ? AND revoked_at IS NULL").bind(now, watchmanId).run();
  await audit(env, "WATCHMAN_UPDATED", actorUserId, societyId, null, { watchmanId, status, displayName });
  return { id: watchmanId, username: existing.username, displayName, status };
}

export async function deleteWatchman(env: Env, actorUserId: string, societyId: string, watchmanId: string) {
  await requireWatchmanCentralMode(env, societyId);
  const existing = await env.DB.prepare("SELECT id, username FROM watchman_accounts WHERE id = ? AND society_id = ? AND status != 'DELETED'").bind(watchmanId, societyId).first<any>();
  if (!existing) throw new ApiError(404, "WATCHMAN_NOT_FOUND", "Watchman not found");
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE watchman_accounts SET status = 'DELETED', credential_version = credential_version + 1, updated_at = ? WHERE id = ?").bind(now, watchmanId).run();
  await env.DB.prepare("UPDATE watchman_sessions SET revoked_at = ? WHERE watchman_id = ? AND revoked_at IS NULL").bind(now, watchmanId).run();
  await audit(env, "WATCHMAN_DELETED", actorUserId, societyId, null, { watchmanId, username: existing.username });
  return { id: watchmanId, deleted: true };
}

export async function resetWatchmanPassword(env: Env, actorUserId: string, societyId: string, watchmanId: string, password: string) {
  await requireWatchmanCentralMode(env, societyId);
  const existing = await env.DB.prepare("SELECT id FROM watchman_accounts WHERE id = ? AND society_id = ? AND status != 'DELETED'").bind(watchmanId, societyId).first();
  if (!existing) throw new ApiError(404, "WATCHMAN_NOT_FOUND", "Watchman not found");
  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE watchman_accounts SET password_hash = ?, credential_version = credential_version + 1, updated_at = ? WHERE id = ?")
    .bind(passwordHash, now, watchmanId).run();
  await env.DB.prepare("UPDATE watchman_sessions SET revoked_at = ? WHERE watchman_id = ? AND revoked_at IS NULL").bind(now, watchmanId).run();
  await audit(env, "WATCHMAN_PASSWORD_RESET", actorUserId, societyId, null, { watchmanId });
  return { id: watchmanId, passwordReset: true };
}

export async function watchmanLogin(env: Env, societyId: string, usernameValue: unknown, passwordValue: unknown, request: Request) {
  await requireWatchmanCentralMode(env, societyId);
  const username = normalizeUsername(usernameValue);
  const password = requiredString(passwordValue, "password");
  const installationId = installationIdFrom(request);
  const device = await env.DB.prepare("SELECT id FROM devices WHERE society_id = ? AND installation_id = ? AND status = 'ACTIVE'").bind(societyId, installationId).first<any>();
  if (!device) throw new ApiError(403, "DEVICE_NOT_AUTHORIZED", "This installation is not registered for the society");
  const account = await env.DB.prepare("SELECT id, username, display_name displayName, password_hash, status FROM watchman_accounts WHERE society_id = ? AND username = ? AND status != 'DELETED'").bind(societyId, username).first<any>();
  if (!account || account.status !== "ACTIVE" || !account.password_hash || !(await verifyPassword(password, account.password_hash))) {
    throw new ApiError(401, "INVALID_WATCHMAN_CREDENTIALS", "Invalid watchman username or password");
  }
  const token = await createWatchmanSessionToken();
  const tokenHash = await hashSessionToken(token);
  const now = new Date();
  const expires = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  const sessionId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO watchman_sessions (id, watchman_id, token_hash, device_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(sessionId, account.id, tokenHash, device.id, expires.toISOString(), now.toISOString()).run();
  await audit(env, "WATCHMAN_LOGIN", null, societyId, device.id, { watchmanId: account.id });
  return { accessToken: token, tokenType: "Bearer", expiresAt: expires.toISOString(), watchman: { id: account.id, username: account.username, displayName: account.displayName } };
}

export async function authenticateWatchmanSession(env: Env, request: Request) {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) throw new ApiError(401, "WATCHMAN_AUTH_REQUIRED", "Watchman session token is required");
  const token = header.slice(7).trim();
  if (!token) throw new ApiError(401, "WATCHMAN_AUTH_REQUIRED", "Watchman session token is empty");
  const tokenHash = await hashSessionToken(token);
  const row = await env.DB.prepare(`SELECT ws.id sessionId, ws.watchman_id watchmanId, ws.device_id deviceId, ws.expires_at expiresAt, wa.society_id societyId, wa.username, wa.display_name displayName, wa.status watchmanStatus, d.status deviceStatus, s.status societyStatus FROM watchman_sessions ws JOIN watchman_accounts wa ON wa.id = ws.watchman_id JOIN devices d ON d.id = ws.device_id JOIN societies s ON s.id = wa.society_id WHERE ws.token_hash = ? LIMIT 1`).bind(tokenHash).first<any>();
  if (!row || row.revokedAt || row.watchmanStatus !== "ACTIVE" || row.deviceStatus !== "ACTIVE" || row.societyStatus !== "ACTIVE" || Date.parse(row.expiresAt) <= Date.now()) {
    throw new ApiError(401, "WATCHMAN_SESSION_INVALID", "Watchman session is invalid or expired");
  }
  await requireWatchmanCentralMode(env, row.societyId);
  return row;
}

export async function changeWatchmanPassword(env: Env, session: any, currentPassword: string, newPassword: string) {
  const account = await env.DB.prepare("SELECT id, password_hash, status FROM watchman_accounts WHERE id = ?").bind(session.watchmanId).first<any>();
  if (!account || account.status !== "ACTIVE" || !account.password_hash || !(await verifyPassword(currentPassword, account.password_hash))) {
    throw new ApiError(401, "INVALID_CURRENT_PASSWORD", "Current password is incorrect");
  }
  const passwordHash = await hashPassword(newPassword);
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE watchman_accounts SET password_hash = ?, credential_version = credential_version + 1, updated_at = ? WHERE id = ?")
    .bind(passwordHash, now, session.watchmanId).run();
  await env.DB.prepare("UPDATE watchman_sessions SET revoked_at = ? WHERE watchman_id = ? AND revoked_at IS NULL").bind(now, session.watchmanId).run();
  return { passwordChanged: true };
}

export async function logoutWatchman(env: Env, session: any) {
  await env.DB.prepare("UPDATE watchman_sessions SET revoked_at = ? WHERE id = ?").bind(new Date().toISOString(), session.sessionId).run();
  return { loggedOut: true };
}
