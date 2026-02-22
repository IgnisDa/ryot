# Database-Driven Automations, Signals, and Subscriptions

## Purpose

Build one database-driven automation system for schema lifecycle hooks, semantic domain signals, user subscriptions, notifications, and future custom sandbox actions.

The system must treat built-in and user-created entity, event, relationship, and signal schemas uniformly. Domain concepts such as “an episode was discovered” must be defined by seeded database rows and sandbox scripts rather than TypeScript notification enums or feature-specific delivery branches.

V2 is greenfield and has no existing V2 user data. Breaking its current tables and contracts is acceptable. Legacy bootstrap intentionally discards V1 notification platforms, credentials, and configured-event preferences. Migrated users receive the same active default subscriptions as new users through `bootstrapNewUser` and create new channels themselves.

Reset and regenerate the unreleased V2 Drizzle migration history as part of this feature. The
baseline is a single squashed snapshot regenerated in place whenever a phase changes the schema,
so every phase keeps a working database for its own code: the Phase 1 baseline still contains
`event_schema_trigger` and `notification_platform.configured_events` because runtime code needs
them until phases 2–3 land, while the released baseline creates `notification_channel` directly
and never creates a V2 `notification_platform`. Existing V2 development/test databases must be
rebuilt against the current baseline; only V1 data is supported through legacy bootstrap.

## Decisions

- Replace `event_schema_trigger`; do not maintain a second event-only trigger system.
- Use **automation** as the umbrella feature.
- A **policy** is synchronous sandbox logic that runs before a schema write and may allow, replace, or reject it.
- A **subscription** is asynchronous post-commit sandbox logic. It cannot affect the completed operation, and its failure is isolated.
- A **signal** is a persisted semantic occurrence defined by a database-backed **signal schema**.
- Keep the existing `event` terminology for temporal records attached to entities. Signals are distinct automation messages.
- Consider notification destinations **channels**, not event subscriptions. Rename the database table `notification_platform` to `notification_channel` and use channel terminology in public contracts as part of this breaking change.
- A subscription references a reusable sandbox script. Subscribing never creates a duplicate copy of script code.
- Ship built-in subscriptions/actions first, while making custom scripts, custom schemas, and custom signals the intended end state.
- Private review automation applies only to the review author. V1’s public/cross-user `ReviewPosted` behavior remains excluded.
- The built-in notification action sends to all enabled channels belonging to the subscription user.
- Persist signals, resolved recipients, and subscription execution history.
- Application code owns generic lifecycle capture, transactions, authorization, validation, and durable dispatch. Schema-derived semantic detection and notification message construction belong in database-linked sandbox scripts. A non-schema application workflow may emit a seeded built-in signal directly when it is the authoritative source of that fact, but it cannot choose recipients or construct the notification message.

## Current State Being Replaced

- `event_schema_trigger` supports `before_create` and `after_create` scripts only for event schemas. Built-in after-create behavior includes auto-completion and integration pushes; there is no authenticated trigger-management API.
- Entity and relationship schemas have no corresponding lifecycle hooks.
- Notification preferences live in `notification_platform.configured_events`, backed by the closed `NotificationEventType` literal union.
- `modules/media-monitoring` computes domain-specific TypeScript diffs and directly starts `NotificationDeliveryWorkflow` for monitoring users.
- Sandbox host functions are capability-allowlisted per script, with the authenticated user and execution identity appended by the runtime.
- After-create event scripts already demonstrate deterministic, fire-and-forget sandbox dispatch, but there is no durable user-facing subscription-run history.

## Terminology and Model

### Policy

A policy binds a sandbox script to a schema lifecycle operation before persistence. Policies are ordered and synchronous. The initial implementation preserves the existing event `before_create` behavior; entity and relationship policies are part of the extensible model but need not be exposed until their write contracts are defined.

Policies form a sequential reducer over a canonical write draft. Each policy receives the valid,
authorized draft produced by the preceding policy. `allow` passes it through, `skip` stops the chain
as a successful no-op, and `replace` may change only fields explicitly allowed by the source
contract. Normalize, schema-validate, and reauthorize every replacement immediately; invalid
output, an unauthorized reference, or script failure rejects that record's write. Policies cannot
replace the actor, owner, schema, operation, origin, or relationship endpoints unless a future
source contract explicitly permits it. The initial event contract permits replacement of only
`properties`, `occurredAt`, and `sessionEntityId`.

### Subscription

A subscription binds a sandbox script to either:

- a lifecycle operation on an entity, event, or relationship schema; or
- a semantic signal schema.

Subscriptions run after commit through durable workflows. Multiple matching subscriptions are independent and may run concurrently.

Every installed notification subscription is a user-owned `automation_rule` row. The row is the
user's lightweight binding and references shared built-in target schemas and notification script;
script code is never copied. Signal dispatch resolves active signal-targeted rules whose owners are
present in the snapshotted recipient set. Global built-in rules are reserved for unconditional
policies, lifecycle detectors, and other system behavior, and cannot notify users directly.

Enforce that restriction through capability resolution, not convention. The effective host
functions for a run are the intersection of the script metadata allowlist, the execution
principal's ceiling, and the rule's ceiling. A global built-in rule never receives
`sendNotification`, even when processing a user-owned row and therefore running with that user's
data authority. Detector scripts receive `emitSignal` but not `sendNotification`. Built-in seeding
and rule mutation must reject a global built-in rule whose script requests the forbidden
capability, while runtime intersection remains defense in depth. User-owned rules may receive
`sendNotification` only when their referenced script explicitly allowlists it.

Direct sandbox execution is a fourth ceiling, enforced at the shared choke point rather than in
`RunSandboxWorkflow` alone: internal paths such as provider population, event policies, and
integrations call `SandboxExecutionQueue` directly, so the queue payload carries a trusted
server-set execution kind — `subscription`, `policy`, `provider`, or `direct` — that public
enqueue can neither supply nor override, and the queue worker resolves the effective host
functions from it. The capability matrix by kind:

- `emitSignal` and `sendNotification` exist only in `subscription` kind, which supplies the
  `automation_effect` parent and `effectKey` semantics. `policy`, `provider`, and `direct` runs
  never receive them, regardless of the script's own allowlist.
- `createEvents` remains available to `direct` runs, preserving current behavior: those writes
  carry the `automation` origin with the run's execution ID and dispatch as root occurrences at
  depth zero, outside any effect ledger. `policy` and `provider` runs never receive it. In
  `subscription` kind it is ledger-tracked like every automation-producing write.
- `httpCall` stays available in every kind under per-script allowlists, because providers depend
  on it for data fetches including POST-based queries. Only `subscription` invocations are
  ledger-tracked and consume host-call budget; externally mutating `httpCall` use outside
  subscriptions is a built-in script-review concern, not a runtime distinction the worker can
  enforce.
- Cache primitives such as `claimCachedValue` and read-only lookups are not ledger effects and
  remain available in every kind under per-script allowlists.

### Signal

A signal is a schema-validated semantic fact such as:

- `media.episode.discovered`
- `integration.disabled`
- `media.status.changed`
- `media.release-date.changed`
- a user-defined `reading.streak-reached`

Built-in signal schemas are seeded like built-in entity schemas. User-created signal schemas remain
part of the intended end state but are not implemented or exposed in the initial release. Initial
signal schemas are seeded built-ins, and only built-in scripts or trusted application workflows may
emit them. Custom signal schema creation and user-script signal emission move together to the later
custom-automation phase.

## Persistence

### `signal_schema`

Store:

- `id`, `slug`, `name`, `user_id`, `is_builtin`
- `properties_schema`, using the same property-schema model as other schemas
- `audience_policy`
- `catalog_state`: `active` or `hidden`
- optional `archived_at`, reserved for future user-owned schemas
- timestamps

Use the same global/user uniqueness convention as existing schema tables. Future user-created
signal schemas support actor-only audiences. Broader cross-user policies remain restricted to
trusted built-ins.

Built-in signal schemas are never hard-deleted; incompatible contracts use successor slugs. When
custom signal schemas arrive, their delete operation archives the schema instead of removing it.
Archival transactionally deactivates targeting rules and prevents new rules or emissions while
retaining the schema and historical signals. Account deletion remains the exception and removes
that user's custom schemas with the rest of their private data.

Initial audience policies:

