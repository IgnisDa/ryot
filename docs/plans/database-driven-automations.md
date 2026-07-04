# Database-Driven Automations, Signals, and Subscriptions

## Purpose

Build one database-driven automation system covering schema lifecycle hooks, semantic domain
signals, user subscriptions, and notifications.

Built-in and user-created entity, event, relationship, and signal schemas are treated uniformly.
Domain behavior such as "an episode was discovered" is defined by seeded database rows and sandbox
scripts, not TypeScript notification enums or feature-specific delivery branches. The application
runtime never switches on signal slugs; sandbox scripts are themselves seeded data and may branch
on slugs and snapshot shapes freely.

V2 is unreleased greenfield: breaking its current tables and contracts is acceptable, and the
unreleased Drizzle migration history may be regenerated when a phase changes the schema.

## Model

- **Automation** is the umbrella feature.
- A **policy** is synchronous sandbox logic that runs before a schema write and may allow, skip,
  or replace it.
- A **subscription** is asynchronous post-commit sandbox logic. It cannot affect the completed
  operation, and its failure is isolated.
- A **signal** is a persisted semantic occurrence defined by a database-backed **signal schema**.
  Events remain temporal records attached to entities; signals are distinct automation messages.
- Notification destinations are **channels** (`notification_channel`). Channels own delivery
  configuration only; subscriptions decide when notifications happen.
- An **automation rule** binds a sandbox script to either a lifecycle operation on an
  entity/event/relationship schema or to a signal schema. Rules reference reusable scripts;
  subscribing never copies script code.

### Policies

Policies form an ordered, sequential reducer over a canonical write draft, executed before the
write transaction opens. `allow` passes the draft through, `skip` stops the chain as a successful
no-op, and `replace` may change only fields the source contract explicitly allows. Every
replacement is normalized, schema-validated, and reauthorized; invalid output, an unauthorized
reference, or script failure rejects that record's write. Policies cannot replace the actor,
owner, schema, operation, origin, or relationship endpoints. The initial event create contract
permits replacing only `properties`, `occurredAt`, and `sessionEntityId`. Policies never hold a
database transaction across sandbox execution.

### Subscriptions

Subscriptions run after commit through durable workflows. Matching subscriptions are independent
and may run concurrently, and dispatch never rolls back or delays the completed business
operation. Every installed notification subscription is one lightweight user-owned
`automation_rule` row referencing shared built-in target schemas and the shared notification
script. Global built-in rules (`user_id IS NULL`) exist for policies and lifecycle detectors and
can never notify users directly.

### Producers: observers and authors

Signals have exactly two producer types, both flowing through the one signal-emission service:

- **Observers** are built-in detector scripts subscribed to lifecycle occurrences on schema-backed
  writes. The writer does not know the semantics — a provider refresh inserting relationship rows
  does not know it "discovered episodes" — so a detector derives the fact and calls `emitSignal`.
- **Authors** are trusted application workflows emitting a fact they themselves produce and are
  the authority for: `integration.disabled` is emitted by the workflow that performs the disable.
  An author supplies the schema, validated properties, and actor context from records it has
  authoritatively loaded. It can never choose recipients or construct the notification message.

A workflow may author a signal only for a fact it produces itself; anything derivable from a
schema-backed write must use a detector.

## Persistence

### `signal_schema`

- `id`, `slug`, `name`, `user_id` (null for built-ins), `is_builtin`
- `properties_schema`, using the same property-schema model as other schemas
- `audience_policy`
- `catalog_state`: `active` or `hidden`
- timestamps

Use the same global/user uniqueness convention as existing schema tables. Each built-in schema's
slug, properties schema, and audience policy form an immutable contract: idempotent seeding may
update display name and catalog state but must fail loudly if a contract field differs. Payload or
audience changes use a successor slug, retaining the old schema for historical signals and
existing rules. Built-in signal schemas are never hard-deleted.

Audience policies:

```ts
type SignalAudiencePolicy =
	| { kind: "actor" }
	| {
			kind: "related_users";
			relationshipSchemaId: RelationshipSchemaId;
			subjectSide: "source" | "target";
	  };
```

`actor` requires a non-null `actor_user_id`. `related_users` requires a non-null
`subject_entity_id` and a valid visible relationship schema, and resolves non-null
`relationship.user_id` values on relationships matching the subject entity and configured schema.
The signal subject is the entity that owns the audience relationship — for a new show season, the
parent show. Related-user signals have no actor, keeping them independent of any recipient
account. A valid related-user signal may resolve an empty audience. One generic resolver
interprets the stored policy; no code path switches on schema slugs.

### `signal`

- deterministic `id`, `signal_schema_id`
- optional `actor_user_id` and `subject_entity_id`; the subject FK uses `ON DELETE SET NULL`
- validated `properties`, server-derived origin
- `occurred_at`, `created_at`

