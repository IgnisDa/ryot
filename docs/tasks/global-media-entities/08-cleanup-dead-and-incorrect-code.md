# Cleanup: Dead and Incorrect Code

**Parent Plan:** [Global Media Entities & User Library](./README.md)

**Type:** AFK

**Status:** todo

## Backwards compatibility

**There is no backwards compatibility requirement for this plan.** Existing user-scoped media entity rows in the database are not migrated. Any code, tests, or assertions that exist only to preserve the old per-user media entity behavior should be deleted, not adapted.

## What to build

After tasks 01–07 land, several code paths become dead, incorrect, or internally contradictory. This task removes or corrects all of them.

### 1. Dead import in the worker

`media/worker.ts` imported `createEntity` from `~/modules/entities` before Task 03 replaced it with direct repository calls. Remove the import and any related type imports that are no longer referenced. Verify no other consumer in the worker file relies on them.

### 2. `getEntityDetail` incorrectly blocks global entities

`entities/service.ts` calls `checkCustomAccess` with a `builtin_resource` error path after resolving the entity scope. Because global media entities use builtin schemas (`isBuiltin = true`), this guard currently returns `"Built-in entity schemas do not support generated entity detail pages"` for any global media entity — directly contradicting the universal-read access model agreed in Task 04.

Fix: remove or relax the `builtin_resource` branch in `getEntityDetail` for entities with `userId = null`. The correct rule after this plan is: builtin-schema user-owned entities are still not directly editable or detail-viewable via the custom entity path (collections, custom schemas), but global entities (`userId = null`) are always readable. The simplest fix is to treat `builtin_resource` as `not_found` only when the entity is user-scoped; pass through when it is global.

Update the `getEntityDetail` unit test in `entities/service.test.ts` to cover both cases: a user-scoped builtin entity still returns `not_found`, and a global entity returns `data`.

### 3. Stale guard condition in `entities/service.ts`

Before Task 03, `createEntity` blocked builtin schemas only when `externalId` was absent: `if (scope.isBuiltin && !hasExternalId)`. Task 03 replaces this with `if (scope.isBuiltin)`. Verify the old partial condition `!hasExternalId` is entirely gone and no silent fallthrough remains where builtin-schema creation could succeed.

Remove the now-dead test case in `entities/service.test.ts` "allows creation for a built-in schema when provenance fields are provided" if it was not already converted by Task 03.

### 4. Stale e2e test assertions for builtin-schema creation via HTTP

`tests/src/tests/entities.test.ts` previously contained a test "creates entity for a built-in schema when provenance fields are provided" that expected `200`. Task 03 converts it to expect `400`. Verify that conversion happened and that no other e2e test still asserts that `POST /entities` with a builtin schema and provenance fields succeeds.

### 5. `entityProvenanceUniqueConstraint` catch handler still references user-scoped dedup

The `isUniqueConstraintError` catch in `createEntity` service calls `findEntityByExternalIdForUser` as a fallback after a unique-constraint collision. After Task 04, `findEntityByExternalIdForUser` returns both user-scoped and global entities (`or(isNull, eq(userId))`). For custom schemas this is correct. Verify the catch path is exercised only by custom-schema entities (builtin schemas are blocked before this point) and that the broadened lookup does not accidentally return a global entity as the "existing" entity for a custom-schema creation.

### 6. `customEntityDetailError` constant

The constant `"Built-in entity schemas do not support generated entity detail pages"` in `entities/service.ts` becomes misleading once global entities are viewable. If the fix in item 2 above removes the `builtin_resource` branch entirely from `getEntityDetail`, delete the constant. If the branch is kept for user-scoped builtin entities only, rename the constant to reflect its narrowed meaning.

### 7. Backwards-compatibility note added to each prior task

Add a single sentence to each of tasks 01–07 in the "What to build" section: _"Backwards compatibility with existing user-scoped media entity rows is not required."_ This makes the constraint explicit and prevents implementors from adding migration code or dual-path fallbacks.

## Acceptance criteria

- [ ] `media/worker.ts` does not import `createEntity` from `~/modules/entities`.
- [ ] `getEntityDetail` returns `200` (data) for a global media entity (`userId = null`, `isBuiltin = true`), not `not_found` or `validation`.
- [ ] `getEntityDetail` continues to return `not_found` for a user-scoped entity with a builtin schema that does not belong to the requesting user.
- [ ] No `if (scope.isBuiltin && !hasExternalId)` condition exists anywhere in the entity service.
- [ ] No e2e test asserts that `POST /entities` with a builtin schema and provenance fields returns `200`.
- [ ] The `isUniqueConstraintError` catch in `createEntity` is only reachable for custom (non-builtin) schema entities; any builtin-schema path is blocked before it.
- [ ] The `customEntityDetailError` constant is either deleted or renamed to reflect its post-fix scope.
- [ ] Tasks 01–07 each contain an explicit backwards-compatibility note.
- [ ] `bun run typecheck`, `bun run test`, and `bun run lint` pass in both `apps/app-backend` and `tests`.

## Blocked by

- [Task 03](./03-worker-global-media-import.md)
- [Task 04](./04-entity-read-scope-for-global-entities.md)
- [Task 05](./05-events-global-entity-support.md)
- [Task 06](./06-collections-global-entity-support.md)
- [Task 07](./07-query-engine-user-library-scope.md)

## User stories addressed

- All user stories (correctness sweep across the entire plan)
