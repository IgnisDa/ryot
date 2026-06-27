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

## Entity Schemas Service

### Current state

`EntitySchemasService` exposes `create` for user-defined entity schemas and read/search methods, but
no `update` or `delete`. Creating a schema also creates a `tracker_entity_schema` link in the same
transaction and then schedules default saved-view creation through a durable workflow.

### Decision

- `create` will remain the single entity-schema creation entry point for one schema at a time. No
  creation modes will be added.
- `update` and `delete` will not be added because those operations are not currently supported.
- The `tracker_entity_schema` join table must have an explicit owning service. The current
  `TrackersRepository.linkEntitySchema` write must be moved behind that owner; it must not be
  treated as part of `TrackersService` tracker CRUD.
- Entity-schema creation and its tracker link must remain atomic. The caller may coordinate the two
  simple writes inside the existing transaction.
- Default saved-view creation remains a post-schema workflow. It must use the normal
  `SavedViewsService.create` path and preserve the current conflict-as-no-op behavior.
- Read-only repository access from import and query workflows may remain an implementation detail;
  direct writes must use the owning service.

## Event Schemas Service

### Current state

`EventSchemasService` exposes `create` and read methods, but no `update` or `delete`. Its create
operation validates the parent entity schema, reserved slugs, and event properties schema before
inserting one user-owned event schema.

### Decision

- `create` will remain the single event-schema creation entry point for one schema at a time.
- `update` and `delete` will not be added because those operations are not currently supported.
- No `save`, upsert, or mode-based creation method will be introduced.
- Parent entity-schema access validation, reserved built-in slug protection, properties-schema
  validation, and conflict behavior must be preserved.
- The `event_schema_trigger` table is a separate ownership concern. Built-in seed writes to that
  table must not be folded into `EventSchemasService` CRUD; its owner should be handled separately.
- Read-only repository access from event creation and import workflows may remain an implementation
  detail; direct event-schema writes must use `EventSchemasService`.

## Relationship Schemas Service

### Current state

`RelationshipSchemasService` exposes `create` and read methods, but no `update` or `delete`. Its
create operation validates the referenced entity schemas, reserved built-in slugs, and relationship
properties schema before inserting one user-owned relationship schema.

### Decision

- `create` will remain the single relationship-schema creation entry point for one schema at a time.
- `update` and `delete` will not be added because those operations are not currently supported.
- No `save`, upsert, or mode-based creation method will be introduced.
- Entity-schema access validation, reserved built-in slug protection, properties-schema validation,
  and conflict behavior must be preserved.
- Any future deletion must have an explicit data-loss policy because relationship rows reference
  relationship schemas with cascading deletion.
- Read-only repository access from collections, imports, and media workflows may remain an
  implementation detail; direct relationship-schema writes must use `RelationshipSchemasService`.

## Notifications Service

### Current state

`NotificationsService` already exposes exactly one `create`, `update`, and `delete` method for
notification-platform rows. Its `test` and `trigger` methods enqueue delivery workflows and do not
write notification-platform rows. Delivery code uses the repository read-only.

### Decision

- No structural CRUD refactor is required for `NotificationsService`.
- Keep `create`, `update`, and `delete` as the only notification-platform write methods.
- Preserve user scoping, platform-kind validation, and the current update and delete behavior.
- `test` and `trigger` may remain separate workflow operations because they do not write the owned
  table.
- Repository access from delivery code must remain read-only.

## Integrations Service

### Current state

`IntegrationsService` already exposes exactly one `create`, `update`, and `delete` method for
integration rows. Integration workers, however, directly call `IntegrationsRepository.updateForUser`
to record `lastFinishedAt` and disable integrations after repeated failures.

### Decision

- No additional integration write methods will be added.
- Worker updates must use the existing `update` entry point. Its internal input may support fields
  such as `lastFinishedAt` that are not accepted by the public API payload, without adding methods
  such as `disable` or `markFinished`.
- Each update must remain a single-integration update; no mode-based or batch update input will be
  introduced.
- Provider-specific validation, progress-threshold validation, ownership checks, and workflow
  behavior must be preserved.
- Repository access from metadata lookup and integration workflows may remain read-only. Direct
  integration writes must use `IntegrationsService`.

## Imports Service

### Current state

`ImportsService` exposes orchestration methods such as `startImportRun`,
`createRunForIntegration`, `removeImportRun`, and `failRunForIntegration`. The repository has the
row-level `createRun`, `updateRun`, and `deleteRunById` operations, but import workflows call
`updateRun` directly. The separate `import_run_failure` table is also written directly through
`ImportsRepository.createFailure`.

### Decision

- `create` will be the single `import_run` creation entry point for one run at a time. File
  claiming, source-payload storage, queueing, and failure compensation remain caller/workflow
  orchestration and must not become creation modes.
- `update` will be the single `import_run` update entry point for one run at a time. Status,
  progress, finalization, and failure callers must use it without adding methods such as
  `markStarted`, `fail`, or `updateProgress`.