```ts
type SignalAudiencePolicy =
	| { kind: "actor" }
	| {
		kind: "related_users";
		relationshipSchemaId: RelationshipSchemaId;
		subjectSide: "source" | "target";
	};
```

For `related_users`, resolve non-null `relationship.user_id` values on relationships matching the signal’s subject entity and configured relationship schema. Set the semantic signal’s subject to the entity that owns the audience relationship; for a new show season, this is the parent show rather than the season row.

Audience-policy prerequisites are validated before insertion: `actor` requires a non-null
`actor_user_id`, while `related_users` requires a non-null `subject_entity_id` and a valid visible
relationship schema. The subject may become null later only through its `ON DELETE SET NULL`
foreign key. A valid related-user signal may still resolve an empty audience. Initial
`related_users` signals have no actor; this keeps them independent of any recipient account.

### `signal`

Store:

- `id`, `signal_schema_id`
- optional `actor_user_id` and `subject_entity_id`; the subject FK uses `ON DELETE SET NULL`
- validated `properties`
- server-derived origin
- `occurred_at`, `created_at`
- optional `causation_id` and `correlation_id`
- automation depth

Signal creation and recipient resolution happen atomically. No caller may provide arbitrary recipient user IDs.

`created_at` is always the insertion time. `occurred_at` is when Ryot observed or authoritatively
produced the fact. Lifecycle detectors inherit the lifecycle occurrence's commit time rather than a
mutable domain timestamp stored on the record. Observation signals keep provider release dates in
their validated properties instead of backdating the occurrence. Only a trusted authoritative
source, such as the future calendar producer, may override the inherited occurrence time. Public
callers cannot provide signal timestamps. Expose both timestamps in signal snapshots.

A signal is an immutable, self-contained fact rather than a live view of its subject. Its
schema-validated properties must contain the minimal display data needed by consumers, such as the
subject name and old/new values. The subject entity ID is only an optional navigation reference.
Signal snapshots use stored schema identity, properties, occurrence time, and origin and never
refresh entity properties at execution time.

### `signal_recipient`

Snapshot the authorized audience at emission time using `(signal_id, user_id)`. Subscription dispatch must use this snapshot so later monitoring/unmonitoring does not change an already-emitted signal’s audience. Denormalize `signal_created_at` and `signal_schema_id` onto the recipient row so recipient-scoped pagination and schema filtering index directly instead of joining `signal` for every page.

Recipient user deletion cascades only that recipient row and the user's private subscription runs;
the shared signal remains visible to its other recipients. Account deletion removes private
actor-audience signals entirely. Thus deleting one account cannot erase another recipient's
related-user signal history.

Persist the signal even when audience resolution produces no recipients. The empty recipient set is
an immutable snapshot: dispatch creates no runs, duplicate emission returns the existing signal
without resolving the audience again, and the signal is invisible through user-facing APIs.

### `automation_rule`

Replace `event_schema_trigger` with a generalized rule table containing:

- identity, ownership, name, built-in/active flags, timestamps
- `kind`: `policy` or `subscription`
- `operation`: `create`, `update`, `delete`, or `signal`; lifecycle rules initially expose `create` plus the built-in-only entity and relationship update/delete detectors required by media monitoring
- sandbox script ID
- optional ordering position for policies
- rule configuration/metadata
- exactly one target FK: entity schema, event schema, relationship schema, or signal schema

Enforce exactly one target with a database check. Index every target FK. Preserve real FKs and cascading deletion rather than using an unchecked polymorphic string ID.

Also enforce that a signal-schema target has `kind = "subscription"` and `operation = "signal"`.
Entity-, event-, and relationship-schema targets cannot use the `signal` operation, and policies
cannot target signal schemas.

Rules owned by a user may reference that user’s scripts or shared built-in scripts. The service must verify schema visibility, rule ownership, and script ownership when creating or updating a rule.

Database constraints own structural integrity only: exactly one target, target/operation
compatibility, and real foreign keys. Cross-table ownership and visibility rules are enforced
transactionally by the automation service because a user rule may reference either user-owned or
global built-in schemas and scripts. Service tests must cover every allowed and forbidden ownership
combination.

Built-in rule seeding must be idempotent. User rules should be unique per user, target, operation, and script in the initial model.
Because the four target FKs are nullable and PostgreSQL treats nulls as distinct, implement this
with per-target partial unique indexes: for user rules,
`(user_id, target_id, operation, sandbox_script_id) WHERE target_id IS NOT NULL AND user_id IS NOT NULL`;
for global built-in rules, `(target_id, operation, sandbox_script_id) WHERE user_id IS NULL`,
excluding the nullable `user_id` from the indexed columns because a null column value never
collides. This follows the schema's existing partial-index convention.

Allow at most 256 user-owned automation rules per user. Active, inactive, and
bootstrap-installed notification rules all count toward the same limit. Enforce the limit inside
the rule-creation transaction while locking the owning user row so concurrent creates cannot
exceed it. Global built-in rules do not consume a user's quota.

Treat each built-in signal schema's slug, properties schema, and audience policy as an immutable
contract. Idempotent seeding may update display name and catalog state, but it must fail loudly if
an existing contract field differs. Any payload or audience change uses a new schema slug; retain
the old schema for historical signals and existing rules, and let consumer scripts support both
during an explicit migration. Do not introduce signal-schema revision tables initially.

### `subscription_run`

Persist one row per subscription execution:

- deterministic ID/execution ID
- optional execution user ID and an optional rule FK using `ON DELETE SET NULL`
- an indexed scalar `original_rule_id` column plus an immutable rule snapshot containing the rule name, target, operation, sandbox script ID, normalized rule configuration/metadata, and the effective capability ceiling resolved at dispatch
- optional signal ID
- lifecycle occurrence ID, source kind, operation, and record ID when signal ID is absent
- queued/running/succeeded/failed/skipped status, with a structured reason for skipped runs
- sandbox script `updated_at` and a hash of the code and metadata used for execution
- sanitized trigger snapshot
- sandbox value, logs, error, and timing
- queued, started, and finished timestamps

Bound persisted execution artifacts by their UTF-8 JSON/string representation:

- a sandbox return value may use at most 64 KiB; exceeding the limit fails the run with the typed `result_too_large` reason and stores only bounded failure metadata
- retain at most 100 log entries, 4 KiB per entry, and 64 KiB combined; truncate excess logs with an explicit marker without changing an otherwise successful run
- retain at most 16 KiB of error details, followed by an explicit truncation marker when needed
- retain at most 256 KiB for the sanitized trigger snapshot; when it is larger, preserve its core schema/record/occurrence IDs, original byte size, deterministic hash, and an explicit truncation marker rather than the oversized body

Apply the bounds before writing the run row or returning it through an API. The sandbox still
receives the complete schema-validated context. Artifact overflow affects only the subscription
run and never the already-committed source operation.

Keep runs indefinitely initially. Retention and manual replay are later capabilities, not prerequisites for the first release. Deleting a user remains an explicit exception and removes that user’s private automation data through the user-table cascades.

Deleting a rule prevents only future matching. It does not cancel runs that have already been
created, and it never deletes their history. Already-created runs continue using their immutable
rule snapshot even if the live rule is subsequently changed or deleted.

Rule matching linearizes at run insertion as defined under Runtime Semantics: the insertion
transaction re-reads the live rule, rechecks activity, and writes the snapshot atomically, so a
rule deactivated, deleted, or modified between resolution and insertion is respectively skipped,
skipped, or snapshotted as it exists then. Index the table for the documented
history queries: a composite matching `(queued_at DESC, id DESC)` scoped to the execution user,
plus `original_rule_id` and `status`; index `signal_recipient` on its denormalized
`(user_id, signal_created_at DESC, signal_id DESC)` columns, with `signal_schema_id` covered for
the filter, so recipient-scoped pagination does not scan.

### `automation_effect`

Persist one internal row per unique effectful host call so effect-key idempotency and breadth
accounting share one durable source of truth. Store the deterministic child ID, parent run ID,
correlation ID, host-function name, caller `effectKey`, validated-input hash, correlation units,
pending/accepted/failed status, a bounded result or downstream execution reference, and
timestamps. Enforce uniqueness on the derived child ID. Only subscription runs may invoke
ledger-tracked host functions; policies and direct sandbox executions never create effect rows.

