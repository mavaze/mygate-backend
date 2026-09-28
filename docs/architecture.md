# My Gate backend architecture

```text
                       Firebase Authentication
                                |
                         Google/Firebase ID token
                                |
                                v
                    +---------------------------+
                    | Cloudflare Worker         |
                    |                           |
 Admin Web -------->| /v1/admin/*               |
 Android ---------->| /v1/devices/*             |
 Society Admin ---->| /v1/society/*             |
 Watchman ----------> /v1/watchmen/* (central) |
                    |                           |
                    +-------------+-------------+
                                  |
                                  v
                            D1 mygate-control
```

The same Worker serves the lightweight static Admin Portal and the API. This deliberately minimizes Cloudflare resources and stays within the Free tier architecture.

## Identities

- Platform Admin: Firebase/Google identity; global role in `platform_admins`.
- Society Admin: exactly one Firebase/Google identity per society; role in `society_users`.
- Watchman: not a Firebase user. Authentication is either local to the console or central through D1, controlled by the signed `WATCHMAN_AUTH` capability.

## Commercial authorization

There is no DEV licensing bypass. A development phone uses a normal `PILOT` license. A customer uses `PILOT` or `PRODUCTION` according to the commercial agreement.

A society has one active license. A license references a reusable plan. A plan references capabilities with optional JSON configuration. The capability set is copied into the signed entitlement JWT.

## Security model

The Worker is authoritative. A mock/proxy server cannot fabricate a valid signed entitlement because the RSA signing private key is held only by Cloudflare.

Android must verify the entitlement signature, `kid`, `alg`, `exp`, installation hash and license expiry before using commercial fields.

This does not claim to make a modified/repacked APK impossible. App Check and Play Integrity can be added later as additional controls.

## Data boundary

Control plane:

- societies
- platform admins
- society-admin identities
- licenses
- plans
- capabilities
- devices
- central watchman accounts/sessions when enabled
- audit

Data plane:

- visitors
- residents
- contacts
- tasks
- visitor photos
- society logo
- operational spreadsheets/calendars

The data plane remains in Google services according to the application's existing architecture.
