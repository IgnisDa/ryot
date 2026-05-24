# E2E Auth Recovery Coverage

**Parent Plan:** [God Mode Auth Recovery](./README.md)

**Type:** AFK

**Status:** done

## What to build

Add E2E coverage for the completed god-mode recovery behavior in the shared test suite. These tests should verify the feature from the outside through HTTP calls and Better Auth flows, not by importing implementation details. Use existing auth and OIDC test patterns as prior art.

The goal is to prove the migration recovery path works end-to-end: an admin can generate a reset link for an eligible user, the user can set a new Better Auth password, and the user can sign in. Also prove invalid auth states are rejected.

## Acceptance criteria

- [x] E2E test rejects god-mode user listing without the correct admin bearer token
- [x] E2E test rejects god-mode reset generation without the correct admin bearer token
- [x] E2E test generates a reset link for an eligible credential user (Better Auth requires an existing credential account to request a password reset; `none`-state users receive a documented 500 from the reset endpoint)
- [x] E2E test completes reset-password with the generated token and signs in with the new password
- [x] E2E test verifies OIDC-only users cannot receive local password reset links
- [x] E2E test verifies mixed auth users cannot receive local password reset links
- [x] E2E assertions focus on observable behavior: HTTP status, response body, successful sign-in, and protected endpoint access

## User stories addressed

- User story 7
- User story 8
- User story 9
- User story 10
- User story 14
- User story 15
- User story 18
- User story 31

## Implementation Notes

Test file: `tests/src/tests/auth-god-mode-recovery.test.ts` (13 tests, all passing). Uses the global test infrastructure from `setup.ts` with `SERVER_ADMIN_ACCESS_TOKEN=test-admin-token`. Tests cover admin token enforcement (401), user listing classification for all four auth states, full reset-password flow for credential users (reset link → password update → sign-in → protected endpoint access), session revocation after password reset, OIDC user reset rejection (400), mixed auth user reset rejection (400), and the documented limitation that Better Auth returns 500 for `none`-state users (no credential account to initiate reset). Uses direct SQL inserts to seed `none` and `oidc` state users; uses `createTestUser()` fixture for credential users.
