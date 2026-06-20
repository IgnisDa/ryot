# Service Write Boundaries

## Decision

Each owning service will expose at most one write entry point for each supported CRUD verb:

- `create`
- `update`
- `delete`

Read methods and orchestration methods may have other names, but they must not become alternate
write points for the owned table. An orchestration method that mutates the table must express that
work through the service's canonical CRUD methods. Repository helpers may remain implementation
details behind the service boundary.

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
  global-entity `replaceExisting` behavior.
- `save` will not remain a public service write method.
- Entity deletion is not being added by this plan. If supported later, it will use the service's
  single `delete` entry point.
- The unified `create` and `update` inputs must remain typed and must cover both API and internal
  entity creation/update use cases without exposing a second service-level writer.

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
- `delete` will be the single relationship deletion entry point. Its typed input must cover both
  individual relationships and the required scoped or bulk deletion behavior.
- `save` will not remain a public service write method.
- No public `sync`, `move`, `deleteUserRelationship`, `deleteUserRelationshipsForEntity`, or other
  alternate relationship write method will be added. Batch synchronization and entity-merge
  behavior must be represented through `create`, `update`, and `delete` while preserving atomicity,
  set-based database behavior, and conflict semantics.
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
- `update` will be the single event update entry point, but only for moving event references during
  an entity merge. It must not modify event properties, timestamps, or schemas.
- `delete` will be the single event deletion entry point for the existing user-state clearing
  behavior. It will support scoped deletion by user and entity, including both event and session
  entity references. No API endpoint or single-event deletion operation is required.
- `UserStateService` will use `EventsService` for event-table writes while preserving the transaction
  that coordinates event and relationship changes.
- Event content remains append-only; no general event edit or upsert method will be added.
- Any direct event-workflow invocation that creates rows must remain part of the canonical create
  path and must not bypass event validation, triggers, or idempotency.

## Follow-up

Implement and verify these decisions one service at a time, beginning with `EntitiesService` and
then `RelationshipsService` and `EventsService`. Do not add decisions for later services until they
are discussed.
