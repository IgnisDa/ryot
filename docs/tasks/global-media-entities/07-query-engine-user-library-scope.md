# Query Engine: User Library Scope

**Parent Plan:** [Global Media Entities & User Library](./README.md)

**Type:** AFK

**Status:** todo

## Backwards compatibility

Backwards compatibility with existing user-scoped media entity rows is not required.

## What to build

Update the query engine so that saved views and tracker pages show only entities in the requesting user's library — not every global entity ever imported by any user.

**`query-engine/query-builder.ts`** — Replace the single `WHERE entity.userId = :userId` predicate in `buildBaseEntitiesCte` with a UNION of two branches:

1. **User-owned entities**: `WHERE entity.userId = :userId` — collections, custom schema entities owned directly by the user.
2. **Global library entities**: `WHERE entity.userId IS NULL` joined through the `relationship` table on `relType = 'in_library'`, `relationship.userId = :userId`, `relationship.targetEntityId = userLibraryEntityId` — global media entities the user has imported.

The `userLibraryEntityId` must be passed into `buildBaseEntitiesCte` (extend the input type). `executePreparedQuery` resolves it by calling `getUserLibraryEntityId` before building CTEs. If the library entity is missing (invariant violation), treat the user's library as empty for global entities rather than throwing — the UNION simply returns no global entities for that branch.

**Unit tests** — The query engine has no unit-level tests for `buildBaseEntitiesCte` directly (it is tested via integration). No new unit tests are required here.

**E2E tests (`tests/src/tests/query-engine.test.ts`)** — Add an isolation test using two distinct users:
- User A imports a global media entity (via the worker or by direct `in_library` fixture setup).
- User B does not import that entity.
- User A's query engine results for the media entity schema include the entity.
- User B's query engine results for the same schema do NOT include the entity.

Also add a positive test: a user who has imported a global entity sees it in their query engine results.

The existing query engine e2e suite in `tests/src/test-support/query-engine-suite.ts` and `tests/src/tests/query-engine.test.ts` must continue to pass — collection entities (user-owned) must still appear in results.

## Acceptance criteria

- [ ] A user's query engine results include global media entities they have `in_library`.
- [ ] A user's query engine results do NOT include global media entities imported by other users.
- [ ] A user's query engine results continue to include their user-owned entities (collections, custom schema entities).
- [ ] A user with no library items sees no global entities in their results (empty UNION branch, no error).
- [ ] All existing query engine e2e tests continue to pass.
- [ ] E2E isolation test: user A sees their imported entity, user B does not.
- [ ] `bun run typecheck`, `bun run test`, and `bun run lint` pass in both `apps/app-backend` and `tests`.

## Blocked by

- [Task 02](./02-in-library-repository-primitives.md)
- [Task 04](./04-entity-read-scope-for-global-entities.md)

## User stories addressed

- User story 8 (library contains only the user's own items)
- User story 13 (query engine results scoped to user's library)
