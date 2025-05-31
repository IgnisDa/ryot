# `in_library` Repository Primitives

**Parent Plan:** [Global Media Entities & User Library](./README.md)

**Type:** AFK

**Status:** todo

## Backwards compatibility

Backwards compatibility with existing user-scoped media entity rows is not required.

## What to build

Add the two repository functions that every downstream task depends on for expressing user-to-media association. No service logic or route changes in this task — pure persistence layer only.

**`getUserLibraryEntityId(userId)`** — Queries the `entity` table for the single entity owned by `userId` whose `entitySchemaId` matches the builtin `library` schema. Returns the entity id or `undefined`. This is the lookup used by the worker, events service, and collections service before writing an `in_library` relationship.

**`upsertInLibraryRelationship({ userId, mediaEntityId, libraryEntityId })`** — Inserts a `relationship` row with `relType = 'in_library'`, `userId`, `sourceEntityId = mediaEntityId`, `targetEntityId = libraryEntityId`. Uses `onConflictDoNothing` against the existing `relationship_user_source_target_rel_type_unique` constraint so re-importing the same title is a silent no-op.

Both functions live in the entities repository (`entities/repository.ts`) or a colocated `library/repository.ts` if the module boundary warrants it — follow the existing pattern for where `createGlobalEntity` and `upsertPersonRelationship` live.

**Unit tests** — Pure functional tests (no DB) verifying that `upsertInLibraryRelationship` calls the underlying insert with the correct shape. Follow the dep-injection pattern of existing repository-adjacent tests.

## Acceptance criteria

- [ ] `getUserLibraryEntityId(userId)` returns the id of the user's library entity when it exists.
- [ ] `getUserLibraryEntityId(userId)` returns `undefined` when no library entity exists for the user.
- [ ] `upsertInLibraryRelationship` inserts a row with `relType = 'in_library'`, correct `userId`, `sourceEntityId`, and `targetEntityId`.
- [ ] Calling `upsertInLibraryRelationship` twice with the same arguments does not create a duplicate row (idempotent via `onConflictDoNothing`).
- [ ] Both functions are exported from their module's `index.ts` barrel.
- [ ] Unit tests cover both the happy path and the idempotency of `upsertInLibraryRelationship`.
- [ ] `bun run typecheck`, `bun run test`, and `bun run lint` pass in `apps/app-backend`.

## Blocked by

- [Task 01](./01-library-schema-and-signup-entity.md)

## User stories addressed

- User story 1 (same entity row shared across users)
- User story 9 (re-importing is idempotent)
- User story 11 (library entity deletion cascades correctly)
