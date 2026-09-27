# My Gate Backend

> Increment 01 package dependencies were updated on 24 Sep 2026 to use the currently published Cloudflare Workers Types 5.x line. The earlier 4.20260912.0 version does not exist in npm.

Cloudflare Worker + D1 control-plane backend for the My Gate Android application.

## Principles

- No DEV licensing bypass.
- Development uses normal `PILOT` licenses.
- Cloudflare D1 is authoritative for societies, memberships, devices and licenses.
- Firebase Authentication establishes user identity.
- The Android client never becomes the licensing authority.
- No custom domain is required initially; deploy through `workers.dev`.
- Operational Google Drive/Sheets/Contacts/Calendar data is not stored here.

## Prerequisites

- Node.js 20+
- npm
- Cloudflare account
- Wrangler CLI (installed by npm)
- Firebase project

## Local setup

```bash
npm install
cp .dev.vars.example .dev.vars
# edit .dev.vars
npm run db:migrate:local
npm run dev
```

Health endpoint:

```text
GET http://localhost:8787/v1/health
```

The authenticated endpoints require a Firebase ID token and a registered D1 user/membership/device.

## First Cloudflare deployment

1. Create a D1 database named `mygate-control`.
2. Put its database ID into `wrangler.jsonc`.
3. Set the Firebase project ID.
4. Store the entitlement signing private key as a Worker secret.
5. Apply migrations:
   `npm run db:migrate:remote`
6. Deploy:
   `npm run deploy`

## Security

Do not put private keys, Firebase service-account credentials, or Cloudflare API tokens in the Android app or Git.

This first increment verifies Firebase ID tokens using Google's public JWKS. Production App Check / Play Integrity verification is the next security increment.

## API

- `GET /v1/health`
- `GET /v1/me`
- `POST /v1/devices/register`
- `GET /v1/entitlement`
- `POST /v1/devices/heartbeat`

Required headers for device endpoints:

```text
Authorization: Bearer <Firebase ID token>
X-MyGate-Installation-Id: <random installation UUID>
X-MyGate-App-Version: <version>
```

## TypeScript runtime types

Run `npm run generate-types` before typechecking.


## Licensing

See `docs/licensing.md` for the plan/capability model and platform-admin endpoints.
