# Remove Legacy Contract Artifacts

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** in_progress

## What to build

Remove migration-obsolete backend contract artifacts after backend, E2E, and app-client no longer depend on them. This includes the old renamed backend package, the reference backend package, generated OpenAPI backend exports and generation flow, old `openapi-fetch` dependencies where unused, temporary compatibility exports, and any obsolete direct `@ryot/app-backend/lib/*` consumers.

Do not run this before app-client and tests are migrated away from the legacy generated contract.

## Acceptance criteria

- [ ] No tests import generated OpenAPI backend path types
- [ ] App-client no longer imports generated OpenAPI backend path types
- [ ] Old backend and reference backend packages are removed from the workspace
- [ ] Obsolete generated OpenAPI backend exports and generation scripts are removed when no longer needed
- [ ] Unused `openapi-fetch` dependencies are removed from migrated packages
- [ ] Full repository checks are no longer blocked by legacy contract artifacts

## Progress Notes

- `bun turbo --filter=@ryot/tests check` now passes again after switching broken tests imports from deleted `@ryot/ts-utils/view-language` helpers to `@ryot/app-backend/query-language`.
- The initial tests-only cleanup removed a subset of `oxlint-disable` comments in polling and several query-engine/event test helpers while keeping the legacy adapter layer intact.
- A follow-up cleanup slice removed more `oxlint-disable` comments from malformed-request tests, sandbox result assertions, event-schema loops, and query-engine scenario loops by using raw fetch, `Promise.all`, and small runtime-shape helpers.
- The tests-only path-string bridge has now been removed from `@ryot/tests`: active tests were migrated from `client.GET/POST/DELETE(...)` calls to named client methods and `tests/src/fixtures/backend-client-legacy.ts` was deleted.
- The remaining work is concentrated in residual compatibility warnings in `tests/src/fixtures/backend-client.ts`, query-engine fixture narrowing, and older non-test artifacts such as `tests/src/seed-script.ts` that still depend on generated OpenAPI/openapi-fetch flows.

## User stories addressed

Reference by number from the parent PRD:

- User story 51
- User story 52
- User story 53
- User story 62
