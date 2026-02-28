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

## Integrations Service

### Current state

Implemented. `IntegrationsService` exposes exactly one `create`, `update`, and `delete` method for
integration rows. The `finalizeIntegrationRun` worker now records `lastFinishedAt` and disables
integrations after repeated failures through `IntegrationsService.update` rather than
`IntegrationsRepository.updateForUser`. Metadata lookup and the integration workflow keep their
repository access read-only.

### Checklist

- [x] Do not add additional integration write methods.
- [x] Route worker updates through the existing `update` entry point. Its internal input may support
  fields such as `lastFinishedAt` that are not accepted by the public API payload, without adding
  methods such as `disable` or `markFinished`.
- [x] Keep each update as a single-integration update; do not introduce mode-based or batch update input.
- [x] Preserve provider-specific validation, progress-threshold validation, ownership checks, and
  workflow behavior.
- [x] Keep repository access from metadata lookup and integration workflows read-only. Direct
  integration writes must use `IntegrationsService`.

### Implementation notes

- `IntegrationsService.update` now takes a `UserId` instead of the full `CurrentUserValue` (it only
  ever used `user.id`), so integration workers can call it with `integration.userId`. Its body type
  is an internal `UpdateIntegrationInput` that extends the public `UpdateIntegrationBody` with an
  optional `lastFinishedAt`; the public API route is unaffected.
- To let the worker import `IntegrationsService` without an import cycle
  (`service → integration-workflow → worker → service`), the `ProcessIntegrationRunWorkflow`
  definition was split into a leaf `integration-workflow.ts` and the run/layer implementation moved
  to a new `integration-workflow-live.ts`, following the existing `-workflow` / `-workflow-live`
  convention. `service.ts` and `reconciliation-workflow.ts` import only the leaf definition.
- Adversarial review surfaced that routing bookkeeping writes through `update` re-ran
  progress-threshold validation and re-wrote `providerSpecifics` on every call. `update` now
  validates thresholds only when the caller supplies a threshold field and forwards
  `providerSpecifics` only when the caller supplies it, mirroring the pre-existing
  provider-specifics gating. This keeps validation for real threshold/provider changes while
  preventing a `lastFinishedAt`/`isDisabled` bookkeeping write from being rejected by a
  pre-existing out-of-range threshold (e.g. legacy/migrated rows) or from clobbering a
  concurrently-updated `providerSpecifics`.
- Known behavior change: `update` performs an ownership check, so if an integration is deleted
  during the narrow window between media processing completing and finalization running, the
  finalize step now fails the run instead of silently skipping the `lastFinishedAt` write. This is
  a rare race and a direct consequence of the plan's requirement to route the write through the
  service's ownership-checked entry point; the run row itself is already marked completed.

## Saved Views Service

### Current state

Implemented. `SavedViewsService` exposes one canonical `create`, `update`, and `delete` entry point
for saved views. `clone` and `createDefaultForSchema` construct create inputs and delegate to
`create`; `reorder` reads the scoped order and delegates one sort-order update at a time to `update`
inside a transaction. The clone and reorder operations remain API routes, and the default-view
operation remains owned by its durable worker.

### Checklist

- [x] Keep `create` as the single canonical saved-view creation entry point for one view at a time.
  The `clone` and `createDefaultForSchema` convenience wrappers must construct normal create inputs
  before invoking it.
- [x] Keep `update` as the single canonical saved-view update entry point for one view at a time.
  The `reorder` convenience wrapper must read the current order, calculate the new order, retain
  validation of duplicate, unknown, and tracker-scoped view slugs, and invoke `update` for the affected
  views inside a transaction.
- [x] Keep `delete` as the single saved-view deletion entry point.
- [x] Keep `clone`, `reorder`, and `createDefaultForSchema` as public service convenience wrappers,
  not independent write methods. `clone` and `createDefaultForSchema` must delegate to `create`, and
  `reorder` must delegate to `update` for each affected view. Their API route and worker concepts may
  remain and must invoke these service wrappers.
- [x] Preserve built-in-view mutation protections. Clones must remain user-owned, and default-view
  creation must preserve its current conflict-as-no-op worker behavior.
- [x] Preserve creation and update sort-order placement, including placing clones and newly
  tracker-associated views at the end of the relevant order.

### Implementation notes