On repetition, the same input hash resumes or returns the existing effect and consumes neither a
host-call slot nor correlation units again; a different hash is the deterministic conflict already
defined below. Also persist a minimal `automation_correlation_budget` row containing only the
correlation ID, consumed-unit count, and timestamps. Serialize new-effect reservations per parent
run and correlation, then enforce the 32-call limit and atomically increment the 256-unit counter
in the same transaction that inserts the ledger row. A bulk producing call uses one effect row and
reserves one correlation unit per requested item.

Retain effect rows with their run and cascade them only when that private run is removed through
user deletion. Retain the non-personal correlation counter independently so deleting one
recipient's private history cannot restore capacity to a still-running multi-recipient tree. Do
not expose either internal table as a separate user-facing history API initially.

## Runtime Semantics

### Schema lifecycle

All entity, event, and relationship writes must pass through their owning service. Do not dispatch automation from repositories. The initial release produces lifecycle occurrences for public creates and for the provider-population entity/relationship create/update/delete paths scoped below; other mutation paths route through services but are explicitly documented as occurrence-free until update/delete support broadens.

Every lifecycle description carries a server-derived origin. Public callers cannot provide or
override it, and nested application write paths must propagate the root origin rather than replace
it with an internal implementation detail; the provider/import workflow payloads that currently
discard the root origin must thread it end to end. Account-initialization writes performed by
`bootstrapNewUser`, such as the library entity, carry the `bootstrap` origin. Legacy bootstrap
uses a separate trusted `suppressAutomation` path and produces no lifecycle occurrence.

For a create:

1. Resolve and execute ordered policies before opening the write transaction.
2. Validate the policy result through a source-specific Effect Schema.
3. Persist the final value transactionally.
4. After commit, enqueue lifecycle subscription dispatch with the persisted record snapshot.
5. Resolve active subscriptions and start one durable execution workflow per rule.

An array submission is an ordered sequence of independent record creates, not one atomic batch.
Complete an item's policy chain, transaction, and post-commit dispatch initiation before processing
the next item. Stop at the first failure: earlier committed items and their runs remain, while later
items are not attempted. Failure details must include the failed item index and the number already
committed. Do not promise batch-level atomicity.

The public event create endpoint awaits this durable workflow and returns real per-item outcomes:
the number of items written, the number skipped by policy, and — when the batch stopped early —
the failed item index and typed reason. It no longer returns a speculative count immediately
after enqueueing. Per-item validation moves inside the workflow in item order so earlier valid
items commit before a later invalid item stops the batch. A batch that partially commits before
stopping returns a success-status batch-outcome response carrying the typed failure details, not
a transport-level `4xx`, because the earlier items remain committed. Internal durable callers
keep composing the same workflow with deterministic execution IDs.

Subscription matching linearizes at run insertion, not at the source transaction's commit time.
The post-commit dispatcher resolves candidate rules, then inserts each `subscription_run` in a
transaction that re-reads the live rule, rechecks it is active, and writes the rule snapshot
from that same read. A rule activated before its insertion transaction may receive an occurrence
that committed moments earlier; a rule deactivated or deleted before it produces no run; a rule
modified before it is snapshotted as it exists at insertion. Once a `subscription_run` exists,
later rule changes do not affect that run.

Policies must never hold a database transaction across sandbox execution. Subscription dispatch must never roll back or delay the completed business operation.

Initial lifecycle delivery rules:

- A user-owned entity, event, or relationship is visible to subscriptions owned by that user plus applicable built-in rules.
- A global row (`user_id IS NULL`) runs built-in lifecycle rules only. It is never broadcast to every user subscribed to its schema.
- A built-in lifecycle detector may emit a semantic signal whose audience policy safely fans out to eligible users.
- Create is the first fully public operation. Internally, provider-backed entity saves also classify each mutation as `create`, `update`, or `noop`, capturing `before` and `after` atomically. Dispatch `update` only when material persisted fields changed; timestamp-only changes, identical replacements, and preserved conflicts are `noop` and dispatch nothing. Provider relationship synchronization — additive and authoritative — likewise runs through `RelationshipsService`, atomically returns ordered `create`, `update`, `delete`, or `noop` outcomes, and dispatches one occurrence per material mutation after commit; additive syncs simply never produce `delete` outcomes. Only seeded built-in media detectors may target these internal entity and relationship updates/deletes initially. Public/custom update or delete rules, update policies, and public relationship mutation APIs remain deferred.

Audit every mutation call site as part of the cutover. Entity-import population already routes
entity and ordinary relationship writes through their services; move its remaining direct
`syncGlobalRelationships` repository calls behind `RelationshipsService` as well. During
population, the bulk relationship sync becomes the sole writer of each parent-child relationship
set in both modes: initial population runs a full-set sync per parent scope instead of the
current per-child individual inserts (which today are the only edge writer when `syncExisting`
is false), and refresh keeps its authoritative sync. The per-child inserts must go because they
make the refresh sync classify every row as pre-existing and report `createdCount = 0`,
silencing the episode-discovery detector. The audit also covers the other known direct writers — collections membership
events/relationships, user-state merge/clear, media-monitoring enable/disable, the media-trending
refresh, and the builtin bootstrap's library entity — each of which must go through its owning
service. Of these, only paths in the initial occurrence scope carry origins and dispatch;
user-state merge/clear and the media-trending refresh are bulk mutations documented as
occurrence-free until update/delete support broadens, so no immutable before/after capture is
retrofitted onto their bulk SQL now. Translation overlay writes modify `entity_translation`, not
the canonical `entity` row, so they produce no entity lifecycle occurrence and cannot wake
canonical entity-update detectors.

Normal imports are not legacy bootstrap and do not suppress automation. They propagate the
server-derived `import` origin and retain one occurrence per committed canonical mutation. Durable
import workflows stream large inputs in bounded chunks and apply persisted-queue backpressure so a
10,000-item import never materializes or enqueues an unbounded batch at once. Chunking may batch
database access but must preserve stable per-record occurrence IDs, the documented per-item
failure semantics, and independent subscription runs; it cannot collapse multiple mutations into
one occurrence. Legacy bootstrap remains the only path that suppresses dispatch for writes inside
the initial occurrence scope; the occurrence-free bulk mutations above are out of scope rather
than suppressed.

### Signal emission

Built-in sandbox scripts call a generic `emitSignal` host function. Trusted application workflows may call
the same underlying signal service for authoritative facts that do not arise from entity, event,
or relationship lifecycle, such as an integration being automatically disabled. This is not a
general bypass for schema-derived detection. In either case, emission:

1. Loads an accessible signal schema by ID.
2. Validates signal properties.
3. Derives the actor from server-controlled emission context.
4. When a subject is supplied or required by the audience policy, validates that it is readable to the actor unless a trusted built-in execution is producing a global signal.
5. Resolves the signal schema’s audience policy and snapshots recipients.
6. Inserts the signal and recipients transactionally.
7. Enqueues signal subscription dispatch after commit.

User scripts cannot select recipients. User-owned signal schemas are actor-only initially. Trusted built-in scripts may emit built-in related-user signals.

For sandbox emission, the actor comes from the hidden user execution principal. For a trusted
application workflow, the workflow constructs the same hidden principal from the authoritative
record it has loaded; this field is never accepted from a public request or sandbox argument. The
`integration.disabled` path therefore uses the owning `integration.user_id` loaded by the
integration workflow, and the actor audience policy maps that principal to the sole recipient.
The workflow supplies no recipient IDs. A system-principal workflow cannot emit an actor-audience
signal and may emit only a built-in policy-compatible signal with its required subject.

### Subscription execution

Use a feature-owned durable `SubscriptionExecutionWorkflow` that:

1. Creates or resumes the deterministic subscription-run row.
2. Marks it running.
3. Awaits `RunSandboxWorkflow` with the subscription user as sandbox identity.
4. Records success, failure, logs, returned value, and timing.
5. Completes without affecting sibling subscriptions or the source operation.

