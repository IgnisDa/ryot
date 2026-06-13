# Canonical Cutover And Old Engine Removal

**Parent Plan:** [Query Engine Hierarchical Results PRD](./README.md)

**Type:** AFK

**Status:** done

## What to build

After the side-by-side v2 engine satisfies the PRD proof criteria, cut consumers over to the v2 query document shape and v2 execution path, delete the old engine and obsolete supporting code/tests, and rename the v2 module, schema, route group, fixtures, and tests to canonical query-engine names. This task should not start until the v2 implementation is independently proven by E2E tests.

Do not keep both query engines long-term. Do not preserve old request-shape compatibility unless a concrete shipped-data requirement is discovered and explicitly handled. Make sure to change all names to their correct counterparts, for example: `SourceV2` to `Source` etc.

## Acceptance criteria

- [x] The canonical query-engine execute API uses the v2 query document and response model.
- [x] Temporary v2 route/module names are renamed to canonical query-engine names.
- [x] Old query-engine modules, old executable query-language request variants, obsolete view validation paths, obsolete fixtures, and obsolete tests are removed or rewritten.
- [x] Backend consumers, sandbox host functions, and saved-view runtime paths are updated where they still depend on the old contract.
- [x] The E2E proof criteria from the parent PRD pass against the canonical query-engine API.
- [x] No permanent compatibility layer keeps both old and new query engines alive in backend/tests.
- [x] The old compiler's behavior remains historical context only and does not constrain the canonical v2 implementation.
- [ ] Frontend query-engine wrappers are cut over. Deferred by request; `apps/app-client` is allowed to break during this backend/test-focused cutover phase.

## Implementation notes

The old backend query-engine module was replaced by the v2 implementation at the canonical
`query-engine` module path. The canonical API group is now `queryEngine` at
`/query-engine/execute`, and the backend app only wires one query-engine route/service. Saved-view
create/update validation now uses the canonical query document validator directly and no longer calls
the old query-engine saved-view validator. Sandbox `executeQueryEngine` now decodes canonical query
documents.

The canonical query-engine and saved-view E2E proof suites were renamed to the non-v2 fixture/test
names and pass against the canonical route. Sandbox E2E coverage was updated for the canonical query
document payload.

The old `#lib/views` validation path and old flat executable `QueryEngineRequest` schemas/tests were
deleted. Tests that still used old grid/table request helpers or flat `relationshipJoins` were rewritten
to send canonical query documents directly. The temporary e2e compatibility adapter was removed.

Backend review follow-up fixes were completed: built-in saved views now store canonical query documents
that preserve the old in-library media filter and the measurement/workout-template default sorts, and
bootstrap updates existing built-in saved-view definitions on conflict while preserving disabled state.
Saved-view create/update now call `QueryEngineService.validate`, which combines pure document validation
with DB-aware visible schema checks for root sources, nested event sources, relationship includes, and
expression-owned sources before persistence.

Verified with `bun run test` in `apps/app-backend`, `bun turbo --filter=@ryot/app-backend check`,
`bun run check` in `tests`, and targeted e2e suites for query-engine, saved-views, sandbox, exercises,
measurements, workouts, and workout-templates.

Deferred frontend work: full frontend consumer cutover is not complete. Existing frontend
entity-detail and media overview queries still use the old flat request shape with `eventJoins` and
`relationshipJoins`. Per the current implementation scope, `apps/app-client` is allowed to break while
backend and tests finish the canonical cutover.

Persistence cleanup was completed in Task 12: `saved_view.queryDefinition`, builtin dual-write helpers,
seed-script normalization, and old saved-view query-definition schemas were removed.

## User stories addressed

Reference by number from the parent PRD:

- User story 28
- User story 29
- User story 30
- User story 34
