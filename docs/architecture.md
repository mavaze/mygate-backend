# My Gate backend architecture

```text
                    Firebase Authentication
                              |
                              | Firebase ID token
                              v
My Gate Android ---> Cloudflare Worker ---> D1
       |                   |
       |                   +-- identity
       |                   +-- membership
       |                   +-- device authorization
       |                   +-- license entitlement
       |                   +-- audit
       |
       +---- Google Drive / Sheets / Contacts / Calendar
```

## Commercial authorization

There is no DEV license and no debug bypass.

A development phone uses a normal PILOT license. A customer uses PILOT or PRODUCTION according to the commercial agreement.

## Security model

The Worker is authoritative. The Android client is not.

A mock server cannot fabricate a valid signed entitlement because the signing private key is held only by Cloudflare.

This does not claim to make a modified/repacked APK impossible to create. Production App Check + Play Integrity and Play distribution are additional controls against that threat.

## Data boundary

Control plane:

- societies
- licenses
- users
- memberships
- devices
- audit
- app release policy

Data plane:

- visitors
- residents
- contacts
- tasks
- visitor photos
- operational spreadsheets/calendars

The data plane remains in Google services according to the application's existing architecture.
