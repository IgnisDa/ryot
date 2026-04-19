# Events: Global Entity Support and Implicit `in_library`

**Parent Plan:** [Global Media Entities & User Library](./README.md)

**Type:** AFK

**Status:** todo

## Backwards compatibility

Backwards compatibility with existing user-scoped media entity rows is not required.

## What to build

Allow users to create events against global entities, and implicitly add those entities to the user's library when they do so.

**`events/repository.ts`** — `getEventCreateScopeForUser` currently guards event creation with `eq(entity.userId, input.userId)`. Broaden this to `or(isNull(entity.userId), eq(entity.userId, input.userId))` so the scope query locates global entities.

**`events/service.ts`** — Add the implicit `in_library` upsert step. Inject two new deps: `getUserLibraryEntityId` and `upsertInLibraryRelationship` (from Task 02). In `createEvent` and `createEvents`, after resolving the event create scope and before calling `createEventForUser`, check if the target entity is global (`scope.entityUserId === null` or a similar signal returned from the scope query). If it is, call `getUserLibraryEntityId` and `upsertInLibraryRelationship`. This belongs in the service, not the repository, to keep repositories single-purpose.

The scope query in `getEventCreateScopeForUser` should return `entity.userId` (or a derived `isGlobal` flag) so the service can make this decision without a second DB round-trip.

**`EventServiceDeps`** — Extend the deps type with `getUserLibraryEntityId` and `upsertInLibraryRelationship`. Provide default implementations from the repository in `eventServiceDeps`.

**Unit tests (`events/service.test.ts`)** — Add cases:
- Creating an event against a global entity calls `upsertInLibraryRelationship` with the correct arguments.
- Creating an event against a global entity when `in_library` already exists still succeeds (idempotent upsert).
- Creating an event against a user-owned entity does NOT call `upsertInLibraryRelationship`.
- `getUserLibraryEntityId` returning `undefined` causes the event creation to fail with a clear error.

**E2E tests (`tests/src/tests/events.test.ts`)** — Add a test: create an event against a global media entity (one imported via the worker in Task 03); assert the event is created successfully and an `in_library` relationship now exists for the user.

## Acceptance criteria

- [ ] `POST /events` succeeds when the target entity is global (`userId = null`).
- [ ] Creating an event against a global entity automatically upserts an `in_library` relationship for the requesting user.
- [ ] Creating an event against a global entity the user already has `in_library` does not produce a duplicate `in_library` row.
- [ ] Creating an event against a user-owned entity (collection, custom schema) does not write an `in_library` row.
- [ ] If the user's library entity is missing (invariant violation), event creation returns a clear server error rather than silently succeeding.
- [ ] Unit tests cover all four cases above.
- [ ] E2E test verifies the end-to-end path: event creation against a global entity → `in_library` exists.
- [ ] `bun run typecheck`, `bun run test`, and `bun run lint` pass in both `apps/app-backend` and `tests`.

## Blocked by

- [Task 02](./02-in-library-repository-primitives.md)
- [Task 04](./04-entity-read-scope-for-global-entities.md)

## User stories addressed

- User story 3 (log events against library items)
- User story 4 (logging an event implicitly adds item to library)
