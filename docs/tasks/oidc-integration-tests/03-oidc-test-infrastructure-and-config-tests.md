# OIDC Test Infrastructure and Config Tests

**Parent Plan:** [OIDC Integration Tests](./README.md)

**Type:** AFK

**Status:** done

## What to build

Create `tests/src/tests/auth-oidc.test.ts` with its own independent container stack and three backend process variants. Validate the infrastructure immediately with config-driven assertions that don't yet require a full OIDC sign-in flow. Also create `tests/src/fixtures/auth-oidc.ts` with the `oidcSignIn` helper (the helper is scaffolded here so later tasks can use it without re-opening this file).

### Container stack

`auth-oidc.test.ts` owns a `beforeAll`/`afterAll` that starts four containers independently of `tests/src/setup.ts`:

| Container | Image | Ready condition |
|---|---|---|
| PostgreSQL | `postgres:18-alpine` | log message `database system is ready` |
| Redis | `redis:alpine` | log message `Ready to accept connections` |
| S3 | `rustfs/rustfs` | HTTP `/health` on port 9000 returns 200 |
| Mock OIDC server | `ghcr.io/navikt/mock-oauth2-server:2.1.10` | `GET /default/.well-known/openid-configuration` returns 200 |

The S3 bucket must be created after the container starts (same pattern as the shared `setup.ts`).

### Three backend processes

Start three backend processes in `beforeAll`, all sharing the same postgres/redis/S3 containers from this file's stack. Each process gets a unique port via `get-port`. All three must pass the health check before any test runs.

| Process | Additional env vars vs. base | Purpose |
|---|---|---|
| Backend A | `SERVER_OIDC_CLIENT_ID`, `SERVER_OIDC_CLIENT_SECRET`, `SERVER_OIDC_ISSUER_URL` | Happy-path OIDC, config assertions |
| Backend B | Same OIDC vars + `USERS_DISABLE_LOCAL_AUTH=true` | Local-auth-disabled behavior |
| Backend C | Same OIDC vars + `USERS_ALLOW_REGISTRATION=false` | Registration gating (used in task 06) |

`SERVER_OIDC_CLIENT_ID` and `SERVER_OIDC_CLIENT_SECRET` can be any non-empty string (e.g., `test-client` / `test-secret`) — the mock server accepts any credentials.

`SERVER_OIDC_ISSUER_URL` must be set to `http://{oidcHost}:{oidcMappedPort}/default` where host and port come from the started OIDC container.

Base env vars for all three backends are the same as in `tests/src/setup.ts` (database URL, Redis URL, S3 config, `SERVER_ADMIN_ACCESS_TOKEN`, `FRONTEND_URL=http://localhost:3000`, `NODE_ENV=test`).

### `oidcSignIn` helper

Create `tests/src/fixtures/auth-oidc.ts` exporting:

```
oidcSignIn(username: string, backendUrl: string, oidcBaseUrl: string): Promise<string>
```

Returns the session cookie string (value of `Set-Cookie` from the backend's callback response). The three-step flow:

**Step 1 — Get the authorization redirect from the backend:**
`GET {backendUrl}/auth/oauth2/authorize/oidc?callbackURL=http://localhost:3000/`
Use `redirect: 'manual'`. Capture the `Location` header (full mock-server authorize URL with all OAuth2 query params) and the `Set-Cookie` header (Better Auth's state cookie).

**Step 2 — Complete login at the mock OIDC server:**
Parse the `Location` URL from step 1 into its query params using the `URL` and `URLSearchParams` APIs. POST those same params back to the mock server's authorize endpoint as `application/x-www-form-urlencoded` body, adding `username={username}`. Use `redirect: 'manual'`. Capture the `Location` header — this is the backend callback URL containing `code` and `state` query params.

The mock server's authorize endpoint is the `Location` URL's origin + pathname (strip the query string before POSTing, send the params as form body instead).

**Step 3 — Complete the callback at the backend:**
`GET {Location from step 2}` with `Cookie: {Set-Cookie value from step 1}`. Use `redirect: 'manual'`. Capture the `Set-Cookie` header — this is the session cookie. Return it.

**Test isolation:** Each test must call `oidcSignIn` with a unique `username` (e.g., `crypto.randomUUID()` or a UUID-prefixed string). Never share identities between tests.

Also export a helper to get the backend URL for each process variant (A, B, C), following the same pattern as `getBackendUrl()` in `setup.ts`.

### Config tests to write in this slice

Using **Backend A** (OIDC enabled, local auth on):
- `GET /system/config` returns `auth.oidcEnabled: true`
- `GET /system/config` returns `auth.oidcButtonLabel` matching the `FRONTEND_OIDC_BUTTON_LABEL` env var set for backend A (set a recognizable test value like `"Sign in with TestOIDC"`)

Using **Backend B** (OIDC enabled, local auth disabled):
- `GET /system/config` returns `auth.localAuthDisabled: true`
- `POST /authentication/email` returns 400 and the response body contains `"Local authentication is disabled"`

These four tests confirm the infrastructure is wired correctly without requiring a full OIDC sign-in flow.

### Pattern reference

The `beforeAll`/`afterAll` structure must mirror `tests/src/setup.ts` exactly (same container images, same S3 bucket creation, same backend spawn/health-check pattern, same `backendProcess.stdout` logging). The `oidcSignIn` helper follows the same export style as `createTestUser` and `createAuthenticatedClient` in `tests/src/fixtures/auth.ts`.

## Acceptance criteria

- [x] `tests/src/tests/auth-oidc.test.ts` exists with a working `beforeAll`/`afterAll` that starts the mock OIDC server and three backend processes
- [x] `tests/src/fixtures/auth-oidc.ts` exists and exports a functional `oidcSignIn` helper
- [x] The four config assertions (two for backend A, two for backend B) pass
- [x] `afterAll` stops all three backend processes and all four containers cleanly
- [x] `bun run check`, `bun run test`, and `bun run format` pass in the `tests` directory

## User stories addressed

- User story 2 — config returns `oidcEnabled: true` when OIDC env vars are set
- User story 3 — config returns the `oidcButtonLabel` string
- User story 4 — config returns `localAuthDisabled: true`
- User story 5 — email sign-up returns 400 when local auth is disabled
- User story 13 — reusable `oidcSignIn` fixture
