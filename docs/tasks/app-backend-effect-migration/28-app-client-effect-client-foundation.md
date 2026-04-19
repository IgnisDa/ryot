# App Client Effect Client Foundation

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Introduce the app-client Effect HTTP client foundation using the pure backend `AppContract`. Preserve Better Auth client usage for Better Auth endpoints. Replace the generated OpenAPI client factory with an Effect client boundary that supports base URL selection, cookie/session propagation, and app-owned contract calls.

This slice should not migrate every app-client screen. It establishes the client boundary and migrates the smallest health/config/onboarding path.

## Acceptance criteria

- [ ] App-client no longer needs `openapi-fetch` for the migrated health/config/onboarding path
- [ ] App-client can create an Effect `HttpApiClient` from the pure backend contract
- [ ] Cookie/session propagation works for contract calls
- [ ] Better Auth endpoints remain handled by Better Auth client or raw auth helpers
- [ ] System health/config app-client usage is migrated to the new client boundary
- [ ] App-client check progresses past the migrated client foundation files

## User stories addressed

Reference by number from the parent PRD:

- User story 44
- User story 45
- User story 53
