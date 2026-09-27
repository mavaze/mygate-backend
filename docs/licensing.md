# My Gate licensing model

My Gate deliberately separates two concepts:

- **License type**: `PILOT` or `PRODUCTION`. This describes the commercial/lifecycle state of a license and is not a feature tier.
- **License plan**: an immutable internal `planCode` such as `CORE`, with a display name that can change. A plan is a bundle of capabilities.

A future commercial tier can therefore be introduced by adding a new plan row and assigning capabilities to it. The Android app and entitlement API do not need a new hard-coded enum for every future tier.

## Capabilities

Capabilities use stable machine-readable codes such as `VISITORS`, `TASKS`, and `ADVANCED_REPORTING`. Optional per-capability configuration is stored as JSON in `license_plan_capabilities.config_json`, allowing future limits without schema changes for every feature.

## Entitlement

`GET /v1/entitlement` returns:

- signed RS256 entitlement JWT
- server time
- license expiry
- license type
- plan code
- active capabilities and their configuration

The Worker remains authoritative. The Android client may use capabilities to hide/disable UI, but it must not treat local UI state as proof of entitlement.

## Platform administration foundation

Platform administrators can currently create:

- license plans: `POST /v1/admin/plans`
- plan capability assignments: `POST /v1/admin/plans/{planCode}/capabilities`
- societies: `POST /v1/admin/societies`
- licenses: `POST /v1/admin/licenses`

These endpoints require an existing `PLATFORM_ADMIN` membership. Initial platform-admin bootstrap remains an operational/D1 setup task until the private admin portal is implemented.

Additional read endpoints for the future admin portal:

- `GET /v1/admin/plans`
- `GET /v1/admin/capabilities`
