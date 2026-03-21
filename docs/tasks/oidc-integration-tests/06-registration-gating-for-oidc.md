# Registration Gating for OIDC

**Parent Plan:** [OIDC Integration Tests](./README.md)

**Type:** AFK

**Status:** done

## What to build

Add one test to `tests/src/tests/auth-oidc.test.ts` against **Backend C** (`USERS_ALLOW_REGISTRATION=false`, OIDC enabled, local auth on). This test verifies that a first-time OIDC user is rejected when registration is disabled.

This task depends on task 03 (infrastructure + `oidcSignIn` helper). Tasks 04 and 05 are independent.

### Why this is the hardest OIDC test

When registration is disabled, Better Auth must reject the OIDC callback for a user who has never signed in before. The rejection happens inside the OAuth2 callback handler at `GET /auth/oauth2/callback/oidc`. The test must observe this rejection at the HTTP level — either as a non-200 final response, an error redirect, or a redirect to `http://localhost:3000/` with an error indicator in the query string — without relying on any implementation detail of how Better Auth surfaces the error.

The exact HTTP behavior (status code, redirect destination, error payload structure) depends on how the installed version of `better-auth` + `genericOAuth` plugin handles a disabled-registration OIDC callback. The test must be written to observe whatever signal the backend actually produces rather than asserting a specific status code.

### Test — First-time OIDC sign-in is rejected when registration is disabled

Steps:
1. Generate a unique `username` that has **never** been used on Backend C
2. Attempt the OIDC flow against Backend C using the three-step mechanism from `oidcSignIn`
   - However, unlike `oidcSignIn`, do not assume step 3 succeeds. Capture the response from the backend callback step (step 3) regardless of status.
3. Assert the response from step 3 is **not** a successful session issuance. Acceptable signals:
   - The `Set-Cookie` response header contains no session cookie
   - The response status is 4xx
   - The `Location` header (if a redirect) contains an error parameter
4. Query the `user` table: `SELECT count(*) FROM "user" WHERE email = '{username}@localhost'`
5. Assert count is **0** — no user row was created

**Practical note on observing rejection:** `oidcSignIn` returns the session cookie unconditionally. For this test, inline the three-step logic (or add a variant helper that returns the raw step-3 response) so the test can inspect the callback response before deciding whether a session was issued. Do not call the existing `oidcSignIn` helper and then check for a missing cookie — write the test to explicitly follow only steps 1 and 2 and then examine step 3's response directly.

**Alternative assertion if Better Auth redirects silently:** If Better Auth redirects to `http://localhost:3000/` with no error signal, fall back to asserting only the DB count (step 5). The absence of a user row is the ground-truth assertion; the HTTP-level signal is a stronger but optional check.

### Scope

Only test a **first-time** user on Backend C. A user who already exists (created on Backend A, for example) attempting OIDC on Backend C is a different scenario (shared-database linking) that is out of scope — the databases are separate per process.

## Acceptance criteria

- [x] The test asserts that a first-time OIDC sign-in against a backend with `USERS_ALLOW_REGISTRATION=false` does not produce a valid session
- [x] The test asserts that no `user` row with the attempted email exists in the database after the failed flow
- [x] The unique `username` used in the test does not conflict with any other test in the file
- [x] `bun run check`, `bun run test`, and `bun run format` pass in the `tests` directory

## User stories addressed

- User story 11 — first-time OIDC sign-in is rejected when registration is disabled
