# Config And System Endpoints

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** done

## What to build

Implement the Effect-native configuration layer and system endpoints needed during migration. The health endpoint should already exist from the shell; this slice completes the config parsing, config validation, masked system config response, and `/api/system/config` behavior. Do not migrate metrics.

Config should use Effect Config and redacted values for secrets. The public config endpoint should expose only client-safe derived values such as auth availability flags.

## Acceptance criteria

- [x] Required runtime environment values are parsed through Effect config
- [x] Sensitive values are represented as redacted values internally
- [x] OIDC configuration completeness is validated consistently
- [x] `/api/system/config` returns direct typed client-safe config data
- [x] `/api/system/metrics` remains intentionally unimplemented or absent from the migrated route surface
- [x] Health and config E2E coverage can run through the Effect client where contract-valid

## Implementation notes

The old backend included `system` and `providers` top-level fields in the config response — masked dumps of the full `systemConfigDef` and `appConfigDef` trees. After auditing every consumer, no app-client or E2E code reads either field; the only consumer (`auth.tsx`) uses only `auth.*` flags. The PRD also scopes this endpoint to "client-safe derived values such as auth availability flags."

`system` and `providers` were therefore removed from `ConfigResponse` rather than carried forward as `Schema.Unknown` empty objects. `ConfigResponse` now contains only the `auth` block.

## User stories addressed

Reference by number from the parent PRD:

- User story 9
- User story 10
- User story 18
- User story 23
- User story 26
