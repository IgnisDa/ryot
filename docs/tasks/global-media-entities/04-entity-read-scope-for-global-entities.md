# Entity Read Scope for Global Entities

**Parent Plan:** [Global Media Entities & User Library](./README.md)

**Type:** AFK

**Status:** todo

## Backwards compatibility

Backwards compatibility with existing user-scoped media entity rows is not required.

## What to build

Broaden every read-path entity scope check so that global entities (`userId = null`) are visible to any authenticated user. Per the agreed access model, global entities are universally readable — no `in_library` check is required for reads.

**`entities/repository.ts`** — Update the following functions to accept global entities alongside user-owned ones:

- `getEntityScopeForUser` — change `eq(entity.userId, input.userId)` to `or(isNull(entity.userId), eq(entity.userId, input.userId))`.
- `getEntityByIdForUser` — same predicate change.
- `listEntitiesByEntitySchemaForUser` — same predicate change. (This function is used for non-query-engine listings; the query engine gets its own fix in Task 07.)
- `findEntityByExternalIdForUser` — same predicate change so that a re-import attempt can find an already-global entity before attempting to create.

**`events/repository.ts`** — `getEntityScopeForUser` uses the same `eq(entity.userId, input.userId)` pattern. Apply the same broadening so that downstream event operations can locate global entities.

**Unit tests (`entities/service.test.ts`)** — Update the `getEntityDetail` test to assert that a scope result with `userId = null` (a global entity) is returned correctly instead of `not_found`.

**E2E tests (`tests/src/tests/entities.test.ts`)** — Add a test: after a media import job runs and produces a global entity, `GET /entities/:id` returns 200 for the importing user. A second user (who has not imported the entity) also gets 200, confirming universal read access.

## Acceptance criteria

- [ ] `GET /entities/:id` returns `200` for a global entity (`userId = null`) for any authenticated user, not just the importer.
- [ ] `GET /entities/:id` continues to return `200` for user-owned entities (collections, custom schema entities) only for their owner.
- [ ] `listEntitiesByEntitySchemaForUser` returns global entities of the requested schema alongside user-owned ones.
- [ ] `findEntityByExternalIdForUser` finds a global entity by external id when `userId = null` matches.
- [ ] The `getEntityDetail` unit test covers the global-entity path (scope with `userId = null` returns data, not `not_found`).
- [ ] E2E test confirms a second user can read a global entity they did not import.
- [ ] `bun run typecheck`, `bun run test`, and `bun run lint` pass in both `apps/app-backend` and `tests`.

## Blocked by

- [Task 01](./01-library-schema-and-signup-entity.md)

## User stories addressed

- User story 7 (any user can view global entity details without importing)