Artifact bounds are execution-kind-specific and applied at the shared sandbox worker's
serialization boundary, before any durable result row or workflow payload is persisted.
`subscription` and `direct` runs get the 64 KiB value limit; a subscription return value over it
converts that run to `failed/result_too_large`, and `SubscriptionExecutionWorkflow` re-applies
the same bounds as defense in depth. `provider` and import executions keep a separate, larger
operational bound sized to real provider graphs and pass results that exceed it by durable
artifact reference instead of failing. Log bounds apply uniformly. Dispatch likewise enforces the
trigger-snapshot cap on the durable execution payload it enqueues — snapshots are minimal by
design, and a context that still exceeds the cap is stored out of band and passed by reference
rather than inlined into workflow state. Out-of-band artifacts live in durable storage, not a
TTL-bound cache — a fixed-TTL store cannot serve an indefinitely retried workflow — are readable
only by their owning execution, and are deleted with their run. Log, error, and retained-trigger
truncation do not by themselves change run status.

Resolve a hidden execution principal for every run:

```ts
type AutomationPrincipal =
	| { kind: "user"; userId: UserId }
	| { kind: "system" };
```

A user-owned lifecycle or signal subscription runs as its rule owner. A built-in lifecycle rule
processing a user-owned row runs as that row's owner. A built-in rule processing a global row runs
as `system`; this requires both a built-in rule and built-in script. System execution receives a
restricted host-function set: it may inspect global data and emit authorized built-in signals, but
it cannot call `sendNotification`. System runs have no execution user ID and are not exposed by
user-facing run APIs. User notification rules remain user-owned rows that reference the shared
built-in notification script.

The principal controls data authority only. It does not grant host functions by itself: the rule
and script capability ceilings above still apply, so a global detector processing a user-owned row
cannot turn its user principal into direct notification authority.

Use execution IDs derived from the occurrence and rule IDs. Every effectful automation host call,
including `emitSignal` and `sendNotification`, requires a caller-supplied stable `effectKey`.
Derive the child ID from the parent automation execution ID, host-function name, and effect key.
Repeating a key with the same validated input returns the existing effect; reusing it with different
input fails as a deterministic conflict. A duplicate signal emission never recalculates its
snapshotted recipients. Derive each `subscription_run` ID from its occurrence and rule IDs.

The initial release does not version sandbox scripts. A queued run resolves the latest script code
and metadata when sandbox execution starts, so a deployment or script edit may change what code a
previously queued run executes. Record the script's `updated_at` value and a hash of the code and
metadata actually loaded for auditability. Exact historical replay requires future script
versioning and is not implied by the retained run record.

Infrastructure-level enqueue failures are retried durably. A completed script failure is recorded rather than retried forever; manual replay can be added later.

Distinguish durable and non-durable source paths. When a source write is an activity inside an
existing durable workflow, such as event creation or provider/import processing, subscription
dispatch is the next durable workflow step after the write activity. Workflow replay resumes that
step, and deterministic execution IDs prevent duplicate runs. Do not catch-and-log dispatch
startup failures as success on these paths; allow the owning workflow to retry them. Likewise, an
`emitSignal` effect that commits inside a subscription run uses its pending `automation_effect`
entry to resume deterministic signal dispatch.

The accepted commit-to-enqueue gap applies only to genuinely non-durable service writes. If such a
process terminates after its transaction commits but before durable dispatch is accepted, that
occurrence may remain undispatched. There is no transactional outbox or reconciliation worker for
those paths initially. The plan must not weaken write paths that already have a durable continuation.

Activities never start durable work, so a durable source workflow's write Activity returns a
bounded occurrence envelope — occurrence IDs, operations, and the minimal snapshots already
defined for sandbox context — and the workflow body dispatches from it as its next step. Provider
population restructures its single whole-graph transaction into per-scope Activities aligned to
natural graph units: one parent's complete relationship set (a show's seasons, one season's
episodes, one credit group) commits atomically per Activity, so no envelope grows with the full
graph and no authoritative set is ever split across chunks — a split set would delete rows
absent from its partial chunk. Partial graph commits are accepted: a later scope's failure
leaves earlier committed scopes and their already-dispatched occurrences in place, and the
durable workflow resumes from the failed scope with deterministic occurrence IDs preventing
duplicates. The root's `populated_at` is set in the final step, so `rootPreviouslyPopulated`
stays false throughout a first population. This preserves the no-lifecycle-occurrence-table
decision.

Carry causation/correlation IDs and a bounded automation depth through lifecycle-to-signal and
signal-to-write chains. The initial server-wide maximum is eight subscription hops. A root
occurrence starts at depth zero; each triggered subscription runs at its occurrence depth plus one,
and signals or writes it creates carry that run depth. Policies and sibling subscriptions do not
add depth. At depth eight, terminal effects such as `sendNotification` remain allowed, but any
attempt to emit another signal or create another automation-producing write fails the run with a
typed depth-limit error. The limit is not configurable per user or rule initially.

Depth does not bound breadth, so apply two additional server-wide limits:

- one subscription run may invoke at most 32 effectful host functions, including terminal effects
- one root correlation may produce at most 256 child lifecycle occurrences and signals across all of its branches; each emitted signal and each item in an automation-created entity/event/relationship array consumes one unit

Recipient fan-out and the delivery executions produced by one accepted `sendNotification` call do
not consume correlation units, but the call consumes one of its run's 32 host-call slots. Reserve
host-call slots and correlation units through the `automation_effect` ledger before accepting an
effect. Workflow replay or a repeated `effectKey` with the same input consumes no additional
capacity. A call whose complete requested batch cannot fit is rejected before its first effect.
Exceeding either limit fails the calling run with the typed `automation_budget_exceeded` reason;
the root source operation, previously accepted effects, and sibling runs remain unchanged. These
limits are server constants rather than user-configurable settings initially.

### Sandbox context

Standardize subscription input under an `automation` key:

```ts
type AutomationOrigin =
	| { kind: "api" }
	| { kind: "bootstrap" }
	| { kind: "collection" }
	| { kind: "import"; importRunId?: ImportRunId }
	| { kind: "integration"; integrationId: IntegrationId; importRunId?: ImportRunId }
	| { kind: "automation"; executionId: string }
	| { kind: "provider_refresh" };

type AutomationContext = {
	ruleId: AutomationRuleId;
	occurrenceId: string;
	origin: AutomationOrigin;
	scopeEntity?: {
		id: EntityId;
		name: string;
		entitySchemaId: EntitySchemaId;
		entitySchemaSlug: string;
	};
	rootPreviouslyPopulated?: boolean;
	owningSeason?: { number: number | null; name: string | null };
	batch?: {
		id: string;
		isLeader: boolean;
		beforeCount: number;
		afterCount: number;
		createdCount: number;
		updatedCount: number;
		deletedCount: number;
	};
	operation: "create" | "update" | "delete" | "signal";
	source:
		| { kind: "entity"; before?: EntitySnapshot; after?: EntitySnapshot }
		| { kind: "event"; before?: EventSnapshot; after?: EventSnapshot }
		| { kind: "relationship"; before?: RelationshipSnapshot; after?: RelationshipSnapshot }
		| { kind: "signal"; signal: SignalSnapshot };
};
```

Each `RelationshipSnapshot` contains the relationship identity, schema identity, schema-validated
properties, and minimal immutable snapshots of both its source and target endpoints. Each endpoint
snapshot contains its entity ID, entity-schema slug, and name. Capture those values atomically with
the relationship mutation so create/update detectors can derive labels and an audience subject
without entity-query host functions.

Every committed lifecycle mutation receives an opaque occurrence ID that is stable across workflow
replay or enqueue retry and distinct for every separate mutation of the same record. Durable callers
derive it from their execution ID and mutation/item index; non-durable paths generate it once before
persistence. Keep the affected record ID separately. Derive subscription execution IDs from the
occurrence and rule IDs. A signal's deterministic signal ID is its occurrence ID. Do not add a
separate lifecycle-occurrence table initially.

For bulk provider relationship synchronization, additive or authoritative, derive each occurrence
ID from the parent sync execution ID plus the relationship schema, direction, endpoints, and
mutation operation. Never
use database return order or loop position as the stable mutation identity.

Relationship-sync occurrences also carry a generic batch descriptor scoped to the sync's anchor,
relationship schema, and direction. Select its leader deterministically from stable mutation
identity. Count-oriented detector scripts run only for the leader and use the before/after and
per-operation counts to emit one aggregate signal; per-record detectors still process their own
occurrence. Do not duplicate the full relationship batch into every snapshot.