- `delete` will be the single `import_run` deletion entry point for one run at a time. The caller
  must retain the existing terminal-status check before invoking it; `removeImportRun` must not
  remain a second write path.
- `createRunForIntegration` and other run-start helpers must delegate to `create` rather than
  writing through the repository.
- `import_run_failure` is a separate table and requires an explicit owning service with its own
  narrow `create` entry point. Failure creation must not be folded into `import_run` CRUD.
- All import workflows and status helpers must stop using repository write helpers directly while
  preserving asynchronous status updates, failure recording, cleanup, and queue behavior.

## Translations Service

### Current state

`TranslationsService` currently exposes `requestFill`, which only enqueues the translation
workflow. The workflow writes `entity_translation` directly through
`TranslationsRepository.upsertOverlay`. Each entity-language pair is unique, so the repository
write currently combines insertion and replacement.

### Decision

- `requestFill` will remain workflow orchestration and will not become a table write method.
- `create` will be the single entry point for inserting one translation overlay.
- `update` will be the single entry point for replacing one existing translation overlay.
- The workflow caller will read the existing overlay and choose `create` or `update`; the service
  will not expose an `upsert` method or hide that branch internally.
- `delete` will not be added because translation rows currently have no standalone deletion
  requirement and are removed with their entity through the existing foreign-key cascade.
- The workflow must move the `upsertOverlay` repository write behind the service while preserving
  execution-id idempotency, activity retry behavior, the populated-entity precondition, and the
  translation update notification.
- Any unique-conflict or concurrency handling must remain in the workflow caller rather than
  becoming a complex branch in a CRUD method. Read-only repository methods may remain available.

## God Mode Service

### Current state

`GodModeService` is an administrative orchestration service. It currently performs user-table
writes through `GodModeRepository.updateUserDisabled`, `deleteUser`, and
`deleteAndRecreateUser`; the reset flow also inserts an OIDC account row directly. User
provisioning already uses `AuthService` for user creation and account linking.

### Decision

- `AuthService` will be the canonical write gateway for the Better Auth `user` and `account`
  tables. God-mode code must not write those tables through `GodModeRepository`.
- No generic AuthService CRUD surface will be introduced solely to satisfy this plan. Existing
  methods such as `createAuthUser`, `updateUserPreferences`, and `linkAuthAccount` should remain
  the preferred wrappers where they meet a concrete need; any new wrapper must be added only when a
  specific caller would otherwise access a repository or Better Auth's internal adapter directly.
- `GodModeService` will remain an orchestration service. Methods such as `provisionUser`,
  `setUserDisabled`, `deleteUser`, and `resetUser` will not be replaced by mode-based CRUD methods.
- `setUserDisabled` will read the current row, calculate the desired `disabledAt` value in
  `GodModeService`, and delegate the single-row update to `AuthService`.
- `deleteUser` will retain its snapshot, transaction, session cleanup, and API-key cache cleanup,
  but will delegate the user-row deletion to an existing or minimally added AuthService wrapper
  around the appropriate Better Auth primitive.
- `resetUser` will retain auth-state classification, OIDC preservation, bootstrap, transaction,
  and cleanup decisions in `GodModeService`; it may orchestrate the existing or minimally added
  Better Auth primitive wrappers without introducing a reset or delete-and-recreate write method.
- Any new AuthService wrapper must preserve Better Auth lifecycle behavior and participate in the
  existing transaction boundary where the caller requires atomicity. If Better Auth's internal
  adapter cannot use the current transaction, resolve that integration constraint before migrating
  God Mode; do not restore direct repository writes.
- God-mode repository methods may remain read-only. Auth lifecycle side effects, including session
  invalidation and API-key cache cleanup, must be preserved.

## Sandbox API Service

### Current state

`SandboxApiService` exposes `createScript` as the only `sandbox_script` write. Its `enqueue` and
`getResult` methods only validate access and orchestrate sandbox workflows. There are no current
user-facing update or delete operations for sandbox scripts.

### Decision

- No CRUD refactor is required for `SandboxApiService`.
- `createScript` remains the single user-facing sandbox-script write entry point.
- Preserve slug normalization, metadata and code validation, user ownership checks, and unique-slug
  conflict behavior.
- Do not add clone, update, delete, or upsert methods without a concrete product requirement.
- Any built-in script seeding remains an explicit bootstrap concern and must not become a second
  user-facing write path.

## Follow-up

Implement and verify these decisions one service at a time, beginning with `EntitiesService` and
then `RelationshipsService`, `EventsService`, `SavedViewsService`, `TrackersService`,
`EntitySchemasService`, `EventSchemasService`, `RelationshipSchemasService`,
`NotificationsService`, `IntegrationsService`, `ImportsService`, `TranslationsService`, and
`GodModeService`, and `SandboxApiService`. Do not add decisions for later services until they are
discussed.
