# Browse Mixed Entities Automatically

**Parent Plan:** [Composable Views Tracer](./tracer.md)

**System Design:** [Composable Views](./README.md)

**Status:** done

**Depends On:** [03 - Unify Plugin And Entity Pages](./03-unify-plugin-and-entity-pages.md)

## What To Build

Create a normal saved view using the new kernel entity browser and browse an ordered collection containing several entity types. The selection query determines membership and order; `EntityResults` chooses the presentation from real entity provenance.

Implement [Browser Configuration](./tracer.md#browser-configuration) for selection, grid/list layout, stable identities, pagination, and counting; implement [Entity Presentations](./tracer.md#entity-presentations) for the registry, batch contract, scheduling, and fallback. Task 06 adds the remaining configured controls and general table path. Task 05 supplies rich domain presentation content.

A browser declaration requests the automatic provider set during compilation. Include all eligible registered providers and their reachable dependencies, not just types found on the first page. Register simple useful fixture presentation content through the final contract to exercise later-page selection; extend it in Task 05 rather than creating a temporary renderer API.

Resolve presentation identity by owner plugin ID plus schema slug and layout. Group requests by presentation without regrouping visible rows. Provide the kernel fallback using common entity identity/name/schema and sync data, not guessed domain property names. Contain a failed provider batch or item render instead of crashing the whole page.

## Acceptance Criteria

- [x] A new-format saved view loads mixed entities through the standard browser and `EntityResults`, not a hardcoded dashboard list.
- [x] The server validates the actual source of projected entity identity/provenance fields.
- [x] Query order and entity keys stay stable when presentation batches complete in another order.
- [x] The browser uses one selection source across grid and list rather than separate layout queries.
- [x] Load more follows returned cursors, handles overlap by stable keys, and rejects invalid duplicate entity rows within one page.
- [x] Count-on-demand counts distinct selected entities and has explicit loading/failure state.
- [x] A plugin type first appearing on page two renders without compilation, iframe replacement, or loss of existing row state.
- [x] Automatic discovery follows the specified ready/enabled rules; unavailable automatic presentation uses the supported fallback.
- [x] Missing explicit exports remain build errors, not fallback cases.
- [x] The typed batch-loader contract, chunking, cancellation, deduplication, and bounded scheduling are available to domain presentations.
- [x] Missing requested data, batch errors, and item render errors have local retry/basic entity-link states.
- [x] Browser/recipe/runtime tests prove the complete selection-to-render path with deterministic mixed data.

## Verification

Extend existing saved-view query/controller behaviour tests rather than preserving the old implementation. Use a page size of two in the mixed browser test and verify that the mounted iframe identity does not change when the later plugin type appears.

## User Stories Addressed

- [User story 5](./tracer.md#user-stories): ordered automatic mixed browsing and pagination.
- User story 7: layout and count behaviour retain selection meaning.
- User story 3: automatic presentation works across public contributor boundaries.

## Implementor Notes

Record the final browser source/settings schemas, automatic registry key, and generic fallback ownership for Tasks 05 and 06.

- The kernel owns the embedded `entity-browser` source and compiles it as a `kernel-saved-view` target through the standard client-page artifact flow.
- Browser settings select one query from the shared saved-view `dataSources` document through `sourceName`; grid and list reuse that source, including its ordering and filters.
- Automatic presentations are keyed by owner plugin ID, entity schema slug, and layout. The client SDK owns the generic entity identity/name/schema/sync fallback.
- Presentation loaders receive sorted batches of at most 100 entities. The application-scoped scheduler admits at most four batches, while shared query identity deduplicates equal requests and cancellation releases obsolete work.
- Kernel renderer builds reuse graph-bound `client_page_build` records keyed by user, renderer name, source hash, and graph hash. Sessions recheck the exact build, artifact, graph, view revision, and contributor set.
- Generated `kernel/backend/src/drizzle/20260907101511_peaceful_tombstone` with `bun run db:generate` from `kernel/backend` so kernel renderer builds can use the shared build table.
- Verified the focused entity-browser API and composed-view browser E2E suites, affected package tests, all non-E2E package tests, and the complete repository check.
