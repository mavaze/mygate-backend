# My Gate Backend

Cloudflare Worker + D1 control-plane backend for the My Gate Android application. The Admin Portal is added in the next project increment.

## Architecture constraints

- Cloudflare Free tier only.
- One Worker is used for the API; the next increment adds the lightweight Admin Portal to the same Worker.
- One D1 database (`mygate-control`).
- No custom domain required; use `workers.dev`.
- No Pages, KV, R2, Queues, Durable Objects or separate API gateway unless a future requirement justifies one.
- Operational society data (visitor images, society logo, contacts, visitor information, visits and tasks) remains in the society administrator's Google account.
- Firebase Authentication establishes Google/Firebase identity for Platform Admin and Society Admin.
- Watchmen are not Firebase users. Their authentication is controlled by the signed license capability `WATCHMAN_AUTH`: `LOCAL` or `CENTRAL`.

## Current model

- One society has exactly one Society Admin Gmail/Firebase identity.
- A Gmail address can belong to only one active society.
- Platform Admins are global. The first one is bootstrapped manually in D1; multiple admins are supported as an extension point.
- A society has one active commercial license at a time. Replacing a license suspends the previous active license.
- Plans are reusable capability bundles. Capabilities can carry JSON configuration.
- Android receives only a short-lived signed RS256 entitlement JWT as licensing proof.

## Local setup

```bash
npm install
cp .dev.vars.example .dev.vars
# edit the local values
npm run db:migrate:local
npm run dev
```

The Worker serves the portal at `/` and the API under `/v1/*`.

## Deployment

```bash
npm run db:migrate:remote
npm run deploy
```

Store the entitlement signing private key with Wrangler secret management. Never put it in Git or the web assets.

## First platform admin

1. Sign in once with the intended Google/Firebase account so `/v1/me` creates the user row.
2. Obtain the Firebase UID for that account.
3. Run the SQL pattern in `scripts/bootstrap-platform-admin.sql.example` against the remote D1 database.
4. Refresh the Admin Portal.

There is intentionally no "first user becomes admin" API behavior.

## API and Android contract

See `docs/api-contract.md` for the Android-facing contract, signed entitlement claims, installation binding and central watchman session APIs.

## Admin Portal

See `docs/admin-portal.md` for the resource model and `docs/cloudflare-setup.md` for Firebase web configuration.

## Security

The Worker is authoritative. A proxy/mock server can fabricate HTTP responses but cannot fabricate a valid entitlement signature without the Cloudflare-only RSA private key. This does not claim that a modified/repackaged APK is impossible; Play Integrity/App Check can be added later without changing the commercial data model.
