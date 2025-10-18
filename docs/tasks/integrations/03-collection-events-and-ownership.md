# Collection Events and Ownership Infrastructure

**Parent Plan:** [Integrations](./README.md)

**Type:** AFK

**Status:** done

## What to build

Two pieces of infrastructure that push integrations (task 07) and Yank ownership sync (task 05) depend on:

1. Two new builtin event schemas on the collection entity schema (`add-entity-to-collection`, `remove-entity-from-collection`) and the collection service changes that emit them.
2. An ownership merge helper in the imports media write path that merges ownership state into the `in-library` relationship while reusing generic entities helpers.

Refer to the **Collection Events** and **Ownership via In-Library Relationship** sections of the parent PRD for full detail.

**Prerequisites:** Task 01 (schema), Task 02 (before-trigger / event system including `createEventBySchemaSlugWithTriggers`).

---

### 1. New builtin event schemas

Seed two new builtin event schemas on the `collection` entity schema in `src/modules/builtins/`:

**`add-entity-to-collection`**
```
propertiesSchema.fields:
  entityId:                  string, required
  entitySchemaSlug:          string, required
  relationshipId:            string, required
  relationshipProperties:    object, optional, unknownKeys: passthrough
```

**`remove-entity-from-collection`**
```
propertiesSchema.fields:
  entityId:                  string, required
  entitySchemaSlug:          string, required
  relationshipId:            string, required
  relationshipProperties:    object, optional, unknownKeys: passthrough
```

Both are builtin (`isBuiltin = true`, `userId = null`). Add them to the builtins seeding logic alongside other media lifecycle event schemas using the existing `INSERT ... ON CONFLICT DO UPDATE` upsert pattern.

These schemas are attached to the collection entity schema, not to individual media entity schemas. The collection entity already exists as a builtin entity schema.

### 2. `createEventBySchemaSlugWithTriggers` helper in events module

Add a new public service function to `src/modules/events/service.ts` and export it from `src/modules/events/index.ts`:

```ts
createEventBySchemaSlugWithTriggers(input: {
  userId: string;
  entityId: string;
  eventSchemaSlug: string;
  properties: Record<string, unknown>;
  occurredAt?: string;
  context?: EventWriteContext;
})
```

Behavior:
- Looks up the builtin event schema with the given slug for the entity (joins entity → entitySchema → eventSchema where eventSchema.slug = input and eventSchema.userId IS NULL).
- If not found: returns a not-found error.
- Calls `createEventsWithTriggers` with the resolved event schema ID.
- Propagates the `EventWriteContext`.

This is the function called by the collections service to emit membership events. It must not require the caller to know the event schema ID.

### 3. Collection service — emit add event

In `addToCollection` (`src/modules/collections/service.ts`):

1. Check whether the membership relationship was newly inserted by modifying `writeCollectionMembership` to return `{ data: CollectionMembershipData, wasInserted: boolean }`.
2. The membership write and event emission happen within a single DB transaction:
   - Write the relationship.
   - If `wasInserted === true`: call `createEventBySchemaSlugWithTriggers` with:
     - `entityId = collectionId`
     - `eventSchemaSlug = "add-entity-to-collection"`
     - `properties = { entityId: entity.id, entitySchemaSlug: entity.entitySchemaSlug, relationshipId: relationship.id, relationshipProperties: relationship.properties }`
   - If event creation fails: the transaction rolls back and `addToCollection` returns an error.
3. If `wasInserted === false` (upsert updated an existing row): no event is emitted.

For the transaction scope: the existing `entities/relationships.ts` helpers and the events module's `createEventBySchemaSlugWithTriggers` must both accept an optional `DbClient` transaction parameter so the collection service can pass a single transaction through both. Follow the existing pattern in `collections/repository.ts` which already accepts an optional `database` parameter.

The collection service's `AddToCollectionServiceDeps` must include the new event creation function as a typed dep.

### 4. Collection service — emit remove event

In `removeFromCollection`:

1. Delete the membership relationship (existing behavior).
2. `deleteCollectionMembership` already returns the deleted row if one existed.
3. If a row was deleted: call `createEventBySchemaSlugWithTriggers` with:
   - `entityId = collectionId`
   - `eventSchemaSlug = "remove-entity-from-collection"`
   - `properties = { entityId: entity.id, entitySchemaSlug: entity.entitySchemaSlug, relationshipId: deletedRelationship.id, relationshipProperties: deletedRelationship.properties }`
4. If event creation fails: the relationship has already been deleted. Return the error to the caller. (Removal is not wrapped in a transaction because delete-then-emit-failure is safer than rollback here — the resource is gone either way.)
5. If no row was deleted: no event is emitted.

The collection service's `RemoveFromCollectionServiceDeps` must include the event creation function as a typed dep.

### 5. Entity schema slug availability

The collection service's `getEntityById` query currently only returns `{ id, userId }`. Extend it to also return `entitySchemaSlug` (by joining `entitySchema` and selecting `entitySchema.slug`). This is needed to populate `entitySchemaSlug` in the event properties.

### 6. Ownership merge helper

Implement a local `writeOwnershipToLibrary` helper in `src/modules/imports/media/write.ts` for the media write phase:

```ts
writeOwnershipToLibrary(input: {
  userId: string;
  entityId: string;
  provider: string;
  syncedAt?: Date;
})
```

Behavior:
1. Call `ensureEntityInLibrary` to get/create the `in-library` relationship.
2. Resolve the builtin library entity and `in-library` relationship schema IDs.
3. Read the current `in-library` relationship properties for this user/entity pair.
4. Merge ownership fields:
   - `owned = true`
   - `ownershipSources = [...existing, provider]` deduped (if provider already present, do not add again)
   - `ownershipSyncedAt = syncedAt ?? now` (ISO string)
5. Write updated properties back through the generic relationship write path.

The updated `in-library` properties must still be valid against the widened schema from task 01. Since all ownership fields are optional, no validation failure is expected.

## Acceptance criteria

- [x] `add-entity-to-collection` and `remove-entity-from-collection` event schemas exist in the DB after seeding, attached to the builtin `collection` entity schema.
- [x] `createEventBySchemaSlugWithTriggers` is exported from the events module barrel and resolves event schema by slug for a given entity.
- [x] `addToCollection` emits an `add-entity-to-collection` event only when the membership relationship was newly inserted.
- [x] `addToCollection` does not emit an event when the membership relationship already existed and was merely updated.
- [x] If `add-entity-to-collection` event creation fails, the entire add-to-collection operation fails and neither the relationship nor the event is persisted.
- [x] `removeFromCollection` emits a `remove-entity-from-collection` event only when an existing relationship row was deleted.
- [x] `writeOwnershipToLibrary` sets `owned = true`, appends the provider to `ownershipSources` without duplication, and sets `ownershipSyncedAt`.
- [x] Calling `writeOwnershipToLibrary` twice with the same provider does not duplicate the provider in `ownershipSources`.
- [x] Ownership merging stays in the imports media write path and reuses generic `entities` helpers instead of adding integration-specific logic to the entities module.
- [x] Unit tests cover: add event emitted on first insert, no event on upsert update, remove event on deletion, no event when entity was not in collection, transaction rollback on add event failure, ownership merge correctness. Prior art: `src/modules/entities/service.test.ts`, `src/modules/collections/service.ts`.

## User stories addressed

- User story 13 (Radarr push triggered by collection add — event infrastructure)
- User story 14 (Sonarr push triggered by collection add — event infrastructure)
- User story 30 (owned item sync for Yank integrations)
- User story 31 (ownership tracked on library entities)
- User story 32 (ownership accumulates from multiple integrations)