Trusted provider-population occurrences also carry a minimal immutable `scopeEntity` reference
supplied by their owning workflow. It identifies the root entity whose population operation owns
the mutations and is never accepted from public entity or relationship input. An authoritative
nested relationship sync propagates that reference through its nested syncs. Provider-population
entity create/update occurrences for nested child entities, including seasons and episodes, carry
the same root population target as `scopeEntity`. For show-season and show-episode mutations it is
the parent show's ID, schema identity, and name; podcast-episode mutations use the podcast.
Provider-population occurrences also carry `rootPreviouslyPopulated` — true only when the root
population target had a non-null `populated_at` before the operation began — and episode-scoped
occurrences carry a minimal `owningSeason` reference (number and name) so detectors can classify
special seasons. All of these are trusted workflow-supplied values, never public input.

Hierarchical media detectors use `scopeEntity` as the related-user signal subject and as the source
of `entityName`; they do not receive entity-query host functions merely to rediscover ancestry after
commit. Top-level syncs use their anchor as the scope entity. Association detectors are different:
their signal subject is the person/company endpoint from `RelationshipSnapshot`, and the other
endpoint supplies `associatedName`; `scopeEntity` remains population ownership context rather than
the association signal subject and does not gate detector eligibility beyond the
initial-population rule defined with the media detectors.

Expose only JSON-safe, schema-validated snapshots. Identity and privilege remain hidden runtime inputs rather than caller-controlled context fields.

Replace the event-specific `sandbox` origin with `automation`. Propagate origin into emitted
signals together with causation, correlation, and automation depth, and include it in sanitized run
snapshots.

## Sandbox Host Functions

### `emitSignal`

Add the behavior above to the runtime host-function registry. Initially it is available only to
built-in scripts; exposing it to user scripts is deferred with custom signal schemas. The host
function returns the standard sandbox API success/failure envelope.

### `sendNotification`

Accept a schema-validated message and enqueue the existing durable notification delivery workflow for the hidden current user. It must:

- reject arbitrary user IDs
- deliver to all enabled notification channels for that user
- use a deterministic delivery execution ID derived from the automation execution
- return success once durable delivery is accepted, not once every external provider succeeds

Notification formatting remains sandbox behavior. The host function owns authorization and delivery only.

Resolve the enabled channel set and current credentials at each delivery attempt; there is no
channel snapshot, and a retried delivery activity re-reads the set. A channel disabled or deleted
before an attempt is excluded from it; a channel enabled or created between attempts may receive
an already-queued message. Do not snapshot channel IDs, configuration, or credentials into
automation data. Zero enabled channels is a successful delivery with zero results, and subscription
success means durable delivery was accepted rather than that external providers succeeded.

A succeeded subscription run means its sandbox completed and every requested durable child effect
was accepted; it does not assert external delivery. `sendNotification` returns its deterministic
delivery execution ID and the run retains that value. Per-channel sent/failed outcomes remain in
the notification workflow result and operator logs, do not retroactively fail the subscription,
and are not automatically retried when the provider call completed with failure. Delivery is
at-least-once at the provider boundary: the delivery activity may retry after a partial send, so
an individual channel can occasionally receive a duplicate; eliminating that requires per-channel
durable attempts, which are deferred. User-facing copy must say delivery was accepted rather than
delivered. Persistent user-facing delivery history and provider retry controls are deferred.

The shared built-in notification script formats exclusively from the stored signal snapshot and
does not receive entity-query host functions. Subject mutation or deletion therefore cannot change
or break an already-emitted notification.

## Built-In Automations

Seed shared scripts, schemas, and unconditional system rules. Create one lightweight user-owned
rule binding for each installed notification subscription rather than copying script code per user.

### Built-in signal property contracts

Built-in signal properties are structured, minimal, and reject unknown fields. Calendar dates use
ISO 8601 `YYYY-MM-DD`; timestamps use ISO 8601 UTC datetime strings. Do not store a preformatted
message, full entity snapshot, changed image arrays, or credentials. IDs needed to preserve an
existing notification link after subject deletion are duplicated deliberately in validated
properties.

| Signal | Required properties | Optional properties |
| --- | --- | --- |
| `integration.disabled` | `integrationId`, `providerName` | none |
| `workout.created` | `workoutId`, `workoutName` | none |
| `review.created` | `reviewEventId`, `entityId`, `entityName`, `entitySchemaSlug` | none |
| `media.status.changed` | `entityName`, `oldStatus`, `newStatus` | none |
| `media.content-count.changed` | `entityName`, `contentType`, `oldCount`, `newCount` | none |
| `media.release-date.changed` | `entityName`, `changeKind` | variant fields below |
| `media.episode.name.changed` | `entityName`, `episodeNumber` | `seasonNumber`, `oldName`, `newName` |
| `media.episode.images.changed` | `entityName`, `episodeNumber` | `seasonNumber` |
| `media.season-count.changed` | `entityName`, `oldCount`, `newCount` | none |
| `media.episode.discovered` | `entityName`, `discoveredCount`, `oldCount`, `newCount` | `seasonNumber` |
| person/company media/group association signals | `subjectName`, `associatedName`, `role` | none |

`media.release-date.changed` is a discriminated property contract. For
`changeKind: "publish_year"`, require integer `oldYear` and `newYear`. For
`changeKind: "episode_date"`, require `oldDate`, `newDate`, and `episodeNumber`; `seasonNumber` is
optional so the immutable contract also supports podcast episodes. The initial parity scope emits
this variant only for show episodes, but adding podcast episode-date detection later does not
require a successor slug. The schema's conditional rules reject a missing field for the selected variant. Optional
`oldName`/`newName` on `media.episode.name.changed` may be null when a provider adds or removes an
episode name.

The four association signal slugs are `person.media.associated`,
`person.media-group.associated`, `company.media.associated`, and
`company.media-group.associated`.

### Existing event triggers

- Move Integration Progress Policy to an event-schema create policy.
- Move Auto-Complete on Full Progress to an event-schema create subscription.
- Move Radarr, Sonarr, and Jellyfin pushes to subscriptions.
- Delete `event_schema_trigger` and its repository methods after all consumers use automation rules.

### Private reviews

Attach built-in lifecycle detectors to create operations on applicable built-in `review` event
schemas. They emit the actor-audience `review.created` signal only when the server-derived origin is
`api`. `import`, `integration`, `collection`, `provider_refresh`, `automation`, and `bootstrap` origins
emit no such signal. User notification rules target that one signal regardless of how many review event schemas
exist. Only the review author is eligible. Name this behavior “review created,” not `ReviewPosted`,
because no public posting or cross-user review visibility is being restored.

### Workouts

Attach a built-in lifecycle detector to workout entity creation and emit the actor-audience
`workout.created` signal only when the server-derived origin is `api`. `import`, `integration`,
`collection`, `provider_refresh`, `automation`, and `bootstrap` origins emit no such signal. User
notification rules target that signal; origin remains server-controlled lifecycle context.

### Media monitoring

Keep provider refresh scheduling and entity population as application-owned workflows. Remove notification delivery and semantic notification vocabulary from `modules/media-monitoring`.

Represent semantic detection through built-in sandbox scripts with one owner per semantic scope:

| Signal | Sole producer |
| --- | --- |
| `media.status.changed` | parent media-entity update |
| `media.content-count.changed` | anime/manga entity update |
| `media.release-date.changed` | parent media update for top-level dates; initially show-episode update for episode-scoped dates |
| `media.episode.name.changed` | episode-entity update |
| `media.episode.images.changed` | episode-entity update |
| `media.season-count.changed` | leader of show-to-season relationship sync when the net count changes |
| `media.episode.discovered` | leader of show-season-to-episode or podcast-to-episode sync when `createdCount > 0` |
| person/company media/group association signals | corresponding canonical credit-relationship create from either population direction, plus newly added roles from material relationship updates |

Anime/manga numeric counts belong only to `media.content-count.changed`. Episode and season entity
creation alone emits nothing because the parent-child relationship establishes the semantic
association. Removed credit roles do not emit association signals, matching current behavior.
Tests must prove that no second detector emits the same signal for the same semantic scope.

Preserve the existing dual-writer credit population model. Media/group-rooted detail population may
additively write incoming person/company credit edges so newly populated media immediately exposes
its cast and crew. Person/company-rooted population may authoritatively write the same edges in the
outgoing direction to own that subject's filmography. Both paths resolve the same canonical identity
of relationship schema plus source and target endpoints; they do not create direction-specific rows.

