# Global Media Entities & User Library

## Problem Statement

When two users import the same book, anime, or manga, the system creates two separate entity rows — one per user. This means identical reference data (title, cover image, cast, crew) is duplicated for every user who imports it. A user who imports "Dune" creates a completely separate entity from another user who imports the same book. There is no shared canonical record.

Beyond the storage inefficiency, this model makes it impossible to express cross-user facts, such as "these two users are both tracking the same book." It also makes person/cast data inconsistent: persons are already global (`userId = null`), but the media entities they are associated with are user-scoped, creating a split model where persons are shared but their works are not.

## Solution

Media entities created by sandbox scripts (books, anime, manga, persons, companies) become **global** (`userId = null`) — they are reference data shared across all users. The same book imported by two different users resolves to the same entity row.

To replace the ownership signal previously expressed by `entity.userId`, each user gets a **library entity** (a special system entity, auto-created on signup). When a user imports a media item, a `relationship` row with `relType = 'in_library'` is written, linking the global media entity to the user's library entity. This is the canonical expression of "user X has this item."

User-created entities (collections, custom schema entities) remain user-scoped (`userId = currentUser`) and are unaffected.

## User Stories

1. As a user, I want importing a book that someone else has already imported to reuse the same entity row, so that the system is not storing duplicate reference data.
2. As a user, I want my imported media items to appear in my library, so that I can see everything I am tracking in one place.
3. As a user, I want to log a progress, completion, or review event against a book in my library, so that I can track my reading activity.
4. As a user, I want logging an event against a media item to automatically add it to my library if it is not already there, so that I do not have to perform a separate import step.
5. As a user, I want to add a media item to a collection, so that I can organise my library.
6. As a user, I want adding a media item to a collection to automatically add it to my library if it is not already there, so that items in my collections are always reflected in my library.
7. As a user, I want to view the detail page of any media item (including its cast and crew) even if I have not imported it, so that I can explore content before deciding to track it.
8. As a user, I want my library to contain only the items I have explicitly imported or interacted with, so that I do not see items imported by other users.
9. As a user, I want re-importing a media item I already have in my library to be a no-op, so that I do not end up with duplicate library entries.
10. As a user, I want my library and all its associations to be deleted when I delete my account, so that no orphaned data remains.
11. As a user, I want global media entities (books, anime, manga, persons) to persist even after I delete my account, so that other users who have the same items in their libraries are unaffected.
12. As a user, I want the cast and crew of a media item to be globally shared, so that person details populated for one user's import are visible to all users viewing that entity.
13. As a user, I want my query engine results (saved views, tracker pages) to show only items I have in my library, not every item ever imported by anyone.
14. As a user, I want creating a new account to automatically provision a library entity for me, so that imports work immediately without any manual setup.
15. As a user, I want collections to remain fully user-scoped, so that my personal organisation is private.

## Implementation Decisions

### New builtin entity schema: `library`

A new builtin entity schema with `slug = 'library'`, `isBuiltin = true`, `userId = null`, and an empty `propertiesSchema` is seeded as part of the bootstrap manifests. It is not linked to any tracker and does not appear in entity listings or the query engine. It is an invisible structural anchor.

### Library entity per user

One user-scoped entity (`userId = currentUser`, `entitySchemaId = librarySchema.id`) is created for each user inside the existing signup transaction in the authentication module's email route. This happens alongside tracker creation, entity schema linking, and saved view creation. The library entity has no properties and no `externalId`.

### `in_library` relationship

When a media item is imported, a `relationship` row is written:
- `userId = currentUser`
- `sourceEntityId = globalMediaEntityId`
- `targetEntityId = userLibraryEntityId`
- `relType = 'in_library'`

The existing unique constraint `relationship_user_source_target_rel_type_unique` ensures a user cannot have duplicate `in_library` entries for the same entity. Re-importing the same title is idempotent.

### Worker path change

`processMediaImportJob` stops calling `createEntity` (the user-scoped service path) and instead:
1. Calls `createGlobalEntity` (already used for persons) to upsert the media entity with `userId = null`.
2. Calls `updateGlobalEntityById` to set full properties and image (mirroring the person populate flow).
3. Looks up the user's library entity.
4. Upserts an `in_library` relationship row.

This mirrors the existing pattern already used for persons in `processPersonStubs`.

### `createEntity` HTTP endpoint guard

The `createEntity` service blocks **all** builtin schema creation, removing the existing exception that permitted builtin-schema creation when `externalId` and `sandboxScriptId` were provided. The guard becomes: if `scope.isBuiltin`, return a validation error. Builtin entities are exclusively created by the worker.

### Access model for global entities

