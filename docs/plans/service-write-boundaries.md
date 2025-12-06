# Service Write Boundaries

## Decision

Each owning service will expose at most one canonical write entry point for each supported CRUD verb:

- `create`
- `update`
- `delete`

- CRUD methods must remain narrow and single-purpose. Do not add mode-based or discriminated branches
  to make cloning, reordering, synchronization, merging, or bulk behavior fit into a CRUD method.
- Service-level convenience and orchestration methods may have other names and remain public when they
  delegate to canonical CRUD methods in the same service. They may validate inputs, construct CRUD
  inputs, and orchestrate multiple canonical calls, but they must not implement independent upsert or
  table-write behavior.
- Callers and service-level orchestration wrappers must own the surrounding transaction for multi-write
  operations. Repository helpers may remain implementation details, but callers and wrappers must not
  use repository write helpers directly.
- A convenience or orchestration wrapper is not an alternate write point when all owned-table writes
  flow through the service's canonical CRUD methods.
- Extend this plan one service at a time.

## Event Schemas Service

### Current state

`EventSchemasService` exposes `create` and read methods, but no `update` or `delete`. Its create
operation validates the parent entity schema, reserved slugs, and event properties schema before
inserting one user-owned event schema.

### Checklist

- [ ] Keep `create` as the single event-schema creation entry point for one schema at a time.
- [ ] Do not add `update` or `delete` because those operations are not currently supported.
- [ ] Do not introduce `save`, upsert, or mode-based creation methods.
- [ ] Preserve parent entity-schema access validation, reserved built-in slug protection,
  properties-schema validation, and conflict behavior.
- [ ] Keep the `event_schema_trigger` table as a separate ownership concern. Built-in seed writes to
  that table must not be folded into `EventSchemasService` CRUD; its owner should be handled separately.
- [ ] Keep read-only repository access from event creation and import workflows as an implementation
  detail; direct event-schema writes must use `EventSchemasService`.

## Relationship Schemas Service

### Current state

`RelationshipSchemasService` exposes `create` and read methods, but no `update` or `delete`. Its
create operation validates the referenced entity schemas, reserved built-in slugs, and relationship
properties schema before inserting one user-owned relationship schema.

### Checklist

- [ ] Keep `create` as the single relationship-schema creation entry point for one schema at a time.
- [ ] Do not add `update` or `delete` because those operations are not currently supported.
- [ ] Do not introduce `save`, upsert, or mode-based creation methods.
- [ ] Preserve entity-schema access validation, reserved built-in slug protection, properties-schema
  validation, and conflict behavior.
- [ ] Treat any future deletion as requiring an explicit data-loss policy because relationship rows
  reference relationship schemas with cascading deletion.
- [ ] Keep read-only repository access from collections, imports, and media workflows as an implementation
  detail; direct relationship-schema writes must use `RelationshipSchemasService`.

## Entity Schemas Service

### Current state

`EntitySchemasService` exposes `create` for user-defined entity schemas and read/search methods, but
no `update` or `delete`. Creating a schema also creates a `tracker_entity_schema` link in the same
transaction and then schedules default saved-view creation through a durable workflow.

### Checklist

- [ ] Keep `create` as the single entity-schema creation entry point for one schema at a time. Do not
  add creation modes.
- [ ] Do not add `update` and `delete` because those operations are not currently supported.
- [ ] Give the `tracker_entity_schema` join table an explicit owning service. The current
  `TrackersRepository.linkEntitySchema` write must be moved behind that owner; it must not be treated
  as part of `TrackersService` tracker CRUD.
- [ ] Keep entity-schema creation and its tracker link atomic. The caller may coordinate the two simple
  writes inside the existing transaction.
- [ ] Keep default saved-view creation as a post-schema workflow. Its
  `SavedViewsService.createDefaultForSchema` convenience wrapper must delegate to the normal
  `SavedViewsService.create` path and preserve the current conflict-as-no-op behavior.
- [ ] Keep read-only repository access from import and query workflows as an implementation detail;
  direct writes must use the owning service.

## Integrations Service

### Current state

`IntegrationsService` already exposes exactly one `create`, `update`, and `delete` method for
integration rows. Integration workers, however, directly call `IntegrationsRepository.updateForUser`
to record `lastFinishedAt` and disable integrations after repeated failures.

### Checklist