Run the one association detector for a canonical credit-edge `create` regardless of which population
root appears in `scopeEntity`, subject only to the initial-population rule below. The detector reads `subjectName` and the signal subject from the
person/company source endpoint snapshot, `associatedName` from the media/group target endpoint
snapshot, and roles from the relationship properties. A material update emits only roles newly added
relative to its immediate `before` snapshot; identical writes and already-present roles emit nothing,
and removed roles or edge deletion do not emit. This deliberately shifts notification timing to when
the canonical edge first appears rather than waiting for a person/company refresh. If an
authoritative sync later deletes an edge and additive population subsequently re-creates it, that
new `create` may notify again. Accept that existing cross-provider churn risk initially; do not add a
historical association deduplication ledger.

Intentionally drop the current cross-level suppression between season-count and episode-discovery
changes. If one provider refresh adds a season and its episodes, the show-to-season sync emits
`media.season-count.changed` and the nested season-to-episode sync independently emits one
aggregate `media.episode.discovered`. Both are valid semantic facts and users may disable either
subscription. Do not add domain-specific suppression flags or cross-sync coordination merely to
retain the old single-notification behavior.

Initial population stays silent, as it is today. Hierarchical media detectors — status, counts,
discovery, release dates, and episode fields — emit nothing when `rootPreviouslyPopulated` is
false, preserving the current diff's suppression of first-population noise. Association detectors
apply the flag differently: they stay silent only when the unpopulated root is the person/company
subject itself, so a monitored person's own first population does not flood its subscribers,
while a newly populated media entity still announces its credits to users monitoring those
persons/companies, consistent with the deliberate timing shift above.

Preserve the Specials suppression: episode detectors emit nothing when the `owningSeason` name
identifies a special season, matching the current diff. Drop the remaining cross-level
suppressions: today a newly discovered episode hides same-refresh name/image/date changes of
existing episodes in that show season, and the podcast diff does the same. Independent per-record
occurrences make those sibling changes visible again; treat this as a deliberate behavior change
like the season-count case, not a parity bug.

Detector scripts emit built-in signal schemas whose audience policy resolves users connected to the parent media/person/company through the `media-monitoring` relationship. Notification subscriptions consume those signals. The application runtime must not switch on signal slugs.

Where current provider population does not expose sufficient before/after information, enhance the generic write path to capture it rather than retaining feature-specific media diff branches. Each write still dispatches per persisted occurrence; database access may be batched internally.

The first built-in signal catalog should cover the currently implemented media-monitoring changes before the direct notification path is removed:

- status and release-date changes
- season/episode count and discovery changes
- episode name/image changes
- person/company associations with media or groups

## Notification Model

- Remove `configuredEvents` from notification channels, contracts, repositories, and delivery filtering.
- Remove the closed `NotificationEventType` union from notification delivery.
- The platform-to-channel rename is a full public-contract change: rename the `/notifications/platforms` routes to `/notifications/channels`, the platform-named contract types/schemas/brands, and their client callers. No public identifier says "platform" after the cutover.
- Notification delivery accepts a message with no caller-selected channel in the initial model; the built-in action targets all enabled channels.
- Creating/disabling/updating a channel manages only delivery configuration. Subscriptions manage when actions occur.
- `bootstrapNewUser` installs one notification rule for every built-in signal schema whose catalog state is `active` for both auth-created and migrated users. Notification actions with no enabled channels complete successfully with zero deliveries. Creating, deleting, or recreating a channel never creates or changes subscriptions.
- Add nullable `user.bootstrap_completed_at`. `bootstrapNewUser` locks the user row, returns immediately without touching defaults when the marker is already set, and otherwise creates every account default and sets this timestamp in the same transaction. The auth user-created hook attempts bootstrap; a failure is logged and account creation continues so credential/OAuth linking can finish, but the marker remains null and the account is not yet session-ready.
- Before any session is created for a user whose marker is null, synchronously rerun the same idempotent bootstrap under the user-row lock. Create the session only after success; otherwise return a retryable `USER_INITIALIZING` error. This is pending one-time initialization, not ongoing reconciliation, and requires no background repair worker.
- Once `bootstrap_completed_at` is set, normal startup and session creation never rerun bootstrap. Activating or seeding a new catalog signal does not backfill existing users, and seeding never recreates a rule a user deleted. Existing users may opt into newly active entries.

## Public APIs

The phases 1–4 public API surface includes:

- list/get/delete the authenticated user's installed notification rules
- activate/deactivate an installed notification rule
- install or reinstall an active built-in catalog signal
- list/get subscription runs, scoped to the authenticated user
- list/get emitted signals visible to the authenticated recipient
- list/get built-in signal schemas

Catalog installation is the only initial rule-creation path. The client supplies the active
built-in signal-schema target; the server selects the shared built-in notification script and
server-owned rule metadata. Reinstalling recreates the same kind of user-owned `automation_rule`
row after a user has deleted it. Initial endpoints do not accept an arbitrary script ID,
lifecycle-schema target, rule kind, operation, or configuration, and there is no generic rule
update endpoint. Internal services still use the generic persisted model for seeded policies and
detectors.

Run and signal history use opaque keyset cursors and never expose an unbounded list. The default
page size is 50 and the maximum is 100. Return `{ items, nextCursor }` without a total count.
Order signals by `(created_at DESC, id DESC)` and encode that tuple in their cursor; order runs by
`(queued_at DESC, id DESC)`. Use signal insertion time rather than occurrence time so a newly
inserted historical or backdated fact appears at the front instead of inside pages the user may
already have traversed. Initially support `signalSchemaId` as a signal filter and `ruleId` and
`status` as run filters. The run `ruleId` filter matches the indexed scalar `original_rule_id`
column, which survives rule deletion, so deleting a rule does not make its history unfilterable. Cursors are versioned and opaque to clients. This is an intentional new
convention for append-only automation history and does not change existing offset/limit APIs in
other modules.

The built-in-first catalog is derived from built-in signal schemas whose `catalog_state` is
`active`; `hidden` schemas are internal and never offered. Do not seed schemas for separately
scoped features merely to reserve future catalog entries. Installing a catalog entry creates the
same user-owned automation-rule row targeting that signal and the shared notification script. Do
not create a template or parallel notification-subscription table.

Phase 5 exposes generic create/update rule contracts for permitted lifecycle and signal targets
and user-owned scripts; the permitted target matrix and other settled scope decisions are
recorded in "Phase 5 Decisions" under Delivery Phases. Policy management remains built-in-only.
Custom post-commit subscriptions must use the same final generic model rather than introducing
another table.

## Security

- A subscription never expands data visibility.
- Schema lifecycle subscriptions run only for the owning user; global lifecycle rows run built-in rules only.
- Signal recipients are derived server-side from the signal schema’s audience policy and snapshotted.
- User scripts cannot emit to arbitrary users or request arbitrary notification recipients.
- Cross-user audience policies and system-context signal emission are built-in-only.
- System execution requires both a built-in rule and built-in script and cannot send notifications directly.
- Direct `/sandbox/enqueue` executions and policy runs can never call `emitSignal`, `sendNotification`, or other effect-ledger host functions; those require a rule-bound subscription run.
- Every rule mutation verifies rule, schema, and script ownership.
- Exclude disabled users from signal audiences and user-owned lifecycle matching. Recheck the execution user when a created run starts; if disabled, mark it `skipped` with reason `user_disabled` and do not replay it automatically after re-enablement.
- Do not create an authenticated session until `bootstrap_completed_at` is non-null. A pending user may retry initialization, but a completed user is never reconciled against defaults.
- Run logs/results are visible to the rule owner; a run created by a global built-in rule under a user principal is instead visible to its execution user. System-principal runs are not exposed. Sanitize secrets and preserve existing sandbox redaction behavior.
- Signal and run list/get authorization is applied before returning data. A get for an inaccessible or nonexistent record returns the same `404` response so record existence is not leaked.
- Signal-schema archival deactivates its rules and blocks new rules/emissions without deleting history. User deletion removes that user's private actor signals and recipient/run data without deleting shared signals from other recipients.
- Validate all policy outputs, signal properties, rule metadata, and host-function inputs with Effect Schema.

