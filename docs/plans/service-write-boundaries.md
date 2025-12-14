# Service Write Boundaries

## Decision

Each owning service will expose at most one write entry point for each supported CRUD verb:

- `create`
- `update`
- `delete`

CRUD methods must remain narrow and single-purpose. Do not add mode-based or discriminated branches
to make cloning, reordering, synchronization, merging, or bulk behavior fit into a CRUD method.
Read methods and orchestration methods may have other names, but they must not become alternate
write points for the owned table. Callers may orchestrate reads and multiple canonical CRUD calls,
and must own the surrounding transaction. Repository helpers may remain implementation details,
but callers must not use repository write helpers directly.

This plan will be extended one service at a time.

## Entities Service

### Current state

`EntitiesService` exposes both `save` and `create`. `create` handles request-specific normalization,
validation, and provenance deduplication before delegating to `save`. `save` is also used by internal
workflows and currently contains conflict behavior that can replace an existing global entity.

### Decision

- `create` will be the single entity creation entry point for API and internal callers.
- `create` may be idempotent when a matching entity already exists, but it must not modify that
  existing entity.
- `update` will be the single entry point for changes to an existing entity, including the current
  global-entity replacement behavior. Callers must resolve the existing entity before invoking it;
  `create` must not replace an existing entity as a conflict mode.
- `save` will not remain a public service write method.
- Entity deletion is not being added by this plan. If supported later, it will use the service's
  single `delete` entry point.
- The `create` and `update` inputs must remain typed and focused on one entity operation. Callers
  must perform source-specific normalization and conflict resolution before invoking them.

## Relationships Service

### Current state

`RelationshipsService` exposes `save`, which delegates to `RelationshipsRepository.saveRelationship`.
The repository's `onConflict` input makes that operation serve both creation and updating: it can
preserve an existing relationship or replace its properties. The repository also exposes separate
write helpers for deleting one relationship, synchronizing global relationships, deleting all user
relationships for an entity, and moving relationships during an entity merge.

Several modules currently call those repository write helpers directly, including collections,
entity imports, media monitoring, media trending, and user state.

### Decision

- `create` will be the single relationship creation entry point. It must not modify an existing
  relationship; where idempotent behavior is required, it may return the existing relationship with
  `wasInserted: false`.
- `update` will be the single relationship update entry point. It must modify existing relationships
  only and must not upsert.
- `delete` will be the single relationship deletion entry point for one relationship at a time.
- `save` will not remain a public service write method.
- No public `sync`, `move`, `deleteUserRelationship`, `deleteUserRelationshipsForEntity`, or other
  alternate relationship write method will be added. Callers performing batch synchronization,
  entity merges, or scoped deletion must read the affected relationships and orchestrate simple
  `create`, `update`, and `delete` calls inside the existing transaction boundaries.
- All modules currently writing through `RelationshipsRepository` must use `RelationshipsService`.
- Relationship property validation, global versus user scope, collection membership event behavior,
  authoritative versus additive synchronization, and entity-merge behavior must be preserved.

## Events Service

### Current state

`EventsService` exposes `create` and `listForUser`, but no `delete` or `update`. Event creation is
workflow-backed: `create` validates and enqueues the durable event-create workflow, which persists
events through `EventsRepository`. `UserStateService` also writes to the event table directly through
repository operations that delete events for an entity and move events during an entity merge.

### Decision

- `create` will remain the single event creation entry point. Its workflow-backed validation,
  before/after triggers, and execution-id idempotency must be preserved. The durable workflow and
  its repository insert are implementation details of this service-owned create path.
- `update` will be the single event update entry point for moving one event's entity references
  during an entity merge. It must not modify event properties, timestamps, or schemas.
- `delete` will be the single event deletion entry point for one event. `UserStateService` will read
  the events matching its clear-state criteria and orchestrate individual deletes. No API endpoint
  or single-event deletion route is required.
- `UserStateService` will use `EventsService` for event-table writes while preserving the transaction
  that coordinates event and relationship changes.
- Event content remains append-only; no general event edit or upsert method will be added.
- Any direct event-workflow invocation that creates rows must remain part of the canonical create
  path and must not bypass event validation, triggers, or idempotency.

## Saved Views Service

### Current state

`SavedViewsService` already exposes `create`, `update`, and `delete`, but it also exposes `clone`,
`reorder`, and `createDefaultForSchema`. `clone` and `createDefaultForSchema` insert saved views,
while `reorder` updates the sort order of multiple saved views. The clone and reorder operations
are also exposed as API routes, and the default-view operation is used by a durable worker.

### Decision

- `create` will be the single saved-view creation entry point for one view at a time. Clone and
  default-view callers must construct a normal create input before invoking it.
- `update` will be the single saved-view update entry point for one view at a time. Reordering must
  be performed by the caller: read the current order, calculate the new order, and invoke `update`
  for the affected views inside a transaction. The caller must retain validation of duplicate,
  unknown, and tracker-scoped view slugs.
- `delete` will remain the single saved-view deletion entry point.
- `clone`, `reorder`, and `createDefaultForSchema` will not remain public service write methods.
  Their API route and worker concepts may remain, but they must delegate to `create` or `update`.
- Built-in-view mutation protections must remain unchanged. Clones must remain user-owned, and
  default-view creation must preserve its current conflict-as-no-op worker behavior.
- Creation and update behavior must preserve sort-order placement, including placing clones and
  newly tracker-associated views at the end of the relevant order.

## Trackers Service

### Current state

`TrackersService` exposes `create`, `update`, and `reorder`, but no `delete`. `reorder` updates the
sort order of multiple trackers inside a transaction.

### Decision

- `create` will remain the single tracker creation entry point for one tracker.
- `update` will remain the single tracker update entry point for one tracker. It will not gain a
  reorder mode or batch input.
- `reorder` will not remain a public service write method. Its API route may remain, but the caller
  must read the current order, calculate the new order, and invoke `update` for the affected
  trackers inside a transaction.
- Tracker reordering must preserve its current validation for empty, duplicate, and unknown tracker
  ids, as well as the existing ordering algorithm.
- `delete` will not be added because tracker deletion is not currently supported.
- The `tracker_entity_schema` join table is a separate ownership concern. Its writes must not be
  folded into the tracker CRUD methods; that table should be handled when its owning service is
  discussed.

## Follow-up

Implement and verify these decisions one service at a time, beginning with `EntitiesService` and
then `RelationshipsService`, `EventsService`, `SavedViewsService`, and `TrackersService`. Do not
add decisions for later services until they are discussed.
