# Config Default Tests

**Parent Plan:** [OIDC Integration Tests](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Add `tests/src/tests/auth.test.ts` that runs against the **existing shared backend** (the one started by `tests/src/setup.ts`). This backend has no OIDC env vars set, local auth enabled, and registration allowed — the default configuration.

This slice has two responsibilities:
1. Pin the four `auth` block defaults in `GET /system/config` so any future env-var wiring regression is caught immediately.
2. Serve as a regression test confirming that email sign-up still bootstraps correctly after the bootstrap logic was moved to the `databaseHooks` hook in task 01.

### Tests to write

**`GET /system/config` auth block defaults**
- `oidcEnabled` is `false`
- `signupAllowed` is `true`
- `localAuthDisabled` is `false`
- `oidcButtonLabel` is absent / `undefined`

**Email sign-up regression**
- `POST /authentication/email` with a valid unique email/name/password returns 200
- After sign-up, the `tracker` table contains at least one row for the new user (query via `getPgClient()`)

**Duplicate email sign-up**
- A second `POST /authentication/email` with the same email returns a non-200 status with a validation error message

### How to write these tests

Follow the exact pattern of `tests/src/tests/health.test.ts` and `tests/src/tests/trackers.test.ts`:

- Import `getBackendClient`, `getBackendUrl`, and `getPgClient` from `../setup`
- For the email sign-up tests, reuse the `createTestUser` helper from `tests/src/fixtures/auth.ts` which already handles unique email generation and sign-up/sign-in
- Use `describe` + `it` blocks from `bun:test`
- Do not import or call `bootstrapNewUser` directly — assert observable state (DB rows, HTTP responses) only

### Fixture note

`createTestUser` in `tests/src/fixtures/auth.ts` calls `POST /authentication/email` and then `POST /auth/sign-in/email`. For the duplicate-email test, call the sign-up endpoint a second time directly via `fetch` rather than through the fixture, so the test controls both calls explicitly.

## Acceptance criteria

- [ ] `tests/src/tests/auth.test.ts` exists and contains all four `GET /system/config` default assertions
- [ ] The email sign-up regression test passes: a new user has tracker rows in the database after signing up
- [ ] The duplicate email test passes: second sign-up returns a non-200 response
- [ ] `bun run check`, `bun run test`, and `bun run format` pass in the `tests` directory

## User stories addressed

- User story 1 — config endpoint returns correct defaults
- User story 12 — email sign-up still bootstraps after the hook refactor