## Legacy Bootstrap

Update `modules/legacy-bootstrap` in the same feature:

- Preserve startup ordering: rename only colliding legacy tables, run the reset Drizzle baseline, seed global built-in schemas/scripts/rules, migrate legacy data, then drop legacy tables and start runtime workers. Active signal schemas and the shared notification script must exist before migrated users are initialized; their user-owned notification rules are created by `bootstrapNewUser`, not global seeding.
- Pass every migrated user through the same transactional `bootstrapNewUser` path used for auth-created users. It installs the active default notification rules alongside the other account defaults. Any bootstrap failure aborts migration; do not catch-and-log it and continue.
- Treat `bootstrapNewUser` as initialization, never reconciliation. Its inserts and completion marker must remain restart-safe, but normal startup must not rerun it for completed users or recreate rules they deleted.
- Reset `apps/app-backend/src/drizzle` so its baseline creates `notification_channel` directly. Remove the notification-platform block from `rename-tables.ts`; the V1 `notification_platform` no longer collides with any V2 table and remains untouched while Drizzle runs. Remove `notification-platform-mapping.ts` from the migration sequence: do not inspect, validate, copy, or map the old platform kind, credentials, specifics, `configured_events`, or disabled state.
- Drop the original V1 `notification_platform` with the other legacy tables only after successful migration. Migrated users start with zero notification channels and the same active default subscriptions as new users; they create new channels themselves.
- Keep inserts restart-safe and fail fast for missing built-in schemas/scripts or invalid ownership. Contents of the intentionally discarded notification-platform table are not migration inputs and therefore are not validated.
- Do not execute subscriptions for historical entities/events/signals while copying V1 data. Migration writes must suppress lifecycle dispatch.
- Complete the documentation cutover below alongside the implementation.

## Documentation Cutover

Land these documentation updates with the implementation, not before the documented behavior becomes current:

- Update `apps/app-backend/src/modules/legacy-bootstrap/AGENTS.md` to record the reset migration baseline, removal of notification-platform rename/mapping, and intentional V1 data discard.
- Update `docs/plans/v1-v2-port-gap-analysis.md` so its Tier 1 event-driven-alert guidance describes signal producers and user-owned subscriptions instead of wiring `NewWorkoutCreated` and related events into the deleted configured-events send path. Replace its claim of full V1 notification-platform parity with the new channel/subscription model, including zero migrated channels and intentional discard of V1 notification-platform data. Keep calendar-dependent behavior identified as deferred on the calendar feature.
- Update `apps/app-backend/src/modules/builtins/AGENTS.md` so the Auto-Complete and Integration Progress Policy trigger sections describe built-in lifecycle automation rules and their automation context/metadata rather than `event_schema_trigger` rows and the old trigger vocabulary.
- Correct the gap analysis's stale `lib/builtins/AGENTS.md` reference to the actual `apps/app-backend/src/modules/builtins/AGENTS.md` path.
- Update `docs/decisions.md`, `docs/effect-workflow-guide.md`, and the root `apps/app-backend/AGENTS.md` durable-ownership guidance wherever they encode `event_schema_trigger`, configured events, or the old notification/monitoring workflow ownership, and update the workflow owners pinned by `apps/app-backend/src/modules/sandbox/workflow-boundaries.test.ts`.
- Treat these documentation changes as part of the same cutover as the schema and runtime changes, so no sibling document presents the removed configured-events or trigger model as current behavior after release.

## Delivery Phases

Phases 1–4 are implementation and cutover steps behind an unreleased feature boundary, not
independently exposed catalog releases. Do not expose the new catalog/default bootstrap behavior
until the built-in producers, shared notification script, and legacy-bootstrap changes are ready
together. Mark a signal schema `active` only when its producer is enabled. This prevents users
created between implementation steps from permanently missing defaults under the no-backfill
policy. Phase 5 may ship later as the separate custom-automation surface.

1. **Baseline reset and foundation**
   - As the first implementation step, before authoring any automation migrations, reset `apps/app-backend/src/drizzle` to a single squashed baseline of the current schema plus the new automation tables. Regenerate that one baseline in place at each later phase that changes the schema instead of appending migration history. The Phase 1 baseline retains `event_schema_trigger` and `configured_events` because phase 2–3 code still requires them; only the released baseline reflects the final schema.
   - Add signal schemas/signals/recipients, generalized automation rules, durable runs/effects/correlation budgets, services, contracts, and sandbox context.
   - Add `emitSignal` and `sendNotification`.
   - Add the one-time bootstrap completion marker and session-readiness gate.
   - Add internal entity `create`/`update`/`noop` lifecycle outcomes with atomic before/after capture for provider-backed saves.
   - Rearchitect import artifact handling as its own workstream covering both the media and non-media pipelines: stream normalized adapter results in bounded chunks with persisted-queue backpressure instead of loading the entire artifact or `items` array into memory, as the chunked-dispatch requirement assumes.
   - Move provider relationship synchronization, additive and authoritative, behind `RelationshipsService` and expose internal create/update/delete/noop lifecycle outcomes.
   - Preserve current behavior while the new dispatcher is introduced.
2. **Existing trigger migration**
   - Move before/after event trigger rows and execution to automation rules.
   - Remove `event_schema_trigger`.
3. **Built-in notification subscriptions**
   - Remove per-channel configured events and `NotificationEventType` delivery coupling.
   - Add private review-created and workout-created built-ins.
   - Regenerate the baseline to rename `notification_platform` to `notification_channel` and drop `configured_events`, install active defaults through `bootstrapNewUser` for both auth-created and migrated users, and remove legacy notification-platform mapping/rename handling.
4. **Media-monitoring conversion**
   - Seed semantic signal schemas and detector scripts.
   - Establish parity with current diff behavior — including initial-population and Specials suppression — except the explicitly dropped cross-level suppressions (season-count/episode-discovery and new-episode-hides-sibling-changes), then delete direct notification fan-out and TypeScript message construction.
5. **Custom automation surface**
   - Expose generic rule create/update contracts, custom lifecycle subscriptions, custom signal schemas, custom emitters, and run inspection using the same persisted model.
   - Extend lifecycle support to update/delete as their write paths become available.
   - Settled scope decisions for this phase are recorded in "Phase 5 Decisions" below.

Each phase must leave one owner for every side effect; do not run old and new notification paths simultaneously after parity is established.

### Phase 5 Decisions

These scope decisions are settled and bind the Phase 5 implementation:

