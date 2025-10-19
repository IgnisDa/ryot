# Config And System Endpoints

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Implement the Effect-native configuration layer and system endpoints needed during migration. The health endpoint should already exist from the shell; this slice completes the config parsing, config validation, masked system config response, and `/api/system/config` behavior. Do not migrate metrics.

Config should use Effect Config and redacted values for secrets. The public config endpoint should expose only client-safe derived values such as auth availability flags.

## Acceptance criteria

- [ ] Required runtime environment values are parsed through Effect config
- [ ] Sensitive values are represented as redacted values internally
- [ ] OIDC configuration completeness is validated consistently
- [ ] `/api/system/config` returns direct typed client-safe config data
- [ ] `/api/system/metrics` remains intentionally unimplemented or absent from the migrated route surface
- [ ] Health and config E2E coverage can run through the Effect client where contract-valid

## User stories addressed

Reference by number from the parent PRD:

- User story 9
- User story 10
- User story 18
- User story 23
- User story 26