`created_at` is insertion time. `occurred_at` is when Ryot observed or authoritatively produced
the fact: detector emissions inherit the lifecycle occurrence's commit time, and observation
signals keep provider release dates in validated properties rather than backdating the
occurrence. Public callers cannot supply signal timestamps.

A signal is an immutable, self-contained fact, not a live view of its subject. Its validated
properties carry the minimal display data consumers need — subject name, old/new values — and the
subject entity FK is navigation only. Signal snapshots never refresh entity data at execution
time, so subject mutation or deletion cannot change or break an already-emitted signal.

### `signal_recipient`

`(signal_id, user_id)` snapshot of the authorized audience at emission time. Dispatch uses only
this snapshot, so later monitoring or unmonitoring never changes an emitted signal's audience.
Signal creation and recipient resolution are atomic, and no caller may provide recipient user IDs.

A signal with an empty audience is still persisted; duplicate emission returns the existing signal
without re-resolving the audience. Deleting a recipient user cascades only that user's recipient
rows and private runs; shared signals remain for other recipients, while private actor-audience
signals are removed with their actor.

### `automation_rule`

- identity, `user_id` (null = global built-in), `name`, `is_builtin`, `is_active`, timestamps
- `kind`: `policy` or `subscription`
- `operation`: `create`, `update`, `delete`, or `signal`
- `sandbox_script_id`, plus an optional ordering position for policies
- optional server-owned `metadata`, validated with Effect Schema and passed to the script as
  `ruleMetadata`; public rule endpoints never accept it
- exactly one target FK: entity schema, event schema, relationship schema, or signal schema

Database checks enforce exactly one target and target/operation compatibility: a signal-schema
target requires `kind = "subscription"` and `operation = "signal"`; lifecycle targets cannot use
the `signal` operation; policies cannot target signal schemas. Every target FK is a real, indexed
foreign key with cascading deletion — no polymorphic string IDs.

Per-target partial unique indexes provide uniqueness: user rules on
`(user_id, target_id, operation, sandbox_script_id) WHERE target_id IS NOT NULL AND user_id IS NOT NULL`,
global rules on `(target_id, operation, sandbox_script_id) WHERE user_id IS NULL`.

Cross-table ownership and visibility — a user rule may reference that user's or built-in
schemas/scripts — is enforced transactionally by the automation service, with tests covering every
allowed and forbidden combination. Built-in rule seeding is idempotent.

Lifecycle rules initially expose `create`, plus the built-in-only entity and relationship
`update`/`delete` detectors media monitoring requires.

### `subscription_run`

One row per subscription execution:

- deterministic id derived from the occurrence and rule IDs
- optional execution user id
- rule FK using `ON DELETE SET NULL`, a scalar `original_rule_id`, and the denormalized rule name
- optional signal id; occurrence id, source kind, operation, and record id when the trigger was a
  lifecycle occurrence
- status: queued, running, succeeded, failed, or skipped, with a structured reason for skips
- sandbox error, logs, and returned value, plus the script's `updated_at` at execution
- queued, started, and finished timestamps

Each stored artifact — logs, error, returned value — is truncated at a single fixed cap with an
explicit marker before persistence; truncation never changes run status. The sandbox itself always
receives the complete schema-validated context.

Runs are kept indefinitely. Deleting a rule stops future matching but never deletes run history;
`original_rule_id` and the rule name keep history attributable after deletion. Rule matching
linearizes at run insertion: the insertion transaction re-reads the live rule and rechecks that it
is active, so a rule deactivated or deleted before insertion produces no run, and once a run
exists, later rule changes cannot affect it.

Do not add a separate lifecycle-occurrence table.

## Runtime Semantics

### Origins

Every lifecycle description and signal carries a server-derived origin:

```ts
type AutomationOrigin =
	| { kind: "api" }
	| { kind: "bootstrap" }
	| { kind: "import"; importRunId?: ImportRunId }
	| { kind: "integration"; integrationId: IntegrationId; importRunId?: ImportRunId }
	| { kind: "automation"; executionId: string }
	| { kind: "provider_refresh" };
```

Public callers cannot provide or override origins, and nested write paths propagate the root
origin end to end rather than replacing it with an internal detail. An origin kind exists only
with a producing write path; new kinds are added with their producers, never speculatively. Each
dispatch root supplies its origin explicitly: public API writes carry `api`, `bootstrapNewUser`
writes carry `bootstrap`, import runs carry `import`, integration syncs carry `integration`,
scheduled media-monitoring refreshes carry `provider_refresh`, and sandbox-created writes carry
`automation` with the creating execution's ID.

