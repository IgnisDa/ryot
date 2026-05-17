# OIDC Sign-In Happy Path

**Parent Plan:** [OIDC Integration Tests](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Add three tests to `tests/src/tests/auth-oidc.test.ts` that verify the happy-path OIDC sign-in flow against **Backend A** (OIDC enabled, local auth on, registration on). These tests use the `oidcSignIn` helper created in task 03.

This task depends on task 01 (bootstrap hook fix) and task 03 (infrastructure + `oidcSignIn` helper). Both must be complete before this task runs.

### Tests to write

**Test 1 — First-time OIDC sign-in produces a valid session**

1. Call `oidcSignIn(uniqueUsername, backendAUrl, oidcBaseUrl)` → get session cookie
2. Make a request to any authenticated endpoint (e.g., `GET /trackers`) with `Cookie: {sessionCookie}`
3. Assert the response status is 200

This confirms the full three-step OAuth2 code flow succeeds end-to-end and that Better Auth creates a valid session.

**Test 2 — First-time OIDC sign-in creates a user row**

1. Call `oidcSignIn(uniqueUsername, ...)` → get session cookie
2. The mock server produces `email: {username}@localhost` in the userinfo response
3. Query the `user` table: `SELECT id FROM "user" WHERE email = $1` with `{username}@localhost`
4. Assert exactly one row exists

Use `getPgClient()` — the OIDC test file exposes its own pg client pointing at its own postgres container (same pattern as `getPgClient()` in `setup.ts`).

**Test 3 — First-time OIDC sign-in bootstraps the user**

1. Call `oidcSignIn(uniqueUsername, ...)` → get session cookie
2. Resolve the user ID from the `user` table (same query as test 2)
3. Query the `tracker` table: `SELECT count(*) FROM tracker WHERE user_id = $1`
4. Assert count > 0

This is the primary verification that the `databaseHooks.user.create.after` hook fires for OIDC users. It will only pass after task 01 is complete.

### Username uniqueness

Each test must generate its own unique `username` so identities do not leak between tests. Use `crypto.randomUUID()` as the prefix (e.g., `` `user-${crypto.randomUUID()}` ``).

### Mock OIDC server email format

The mock server (`ghcr.io/navikt/mock-oauth2-server`) derives the `email` claim from the username as `{username}@localhost`. When querying the `user` table by email, use this format.

## Acceptance criteria

- [ ] Test 1 passes: OIDC sign-in produces a session cookie that authenticates a protected endpoint
- [ ] Test 2 passes: a `user` row with `email = {username}@localhost` exists after the OIDC flow
- [ ] Test 3 passes: at least one `tracker` row exists for the new OIDC user after the flow
- [ ] Each test uses a unique `username` and does not share state with other tests
- [ ] `bun run check`, `bun run test`, and `bun run format` pass in the `tests` directory

## User stories addressed

- User story 6 — first-time OIDC sign-in creates a valid session
- User story 7 — first-time OIDC sign-in creates a user row
- User story 8 — first-time OIDC sign-in bootstraps default user data
