# Effect E2E Client Harness

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** done

## What to build

Move the E2E package's app-owned route client from generated OpenAPI and `openapi-fetch` to Effect `HttpApiClient` using the pure backend `AppContract`. Keep E2E tests as black-box tests that spawn and call a real server. Keep raw fetch or Better Auth clients for auth endpoints and invalid request cases.

Also adjust global E2E setup so a mostly stubbed backend can boot and pass health without requiring module-specific seed data in global setup.

## Acceptance criteria

- [x] E2E app-owned route helpers use Effect `HttpApiClient` and the pure backend contract
- [x] E2E tests still spawn a real backend process and call it over HTTP
- [x] Better Auth endpoint helpers continue using Better Auth client or raw fetch
- [x] Invalid payload, invalid multipart, and missing/wrong auth tests can still use raw fetch
- [x] Global E2E setup no longer requires domain-specific seed data before tests can begin
- [x] The tests check command typechecks the migrated E2E client harness

## User stories addressed

Reference by number from the parent PRD:

- User story 5
- User story 21
- User story 22
- User story 54
- User story 56