Ensure-mode population requests thread the requesting root's origin through
`EntityPopulationTrigger` — the entity-interest path passes the origin of the write that
registered the interest. Because ensure runs coalesce on `populate-${entityId}` with
`discard: true`, a coalesced execution records the origin of the request that actually started
it, and discarded duplicate requests alter nothing. This coarseness is deliberate and safe: no
built-in detector branches on population origins — population detectors gate on
`rootPreviouslyPopulated` and monitoring relationships instead.

Legacy bootstrap suppresses dispatch entirely and produces no occurrences.

### Lifecycle occurrences

All entity, event, and relationship writes flow through their owning services; automation
dispatches from services, never repositories. The initial occurrence scope is public creates plus
the provider-population entity/relationship create/update/delete paths. Other service write paths
— collection membership mutations, user-state merge/clear, the media-trending refresh — are
occurrence-free until update/delete support broadens. Translation overlay writes modify
`entity_translation`, not the canonical entity row, and produce no occurrence.

For a create:

1. Resolve and execute ordered policies before opening the write transaction.
2. Validate the policy result through a source-specific Effect Schema.
3. Persist the final value transactionally.
4. After commit, enqueue lifecycle dispatch with the persisted record snapshot.
5. Resolve active subscription rules and start one durable execution per rule.

Provider-backed entity saves classify each mutation as `create`, `update`, or `noop`, capturing
`before` and `after` atomically; only material changes dispatch `update` — timestamp-only changes,
identical replacements, and preserved conflicts are `noop` and dispatch nothing. Provider
relationship synchronization returns ordered `create`/`update`/`delete`/`noop` outcomes with
atomically captured endpoint snapshots and dispatches one occurrence per material mutation after
commit; additive syncs never produce `delete` outcomes.

Delivery rules: a user-owned row is visible to that user's subscriptions plus applicable built-in
rules; a global row runs built-in rules only and is never broadcast to users subscribed to its
schema. Built-in detectors bridge to users by emitting signals whose audience policy fans out
safely. Only seeded built-in media detectors may target the internal entity and relationship
update/delete occurrences initially; public update/delete rules, update policies, and public
relationship mutation APIs remain deferred.

### Event create batches

An array submission is an ordered sequence of independent record creates, not one atomic batch.
Each item completes its policy chain, transaction, and dispatch initiation before the next item;
the batch stops at the first failure, leaving earlier committed items and their runs in place. The
public event create endpoint awaits the durable workflow and returns real per-item outcomes: items
written, items skipped by policy, and — when the batch stopped early — the failed index with a
typed reason. A partially committed batch returns a success-status outcome carrying the typed
failure details, not a transport-level `4xx`. Internal durable callers compose the same workflow
with deterministic execution IDs.

### Deterministic identity and replay

- Every committed mutation gets an opaque occurrence ID, stable across replay or enqueue retry and
  distinct per mutation of the same record. Durable callers derive it from their execution ID and
  mutation/item index; non-durable paths generate it once before persistence. The affected record
  ID is kept separately.
- A subscription run ID derives from its occurrence and rule IDs.
- A detector or author emission derives its signal ID from the emitting execution's ID, the
  signal schema slug, and a per-emission discriminator: a deterministic key built from the
  property values that distinguish sibling emissions (for association signals, the subject
  endpoint and role). One execution may therefore emit several signals of one schema — one per
  newly added role — while replay of the same emission still collides into the existing row.
  Repeated emission returns the existing signal and never re-resolves its snapshotted recipients.
- A notification delivery execution ID derives from the run ID.

Deterministic IDs plus conflict-do-nothing inserts make workflow replay safe: no duplicate runs,
signals, or delivery executions. Phase 5 generalizes emission idempotency with explicit effect
keys when user scripts arrive.

### Durable and non-durable sources

When the source write is an activity inside a durable workflow, dispatch is the next durable step
after the write activity: the activity returns a bounded occurrence envelope — occurrence IDs,
operations, the commit timestamp, and the minimal snapshots defined for sandbox context — and the
workflow body
dispatches from it, because activities never start durable work. Dispatch failures on these paths
are not caught-and-logged as success; the owning workflow retries them.

For genuinely non-durable service writes, a process death between commit and accepted dispatch may
leave that occurrence undispatched. There is no transactional outbox or reconciliation worker
initially, and durable write paths must not be weakened to match.

### Provider population

Population already commits per natural graph scope — one parent's complete relationship set per
activity — through a single bulk edge writer, returns ordered mutation outcomes with captured
snapshots as bounded per-activity envelopes, and stamps the root's `populated_at` in the final
step, so `rootPreviouslyPopulated` stays false throughout a first population. Dispatch builds
directly on those envelopes: a later scope's failure leaves earlier committed scopes and their
dispatched occurrences in place, and the workflow resumes from the failed scope with
deterministic occurrence IDs preventing duplicates.