- `SavedViewsService.create` accepts internal-only `slug` and `isBuiltin` fields in addition to the
  public create body. The default-view wrapper uses the slug derived from the entity schema slug so
  names such as `All Books` retain the existing `all-book` slug, while clones remain user-owned and
  continue to be placed at the end by the repository.
- `SavedViewsService.reorder` now loads full rows for the requested tracker scope, calculates the
  existing ordering, and calls `update` with an internal `sortOrder` field for each changed view.
  The scoped rows are locked before a fresh ordered read, and the repository batch order writer was
  removed. Built-in updates persist sort order alongside the allowed disabled-state change, so
  reordering does not weaken built-in definition protections or overwrite concurrent changes.
- Custom-schema default views use an id/name-only display configuration because arbitrary user schemas
  cannot be assumed to have the media properties used by built-in layouts. Built-in seeded views still
  use their existing specialized display configurations.
- `QueryEngineService.validate` now accepts only the user id it actually reads and preserves typed
  `DbError` failures. This lets the durable default-view worker use canonical `create` without
  constructing fake user preferences or identity fields or turning validation database failures into
  defects. HTTP routes still apply their existing `dieOnDbError` conversion. Default-view validation
  failures are converted to the queue's `DbError` contract, while duplicate creation remains a
  conflict that the worker treats as a no-op, including the race after its existing check.

## Trackers Service

### Current state

Implemented. `TrackersService` exposes one canonical `create` and `update` entry point for trackers,
plus a `reorder` convenience wrapper. `reorder` reads the scoped order and delegates one sort-order
update at a time to `update` inside a transaction. There is no `delete`. The reorder operation
remains an API route.

### Checklist

- [x] Keep `create` as the single tracker creation entry point for one tracker.
- [x] Keep `update` as the single tracker update entry point for one tracker. It must not gain a
  reorder mode or batch input.
- [x] Keep `reorder` as a public service convenience wrapper over `update`. It must read the current
  order, calculate the new order, and invoke `update` for the affected trackers inside a transaction.
  Its API route may remain and must invoke the service wrapper.
- [x] Preserve tracker reordering validation for empty, duplicate, and unknown tracker ids, as well
  as the existing ordering algorithm.
- [x] Do not add `delete` because tracker deletion is not currently supported.
- [x] Keep the `tracker_entity_schema` join table as a separate ownership concern. Its writes must not
  be folded into tracker CRUD methods; that table should be handled when its owning service is discussed.

### Implementation notes

- `TrackersService.update` now takes an internal `UpdateTrackerInput` that extends the public
  `UpdateTrackerBody` with an optional `sortOrder`; the public API route is unaffected because
  `UpdateTrackerBody` has no `sortOrder`, so route-driven updates never write it. The repository
  `updateOwned` forwards `sortOrder` only when the caller supplies it, mirroring the saved-views
  pattern, so normal config updates leave the existing sort order intact.
- `reorder` now loads full rows for the user via a new `TrackersRepository.listInOrder`, computes the
  reordered ids with the shared `buildReorderedIds` algorithm, and calls `update` with an internal
  `sortOrder` field for each tracker whose position actually changes. The removed batch order writer
  (`persistOrder`) and the id-only `listIdsInOrder` reader are gone; `countOwnedByIds` still provides
  the explicit unknown-id validation before the ordered read.
- Following the saved-views precedent, `listInOrder` locks the user's tracker rows with
  `SELECT ... FOR UPDATE` before the fresh ordered read. This is a deviation from the previous
  lock-free reorder: it closes the lost-update window that the read-modify-write in the delegated
  `update` calls would otherwise widen, and keeps the isDisabled/config snapshot consistent with the
  per-row `getOwnedById` re-read inside the same transaction.
- Known behavior consequences of routing reorder through `update`: (1) trackers already at their
  target position are skipped, so their `updatedAt` is no longer bumped on every reorder; (2) each
  delegated `update` re-runs `resolveUpdatePayload`, which falls back to the current `name`, `icon`,
  and `accentColor`. Those columns are `NOT NULL` and are populated non-empty by `create`, so this
  does not reject any well-formed row, but a legacy row with a blank required field would now fail a
  reorder instead of silently persisting sort order. Both mirror the saved-views reorder refactor.

## Entities Service

### Current state

