# Legacy Auth State Migration

**Parent Plan:** [God Mode Auth Recovery](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Update the legacy bootstrap user migration so V1 auth state is migrated according to the parent PRD: password-backed users become V2 users with no credential account, OIDC-backed users get minimal Better Auth OIDC account stubs, and corrupt auth states fail loudly before legacy tables are dropped.

This task is migration-focused. Do not introduce a legacy password verifier. Do not migrate V1 password hashes. Do not require OIDC runtime configuration during migration. Do update the legacy bootstrap module notes so a future agent can understand why password users must use god-mode reset links while OIDC users keep OIDC sign-in.

## Acceptance criteria

- [ ] Legacy users with both a non-empty password and a non-empty OIDC subject abort migration with a clear error
- [ ] Legacy users with neither a non-empty password nor a non-empty OIDC subject abort migration with a clear error
- [ ] Legacy OIDC users with invalid email-style names abort migration with a clear error
- [ ] Legacy password users do not receive Better Auth credential account rows during migration
- [ ] Legacy OIDC users receive restart-safe minimal Better Auth account stubs with provider `oidc`, account ID equal to the legacy OIDC subject, and null token/password fields
- [ ] Migration verifies every legacy OIDC user has a matching account stub before old tables can be dropped
- [ ] Migration verifies password users did not receive credential accounts before old tables can be dropped
- [ ] Legacy bootstrap documentation describes password reset-only recovery, OIDC account stub migration, and the intentionally non-migrated auth data

## User stories addressed

- User story 17
- User story 21
- User story 22
- User story 23
- User story 24
- User story 25
- User story 26
- User story 28