Bulk relationship-sync occurrence IDs derive from the sync execution ID plus the relationship
schema, direction, endpoints, and operation — never database return order or loop position. Sync
occurrences carry a batch descriptor scoped to the sync's anchor, relationship schema, and
direction, with a leader selected deterministically from stable mutation identity. Count-oriented
detectors run only on the leader and use its before/after and per-operation counts to emit one
aggregate signal; per-record detectors process their own occurrences. The full relationship batch
is never duplicated into every snapshot.

### Subscription execution

A feature-owned durable `SubscriptionExecutionWorkflow`:

1. Creates or resumes the deterministic run row.
2. Marks it running.
3. Awaits `RunSandboxWorkflow` with the resolved sandbox identity.
4. Records outcome, logs, returned value, and timing.
5. Completes without affecting sibling subscriptions or the source operation.

Every run resolves a hidden execution principal:

```ts
type AutomationPrincipal = { kind: "user"; userId: UserId } | { kind: "system" };
```

A user-owned rule runs as its owner. A built-in rule processing a user-owned row runs as that
row's owner. A built-in rule processing a global row runs as `system`, which requires both a
built-in rule and built-in script. The principal controls data authority only; host functions come
from script capability metadata. System runs have no execution user ID and are not user-visible.

A queued run resolves the latest compiled script code and metadata when execution starts; the
recorded script `updated_at` is an audit breadcrumb, not a version pin, and exact historical
replay requires future script versioning. A completed script failure is recorded rather than
retried; infrastructure enqueue failures retry durably. Disabled users are excluded from signal
audiences and lifecycle matching, and a run whose execution user is disabled when it starts is
marked `skipped` with reason `user_disabled` and is not replayed automatically on re-enablement.

## Sandbox Scripts

### Authoring

All automation scripts are TypeScript `.sandbox.ts` ES modules like every other built-in: authored
under `modules/builtins/sandbox-scripts/automations/`, type-checked against the SDK, unit-tested
in colocated `.test.ts` files, compiled by `sandbox:compile` into the generated registry, and
seeded idempotently from it. `@ryot/sandbox-sdk` gains an automation entry point exporting the
typed context and host capabilities, following the existing provider and trigger entry-point
pattern.

### Context

Subscription input is standardized under an `automation` key:

```ts
type AutomationContext = {
	ruleId: AutomationRuleId;
	ruleMetadata?: JsonValue;
	occurrenceId: string;
	origin: AutomationOrigin;
	operation: "create" | "update" | "delete" | "signal";
	source:
		| { kind: "entity"; before?: EntitySnapshot; after?: EntitySnapshot }
		| { kind: "event"; before?: EventSnapshot; after?: EventSnapshot }
		| { kind: "relationship"; before?: RelationshipSnapshot; after?: RelationshipSnapshot }
		| { kind: "signal"; signal: SignalSnapshot };
	population?: {
		scopeEntity: {
			id: EntityId;
			name: string;
			entitySchemaId: EntitySchemaId;
			entitySchemaSlug: string;
		};
		rootPreviouslyPopulated: boolean;
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
	};
};
```

`population` is present only on trusted provider-population occurrences and is supplied by the
owning workflow, never accepted from public input. `scopeEntity` identifies the root population
target: for show-season and show-episode mutations it is the parent show; podcast-episode
mutations use the podcast; top-level syncs use their anchor. Episode-scoped occurrences carry
`owningSeason` so detectors can classify special seasons. An authoritative nested relationship
sync propagates the scope reference through its nested syncs.

All four snapshot shapes are captured atomically with their mutation and embed everything the
script needs, because entity-query host functions are barred:

- `EntitySnapshot`: entity ID, entity-schema ID and slug, name, and schema-validated properties.
- `EventSnapshot`: event ID, event-schema ID and slug, schema-validated properties, `occurredAt`,
  and an embedded subject reference — entity ID, entity name, entity-schema slug — resolved by
  the writing service at capture time, since event rows store only the entity ID.
- `RelationshipSnapshot`: relationship identity, schema identity, schema-validated properties,
  and minimal immutable snapshots of both endpoints (entity ID, entity-schema slug, name).
- `SignalSnapshot`: signal ID, signal-schema slug, schema-validated properties, `occurredAt`, and
  origin — sufficient for the shared notification script to format a message with no further
  lookups.

Every occurrence envelope also carries the commit timestamp of its write transaction; detector
emissions inherit it as the signal's `occurred_at`.

Detectors derive labels and audience subjects from these snapshots alone. Hierarchical media
detectors use `scopeEntity` as the
related-user signal subject and the source of `entityName`; association detectors instead use the
person/company endpoint as the signal subject, with the other endpoint supplying `associatedName`.

Only JSON-safe, schema-validated snapshots are exposed. Identity and privilege remain hidden
runtime inputs, never caller-controlled context fields.