Implemented. `EntitiesService` exposes one canonical `create` and one `update` entry point; the public
`save` method is gone. `create` is idempotent (insert-or-return-existing) and never modifies an
existing entity. `update` is the sole path for changing an existing entity, including the
global-entity replacement behavior; every caller resolves the existing entity before invoking it.
There is no `delete`.

### Checklist

- [x] Keep `create` as the single entity creation entry point for API and internal callers.
- [x] Allow `create` to be idempotent when a matching entity already exists, but do not let it modify
  that existing entity.
- [x] Keep `update` as the single entry point for changes to an existing entity, including the current
  global-entity replacement behavior. Callers must resolve the existing entity before invoking it;
  `create` must not replace an existing entity as a conflict mode.
- [x] Do not retain `save` as a public service write method.
- [x] Do not add entity deletion through this plan. If supported later, it will use the service's
  single `delete` entry point.
- [x] Keep the `create` and `update` inputs typed and focused on one entity operation. Callers must
  perform source-specific normalization and conflict resolution before invoking them.

### Implementation notes

- The repository `saveEntity` was split into `insertEntity` and `updateEntity`. `insertEntity` keeps
  the idempotent `ON CONFLICT DO NOTHING` insert-or-return for both global and user-with-provenance
  rows and drops the `onConflict` discriminator along with the two modify-existing branches
  (`replaceExisting` and the `populatedAt` first-population upgrade). `updateEntity` writes `name`,
  `properties`, and `populatedAt` by id. `SaveEntityInputBase`/`SaveEntityInput` were renamed to
  `InsertEntityInputBase`/`InsertEntityInput`, and `UpdateEntityInput` was added.
- `EntitiesService.create` takes a typed, scope-discriminated `CreateEntityInput` (the old
  `SaveEntityInput` minus `onConflict`) rather than `(user, CreateEntityBody)`. HTTP-specific
  normalization now lives in the `CreateEntityBody` Effect schema (`libs/contract`): `entitySchemaId`
  trims and requires non-empty (`Schema.Trim` + filter + brand), and `externalId`/`sandboxScriptId`
  trim and drop to `undefined` when empty via a `Schema.transform`. The route just forwards the
  decoded, user-scoped payload. `update` takes `{ entityId, entitySchemaId, name, properties,
  populatedAt }`; it re-reads the schema by `entitySchemaId` to validate properties before writing.
- `EntitiesService.upsert` is a convenience wrapper (not a fourth canonical write) that resolves the
  existing global entity via `findGlobalEntityByExternalId`, then delegates to canonical `create`
  (absent), `update` (`updateExisting`, or an existing unpopulated skeleton), or preserves the
  existing row. Its selection logic is unit-tested in `entities/service.test.ts`.
- `create` now enforces the non-empty-name invariant (`requireText`) for every scope. Previously only
  the API/user path validated the name; global provider-population writes accepted any string. This is
  a deliberate, minor tightening (provider `details` drivers always supply a name) plus name trimming
  for global rows.
- Global-entity replacement is now caller-orchestrated through `upsert`.
  `provider-entity-population-workflow`'s `writeEntityGraph` calls `entities.upsert` inside its
  transaction (`updateExisting = mode !== "refresh"`, `populatedAt: null`) to create the skeleton or
  update-on-initial / preserve-on-refresh, then stamps `populatedAt` with a second `update`.
  `population.ts` `processNode` calls `entities.upsert` per child (`updateExisting = syncExisting`).
  This replaced the duplicated read-then-`create`/`update` blocks at both sites. `media-trending`,
  `relationship-population`, the workout and measurement importers, and the collections service call
  only `create`.
- Known behavior consequence: the old first-population upgrade carried a `WHERE populatedAt IS NULL`
  concurrency guard; the read-then-`update` flow replaces it with a caller-side
  `existing.populatedAt === null` check performed inside the same transaction. This mirrors the
  saved-views/trackers reorder refactors' read-modify-write window and is a direct consequence of the
  plan's requirement that callers resolve the existing entity before calling `update`.
- Test consequence: the `create`-versus-`update`-versus-preserve selection is owned by `upsert` and
  unit-tested in `entities/service.test.ts` (real service + mocked repository). The
  provider-population workflow tests mock `EntitiesService`, so they are now orchestration tests: they
  assert the workflow passes the right `upsert` arguments (notably `updateExisting`) for the primary
  and each child, that related placeholders still go through `create`, and that the final stamp goes
  through `update`.

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
