# OIDC Integration Tests

## Problem Statement

The OIDC authentication feature (commit `10dd5da92`) was shipped without backend integration tests. This leaves three categories of untested behavior:

1. The `GET /system/config` endpoint now returns a derived `auth` block whose values depend entirely on runtime env vars. There is no automated verification that the flags are wired correctly.
2. The `POST /authentication/email` endpoint gained a guard that rejects requests when `USERS_DISABLE_LOCAL_AUTH` is set. This is untested.
3. The most critical gap: `bootstrapNewUser` (which creates default trackers, entity-schema links, saved views, and the library entity for a new user) is **never called for OIDC users**. Only the email sign-up route calls it. An OIDC user who signs in for the first time ends up with an empty account — no trackers, no saved views — which is a functional bug.

## Solution

Two parallel workstreams:

**Workstream 1 — Fix the bootstrap bug.** Move the `bootstrapNewUser` call out of the email sign-up route and into a Better Auth `databaseHooks.user.create.after` hook in the auth instance. This hook fires for every newly created user regardless of how they authenticated, so OIDC and email sign-up users both get bootstrapped through a single code path.

**Workstream 2 — Write integration tests.** Add two new test files to `tests/src/tests/`:
- `auth.test.ts` — tests that run against the existing shared backend (no OIDC configured).
- `auth-oidc.test.ts` — tests that own their own container stack including a real mock OIDC server, and start three backend process variants to cover different configuration states.

The OIDC tests simulate the full OAuth2 authorization-code flow programmatically (no browser, no Playwright) by threading cookies and following HTTP redirects with `fetch()`.

## User Stories

1. As a developer, I want integration tests that verify the `GET /system/config` `auth` block returns correct values by default, so that a regression in env-var wiring is caught automatically.
2. As a developer, I want integration tests that verify `GET /system/config` reports `oidcEnabled: true` when all three OIDC env vars are set, so that the config parsing is confirmed end-to-end.
3. As a developer, I want integration tests that verify `GET /system/config` returns the `oidcButtonLabel` string from the env var, so that the label plumbing is verified.
4. As a developer, I want integration tests that verify `GET /system/config` returns `localAuthDisabled: true` when `USERS_DISABLE_LOCAL_AUTH=true`, so that the flag is confirmed to propagate.
5. As a developer, I want integration tests that verify `POST /authentication/email` returns a 400 error when `USERS_DISABLE_LOCAL_AUTH=true`, so that the guard is confirmed to work.
6. As a developer, I want integration tests that verify a first-time OIDC sign-in creates a valid session, so that the full authorization-code flow is confirmed to work end-to-end.
7. As a developer, I want integration tests that verify a first-time OIDC sign-in creates a user row in the database, so that user provisioning is confirmed.
8. As a developer, I want integration tests that verify a first-time OIDC sign-in bootstraps the user's default data (at minimum: trackers exist), so that the bootstrap gap is confirmed closed.
9. As a developer, I want integration tests that verify a repeated OIDC sign-in with the same identity returns the same user and does not create a duplicate, so that idempotency is confirmed.
10. As a developer, I want integration tests that verify an OIDC sign-in with an email matching an existing local account links to that account rather than creating a new one, so that account linking is confirmed.
11. As a developer, I want integration tests that verify an OIDC sign-in is rejected when `USERS_ALLOW_REGISTRATION=false` and the user has never signed in before, so that registration gating applies to OAuth users.
12. As a developer, I want integration tests that verify email sign-up still bootstraps correctly after the bootstrap logic is moved to the hook, so that the refactor does not regress the existing flow.
13. As a developer, I want a reusable `oidcSignIn` test fixture that encapsulates the multi-step OAuth2 code flow, so that individual test cases stay short and readable.

## Implementation Decisions

### Bug fix: move bootstrap to a Better Auth hook

The `betterAuth({})` call in the auth instance module must be extended with a `databaseHooks` block:

```
databaseHooks: {
  user: {
    create: {
      after: async (user) => bootstrapNewUser(user.id)
    }
  }
}
```

The explicit `await bootstrapNewUser(userId)` call must be removed from the email sign-up route handler. The route handler becomes purely responsible for: checking `disableLocalAuth`, validating the name, calling `auth.api.signUpEmail`, and returning the success response.

The `bootstrapNewUser` function itself already has an idempotency guard: it checks for an existing tracker row before doing any work and returns early if one is found. This makes the hook safe to fire multiple times on the same user without duplicating data.

**Circular import check (already verified):** The four module barrels that `bootstrapNewUser` imports (`collections`, `entity-schemas`, `saved-views`, `trackers`) do not import from the auth library. Adding `bootstrapNewUser` to the auth instance module creates no import cycle.