- [ ] Do not add additional integration write methods.
- [ ] Route worker updates through the existing `update` entry point. Its internal input may support
  fields such as `lastFinishedAt` that are not accepted by the public API payload, without adding
  methods such as `disable` or `markFinished`.
- [ ] Keep each update as a single-integration update; do not introduce mode-based or batch update input.
- [ ] Preserve provider-specific validation, progress-threshold validation, ownership checks, and
  workflow behavior.
- [ ] Keep repository access from metadata lookup and integration workflows read-only. Direct
  integration writes must use `IntegrationsService`.

## Saved Views Service

### Current state

`SavedViewsService` already exposes `create`, `update`, and `delete`, but it also exposes `clone`,
`reorder`, and `createDefaultForSchema`. `clone` and `createDefaultForSchema` insert saved views,
while `reorder` updates the sort order of multiple saved views. The clone and reorder operations are
also exposed as API routes, and the default-view operation is used by a durable worker.

### Checklist

- [ ] Keep `create` as the single canonical saved-view creation entry point for one view at a time.
  The `clone` and `createDefaultForSchema` convenience wrappers must construct normal create inputs
  before invoking it.
- [ ] Keep `update` as the single canonical saved-view update entry point for one view at a time.
  The `reorder` convenience wrapper must read the current order, calculate the new order, retain
  validation of duplicate, unknown, and tracker-scoped view slugs, and invoke `update` for the affected
  views inside a transaction.
- [ ] Keep `delete` as the single saved-view deletion entry point.
- [ ] Keep `clone`, `reorder`, and `createDefaultForSchema` as public service convenience wrappers,
  not independent write methods. `clone` and `createDefaultForSchema` must delegate to `create`, and
  `reorder` must delegate to `update` for each affected view. Their API route and worker concepts may
  remain and must invoke these service wrappers.
- [ ] Preserve built-in-view mutation protections. Clones must remain user-owned, and default-view
  creation must preserve its current conflict-as-no-op worker behavior.
- [ ] Preserve creation and update sort-order placement, including placing clones and newly
  tracker-associated views at the end of the relevant order.

## Trackers Service

### Current state

`TrackersService` exposes `create`, `update`, and `reorder`, but no `delete`. `reorder` updates the
sort order of multiple trackers inside a transaction.

### Checklist

- [ ] Keep `create` as the single tracker creation entry point for one tracker.
- [ ] Keep `update` as the single tracker update entry point for one tracker. It must not gain a
  reorder mode or batch input.
- [ ] Keep `reorder` as a public service convenience wrapper over `update`. It must read the current
  order, calculate the new order, and invoke `update` for the affected trackers inside a transaction.
  Its API route may remain and must invoke the service wrapper.
- [ ] Preserve tracker reordering validation for empty, duplicate, and unknown tracker ids, as well
  as the existing ordering algorithm.
- [ ] Do not add `delete` because tracker deletion is not currently supported.
- [ ] Keep the `tracker_entity_schema` join table as a separate ownership concern. Its writes must not
  be folded into tracker CRUD methods; that table should be handled when its owning service is discussed.

## Entities Service

### Current state

`EntitiesService` exposes both `save` and `create`. `create` handles request-specific normalization,
validation, and provenance deduplication before delegating to `save`. `save` is also used by internal
workflows and currently contains conflict behavior that can replace an existing global entity.

### Checklist

- [ ] Keep `create` as the single entity creation entry point for API and internal callers.
- [ ] Allow `create` to be idempotent when a matching entity already exists, but do not let it modify
  that existing entity.
- [ ] Keep `update` as the single entry point for changes to an existing entity, including the current
  global-entity replacement behavior. Callers must resolve the existing entity before invoking it;
  `create` must not replace an existing entity as a conflict mode.
- [ ] Do not retain `save` as a public service write method.
- [ ] Do not add entity deletion through this plan. If supported later, it will use the service's
  single `delete` entry point.
- [ ] Keep the `create` and `update` inputs typed and focused on one entity operation. Callers must
  perform source-specific normalization and conflict resolution before invoking them.

## Relationships Service

### Current state

`RelationshipsService` exposes `save`, which delegates to `RelationshipsRepository.saveRelationship`.
The repository's `onConflict` input makes that operation serve both creation and updating: it can
preserve an existing relationship or replace its properties. The repository also exposes separate
write helpers for deleting one relationship, synchronizing global relationships, deleting all user
relationships for an entity, and moving relationships during an entity merge.

