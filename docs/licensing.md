# My Gate licensing model

My Gate deliberately separates:

- **License type**: `PILOT` or `PRODUCTION`. This describes the commercial/lifecycle state and is not a feature tier.
- **License plan**: stable machine-readable `planCode` such as `CORE`. A plan is a reusable capability bundle.
- **Capabilities**: stable feature codes with optional JSON configuration.

A future commercial tier can therefore be introduced by creating a new plan and assigning capabilities. Android does not need a new hard-coded enum for every commercial tier.

## Initial capabilities

- `VISITORS`
- `RESIDENTS`
- `CALLING`
- `TASKS`
- `VISITOR_PHOTOS`
- `ADVANCED_REPORTING`
- `MULTI_CONSOLE`
- `WATCHMAN_AUTH`

`WATCHMAN_AUTH` uses configuration:

```json
{"mode":"LOCAL"}
```

or:

```json
{"mode":"CENTRAL"}
```

The initial `CORE` plan uses `LOCAL`.

## License assignment

A society has one current active license. Creating a new license suspends any existing active license for that society. The Admin Portal supports pilot licenses, production licenses, predefined reusable plans and custom plans.

## Entitlement

`GET /v1/entitlement` returns only the signed RS256 entitlement JWT in its response body. Commercial fields are not duplicated in unsigned JSON.

The JWT contains:

- schema version
- society ID
- Firebase/backend user ID
- device ID
- installation hash
- license ID
- license type/status
- plan code
- capabilities and configuration
- actual license expiry
- server time
- standard JWT `iat` and `exp`

JWT lifetime is at most 15 minutes and never extends beyond the actual license expiry.

## Platform administration

Platform-admin endpoints are protected by a global `platform_admins` role. The initial platform admin is bootstrapped manually in D1. Additional platform admins can be enabled/disabled later without changing the authorization model.

## Society administration

Each society has exactly one configured administrator Gmail address. The first verified Firebase login from that address is automatically associated with the society. A Gmail address cannot be associated with multiple societies.
