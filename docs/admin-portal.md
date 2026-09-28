# My Gate Admin Portal

The Admin Portal is an internal platform-operations console. It is public only in the networking sense: it is served from the same Cloudflare Worker `workers.dev` endpoint, but every administrative API requires Firebase authentication plus `PLATFORM_ADMIN` authorization.

## Resource model

- One Cloudflare Worker serves the API and static web assets.
- One D1 database is the commercial control plane.
- No custom domain is required.
- No Cloudflare Pages, KV, R2, Queues, Durable Objects or separate API gateway is required.
- Operational society data remains in the society administrator's Google account.

## Society identity

A society has exactly one configured administrator Gmail/Firebase identity. When that verified Firebase user first authenticates, the backend automatically creates the single `SOCIETY_ADMIN` membership for the matching society. A Gmail address cannot be assigned to two active societies.

## Platform administration

Platform admins are global, not society memberships. The first platform admin is inserted manually into D1 after the Firebase identity exists. Additional platform-admin support is implemented as an extension point, but there is no invitation workflow requirement for the initial deployment.

## Licensing

A license has:

- `licenseType`: `PILOT` or `PRODUCTION`
- `planCode`: reusable plan selected by the platform admin
- validity window
- device limit
- status

A society has one current active license. Creating/replacing a license suspends the previous active license.

A plan is a reusable capability bundle. Capabilities can carry JSON configuration. The `WATCHMAN_AUTH` capability controls watchman authentication mode:

```json
{"mode":"LOCAL"}
```

or

```json
{"mode":"CENTRAL"}
```

The capability set is included in the signed entitlement JWT, so Android never relies on unsigned licensing JSON.

## Watchmen

Watchmen are not Firebase users. In `LOCAL` mode their authentication is local to the My Gate console and does not require a cloud login. In `CENTRAL` mode, the Society Admin manages watchman accounts through the My Gate app and the backend stores only salted PBKDF2 password hashes. Login creates a 12-hour opaque session token stored server-side as a SHA-256 hash and bound to the registered device. Password reset, disable and delete revoke active sessions.

Central watchman authentication is intentionally capability-controlled so the deployment can choose local authentication initially and enable central authentication only for plans/societies that need it.