Several modules currently call those repository write helpers directly, including collections, entity
imports, media monitoring, media trending, and user state.

### Checklist

- [ ] Keep `create` as the single relationship creation entry point. It must not modify an existing
  relationship; where idempotent behavior is required, it may return the existing relationship with
  `wasInserted: false`.
- [ ] Keep `update` as the single relationship update entry point. It must modify existing
  relationships only and must not upsert.
- [ ] Keep `delete` as the single relationship deletion entry point for one relationship at a time.
- [ ] Do not retain `save` as a public service write method.
- [ ] Do not add public `sync`, `move`, `deleteUserRelationship`, `deleteUserRelationshipsForEntity`,
  or other alternate relationship write methods. Callers performing batch synchronization, entity
  merges, or scoped deletion must read the affected relationships and orchestrate simple `create`,
  `update`, and `delete` calls inside the existing transaction boundaries.
- [ ] Route all modules currently writing through `RelationshipsRepository` through
  `RelationshipsService`.
- [ ] Preserve relationship property validation, global versus user scope, collection membership
  event behavior, authoritative versus additive synchronization, and entity-merge behavior.

## Events Service

### Current state

`EventsService` exposes `create` and `listForUser`, but no `delete` or `update`. Event creation is
workflow-backed: `create` validates and enqueues the durable event-create workflow, which persists
events through `EventsRepository`. `UserStateService` also writes to the event table directly through
repository operations that delete events for an entity and move events during an entity merge.

### Checklist

- [ ] Keep `create` as the single event creation entry point. Preserve its workflow-backed validation,
  before/after triggers, and execution-id idempotency. The durable workflow and its repository insert
  are implementation details of this service-owned create path.
- [ ] Keep `update` as the single event update entry point for moving one event's entity references
  during an entity merge. It must not modify event properties, timestamps, or schemas.
- [ ] Keep `delete` as the single event deletion entry point for one event. `UserStateService` will
  read the events matching its clear-state criteria and orchestrate individual deletes. No API endpoint
  or single-event deletion route is required.
- [ ] Route `UserStateService` event-table writes through `EventsService` while preserving the
  transaction that coordinates event and relationship changes.
- [ ] Keep event content append-only; do not add a general event edit or upsert method.
- [ ] Keep any direct event-workflow invocation that creates rows part of the canonical create path;
  it must not bypass event validation, triggers, or idempotency.

## Translations Service

### Current state

`TranslationsService` currently exposes `requestFill`, which only enqueues the translation workflow.
The workflow writes `entity_translation` directly through `TranslationsRepository.upsertOverlay`. Each
entity-language pair is unique, so the repository write currently combines insertion and replacement.

### Checklist

- [ ] Keep `requestFill` as workflow orchestration and do not make it a table write method.
- [ ] Keep `create` as the single entry point for inserting one translation overlay.
- [ ] Keep `update` as the single entry point for replacing one existing translation overlay.
- [ ] Make the workflow caller read the existing overlay and choose `create` or `update`; the service
  must not expose an `upsert` method or hide that branch internally.
- [ ] Do not add `delete` because translation rows currently have no standalone deletion requirement
  and are removed with their entity through the existing foreign-key cascade.
- [ ] Move the `upsertOverlay` repository write behind the service while preserving execution-id
  idempotency, activity retry behavior, the populated-entity precondition, and the translation update
  notification.
- [ ] Keep any unique-conflict or concurrency handling in the workflow caller rather than adding a
  complex branch in a CRUD method. Read-only repository methods may remain available.

## Imports Service

### Current state

`ImportsService` exposes orchestration methods such as `startImportRun`, `createRunForIntegration`,
`removeImportRun`, and `failRunForIntegration`. The repository has the row-level `createRun`,
`updateRun`, and `deleteRunById` operations, but import workflows call `updateRun` directly. The
separate `import_run_failure` table is also written directly through `ImportsRepository.createFailure`.

### Checklist

- [ ] Keep `create` as the single canonical `import_run` creation entry point for one run at a time.
  File claiming, source-payload storage, queueing, and failure compensation remain orchestration in
  `startImportRun`, `createRunForIntegration`, and related helpers; those helpers must delegate to
  `create` rather than implement creation modes.