### Host functions

**`emitSignal`** — emission, in either producer form:

1. Loads an accessible signal schema.
2. Validates signal properties.
3. Derives the actor from the hidden execution principal.
4. When a subject is supplied or required by the audience policy, validates that it is readable to
   the actor unless a trusted built-in execution is producing a global signal.
5. Resolves the audience policy and snapshots recipients.
6. Inserts the signal and recipients transactionally.
7. Enqueues signal subscription dispatch after commit.

Author workflows call the same underlying service, constructing the hidden principal from the
authoritative record they have loaded — `integration.disabled` uses the owning
`integration.user_id` — never from a public request or sandbox argument. A system-principal
workflow cannot emit an actor-audience signal and may emit only a built-in policy-compatible
signal with its required subject. It returns the standard sandbox success/failure envelope.

**`sendNotification`** — accepts a schema-validated message and enqueues the existing
message-kind delivery request for the hidden current user:

- rejects arbitrary user IDs
- delivers to all enabled channels for that user
- uses a deterministic delivery execution ID derived from the run
- returns success once durable delivery is accepted, not once every provider succeeds

Channel sets and credentials resolve at each delivery attempt; nothing about channels is
snapshotted into automation data. Zero enabled channels is a successful delivery with zero
results. Delivery is at-least-once at the provider boundary, so an individual channel can
occasionally receive a duplicate; per-channel durable attempts are deferred. Per-channel
sent/failed outcomes stay in the delivery workflow result and operator logs and never
retroactively fail the subscription run. User-facing copy says delivery was accepted, not
delivered. Notification formatting is sandbox behavior: the shared built-in notification script
formats exclusively from the stored signal snapshot and receives no entity-query host functions.

### Capabilities

Script metadata allowlists are the capability source of truth in this release:

- `emitSignal` and `sendNotification` are provided only to subscription executions. Policies and
  direct `/sandbox/enqueue` runs never receive them, regardless of allowlists.
- Public script creation rejects both capabilities, so only seeded built-ins carry them.
- Detector scripts allowlist `emitSignal` and never `sendNotification`; the shared notification
  script allowlists `sendNotification` and never `emitSignal`. Seeding rejects a global built-in
  rule whose script requests `sendNotification`.

Runtime capability ceilings, loop budgets, and the effect ledger arrive in Phase 5 together with
user scripts — the only code that can create loops or unbounded fan-out.

## Built-In Catalog

### Signal property contracts

Built-in signal properties are structured, minimal, and reject unknown fields. Calendar dates use
ISO 8601 `YYYY-MM-DD`; timestamps use ISO 8601 UTC datetime strings. No preformatted messages,
full entity snapshots, image arrays, or credentials. IDs needed to preserve a notification link
after subject deletion are duplicated deliberately in validated properties.

| Signal                                         | Required properties                                           | Optional properties                  |
| ---------------------------------------------- | ------------------------------------------------------------- | ------------------------------------ |
| `integration.disabled`                         | `integrationId`, `providerName`                               | none                                 |
| `workout.created`                              | `workoutId`, `workoutName`                                    | none                                 |
| `review.created`                               | `reviewEventId`, `entityId`, `entityName`, `entitySchemaSlug` | none                                 |
| `media.status.changed`                         | `entityName`, `oldStatus`, `newStatus`                        | none                                 |
| `media.content-count.changed`                  | `entityName`, `contentType`, `oldCount`, `newCount`           | none                                 |
| `media.release-date.changed`                   | `entityName`, `changeKind`                                    | variant fields below                 |
| `media.episode.name.changed`                   | `entityName`, `episodeNumber`                                 | `seasonNumber`, `oldName`, `newName` |
| `media.episode.images.changed`                 | `entityName`, `episodeNumber`                                 | `seasonNumber`                       |
| `media.season-count.changed`                   | `entityName`, `oldCount`, `newCount`                          | none                                 |
| `media.episode.discovered`                     | `entityName`, `discoveredCount`, `oldCount`, `newCount`       | `seasonNumber`                       |
| person/company media/group association signals | `subjectName`, `associatedName`, `role`                       | none                                 |

`media.release-date.changed` is a discriminated contract: `changeKind: "publish_year"` requires
integer `oldYear` and `newYear`; `changeKind: "episode_date"` requires `oldDate`, `newDate`, and
`episodeNumber`, with `seasonNumber` optional so the contract also covers podcast episodes without
a successor slug. Optional `oldName`/`newName` on `media.episode.name.changed` may be null when a
provider adds or removes an episode name.

The four association slugs are `person.media.associated`, `person.media-group.associated`,
`company.media.associated`, and `company.media-group.associated`.

### Sole producers

One owner per semantic scope; tests must prove no second detector emits the same signal for the
same scope.