Global entities are **universally readable** — any user can view the detail page of any global entity (e.g., browse a book's cast) without having it in their library.

Write operations (creating events, adding to collections) against a global entity require the user to have an `in_library` relationship for it. If the `in_library` relationship does not exist at write time, it is **implicitly upserted** before the primary write. This implicit upsert happens in the **service layer** (not the repository), keeping each repository function single-purpose.

### Query engine scope

`buildBaseEntitiesCte` is updated to produce a UNION of:
1. User-owned entities: `WHERE entity.userId = :userId` (collections, custom schema entities)
2. Global entities in the user's library: `WHERE entity.userId IS NULL` joined through the `in_library` relationship to the user's library entity

This ensures query engine results show only entities the user has imported, not all global entities ever created.

### Entity scope checks

Repository functions that check `entity.userId = userId` for read access (`getEntityScopeForUser`, `getEntityByIdForUser`, `listEntitiesByEntitySchemaForUser`, `findEntityByExternalIdForUser` in both the entities and events modules) are updated to use a broadened predicate: `entity.userId = userId OR entity.userId IS NULL` for reads. Write-path access checks additionally require the `in_library` relationship.

### No data migration

Existing user-scoped media entities are not migrated. This change targets the creation path only.

### Cascade safety

The library entity has `userId = currentUser`, so it is deleted when the user is deleted. The `relationship` table's FK on `targetEntityId` cascades, deleting all `in_library` rows for that user when their library entity is deleted. Global media entities (`userId = null`) are unaffected by user deletion.

## Testing Decisions

**What makes a good test:** Tests should assert observable service-layer behavior through dependency injection — what the service returns, what repository functions are called, and with what arguments. Tests should not assert implementation details (e.g., which SQL clause was used internally) or restate TypeScript type constraints.

### Modules to test

**Entities service** (`entities/service.test.ts`):
- `createEntity` now returns a validation error for all builtin schemas (including when provenance is provided — the existing "allows creation for builtin schema with provenance" test becomes a failure case).
- `getEntityDetail` accepts a global entity (one with `userId = null` in the scope result) without returning `not_found`.

**Events service** (`events/service.test.ts`):
- `createEvent` against a global entity upserts `in_library` before creating the event.
- `createEvent` against a global entity that is already in the user's library does not create a duplicate `in_library` row.
- `listEntityEvents` accepts a global entity scope.

**Collections service** (`collections/service.test.ts`):
- `addToCollection` against a global entity upserts `in_library` before writing `member_of`.
- `addToCollection` against a global entity already in library does not create a duplicate `in_library` row.
- `getEntityById` (used in the collections service) returns a global entity when it exists and the user does not own it directly.

**Authentication service** (`authentication/service.test.ts`):
- The signup bootstrap helper that builds library entity creation input returns the correct shape.

### Prior art

All existing tests in these modules use dependency injection via a `deps` parameter and `create*Deps` / `create*Fixtures` helpers from `~/lib/test-fixtures`. New tests follow the same pattern, mocking `upsertLibraryMembership` and `getUserLibraryEntityId` as injected deps.

## Out of Scope

- Migration of existing user-scoped media entities to global entities.
- Exposing the library entity or `in_library` relationships as a user-visible API (e.g., a "library" endpoint). The library entity is infrastructure only.
- Removing a media item from the library (deleting the `in_library` relationship). This can be added separately.
- Cross-user features (e.g., "users also tracking this"). The global entity model enables this but it is not part of this work.
- Companies as global entities. Persons are already global; companies can follow the same pattern in a separate task.

## Further Notes

- The `library` entity schema must not appear in `authenticationBuiltinEntitySchemas()` tracker links, since it should not surface in any tracker's entity schema list.
- The `in_library` relationship direction follows the existing `member_of` convention: source = the item (global media entity), target = the container (library entity). This is consistent across all collection and library membership relationships.
- The worker already calls repository functions directly for persons (`createGlobalEntity`, `updateGlobalEntityById`, `upsertPersonRelationship`). The media import path will follow the same pattern after this change, making the two flows symmetric.
- The unique constraint `entity_global_external_id_unique` (partial index on `externalId, entitySchemaId, sandboxScriptId WHERE userId IS NULL`) already exists in the schema and will handle deduplication of global media entities.

---

## Tasks

**Overall Progress:** 0 of 8 tasks completed

**Current Task:** [Task 01](./01-library-schema-and-signup-entity.md) (todo)

### Task List

| #   | Task                                                                                                        | Type | Status | Blocked By               |
| --- | ----------------------------------------------------------------------------------------------------------- | ---- | ------ | ------------------------ |
| 01  | [Library Schema and Signup Entity](./01-library-schema-and-signup-entity.md)                                | AFK  | todo   | None                     |
| 02  | [`in_library` Repository Primitives](./02-in-library-repository-primitives.md)                              | AFK  | todo   | Task 01                  |
| 03  | [Worker: Global Media Import and HTTP Guard](./03-worker-global-media-import.md)                            | AFK  | todo   | Task 02                  |
| 04  | [Entity Read Scope for Global Entities](./04-entity-read-scope-for-global-entities.md)                      | AFK  | todo   | Task 01                  |
| 05  | [Events: Global Entity Support and Implicit `in_library`](./05-events-global-entity-support.md)             | AFK  | todo   | Tasks 02, 04             |
| 06  | [Collections: Global Entity Support and Implicit `in_library`](./06-collections-global-entity-support.md)  | AFK  | todo   | Tasks 02, 04             |
| 07  | [Query Engine: User Library Scope](./07-query-engine-user-library-scope.md)                                 | AFK  | todo   | Tasks 02, 04             |
| 08  | [Cleanup: Dead and Incorrect Code](./08-cleanup-dead-and-incorrect-code.md)                                 | AFK  | todo   | Tasks 03, 04, 05, 06, 07 |
