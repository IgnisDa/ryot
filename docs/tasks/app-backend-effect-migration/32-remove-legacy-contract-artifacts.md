# Remove Legacy Contract Artifacts

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** done

## What to build

Remove migration-obsolete backend contract artifacts after backend, E2E, and app-client no longer depend on them. This includes the old renamed backend package, the reference backend package, generated OpenAPI backend exports and generation flow, old `openapi-fetch` dependencies where unused, temporary compatibility exports, and any obsolete direct `@ryot/app-backend/lib/*` consumers.

Do not run this before app-client and tests are migrated away from the legacy generated contract.

## Acceptance criteria

- [x] No tests import generated OpenAPI backend path types
- [x] App-client no longer imports generated OpenAPI backend path types
- [x] Old backend and reference backend packages are removed from the workspace
- [x] Obsolete generated OpenAPI backend exports and generation scripts are removed when no longer needed
- [x] Unused `openapi-fetch` dependencies are removed from migrated packages
- [x] Full repository checks are no longer blocked by legacy contract artifacts

## Progress Notes

- `bun turbo --filter=@ryot/tests check` now passes again after switching broken tests imports from deleted `@ryot/ts-utils/view-language` helpers to `@ryot/app-backend/query-language`.
- The initial tests-only cleanup removed a subset of `oxlint-disable` comments in polling and several query-engine/event test helpers while keeping the legacy adapter layer intact.
- A follow-up cleanup slice removed more `oxlint-disable` comments from malformed-request tests, sandbox result assertions, event-schema loops, and query-engine scenario loops by using raw fetch, `Promise.all`, and small runtime-shape helpers.
- The tests-only path-string bridge has now been removed from `@ryot/tests`: active tests were migrated from `client.GET/POST/DELETE(...)` calls to named client methods and `tests/src/fixtures/backend-client-legacy.ts` was deleted.
- The remaining work is concentrated in residual compatibility warnings in `tests/src/fixtures/backend-client.ts`, query-engine fixture narrowing, and older non-test artifacts such as `tests/src/seed-script.ts` that still depend on generated OpenAPI/openapi-fetch flows.
- Final slice (completed):
  - `tests/src/seed-script.ts` migrated off `@ryot/generated/openapi/app-backend` + `openapi-fetch` to the Effect `AppContract`. It now builds its own `HttpApiClient` (cookie auth) and calls named contract methods (`c.trackers.create`, `c.entitySchemas.search`, `c.savedViews.create`, etc.). Types are sourced from `@ryot/app-backend/query-language` (`QueryExpression`/`QueryFilter`/`RuntimeRef`), `@ryot/app-backend/schema` (`AppSchema`), and the test `ContractPayload`/`ContractSuccess` helpers (type-only import, so `bun run` never pulls test infra). The `{ data }` envelope handling was dropped in favor of direct values. Verified it bundles with no `bun:test` leakage.
  - `apps/website` god-mode admin calls (`provision`, `reset-password`, `ban/set`) moved from the generated `openapi-fetch` client to the Effect `HttpApiClient` built against the exported `AppContract` (`Admin-Access-Token` header preserved, responses decoded by the contract schemas); `@ryot/generated` + `openapi-fetch` removed and `effect`/`@effect/platform`/`@ryot/app-backend` added to the website.
  - Restored the legacy discriminated-union entity image contract (`{ type: "remote"; url } | { type: "s3"; key }`, nullable) on `CreateEntityBody.image` and `ListedEntity.image` instead of the interim flattened URL string. The DB already stored this union (`jsonb`); the entity repository stopped flattening on read and wrapping on write, the import workflow + exercise preload now emit the `remote` union, and consumers were updated (app-client `entity-detail` model uses `toEntityImage`; tests and seed script send the union). The query-engine already projected the union for image-typed display values, so it was unchanged.
  - Removed unused `@ryot/generated`/`openapi-fetch` deps from `apps/app-client`, `apps/website`, `tests`, and the now-dangling `@ryot/generated` dep from `apps/frontend`, `apps/browser-extension`, `libs/graphql`, and `libs/ts-utils`.
  - Deleted `apps/app-backend-legacy`, `apps/app-backend-reference`, and `libs/generated` entirely.
  - Per scope decision (this PRD's artifacts only), the pre-existing V1 web stack (`apps/frontend`, `apps/browser-extension`, `libs/graphql`) is left untouched. It still fails `check` for V1 GraphQL reasons that predate this PRD (already-deleted `@ryot/generated/graphql/*` types, `graphql` tsconfig `moduleResolution=node10`) — not for any legacy contract artifact. `libs/graphql/tsconfig.json` had its dangling reference to the deleted `libs/generated` removed so it fails identically to its pre-deletion baseline.
  - Filtered checks pass: `@ryot/app-backend`, `@ryot/tests`, `@ryot/website`, `@ryot/app-client`, `@ryot/transactional`, `@ryot/ts-utils`, `@ryot/docs`.

## User stories addressed

Reference by number from the parent PRD:

- User story 51
- User story 52
- User story 53
- User story 62