| Signal                                         | Sole producer                                                                                   |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `integration.disabled`                         | integration workflow (author)                                                                   |
| `workout.created`                              | workout entity-create detector                                                                  |
| `review.created`                               | review event-create detectors                                                                   |
| `media.status.changed`                         | parent media-entity update detector                                                             |
| `media.content-count.changed`                  | anime/manga entity update detector                                                              |
| `media.release-date.changed`                   | parent media update for top-level dates; show-episode update for episode-scoped dates           |
| `media.episode.name.changed`                   | episode-entity update detector                                                                  |
| `media.episode.images.changed`                 | episode-entity update detector                                                                  |
| `media.season-count.changed`                   | leader of show-to-season relationship sync when the net count changes                           |
| `media.episode.discovered`                     | leader of show-season-to-episode or podcast-to-episode sync when `createdCount > 0`             |
| person/company media/group association signals | canonical credit-edge create from either population direction, plus newly added roles on update |

Anime/manga numeric counts belong only to `media.content-count.changed`. Episode and season entity
creation alone emits nothing; the parent-child relationship establishes the semantic association.

### Detection behavior

- **Initial-population silence.** Hierarchical media detectors — status, counts, discovery,
  release dates, episode fields — emit nothing when `rootPreviouslyPopulated` is false.
  Association detectors stay silent only when the unpopulated root is the person/company subject
  itself, so a monitored person's own first population does not flood subscribers, while a newly
  populated media entity still announces its credits to users monitoring those persons/companies.
- **Specials.** Episode detectors emit nothing when `owningSeason` identifies a special season.
- **Independence.** Each semantic fact emits on its own: one refresh adding a season and its
  episodes emits both `media.season-count.changed` and one aggregate `media.episode.discovered`,
  and name/image/date changes of existing episodes emit alongside a same-refresh discovery in that
  season. No cross-occurrence suppression or coordination; users disable either subscription.
- **Episode comparisons.** Image comparison is order- and duplicate-insensitive; release-date
  transitions where either side is null emit nothing.
- **Associations.** Credit edges have two writers resolving one canonical identity: media-rooted
  detail population additively writes incoming credit edges so new media immediately exposes cast
  and crew, and person/company-rooted population authoritatively owns that subject's filmography.
  The association detector runs on a canonical edge `create` regardless of which root appears in
  `scopeEntity`, subject only to the initial-population rule. A material update emits only roles
  newly added relative to the immediate `before` snapshot; identical writes, already-present
  roles, removed roles, and deletions emit nothing. An authoritative delete followed by an
  additive re-create may notify again — accepted churn, no historical deduplication ledger.
- **`review.created`.** Built-in detectors on the applicable built-in review event schemas emit
  the actor-audience signal only for `api` origin; all other origins emit nothing. Only the review
  author is eligible; there is no public or cross-user review visibility.
- **`workout.created`.** A built-in detector on workout entity creation emits the actor-audience
  signal only for `api` origin; all other origins emit nothing.

### Existing trigger migration

- Move the Integration Progress Policy to an event-schema create policy.
- Move Auto-Complete on Full Progress to an event-schema create subscription; its
  `inheritedProperties: ["consumedOn"]` configuration moves from the deleted trigger row into the
  rule's `metadata` column and reaches the script as `ruleMetadata`.
- Move the Radarr, Sonarr, and Jellyfin pushes to subscriptions.
- Delete `event_schema_trigger` and its repository methods once all consumers are automation
  rules; automation rules are the only trigger system.

### Media monitoring

`modules/media-monitoring` keeps provider refresh scheduling and entity population ownership.
Notification delivery and semantic notification vocabulary leave the module: detector scripts emit
built-in signals whose audience policy resolves users connected to the parent media, person, or
company through the `media-monitoring` relationship, and notification subscriptions consume those
signals. Where population does not expose sufficient before/after information, the generic write
path is enhanced to capture it rather than adding feature-specific diff branches.

## Notification Model

- Remove `configuredEvents` from channels, contracts, repositories, and delivery filtering, along
  with the `NotificationEventType` union and the legacy event-kind delivery request.
- Delivery accepts a message with no caller-selected channel; the built-in action targets all
  enabled channels for the subscription user.
- `bootstrapNewUser` installs one notification rule per `active` built-in signal schema, for
  auth-created and migrated users alike, inside its existing transactional, idempotent,
  session-gated flow. Activating a catalog schema later does not backfill existing users, and
  seeding never recreates a rule a user deleted; users opt in through the catalog.
- Channel CRUD manages delivery configuration only and never creates or changes subscriptions.
  Notification runs with zero enabled channels complete successfully with zero deliveries.

## Public API

