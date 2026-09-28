# Cloudflare setup

## D1

Create:

```text
mygate-control
```

Copy its database ID into `wrangler.jsonc`.

Apply:

```bash
npm run db:migrate:remote
```

## Worker

The first deployment uses:

```text
https://<worker-name>.<account>.workers.dev
```

No domain purchase is required.

## Secret: entitlement signing key

Generate an RSA PKCS#8 private key locally. Do not commit it.

Example using OpenSSL:

```bash
openssl genrsa 3072 > entitlement-private.pem
openssl pkcs8 -topk8 -nocrypt -in entitlement-private.pem -out entitlement-private-pkcs8.pem
```

Set it as a Cloudflare Worker secret:

```bash
npx wrangler secret put ENTITLEMENT_SIGNING_PRIVATE_KEY
```

The public key will eventually be embedded in the Android application for offline verification of signed entitlements.

## Future custom domain

When a domain is purchased, attach the Worker to an API hostname. The application should receive the API base URL from build/runtime configuration so the hostname can change without changing the licensing model.

## Admin Portal web authentication

The Admin Portal is served by the same Worker as `/v1/*`. It uses the Firebase Web SDK from the browser and Google sign-in. Add these public Firebase web-app configuration variables to Wrangler/`.dev.vars`:

- `FIREBASE_WEB_API_KEY`
- `FIREBASE_WEB_APP_ID`
- `FIREBASE_WEB_MESSAGING_SENDER_ID`
- `FIREBASE_WEB_AUTH_DOMAIN`

These are Firebase client configuration values, not secrets. The entitlement signing private key remains a Worker secret and is never sent to the browser.

Add the deployed `workers.dev` hostname to Firebase Authentication's authorized domains. The first platform administrator must then be bootstrapped in D1 using `scripts/bootstrap-platform-admin.sql.example`.
