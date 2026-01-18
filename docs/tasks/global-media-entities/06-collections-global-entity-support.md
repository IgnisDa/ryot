# Collections: Global Entity Support and Implicit `in_library`

**Parent Plan:** [Global Media Entities & User Library](./README.md)

**Type:** AFK

**Status:** done

## Backwards compatibility

Backwards compatibility with existing user-scoped media entity rows is not required.

## What to build

Allow users to add global entities to their collections, and implicitly add those entities to the user's library when they do so.
Backwards compatibility with existing user-scoped media entity rows is not required.

**`collections/repository.ts`** — `getEntityById` currently guards membership operations with `eq(entity.userId, userId)`. Broaden this to `or(isNull(entity.userId), eq(entity.userId, userId))` so global entities pass the existence check. Return `entity.userId` (or a derived `isGlobal` flag) alongside `entity.id` so the service can decide whether to write `in_library`.

**`collections/service.ts`** — Add the implicit `in_library` upsert step to `addToCollection`. Inject two new deps: `getUserLibraryEntityId` and `upsertInLibraryRelationship` (from Task 02). After verifying the entity and collection both exist and before writing the `member_of` relationship, check if the entity is global. If it is, call `getUserLibraryEntityId` and `upsertInLibraryRelationship`. This mirrors the exact same pattern as Task 05.

**`CollectionServiceDeps`** — Extend with `getUserLibraryEntityId` and `upsertInLibraryRelationship`. Provide default implementations from the repository in the deps object.

**Unit tests (`collections/service.test.ts`)** — Add cases inside the `addToCollection` describe block:
- Adding a global entity to a collection calls `upsertInLibraryRelationship`.
- Adding a global entity that is already `in_library` does not create a duplicate (idempotent).
- Adding a user-owned entity (custom schema) to a collection does NOT call `upsertInLibraryRelationship`.
- `getUserLibraryEntityId` returning `undefined` for a global entity causes `addToCollection` to fail with a clear error.

**E2E tests (`tests/src/tests/collections.test.ts`)** — Add a test: add a global media entity (produced by the worker in Task 03) to a user collection; assert `200` and that an `in_library` relationship now exists for the user. The existing test "adds an entity to a collection" uses a user-owned custom-schema entity and remains unchanged.

## Acceptance criteria

- [x] `POST /collections/memberships` succeeds when the entity is global (`userId = null`).
- [x] Adding a global entity to a collection automatically upserts an `in_library` relationship for the requesting user.
- [x] Adding a global entity that is already `in_library` does not produce a duplicate `in_library` row.
- [x] Adding a user-owned entity (collection, custom schema entity) does not write an `in_library` row.
- [x] A user cannot add a global entity to another user's collection — the collection ownership check is unchanged and continues to return `404`.
- [x] If the user's library entity is missing, `addToCollection` fails clearly instead of proceeding with the collection write.
- [x] Unit tests cover the global entity membership upsert, idempotent path, user-owned entity path, missing-library error, and invalid membership payload regression.
- [x] E2E test verifies: add global entity to collection -> `in_library` exists for the user.
- [x] `bun run typecheck`, `bun run test`, and `bun run lint` pass in both `apps/app-backend` and `tests`.

## Notes

- `collections/repository.ts` now treats global entities as readable for collection membership operations by broadening `getEntityById` to `entity.userId IS NULL OR entity.userId = :userId` and returning `entity.userId` for the service decision.
- `collections/service.ts` mirrors the Task 05 events pattern: `addToCollection` validates membership properties first, then implicitly upserts `in_library` for global entities, then writes `member_of`.
- Validation happens before the implicit library side effect, so rejected membership payloads do not mutate library membership.
- The E2E test verifies the `in_library` side effect with a direct database assertion rather than widening product APIs.

## Blocked by

- [Task 02](./02-in-library-repository-primitives.md)
- [Task 04](./04-entity-read-scope-for-global-entities.md)

## User stories addressed

- User story 5 (add media to a collection)
- User story 6 (adding to collection implicitly adds to library)