- list/get/delete the authenticated user's installed notification rules
- activate/deactivate an installed notification rule
- install or reinstall an active built-in catalog signal
- list/get built-in signal schemas; only `catalog_state = "active"` schemas are offered, `hidden`
  schemas are internal

Catalog installation is the only rule-creation path: the client supplies the active built-in
signal-schema target, and the server selects the shared notification script and server-owned rule
metadata. Reinstalling recreates the same user-owned rule row after deletion. The endpoints accept
no arbitrary script IDs, lifecycle targets, rule kinds, operations, or configuration, and there is
no generic rule update. Internal services still use the generic persisted model for seeded
policies and detectors. Run and signal history endpoints are deferred; the persisted rows support
adding them later.

## Security

- A subscription never expands data visibility.
- Schema lifecycle subscriptions run only for the owning user; global rows run built-in rules
  only.
- Signal recipients are derived server-side from the audience policy and snapshotted; no script or
  workflow supplies recipient IDs.
- Cross-user audience policies and system-context emission are built-in-only. System execution
  requires both a built-in rule and built-in script and cannot send notifications.
- Direct `/sandbox/enqueue` executions and policy runs can never call `emitSignal` or
  `sendNotification`; those require a rule-bound subscription run.
- Every rule mutation verifies rule, schema, and script ownership.
- Disabled users are excluded from audiences and matching, and rechecked at run start.
- Run logs and results are visible to the rule owner; a run created by a global built-in rule
  under a user principal is visible to its execution user; system-principal runs are not exposed.
  Existing sandbox secret redaction is preserved.
- A get for an inaccessible or nonexistent record returns the same `404` so existence is not
  leaked.
- All policy outputs, signal properties, rule metadata, and host-function inputs are validated
  with Effect Schema.

## Legacy Bootstrap

- Startup ordering: seed global built-in schemas, scripts, and rules before migrating users, so
  active signal schemas and the shared notification script exist when `bootstrapNewUser` runs for
  migrated users. Migrated users receive the same active default subscriptions as new users.
- A migrated user's bootstrap failure aborts migration; it is never caught-and-logged.
- Migration writes suppress lifecycle dispatch and emit nothing for historical entities, events,
  or signals.

## Documentation Cutover

Land these with the implementation, not before the documented behavior becomes current:

- `apps/app-backend/src/modules/builtins/AGENTS.md`: describe the trigger built-ins as automation
  rules with automation context rather than `event_schema_trigger` rows.
- `apps/app-backend/AGENTS.md`: update the schema-write-path trigger wording and durable-ownership
  guidance, plus the workflow owners pinned by
  `apps/app-backend/src/modules/sandbox/workflow-boundaries.test.ts`.
- `docs/decisions.md` and `docs/effect-workflow-guide.md`: update wherever they encode
  `event_schema_trigger`, configured events, or the old notification/monitoring workflow
  ownership.
- `docs/plans/v1-v2-port-gap-analysis.md`: describe signal producers and user-owned subscriptions
  for the event-driven-alert guidance; keep calendar-dependent behavior deferred on the calendar
  feature.

After release, no sibling document may present configured events or the trigger model as current
behavior.

## Phases

Phases 1–4 sit behind an unreleased feature boundary; the catalog and default bootstrap behavior
are not exposed until the built-in producers, shared notification script, and legacy-bootstrap
changes are ready together. Mark a signal schema `active` only when its producer is enabled, so
users created between steps do not permanently miss defaults under the no-backfill policy.

1. **Foundation.** Signal schemas/signals/recipients, automation rules, subscription runs, the
   automation service and generic audience resolver, origin threading, lifecycle occurrence
   dispatch, the SDK automation entry point, `emitSignal`/`sendNotification`, and
   `SubscriptionExecutionWorkflow`. Preserve current behavior while the dispatcher is introduced;
   `sendNotification` uses the existing message-kind delivery request and never passes a
   `NotificationEventType`.
2. **Trigger migration.** Move the existing event trigger rows and execution to automation rules;
   delete `event_schema_trigger`.
3. **Built-in notification subscriptions.** Shared notification script; `review.created`,
   `workout.created`, and `integration.disabled` producers; default installs through
   `bootstrapNewUser`; remove `configuredEvents` and `NotificationEventType`; ship the catalog and
   rule-management API.
4. **Media-monitoring conversion.** Seed the media signal schemas and detector scripts, thread the
   `population` context, establish parity per the detection-behavior rules above, then delete the
   module's direct notification fan-out and message construction.
5. **Custom automation surface.** Generic rule create/update contracts, user scripts with
   `emitSignal`/`sendNotification`, custom signal schemas and emitters, run/signal history APIs,
   rule and script quotas, and the loop-prevention machinery: effect ledger, correlation budgets,
   automation depth/breadth limits, and runtime capability ceilings.

Each phase leaves one owner for every side effect; old and new notification paths never run
simultaneously after parity is established.

