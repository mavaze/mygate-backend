# My Gate API contract for Android

Base URL is the deployed Cloudflare Worker `workers.dev` URL. All timestamps are ISO-8601 UTC strings. JSON field names below are contract names.

## Firebase-authenticated requests

Use:

```text
Authorization: Bearer <Firebase ID token>
```

Android device requests additionally use:

```text
X-MyGate-Installation-Id: <stable per-installation random identifier>
X-MyGate-App-Version: <version name>
```

## `GET /v1/me`

Returns the authenticated Firebase user, whether it is a platform admin, and society-admin memberships.

```json
{
  "user": { "id": "...", "firebaseUid": "...", "email": "...", "displayName": "...", "status": "ACTIVE" },
  "roles": { "platformAdmin": false },
  "memberships": [
    {
      "societyId": "...",
      "societyName": "...",
      "adminEmail": "...",
      "role": "SOCIETY_ADMIN",
      "licenseId": "...",
      "licenseType": "PILOT",
      "licenseStatus": "ACTIVE",
      "planCode": "CORE",
      "expiresAt": "..."
    }
  ]
}
```

A society has exactly one Society Admin and exactly one configured Gmail/Firebase identity.

## `POST /v1/devices/register`

Request:

```json
{ "societyId": "..." }
```

Requires the caller to be that society's `SOCIETY_ADMIN`. A registered installation cannot be reassigned to another Firebase user.

Response `201`:

```json
{ "deviceId": "...", "status": "ACTIVE" }
```

## `GET /v1/entitlement`

Requires Firebase authentication and a registered installation.

Response:

```json
{ "entitlement": "<RS256 JWT>" }
```

Android must verify the JWT locally using the pinned My Gate RSA public key. It must not trust unsigned fields for licensing.

JWT protected header:

```json
{ "alg": "RS256", "typ": "JWT", "kid": "mygate-entitlement-v1" }
```

Signed claims include:

```json
{
  "schemaVersion": 1,
  "societyId": "...",
  "userId": "...",
  "deviceId": "...",
  "installationHash": "SHA-256 hex of X-MyGate-Installation-Id",
  "licenseId": "...",
  "licenseType": "PILOT | PRODUCTION",
  "licenseStatus": "ACTIVE",
  "planCode": "...",
  "capabilities": [
    { "code": "WATCHMAN_AUTH", "displayName": "Watchman authentication", "description": "...", "config": { "mode": "LOCAL" } }
  ],
  "licenseExpiresAt": "...",
  "serverTime": "...",
  "iat": 0,
  "exp": 0
}
```

`exp` is at most 15 minutes from issuance and never later than `licenseExpiresAt`.

Android must verify:

1. JWT signature with the My Gate public RSA key.
2. `alg == RS256`.
3. `kid == mygate-entitlement-v1` (or a future explicitly pinned rotated key).
4. `exp` and normal JWT time validity.
5. `installationHash` equals SHA-256 of the local installation ID.
6. `licenseStatus == ACTIVE`.
7. `licenseExpiresAt` has not passed.
8. `societyId`/`deviceId` match the local registered context.
9. Capabilities are read only from the verified signed JWT.

A proxy/mock server returning HTTP 200 with fabricated JSON is therefore not sufficient to create a valid entitlement.

## `POST /v1/devices/heartbeat`

Requires Firebase authentication and the registered installation.

Response:

```json
{ "status": "ACTIVE", "serverTime": "...", "expiresAt": "..." }
```

This is a lightweight device last-seen update. It is not a licensing authority; the signed entitlement is the authoritative client-side license proof.

## Society Admin endpoints

`GET /v1/society/me` returns the society, current license, verified capabilities and registered devices.

When `WATCHMAN_AUTH` is configured as `CENTRAL`:

- `GET /v1/society/watchmen`
- `POST /v1/society/watchmen`
- `PATCH /v1/society/watchmen/{watchmanId}`
- `DELETE /v1/society/watchmen/{watchmanId}`
- `POST /v1/society/watchmen/{watchmanId}/password`

All require Firebase authentication as the single Society Admin. The backend rejects these operations when the society's signed commercial plan is `LOCAL` watchman authentication.

## Central watchman authentication

`POST /v1/watchmen/login` is not a Firebase endpoint. Request:

```json
{ "societyId": "...", "username": "watchman1", "password": "..." }
```

It also requires `X-MyGate-Installation-Id` and the installation must be a registered active device of that society.

Response:

```json
{
  "accessToken": "<opaque random session token>",
  "tokenType": "Bearer",
  "expiresAt": "...",
  "watchman": { "id": "...", "username": "watchman1", "displayName": "..." }
}
```

Central watchman password changes use:

`POST /v1/watchmen/session/change-password`

with `Authorization: Bearer <watchman session token>` and:

```json
{ "currentPassword": "...", "newPassword": "..." }
```

Logout uses `POST /v1/watchmen/session/logout`.

Sessions are 12 hours, server-stored by token hash, and revoked on password reset, disable or delete.

## Admin Portal API surface

Platform-admin-only endpoints include:

- `GET /v1/admin/overview`
- `GET/POST /v1/admin/societies`
- `PATCH /v1/admin/societies/{societyId}`
- `GET/POST /v1/admin/licenses`
- `POST /v1/admin/licenses/{licenseId}/status`
- `POST /v1/admin/licenses/{licenseId}/replace`
- `GET/POST/PATCH /v1/admin/plans`
- `POST/DELETE /v1/admin/plans/{planCode}/capabilities`
- `GET /v1/admin/capabilities`
- `GET /v1/admin/platform-admins`
- `POST /v1/admin/platform-admins/{userId}/status`

The web UI is served from the same Worker as static assets. The API remains Internet-reachable; authorization is based on Firebase identity and D1 roles, not on browser origin.