- **Permitted rule targets.** The generic rule API creates subscription rules only. Permitted targets are: active built-in signal schemas (dispatch already gates execution on the owner being in the snapshotted recipient set; hidden schemas are never permitted), lifecycle `create` on built-in entity, event, and relationship schemas (matching only the owner's rows per the lifecycle delivery rules), and the owner's custom entity, event, relationship, and signal schemas. Policy management remains built-in-only.
- **Rule mutability.** Generic update mutates only name, configuration, and active state. Kind, target, operation, and sandbox script are immutable after creation; changing any of them is delete-and-recreate. This applies uniformly, so the per-target unique indexes never see their indexed columns change.
- **Script capabilities.** Public script creation may allowlist `sendNotification` and `emitSignal`. The three-way capability intersection is unchanged, so both remain inert outside `subscription` runs. `emitSignal` authorization is enforced at emission time, not script creation: a user-principal run may emit only signal schemas owned by that same user, which are actor-only by construction. `sendNotification` under a user principal keeps its existing meaning — the execution user across all enabled channels.
- **Sequencing.** Generic rule contracts and user scripts with `sendNotification` land first; custom signal schemas and user-script `emitSignal` land together afterward, preserving their documented coupling. Phase 5 ships behind the same unreleased boundary as phases 1–4 with no separate feature flag.
- **Script endpoints.** Phase 5 adds no sandbox-script update or delete endpoints; the existing create endpoint suffices and gains the script quota below. Script update/delete semantics (including behavior for rules referencing a deleted script) are deferred with those endpoints.
- **Quotas.** At most 256 sandbox scripts per user, enforced like the rule quota inside the creation transaction under the user-row lock, and added to the existing create endpoint. At most 64 signal schemas per user; archived schemas count toward the limit because archival retains the row. Emission volume needs no new rate limits — automation depth and breadth budgets already bound it.
- **Unified rule surface.** A user's catalog-installed notification rules are ordinary rule rows and appear in, and are managed through, the generic rule endpoints under the same mutability rules; their shared script reference is immutable like any other. Catalog installation remains their only creation path.
- **Custom signal-schema endpoints.** Custom signal schemas get dedicated create/list/get/archive endpoints. The built-in catalog list/get surface stays built-in-only and unchanged; user-owned schemas never appear in the catalog.
- **Run inspection.** No Phase 5 work: the run views shipped with phases 1–4 already expose value, logs, error, timing, and skip reason to the owner.

## Tests and Acceptance Criteria

- Database constraints enforce one rule target, target/operation compatibility, referential integrity, and unique recipient snapshots; service tests enforce valid target and script ownership.
- **Phase 5:** Custom entity, event, and relationship schemas can each run an owner-scoped create subscription through the generic rule API; phases 1–4 reject those target/script combinations.
- Phases 1–4 catalog installation accepts only an active built-in signal target and lets the server select the shared notification script; arbitrary script IDs, lifecycle targets, operations, and generic updates are rejected.
- Global schema rows never fan out to arbitrary user subscriptions.
- Capability tests prove that a global built-in rule never receives `sendNotification`, including when it processes a user-owned row under a user principal, and invalid built-in rule/script capability combinations fail seeding.
- The queue worker enforces execution-kind ceilings at the shared choke point: `policy`, `provider`, and direct `/sandbox/enqueue` runs cannot invoke `emitSignal` or `sendNotification` even when the script's allowlist includes them, direct runs retain `createEvents` as root-occurrence writes, only `subscription` runs create effect-ledger rows, and the execution kind cannot be set through the public enqueue payload.
- Policies preserve existing allow/skip/replace behavior and ordering without holding a transaction open.
- The event create endpoint returns actual per-item outcomes — written count, policy-skip count, and the failed index with typed reason when a batch stops early — and never reports uncommitted items as created.
- Subscription failures are isolated and recorded with useful logs/error/timing.
- Persisted run values, logs, errors, and trigger snapshots obey their byte/count limits; oversized return values fail only their run, while the other artifacts are explicitly truncated.
- Signal and run history pagination is stable under concurrent inserts, enforces the 100-item maximum, follows its documented compound ordering, and never returns inaccessible rows or total counts. Filtering by a deleted rule's original ID still finds runs through their immutable snapshots.
- Workflow replay does not duplicate sandbox runs, effect-ledger entries, automation-producing writes, emitted signals, or delivery executions, and does not consume budget twice. External provider sends inside one delivery execution keep their at-least-once activity semantics; per-channel durable attempts are deferred. Durable source workflows retry post-commit dispatch instead of exposing the accepted non-durable handoff gap.
- `emitSignal` validates payloads, derives actors, rejects unauthorized subjects, and prevents user-selected recipients.
- `integration.disabled` derives its actor from the integration owner loaded by the trusted workflow; public and sandbox payloads cannot supply that actor or a recipient.
- Actor and related-user audience policies enforce their actor/subject prerequisites and resolve and snapshot the correct recipients, including a valid empty related-user audience.
- Archiving a custom signal schema preserves its signals but prevents new rules and emissions; deleting one user removes their private signals and recipient/run data without changing another recipient's shared history.
- Automation-depth limits stop recursive script loops deterministically.
- Rule-count and breadth limits are race-safe and replay-safe: a user cannot exceed 256 owned rules, a run cannot exceed 32 effectful host calls, and a correlation cannot accept more than 256 automation-producing children.
- Notification actions reach every enabled channel and no disabled channel.
- `review.created` and `workout.created` are emitted exactly once for direct API creation and not for `import`, `integration`, `collection`, `provider_refresh`, `automation`, `bootstrap`, or legacy-bootstrap writes.
- `review.created` reaches only the review author.
- Nested provider-population tests prove that both a show-episode entity update and its show-season-to-episode relationship sync carry the parent show as `scopeEntity`; episode-name, episode-image, episode-release-date, and discovery detectors construct the correct signal subject/name without a post-commit entity query.
- Population relationship syncs classify genuinely new child rows as `create` — no earlier per-child insert marks them pre-existing — so episode discovery fires with an accurate `createdCount` on the sync leader.
- Initial population of a monitored entity emits no hierarchical media signals; a monitored person/company's own first population emits no association signals, while first population of a media entity still emits association signals for monitored credit subjects.
- Special-season episode changes emit nothing; name/image/date changes of existing episodes emit alongside a same-refresh episode discovery in that season.
- Episode image comparison stays order- and duplicate-insensitive, and release-date transitions where either side is null emit nothing, matching the current diff.
- Credit-relationship create/update snapshots contain both endpoint IDs, schema slugs, and names. Dual-writer association tests cover media-first, person/company-first, and concurrent discovery of the same canonical edge: media-rooted population still exposes cast/crew, exactly one insertion is classified as `create`, an identical second write is `noop`, and the detector uses the person/company source endpoint as the signal subject and `subjectName` plus the media/group target endpoint as `associatedName` regardless of `scopeEntity`.
- Association update tests emit each newly added role once relative to the immediate before/after snapshots, emit nothing for unchanged or removed roles, and explicitly permit a new notification after a real delete/re-create cycle.
- Media-monitoring tests cover every currently detected change, expect both season-count and aggregate episode-discovery signals when both facts occur, and prove there is no direct notification workflow call left in that module.
- Every seeded signal property contract accepts each currently supported media-monitoring diff variant, rejects unknown or variant-incomplete fields, preserves nullable episode-name transitions, and accepts an `episode_date` without `seasonNumber` for future podcast support.
- Import tests preserve one `import`-origin occurrence per canonical mutation while processing large inputs in bounded chunks; translation-overlay writes produce no canonical entity lifecycle occurrence, and no provider relationship sync, additive or authoritative, bypasses `RelationshipsService`.
- Built-in seeding is idempotent across restarts.
- Auth-created users cannot obtain a session until one transactional bootstrap completes; failed pending initialization is retryable, while completed users are never reconciled or given back deleted defaults.
- The released Drizzle baseline creates only `notification_channel`. Legacy migration neither renames nor reads V1 `notification_platform`; it drops that table only after success, creates no channels, initializes migrated users with active defaults through `bootstrapNewUser`, and emits nothing for historical migration writes.
- No public route, contract type, or client identifier still uses platform terminology after the rename; `/notifications/channels` covers the previous platform CRUD/test surface.
- The documentation cutover updates the legacy-bootstrap and built-ins `AGENTS.md` files, `v1-v2-port-gap-analysis.md`, `docs/decisions.md`, `docs/effect-workflow-guide.md`, the backend `AGENTS.md` durable-ownership guidance, and the owners pinned by `workflow-boundaries.test.ts`; after release, none describes configured events, `event_schema_trigger`, or V1 notification-platform parity as the active model.
- Run all backend checks through Turbo and app-owned tests from `apps/app-backend` according to repository guidelines; validate legacy bootstrap with restored V1 dumps and `bun run run-migration` as required by its `AGENTS.md`.

## Explicitly Deferred

- Public reviews, review visibility, and cross-user review notifications.
- Arbitrary recipient IDs supplied by scripts.
- Per-subscription channel routing; all enabled channels are used initially.
- A generic filter/query language on subscriptions. Sandbox logic can inspect context, while server-side audience resolution prevents unauthorized or global fan-out.
- Multi-hop relationship audience policies until a built-in signal requires them.
- Automatic retries of completed script failures, manual replay, and configurable retention.
- Public or user-created update/delete subscriptions, update policies, and generic public relationship mutation APIs until their write paths and snapshot contracts exist; feature-specific relationship mutations such as collection membership already exist and stay occurrence-free initially. Seeded internal entity and authoritative-relationship update/delete detectors required by media monitoring are in scope.
- Reminder-fired, stale-progress, and completed-to-backlog features, including their signal schemas and producers. Design and seed them only with their owning features.
- `media.release.published`, including its signal schema and producer. It depends on the separately scoped calendar feature that determines when a stored release date becomes current; this automation feature does not build or simulate that scheduler.

## Follow-Up Decisions

Signal, run, effect-ledger, and correlation-budget retention remains indefinite initially and
should be revisited once storage becomes material.