- [ ] Keep `update` as the single canonical `import_run` update entry point for one run at a time.
  Status, progress, finalization, and failure helpers may remain service-level wrappers, but they must
  delegate to `update` without adding independent write methods such as `markStarted`, `fail`, or
  `updateProgress`.
- [ ] Keep `delete` as the single canonical `import_run` deletion entry point for one run at a time.
  `removeImportRun` may remain as a convenience wrapper that retains the existing terminal-status
  check before delegating to `delete`; it must not implement a second write path.
- [ ] Give `import_run_failure` an explicit owning service with its own narrow `create` entry point.
  Failure creation must not be folded into `import_run` CRUD.
- [ ] Stop all import workflows and status helpers from using repository write helpers directly while
  preserving asynchronous status updates, failure recording, cleanup, and queue behavior.

## God Mode Service

### Current state

`GodModeService` is an administrative orchestration service. It currently performs user-table writes
through `GodModeRepository.updateUserDisabled`, `deleteUser`, and `deleteAndRecreateUser`; the reset
flow also inserts an OIDC account row directly. User provisioning already uses `AuthService` for user
creation and account linking.

### Checklist

- [ ] Make `AuthService` the canonical write gateway for the Better Auth `user` and `account` tables.
  God-mode code must not write those tables through `GodModeRepository`.
- [ ] Do not introduce a generic AuthService CRUD surface solely to satisfy this plan. Existing methods
  such as `createAuthUser`, `updateUserPreferences`, and `linkAuthAccount` should remain the preferred
  wrappers where they meet a concrete need; add any new wrapper only when a specific caller would
  otherwise access a repository or Better Auth's internal adapter directly.
- [ ] Keep `GodModeService` as an orchestration service. Methods such as `provisionUser`,
  `setUserDisabled`, `deleteUser`, and `resetUser` must not be replaced by mode-based CRUD methods.
- [ ] Make `setUserDisabled` read the current row, calculate the desired `disabledAt` value in
  `GodModeService`, and delegate the single-row update to `AuthService`.
- [ ] Make `deleteUser` retain its snapshot, transaction, session cleanup, and API-key cache cleanup,
  but delegate the user-row deletion to an existing or minimally added AuthService wrapper around the
  appropriate Better Auth primitive.
- [ ] Make `resetUser` retain auth-state classification, OIDC preservation, bootstrap, transaction,
  and cleanup decisions in `GodModeService`; it may orchestrate the existing or minimally added
  Better Auth primitive wrappers without introducing a reset or delete-and-recreate write method.
- [ ] Make any new AuthService wrapper preserve Better Auth lifecycle behavior and participate in the
  existing transaction boundary where the caller requires atomicity. If Better Auth's internal adapter
  cannot use the current transaction, resolve that integration constraint before migrating God Mode; do
  not restore direct repository writes.
- [ ] Keep god-mode repository methods read-only. Preserve auth lifecycle side effects, including
  session invalidation and API-key cache cleanup.

## Built-in Initialization

### Current state

`builtins/seed.ts` reconciles global system rows such as built-in entity, event, and relationship
schemas, sandbox scripts, triggers, and links. `builtins/bootstrap.ts` creates per-user defaults such
as trackers, tracker-schema links, saved views, and the library entity. Both paths perform direct
database writes because they coordinate multi-table initialization and reconciliation.

### Checklist

- [ ] Keep `builtins/seed.ts` as an explicit system-initialization exception. It may reconcile global
  built-in rows directly within its transaction; this must not become a user-facing write path.
- [ ] Do not add `seed`, `ensure`, `upsert`, or built-in modes to user-facing CRUD methods solely for
  system reconciliation.
- [ ] Make `builtins/bootstrap.ts` use owning service write methods for per-user rows where practical,
  while retaining orchestration and transaction control in the bootstrap caller.
- [ ] Keep bootstrap transactional and idempotent. Reconciliation must only update or replace rows
  owned by the bootstrap process and must not overwrite user-customized rows.
- [ ] Give join tables written by bootstrap explicit ownership and apply the same service-boundary rule.
- [ ] Outside these initialization paths, route all runtime and user-facing writes through the owning
  service entry point.

## Implementation Checklist

- [ ] Implement and verify these decisions one service at a time in the documented section order.
- [ ] Do not add decisions for later services until they are discussed.
- [ ] After the service decisions are complete, begin implementation with the first service in this
  document and proceed through the documented section order.
