# E2E Auth Recovery Coverage

**Parent Plan:** [God Mode Auth Recovery](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Add E2E coverage for the completed god-mode recovery behavior in the shared test suite. These tests should verify the feature from the outside through HTTP calls and Better Auth flows, not by importing implementation details. Use existing auth and OIDC test patterns as prior art.

The goal is to prove the migration recovery path works end-to-end: an admin can generate a reset link for an eligible user, the user can set a new Better Auth password, and the user can sign in. Also prove invalid auth states are rejected.

## Acceptance criteria

- [ ] E2E test rejects god-mode user listing without the correct admin bearer token
- [ ] E2E test rejects god-mode reset generation without the correct admin bearer token
- [ ] E2E test generates a reset link for an eligible no-account/password-migration-style user
- [ ] E2E test completes reset-password with the generated token and signs in with the new password
- [ ] E2E test verifies OIDC-only users cannot receive local password reset links
- [ ] E2E test verifies mixed auth users cannot receive local password reset links if mixed state can be seeded safely
- [ ] E2E assertions focus on observable behavior: HTTP status, response body, successful sign-in, and protected endpoint access

## User stories addressed

- User story 7
- User story 8
- User story 9
- User story 10
- User story 14
- User story 15
- User story 18
- User story 31
