# OIDC Idempotency and Account Linking

**Parent Plan:** [OIDC Integration Tests](./README.md)

**Type:** AFK

**Status:** done

## What to build

Add two tests to `tests/src/tests/auth-oidc.test.ts` against **Backend A** (OIDC enabled, local auth on, registration on). These tests verify that Better Auth's account linking and OIDC idempotency behavior work correctly.

This task depends on task 03 (infrastructure + `oidcSignIn` helper). Task 04 is independent.

### Test 1 — Repeated OIDC sign-in with same identity reuses the same user

Verifies that a second OIDC sign-in with the same `username` does not create a duplicate `user` row.

Steps:
1. Generate a unique `username` (e.g., `user-{crypto.randomUUID()}`)
2. Call `oidcSignIn(username, ...)` → session cookie 1
3. Call `oidcSignIn(username, ...)` again → session cookie 2
4. Resolve the user from the `user` table: `SELECT id FROM "user" WHERE email = '{username}@localhost'`
5. Assert exactly **one** row exists (not two)
6. Assert both session cookies are valid (make authenticated requests with each; expect 200)

This confirms Better Auth's `genericOAuth` plugin resolves a returning OIDC user to the existing account rather than creating a new one.

**Additional bootstrap idempotency check:** After the second sign-in, query `SELECT count(*) FROM tracker WHERE user_id = $userId`. Assert the count equals the expected number from the first sign-in (not double). This verifies the idempotency guard in `bootstrapNewUser` prevents duplicate data.

### Test 2 — OIDC sign-in with same email as existing local user links accounts

Verifies account linking: an OIDC user whose `email` claim matches a pre-existing email/password account is linked to that account, not given a new one.

The mock server derives `email` from the username as `{username}@localhost`. To trigger account linking, create the local user with an email in that format.

Steps:
1. Generate a unique `username` (e.g., `user-{crypto.randomUUID()}`)
2. The target email is `{username}@localhost`
3. Sign up a local email/password user with that email via `POST {backendAUrl}/authentication/email` with `{ email: '{username}@localhost', name: 'Test', password: 'password123' }`. This creates the local user and runs bootstrap.
4. Record the local user's ID: `SELECT id FROM "user" WHERE email = '{username}@localhost'`
5. Call `oidcSignIn(username, backendAUrl, oidcBaseUrl)` — the mock server's userinfo will return `email: '{username}@localhost'`
6. After the OIDC flow, query `SELECT id FROM "user" WHERE email = '{username}@localhost'` again
7. Assert still exactly **one** user row (no duplicate)
8. Assert the user ID is the same as the one recorded in step 4

This confirms Better Auth's `account.accountLinking` configuration (with `trustedProviders: ["email-password", OIDC_PROVIDER_ID]`) correctly merges the OIDC identity with the existing local account.

### Why this is harder than task 04

Account linking relies on Better Auth comparing the OIDC `email` claim against existing `user` rows and the `account` table. If account linking were broken, step 7 would return two rows. The setup requires coordinating an email sign-up and an OIDC sign-in on a shared backend where both auth paths are active.

## Acceptance criteria

- [x] Test 1 passes: two OIDC sign-ins with the same username produce exactly one `user` row and two valid sessions
- [x] Test 1 bootstrap idempotency: tracker count after two sign-ins equals the count after the first sign-in
- [x] Test 2 passes: OIDC sign-in with an email matching a pre-existing local user results in exactly one `user` row with the same ID as the local user
- [x] Each test uses a unique `username` and does not interfere with other tests
- [x] `bun run check` and `bun run test` pass in the `tests` directory

## User stories addressed

- User story 9 — repeated OIDC sign-in with same identity returns same user
- User story 10 — OIDC sign-in with email matching existing local user links to that account