## Tests and Acceptance Criteria

- Database constraints enforce one rule target, target/operation compatibility, referential
  integrity, and unique recipient snapshots; service tests cover every allowed and forbidden
  ownership combination.
- Catalog installation accepts only an active built-in signal target with the server-selected
  script; arbitrary script IDs, lifecycle targets, operations, and generic updates are rejected.
- Global schema rows never fan out to user subscriptions.
- Public script creation rejects the `emitSignal` and `sendNotification` capabilities; policies
  and direct sandbox executions never receive either host function; seeding rejects a global
  built-in rule whose script requests `sendNotification`.
- Policies preserve allow/skip/replace behavior and ordering without holding a transaction open.
- The event create endpoint returns actual per-item outcomes and never reports uncommitted items
  as created.
- Subscription failures are isolated and recorded with useful logs, error, and timing; stored
  artifacts obey the single truncation cap with explicit markers, and truncation never changes
  run status.
- Workflow replay does not duplicate runs, signals, or delivery executions.
- `emitSignal` validates payloads, derives actors, rejects unauthorized subjects, and prevents
  caller-selected recipients; `integration.disabled` derives its actor from the integration owner
  loaded by the workflow.
- Actor and related-user audience policies enforce their prerequisites and snapshot the correct
  recipients, including a valid empty related-user audience; duplicate emission returns the
  existing signal without re-resolving.
- Deleting one user removes their private signals, recipient rows, and runs without changing
  another recipient's shared history; deleting a rule preserves its runs, findable through
  `original_rule_id`.
- `review.created` and `workout.created` emit exactly once for direct API creation and never for
  any other origin or legacy-bootstrap writes; `review.created` reaches only the review author.
- Nested population tests prove show-episode entity updates and season-to-episode syncs carry the
  parent show as `scopeEntity`, and detectors construct correct signal subjects and names without
  post-commit entity queries.
- Population relationship syncs classify genuinely new child rows as `create`, so episode
  discovery fires with an accurate `createdCount` on the sync leader.
- Initial population of a monitored entity emits no hierarchical signals; a monitored
  person/company's own first population emits no association signals, while first population of a
  media entity still emits association signals for monitored credit subjects.
- Special-season episode changes emit nothing; sibling episode changes emit alongside a
  same-refresh discovery; season-count and episode-discovery signals both emit when both facts
  occur.
- Episode image comparison is order- and duplicate-insensitive; null-sided release-date
  transitions emit nothing.
- Dual-writer association tests cover media-first, person/company-first, and concurrent discovery
  of one canonical edge: exactly one insertion classifies as `create`, an identical second write
  is `noop`, and the detector uses the person/company endpoint as subject regardless of
  `scopeEntity`. Update tests emit each newly added role once, nothing for unchanged or removed
  roles, and permit a new notification after a real delete/re-create cycle.
- Media-monitoring tests cover every detected change and prove no direct notification workflow
  call remains in the module.
- Every seeded property contract accepts its supported variants, rejects unknown or
  variant-incomplete fields, preserves nullable episode-name transitions, and accepts an
  `episode_date` without `seasonNumber`.
- Built-in seeding is idempotent across restarts and fails loudly when an existing schema's
  contract fields differ.
- Notification actions reach every enabled channel and no disabled channel; zero enabled channels
  is a success with zero deliveries.
- Legacy migration initializes migrated users with active defaults through `bootstrapNewUser` and
  emits nothing for historical writes.
- The documentation cutover is complete; no sibling document describes configured events or
  `event_schema_trigger` as current behavior.
- All backend checks run through Turbo and app-owned tests from `apps/app-backend`; legacy
  bootstrap is validated with restored V1 dumps per its `AGENTS.md`.

## Explicitly Deferred

- User scripts, custom signal schemas, generic rule contracts, and everything else in Phase 5,
  including effect ledger, correlation/depth/breadth budgets, runtime capability ceilings, and
  rule/script quotas.
- Run and signal history endpoints.
- Public reviews, review visibility, and cross-user review notifications.
- Arbitrary recipient IDs supplied by scripts.
- Per-subscription channel routing; all enabled channels are used.
- A generic filter/query language on subscriptions.
- Multi-hop relationship audience policies until a built-in signal requires them.
- Automatic retries of completed script failures, manual replay, configurable retention, and
  script versioning.
- Public or user-created update/delete subscriptions, update policies, and generic public
  relationship mutation APIs until their write paths and snapshot contracts exist.
- Reminder-fired, stale-progress, and completed-to-backlog features; design and seed their signal
  schemas only with their owning features.
- `media.release.published`; it depends on the separately scoped calendar feature.

## Follow-Up Decisions

Signal and run retention remains indefinite initially and should be revisited once storage becomes
material.