**Transaction note:** The hook approach is not atomic with user creation (the user row is committed before the hook runs), but this is the same level of atomicity as the previous route-level approach. No regression.

### Test infrastructure: `auth-oidc.test.ts` owns its own containers

The OIDC test file has its own `beforeAll`/`afterAll` that starts a fully independent container stack:
- PostgreSQL (`postgres:18-alpine`)
- Redis (`redis:alpine`)
- S3-compatible object store (`rustfs/rustfs`)
- Mock OIDC server (`ghcr.io/navikt/mock-oauth2-server:2.1.10`)

The OIDC container is considered ready when `GET /{issuerId}/.well-known/openid-configuration` returns HTTP 200. The issuer ID used is `default` (the mock server's built-in default).

This isolation means the OIDC tests do not share database state with the main suite.

### Three backend processes

`auth-oidc.test.ts` starts three backend processes in `beforeAll`, each pointing at the same shared containers but configured differently:

| Label | Key env vars | Purpose |
|---|---|---|
| Backend A | `SERVER_OIDC_*` set, local auth on, registration on | Happy-path OIDC flow, account linking |
| Backend B | `SERVER_OIDC_*` set, `USERS_DISABLE_LOCAL_AUTH=true` | Local auth disabled behavior |
| Backend C | `SERVER_OIDC_*` set, `USERS_ALLOW_REGISTRATION=false` | Registration gating for OIDC |

Each backend gets a unique port via `get-port` (already a dev dependency). All three are health-checked before any test runs.

The `SERVER_OIDC_ISSUER_URL` for all three backends points to the mock OIDC container. The `SERVER_OIDC_CLIENT_ID` and `SERVER_OIDC_CLIENT_SECRET` can be any non-empty string — the mock server accepts any credentials.

### `oidcSignIn` helper: programmatic OAuth2 code flow

The helper lives in `tests/src/fixtures/auth-oidc.ts`. It takes a `username` string, a `backendUrl`, and the mock OIDC server's base URL. It returns a session cookie string that can be passed as the `Cookie` header on subsequent requests.

**Step 1 — Get the authorization redirect:**
`GET {backendUrl}/auth/oauth2/authorize/oidc?callbackURL=http://localhost:3000/`
Request option: `redirect: 'manual'`
Captures: `Location` header (the full mock-server authorize URL including `state`, `nonce`, `client_id`, `redirect_uri`, and all other OAuth2 params), `Set-Cookie` header (the state cookie Better Auth set).

The `callbackURL` is `http://localhost:3000/` because `FRONTEND_URL=http://localhost:3000` is set in the test backend env, making it a trusted origin. Better Auth never validates that the URL is reachable — it only checks trusted origin membership.

**Step 2 — Complete login at the mock OIDC server:**
Parse the `Location` URL from step 1 into its query parameters. POST those same parameters back to the mock server's authorize endpoint as `application/x-www-form-urlencoded` body, adding `username={username}`.
Request option: `redirect: 'manual'`
Captures: `Location` header — this is the backend callback URL with `code` and `state` query params.

The mock server auto-approves any username/password and redirects to the `redirect_uri` (which Better Auth set to `{backendUrl}/auth/oauth2/callback/oidc`) with the auth code.

**Step 3 — Complete the callback at the backend:**
`GET {Location from step 2}` (the backend callback URL)
Headers: `Cookie: {state cookie from step 1}`
Request option: `redirect: 'manual'`
Captures: `Set-Cookie` header — this is the session cookie.

Better Auth exchanges the code for tokens at the mock server's token endpoint, fetches user info from the mock server's userinfo endpoint, creates or finds the user, creates a session, and issues a session cookie in the 302 response. The test stops here and does not follow the final redirect to `http://localhost:3000/`.

**Email format for account linking:**
The mock server derives the `email` claim from the username as `{username}@localhost`. Account linking tests must create the local user with an email in this format before initiating the OIDC flow.

**Test isolation:**
Each test call to `oidcSignIn` must use a unique `username` (e.g., derived from `crypto.randomUUID()`) to prevent tests from sharing user state.

### `auth.test.ts` — existing shared backend

Uses `getBackendClient()` and `getBackendUrl()` from `setup.ts`. No additional containers. Tests are:
- Config endpoint default values (`oidcEnabled: false`, `signupAllowed: true`, `localAuthDisabled: false`, no `oidcButtonLabel`)
- Email sign-up creates a user and bootstraps (regression test for the hook refactor)
- Duplicate email sign-up returns a validation error

### Bootstrap assertion

The test query to confirm bootstrap ran: `SELECT count(*) FROM tracker WHERE user_id = $1`. A count greater than zero is sufficient — trackers are the first artifact created by `bootstrapNewUser`, and their existence proves the hook fired. This query is executed via the `getPgClient()` helper already available in the test setup.

## Testing Decisions

**What makes a good test here:** Test observable external behavior, not internal wiring. A test should call HTTP endpoints or query the database — not import and call `bootstrapNewUser` directly. The goal is to confirm that the system behaves correctly from the outside, not to test that a specific function was called.

**Modules under test:**

| Module | Test file | How |
|---|---|---|
| `GET /system/config` auth block | `auth.test.ts` and `auth-oidc.test.ts` | HTTP GET, assert response fields |
| `POST /authentication/email` with local auth disabled | `auth-oidc.test.ts` (backend B) | HTTP POST, assert 400 status |
| `bootstrapNewUser` via email sign-up (regression) | `auth.test.ts` | Sign up via HTTP, query tracker table |
| `bootstrapNewUser` via OIDC (new behavior) | `auth-oidc.test.ts` (backend A) | `oidcSignIn`, query tracker table |
| OIDC session validity | `auth-oidc.test.ts` (backend A) | Use session cookie on a protected endpoint |
| OIDC user provisioning | `auth-oidc.test.ts` (backend A) | Query `user` table after OIDC sign-in |
| OIDC idempotency | `auth-oidc.test.ts` (backend A) | Sign in twice, assert single user row |
| Account linking | `auth-oidc.test.ts` (backend A) | Pre-create local user, OIDC sign-in, assert same user ID |
| Registration gating for OIDC | `auth-oidc.test.ts` (backend C) | `oidcSignIn`, assert error response, assert no user row |

**Prior art:** All tests follow the pattern established by `tests/src/tests/health.test.ts` (HTTP assertions) and `tests/src/tests/trackers.test.ts` (fixture-based setup, cookie-threaded requests). The `oidcSignIn` fixture follows the same design as `createAuthenticatedClient` in `tests/src/fixtures/auth.ts`.

## Out of Scope

- Frontend / app-client OIDC flow testing (the auth screen, auto-launch behavior, OIDC button rendering).
- Two-factor authentication.
- `USERS_TOKEN_VALID_FOR_DAYS` — intentionally not ported per the original plan.
- Multi-provider OIDC (only one provider is supported and tested).
- Testing Better Auth internals (token signing, session expiry, cookie semantics).
- Load or performance testing of the OIDC flow.
- Testing the legacy bootstrap migration module (`modules/legacyBootstrap`).

## Further Notes

- The mock OIDC server image (`ghcr.io/navikt/mock-oauth2-server`) requires no configuration files. It accepts any `client_id`/`client_secret`, auto-approves any username, and serves a valid OIDC discovery document at `/{issuerId}/.well-known/openid-configuration`. No new npm packages are needed — only the Docker image name.
- The three backend processes in `auth-oidc.test.ts` share the same postgres, redis, and S3 containers because they test different config behaviors, not different data states. Cross-process data isolation is achieved through unique usernames per test, not through separate databases.
- The `bootstrapNewUser` function's idempotency guard (checking for an existing tracker before proceeding) means the hook is safe even if Better Auth were to fire it more than once for a given user. Tests should verify idempotency by asserting tracker count equals the expected number (not just greater than zero) after two sign-ins with the same identity.

---

## Tasks

**Overall Progress:** 7 of 7 tasks completed

**Current Task:** All tasks complete.

### Task List

| #   | Task                                                                                                              | Type | Status |
| --- | ----------------------------------------------------------------------------------------------------------------- | ---- | ------ |
| 01  | [Fix Bootstrap Hook](./01-fix-bootstrap-hook.md)                                                                  | AFK  | done   |
| 02  | [Config Default Tests](./02-config-default-tests.md)                                                              | AFK  | done   |
| 03  | [OIDC Test Infrastructure and Config Tests](./03-oidc-test-infrastructure-and-config-tests.md)                    | AFK  | done   |
| 04  | [OIDC Sign-In Happy Path](./04-oidc-sign-in-happy-path.md)                                                        | AFK  | done   |
| 05  | [OIDC Idempotency and Account Linking](./05-oidc-idempotency-and-account-linking.md)                              | AFK  | done   |
| 06  | [Registration Gating for OIDC](./06-registration-gating-for-oidc.md)                                             | AFK  | done   |
| 07  | [Codebase Cleanup](./07-codebase-cleanup.md)                                                                      | AFK  | done   |
