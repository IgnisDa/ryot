# Database-Driven Automations, Signals, and Subscriptions

## Problem Statement

Ryot users want to be told when something meaningful happens in their library — a monitored show
gets new episodes, a show's status changes, a person they follow appears in new media, an
integration stops working, they post a review or log a workout — and they want automated
reactions to their own activity, like media being auto-completed when progress reaches 100%.

Today the backend cannot offer this cleanly. Notification vocabulary is a hardcoded TypeScript
enum (`NotificationEventType`) with per-channel `configuredEvents` filtering; media monitoring
constructs messages and calls the delivery workflow directly; event-driven behavior lives in a
separate one-off `event_schema_trigger` table. Adding or changing a notification topic requires
application code changes across several modules, users cannot subscribe to or mute individual
topics, and a previous large implementation attempt was reverted for code quality. Users get an
all-or-nothing, developer-defined notification surface instead of a catalog they control.

## Solution

Build one database-driven automation system covering schema lifecycle hooks, semantic domain
signals, user subscriptions, and notifications.

Domain behavior such as "an episode was discovered" is defined by seeded database rows and
sandbox scripts, not TypeScript enums or feature-specific delivery branches. Built-in detector
scripts observe lifecycle occurrences on schema-backed writes and emit **signals** — persisted
semantic facts with a server-resolved audience. Users hold lightweight **automation rules**
(subscriptions) that bind a shared notification script to signal schemas they care about, managed
through a catalog API and installed by default at signup. Notification formatting itself runs in
the sandbox from the stored signal snapshot. The existing trigger table and the notification enum
are deleted once their consumers are automation rules.

The application runtime never switches on signal slugs; sandbox scripts are themselves seeded
data and may branch on slugs and snapshot shapes freely.

V2 is unreleased greenfield: breaking its current tables and contracts is acceptable, and the
unreleased Drizzle migration history may be regenerated when a phase changes the schema.

## User Stories

1. As a Ryot user, I want a notification when new episodes of a show or podcast I monitor are
   discovered, so that I know there is new content to consume.
2. As a Ryot user, I want a notification when the season count of a monitored show changes, so
   that I learn about newly announced seasons.
3. As a Ryot user, I want a notification when a monitored media's status changes (for example a
   show is cancelled), so that I can adjust my expectations.
4. As a Ryot user, I want a notification when a monitored media's publish year or an episode's
   release date changes, so that I know when to expect it.
5. As a Ryot user, I want a notification when an episode of a monitored show is renamed, so that
   I notice metadata corrections.
6. As a Ryot user, I want a notification when an episode's images change, so that I see updated
   artwork.
7. As a Ryot user, I want a notification when the chapter or episode count of a monitored anime
   or manga changes, so that I know more content exists.
8. As a Ryot user, I want a notification when a person I monitor is newly associated with media
   or a media group, so that I discover their new work.
9. As a Ryot user, I want a notification when a company I monitor is newly associated with media
   or a media group, so that I follow studios and publishers I care about.
10. As a Ryot user, I want one notification per newly added role when a person gains several
    credits on the same media, so that each fact is reported exactly once.
11. As a Ryot user, I want a confirmation notification when I post a review, so that I know it
    was recorded.
12. As a Ryot user, I want a notification when I create a workout, so that I get immediate
    feedback on logged activity.
13. As a Ryot user, I want a notification when one of my integrations is disabled, so that I can
    fix its credentials promptly.
14. As a Ryot user, I want to browse a catalog of available notification topics, so that I can
    choose exactly which notifications I receive.
15. As a Ryot user, I want to install a subscription from the catalog, so that I start receiving
    that topic.
16. As a Ryot user, I want to deactivate and reactivate an installed subscription without
    deleting it, so that I can pause a topic temporarily.
17. As a Ryot user, I want to delete an installed subscription and reinstall it later, so that I
    fully control my notification surface.
18. As a new user, I want sensible default subscriptions installed at signup, so that I receive
    useful notifications without any setup.
19. As a user migrated from V1, I want the same default subscriptions as new users, so that
    migration leaves me with a working notification setup.
20. As a Ryot user, I want notifications delivered to all my enabled notification channels, so
    that channel configuration stays independent of what I subscribe to.
21. As a Ryot user, I want no notification flood when I first add and populate a new entity, so
    that only genuine changes after that reach me.
22. As a Ryot user, I want no notifications for special seasons, so that extras and specials do
    not create noise.
23. As a Ryot user, I want media auto-completed when my progress reaches 100%, so that my library
    state maintains itself (existing behavior preserved through the migration).
24. As a Ryot user, I want my Radarr, Sonarr, and Jellyfin pushes to keep firing on the same
    occasions as today, so that my external tooling keeps working.
25. As a Ryot user, I want integration progress events filtered by my configured minimum and
    maximum progress, so that partial plays do not pollute my history (existing behavior
    preserved).
26. As a Ryot user, I want my subscriptions and their run results visible only to me, so that my
    activity stays private.
27. As a Ryot user deleting my account, I want my private signals, recipient rows, and runs
    removed while shared signals remain intact for other recipients, so that deletion is clean
    without damaging others' history.
28. As a self-hosting operator, I want built-in schemas, scripts, and rules seeded idempotently
    across restarts, so that upgrades are safe and repeatable.
29. As a self-hosting operator, I want seeding to fail loudly when a built-in schema's contract
    fields differ from the seeded definition, so that contract drift is caught immediately.
30. As a self-hosting operator, I want subscription run history kept with logs, errors, and
    timing — attributable even after the rule is deleted — so that I can debug automation
    behavior.
31. As a backend developer, I want new notification topics defined as seeded rows plus sandbox
    scripts, so that adding one requires no enum edits or delivery-branch changes.
32. As a backend developer, I want workflow replay to never duplicate signals, runs, or
    deliveries, so that durable retries are safe by construction.
33. As a backend developer, I want exactly one producer per semantic signal scope, so that no
    fact is ever reported twice by competing detectors.
34. As a backend developer, I want the trigger table and its execution path deleted once all
    consumers are automation rules, so that there is a single trigger system.

## Implementation Decisions

### Current state this builds on (already landed)

- Sandbox scripts are single-file TypeScript ES modules compiled to format-1 JavaScript through a
  compile step into a generated registry, seeded idempotently, and executed in Deno. Built-ins
  live in the builtins module with colocated unit tests. The sandbox SDK exposes typed entry
  points per script kind (provider, trigger); this feature adds an automation entry point
  following that pattern.
- Notification destinations are **channels** (`notification_channel`). The delivery workflow
  already carries a message-kind request that skips `configuredEvents` filtering and delivers to
  every enabled channel, and the notifications service exposes a send-message operation accepting
  a caller-supplied execution ID. The legacy event-kind request, `configuredEvents`, and
  `NotificationEventType` survive until Phase 3.
- Provider population already commits per natural graph scope (one parent's complete relationship
  set per activity) through a single bulk edge writer, returns ordered
  `create`/`update`/`delete`/`noop` mutation outcomes with atomically captured before/after
  snapshots as bounded per-activity envelopes, and stamps the root's `populated_at` in a final
  step so `rootPreviouslyPopulated` stays false throughout a first population.
- User bootstrap runs transactionally and idempotently behind a session gate
  (`bootstrap_completed_at`), for auth-created and migrated users alike.

### Model

- **Automation** is the umbrella feature.
- A **policy** is synchronous sandbox logic that runs before a schema write and may allow, skip,
  or replace it.
- A **subscription** is asynchronous post-commit sandbox logic. It cannot affect the completed
  operation, and its failure is isolated.
- A **signal** is a persisted semantic occurrence defined by a database-backed **signal schema**.
  Events remain temporal records attached to entities; signals are distinct automation messages.
- Channels own delivery configuration only; subscriptions decide when notifications happen.
- An **automation rule** binds a sandbox script to either a lifecycle operation on an
  entity/event/relationship schema or to a signal schema. Rules reference reusable scripts;
  subscribing never copies script code.

Policies form an ordered, sequential reducer over a canonical write draft, executed before the
write transaction opens. Allow passes the draft through, skip stops the chain as a successful
no-op, and replace may change only fields the source contract explicitly allows. Every
replacement is normalized, schema-validated, and reauthorized; invalid output, an unauthorized
reference, or script failure rejects that record's write. Policies cannot replace the actor,
owner, schema, operation, origin, or relationship endpoints. The initial event create contract
permits replacing only properties, occurrence time, and session entity. Policies never hold a
database transaction across sandbox execution.

Subscriptions run after commit through durable workflows. Matching subscriptions are independent
and may run concurrently, and dispatch never rolls back or delays the completed business
operation. Every installed notification subscription is one lightweight user-owned rule row
referencing shared built-in target schemas and the shared notification script. Global built-in
rules (null user) exist for policies and lifecycle detectors and can never notify users directly.

Signals have exactly two producer types, both flowing through the one signal-emission service:

- **Observers** are built-in detector scripts subscribed to lifecycle occurrences on
  schema-backed writes. The writer does not know the semantics — a provider refresh inserting
  relationship rows does not know it "discovered episodes" — so a detector derives the fact and
  emits the signal.
- **Authors** are trusted application workflows emitting a fact they themselves produce and are
  the authority for: `integration.disabled` is emitted by the workflow that performs the disable.
  An author supplies the schema, validated properties, and actor context from records it has
  authoritatively loaded. It can never choose recipients or construct the notification message.

A workflow may author a signal only for a fact it produces itself; anything derivable from a
schema-backed write must use a detector.

### Persistence

**`signal_schema`**: identity, slug, name, nullable owner user (null for built-ins), built-in
flag, a properties schema using the same property-schema model as other schemas, an audience
policy, a catalog state (`active` or `hidden`), and timestamps. Same global/user uniqueness
convention as existing schema tables. Each built-in schema's slug, properties schema, and
audience policy form an immutable contract: idempotent seeding may update display name and
catalog state but must fail loudly if a contract field differs. Payload or audience changes use a
successor slug, retaining the old schema for historical signals and existing rules. Built-in
signal schemas are never hard-deleted.

Audience policies are a stored discriminated value with two kinds: **actor** (requires a non-null
actor user) and **related-users** (configured with a relationship schema reference and which side
the subject sits on; requires a non-null subject entity and a valid visible relationship schema,
and resolves the non-null relationship owners on relationships matching the subject entity and
configured schema). The signal subject is the entity that owns the audience relationship — for a
new show season, the parent show. Related-user signals have no actor, keeping them independent of
any recipient account. A valid related-user signal may resolve an empty audience. One generic
resolver interprets the stored policy; no code path switches on schema slugs.

**`signal`**: deterministic ID, schema FK, optional actor user and subject entity (subject FK
set-null on delete), validated properties, server-derived origin, occurrence time, and creation
time. Creation time is insertion time; occurrence time is when Ryot observed or authoritatively
produced the fact — detector emissions inherit the lifecycle occurrence's commit time, and
observation signals keep provider release dates in validated properties rather than backdating
the occurrence. Public callers cannot supply signal timestamps. A signal is an immutable,
self-contained fact, not a live view of its subject: its validated properties carry the minimal
display data consumers need (subject name, old/new values) and the subject FK is navigation only,
so subject mutation or deletion cannot change or break an already-emitted signal.

**`signal_recipient`**: a `(signal, user)` snapshot of the authorized audience at emission time.
Dispatch uses only this snapshot, so later monitoring or unmonitoring never changes an emitted
signal's audience. Signal creation and recipient resolution are atomic, and no caller may provide
recipient user IDs. A signal with an empty audience is still persisted; duplicate emission
returns the existing signal without re-resolving the audience. Deleting a recipient user cascades
only that user's recipient rows and private runs; shared signals remain for other recipients,
while private actor-audience signals are removed with their actor.

**`automation_rule`**: identity, nullable owner user (null = global built-in), name, built-in and
active flags, timestamps, a kind (`policy` or `subscription`), an operation (`create`, `update`,
`delete`, or `signal`), a sandbox script FK plus an optional ordering position for policies, an
optional server-owned metadata value (Effect Schema-validated, passed to the script as rule
metadata, never accepted by public endpoints), and exactly one target FK among entity schema,
event schema, relationship schema, and signal schema. Database checks enforce exactly one target
and target/operation compatibility: a signal-schema target requires subscription kind and signal
operation; lifecycle targets cannot use the signal operation; policies cannot target signal
schemas. Every target FK is a real, indexed foreign key with cascading deletion — no polymorphic
string IDs. Per-target partial unique indexes provide uniqueness: user rules on
(user, target, operation, script) where the target and user are non-null, global rules on
(target, operation, script) where the user is null. Cross-table ownership and visibility — a user
rule may reference that user's or built-in schemas/scripts — is enforced transactionally by the
automation service. Built-in rule seeding is idempotent. Lifecycle rules initially expose
`create`, plus the built-in-only entity and relationship `update`/`delete` detectors media
monitoring requires.

**`subscription_run`**: one row per subscription execution — a deterministic ID derived from the
occurrence and rule IDs; an optional execution user; a rule FK that nulls on delete plus a scalar
original-rule ID and the denormalized rule name; an optional signal ID; the occurrence ID, source
kind, operation, and record ID when the trigger was a lifecycle occurrence; a status (queued,
running, succeeded, failed, or skipped, with a structured reason for skips); the sandbox error,
logs, and returned value plus the script's update timestamp at execution; and queued, started,
and finished timestamps. Each stored artifact — logs, error, returned value — is truncated at a
single fixed cap with an explicit marker before persistence; truncation never changes run status.
The sandbox itself always receives the complete schema-validated context. Runs are kept
indefinitely. Deleting a rule stops future matching but never deletes run history; the
original-rule ID and rule name keep history attributable after deletion. Rule matching linearizes
at run insertion: the insertion transaction re-reads the live rule and rechecks that it is
active, so a rule deactivated or deleted before insertion produces no run, and once a run exists,
later rule changes cannot affect it. Do not add a separate lifecycle-occurrence table.

### Origins

Every lifecycle occurrence and signal carries a server-derived origin, a discriminated value with
kinds: `api`, `bootstrap`, `import` (optional import run reference), `integration` (integration
reference, optional import run reference), `automation` (creating execution's ID), and
`provider_refresh`. Public callers cannot provide or override origins, and nested write paths
propagate the root origin end to end rather than replacing it with an internal detail. An origin
kind exists only with a producing write path; new kinds are added with their producers, never
speculatively. Each dispatch root supplies its origin explicitly: public API writes carry `api`,
new-user bootstrap writes carry `bootstrap`, import runs carry `import`, integration syncs carry
`integration`, scheduled media-monitoring refreshes carry `provider_refresh`, and sandbox-created
writes carry `automation` with the creating execution's ID.

Ensure-mode population requests thread the requesting root's origin through the population
trigger — the entity-interest path passes the origin of the write that registered the interest.
Because ensure runs coalesce on a per-entity execution ID with discarded duplicates, a coalesced
execution records the origin of the request that actually started it, and discarded duplicate
requests alter nothing. This coarseness is deliberate and safe: no built-in detector branches on
population origins — population detectors gate on `rootPreviouslyPopulated` and monitoring
relationships instead.

Legacy bootstrap suppresses dispatch entirely and produces no occurrences.

### Lifecycle occurrences

All entity, event, and relationship writes flow through their owning services; automation
dispatches from services, never repositories. The initial occurrence scope is public creates plus
the provider-population entity/relationship create/update/delete paths. Other service write paths
— collection membership mutations, user-state merge/clear, the media-trending refresh — are
occurrence-free until update/delete support broadens. Translation overlay writes modify the
translation table, not the canonical entity row, and produce no occurrence.

For a create: resolve and execute ordered policies before opening the write transaction; validate
the policy result through a source-specific Effect Schema; persist the final value
transactionally; after commit, enqueue lifecycle dispatch with the persisted record snapshot;
resolve active subscription rules and start one durable execution per rule.

Provider-backed entity saves classify each mutation as create, update, or noop with atomically
captured before/after; only material changes dispatch `update` — timestamp-only changes,
identical replacements, and preserved conflicts are noop and dispatch nothing. Provider
relationship synchronization returns ordered create/update/delete/noop outcomes with atomically
captured endpoint snapshots and dispatches one occurrence per material mutation after commit;
additive syncs never produce delete outcomes.

Delivery rules: a user-owned row is visible to that user's subscriptions plus applicable built-in
rules; a global row runs built-in rules only and is never broadcast to users subscribed to its
schema. Built-in detectors bridge to users by emitting signals whose audience policy fans out
safely. Only seeded built-in media detectors may target the internal entity and relationship
update/delete occurrences initially; public update/delete rules, update policies, and public
relationship mutation APIs remain deferred.

### Event create batches

An array submission is an ordered sequence of independent record creates, not one atomic batch.
Each item completes its policy chain, transaction, and dispatch initiation before the next item;
the batch stops at the first failure, leaving earlier committed items and their runs in place.
The public event create endpoint awaits the durable workflow and returns real per-item outcomes:
items written, items skipped by policy, and — when the batch stopped early — the failed index
with a typed reason. A partially committed batch returns a success-status outcome carrying the
typed failure details, not a transport-level 4xx. Internal durable callers compose the same
workflow with deterministic execution IDs.

### Deterministic identity and replay

- Every committed mutation gets an opaque occurrence ID, stable across replay or enqueue retry
  and distinct per mutation of the same record. Durable callers derive it from their execution ID
  and mutation/item index; non-durable paths generate it once before persistence. The affected
  record ID is kept separately.
- A subscription run ID derives from its occurrence and rule IDs.
- A detector or author emission derives its signal ID from the emitting execution's ID, the
  signal schema slug, and a per-emission discriminator: a deterministic key built from the
  property values that distinguish sibling emissions (for association signals, the subject
  endpoint and role). One execution may therefore emit several signals of one schema — one per
  newly added role — while replay of the same emission still collides into the existing row.
  Repeated emission returns the existing signal and never re-resolves its snapshotted recipients.
- A notification delivery execution ID derives from the run ID.

Deterministic IDs plus conflict-do-nothing inserts make workflow replay safe: no duplicate runs,
signals, or delivery executions.

### Durable and non-durable sources

When the source write is an activity inside a durable workflow, dispatch is the next durable step
after the write activity: the activity returns a bounded occurrence envelope — occurrence IDs,
operations, the commit timestamp, and the minimal snapshots defined for sandbox context — and the
workflow body dispatches from it, because activities never start durable work. Dispatch failures
on these paths are not caught-and-logged as success; the owning workflow retries them.

For genuinely non-durable service writes, a process death between commit and accepted dispatch
may leave that occurrence undispatched. There is no transactional outbox or reconciliation worker
initially, and durable write paths must not be weakened to match.

### Provider population dispatch

Dispatch builds directly on the landed per-scope envelopes: a later scope's failure leaves
earlier committed scopes and their dispatched occurrences in place, and the workflow resumes from
the failed scope with deterministic occurrence IDs preventing duplicates.

Bulk relationship-sync occurrence IDs derive from the sync execution ID plus the relationship
schema, direction, endpoints, and operation — never database return order or loop position. Sync
occurrences carry a batch descriptor scoped to the sync's anchor, relationship schema, and
direction, with a leader selected deterministically from stable mutation identity.
Count-oriented detectors run only on the leader and use its before/after and per-operation counts
to emit one aggregate signal; per-record detectors process their own occurrences. The full
relationship batch is never duplicated into every snapshot.

### Subscription execution

A feature-owned durable subscription-execution workflow creates or resumes the deterministic run
row, marks it running, awaits the existing sandbox-run workflow with the resolved sandbox
identity, records outcome, logs, returned value, and timing, and completes without affecting
sibling subscriptions or the source operation.

Every run resolves a hidden execution principal: either a user principal or a system principal. A
user-owned rule runs as its owner. A built-in rule processing a user-owned row runs as that row's
owner. A built-in rule processing a global row runs as system, which requires both a built-in
rule and built-in script. The principal controls data authority only; host functions come from
script capability metadata. System runs have no execution user ID and are not user-visible.

A queued run resolves the latest compiled script code and metadata when execution starts; the
recorded script update timestamp is an audit breadcrumb, not a version pin, and exact historical
replay requires future script versioning. A completed script failure is recorded rather than
retried; infrastructure enqueue failures retry durably. Disabled users are excluded from signal
audiences and lifecycle matching, and a run whose execution user is disabled when it starts is
marked skipped with a user-disabled reason and is not replayed automatically on re-enablement.

### Sandbox scripts

All automation scripts are TypeScript sandbox ES modules like every other built-in: authored in
an automations grouping alongside the existing built-in scripts, type-checked against the SDK,
unit-tested in colocated test files, compiled into the generated registry, and seeded
idempotently from it. The sandbox SDK gains an automation entry point exporting the typed context
and host capabilities, following the existing provider and trigger entry-point pattern.

Subscription input is standardized under an automation key carrying: the rule ID; optional rule
metadata; the occurrence ID; the origin; the operation (create, update, delete, or signal); a
source discriminated by kind — entity (optional before/after entity snapshots), event (optional
before/after event snapshots), relationship (optional before/after relationship snapshots), or
signal (a signal snapshot); and an optional population block present only on trusted
provider-population occurrences, supplied by the owning workflow and never accepted from public
input. The population block carries: a scope entity (ID, name, entity-schema ID and slug)
identifying the root population target — for show-season and show-episode mutations the parent
show, for podcast-episode mutations the podcast, for top-level syncs their anchor; a
root-previously-populated flag; an optional owning season (number and name) on episode-scoped
occurrences so detectors can classify special seasons; and an optional batch descriptor (batch
ID, leader flag, before/after counts, and created/updated/deleted counts). An authoritative
nested relationship sync propagates the scope reference through its nested syncs.

All four snapshot shapes are captured atomically with their mutation and embed everything the
script needs, because entity-query host functions are barred:

- **Entity snapshot**: entity ID, entity-schema ID and slug, name, and schema-validated
  properties.
- **Event snapshot**: event ID, event-schema ID and slug, schema-validated properties, occurrence
  time, and an embedded subject reference — entity ID, entity name, entity-schema slug — resolved
  by the writing service at capture time, since event rows store only the entity ID.
- **Relationship snapshot**: relationship identity, schema identity, schema-validated properties,
  and minimal immutable snapshots of both endpoints (entity ID, entity-schema slug, name).
- **Signal snapshot**: signal ID, signal-schema slug, schema-validated properties, occurrence
  time, and origin — sufficient for the shared notification script to format a message with no
  further lookups.

Every occurrence envelope also carries the commit timestamp of its write transaction; detector
emissions inherit it as the signal's occurrence time.

Detectors derive labels and audience subjects from these snapshots alone. Hierarchical media
detectors use the scope entity as the related-user signal subject and the source of the entity
name; association detectors instead use the person/company endpoint as the signal subject, with
the other endpoint supplying the associated name. Only JSON-safe, schema-validated snapshots are
exposed. Identity and privilege remain hidden runtime inputs, never caller-controlled context
fields.

### Host functions

**Emit-signal** — emission, in either producer form: loads an accessible signal schema, validates
signal properties, derives the actor from the hidden execution principal, validates a supplied or
policy-required subject as readable to the actor (unless a trusted built-in execution is
producing a global signal), resolves the audience policy and snapshots recipients, inserts the
signal and recipients transactionally, and enqueues signal subscription dispatch after commit.
Author workflows call the same underlying service, constructing the hidden principal from the
authoritative record they have loaded — `integration.disabled` uses the owning integration's user
— never from a public request or sandbox argument. A system-principal workflow cannot emit an
actor-audience signal and may emit only a built-in policy-compatible signal with its required
subject. It returns the standard sandbox success/failure envelope.

**Send-notification** — accepts a schema-validated message and enqueues the existing message-kind
delivery request for the hidden current user: rejects arbitrary user IDs, delivers to all enabled
channels for that user, uses a deterministic delivery execution ID derived from the run, and
returns success once durable delivery is accepted (not once every provider succeeds). Channel
sets and credentials resolve at each delivery attempt; nothing about channels is snapshotted into
automation data. Zero enabled channels is a successful delivery with zero results. Delivery is
at-least-once at the provider boundary, so an individual channel can occasionally receive a
duplicate; per-channel durable attempts are deferred. Per-channel sent/failed outcomes stay in
the delivery workflow result and operator logs and never retroactively fail the subscription run.
User-facing copy says delivery was accepted, not delivered. Notification formatting is sandbox
behavior: the shared built-in notification script formats exclusively from the stored signal
snapshot and receives no entity-query host functions.

### Capabilities

Script metadata allowlists are the capability source of truth in this release. Emit-signal and
send-notification are provided only to subscription executions; policies and direct sandbox
enqueue runs never receive them, regardless of allowlists. Public script creation rejects both
capabilities, so only seeded built-ins carry them. Detector scripts allowlist emit-signal and
never send-notification; the shared notification script allowlists send-notification and never
emit-signal. Seeding rejects a global built-in rule whose script requests send-notification.
Runtime capability ceilings, loop budgets, and the effect ledger arrive with user scripts (out of
scope here) — the only code that can create loops or unbounded fan-out.

### Built-in signal catalog

Built-in signal properties are structured, minimal, and reject unknown fields. Calendar dates use
ISO 8601 date strings; timestamps use ISO 8601 UTC datetime strings. No preformatted messages,
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

`media.release-date.changed` is a discriminated contract: a publish-year change requires integer
old and new years; an episode-date change requires old date, new date, and episode number, with
season number optional so the contract also covers podcast episodes without a successor slug.
Optional old/new names on `media.episode.name.changed` may be null when a provider adds or
removes an episode name. The four association slugs are `person.media.associated`,
`person.media-group.associated`, `company.media.associated`, and
`company.media-group.associated`.

One owner per semantic scope; tests must prove no second detector emits the same signal for the
same scope:

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
| `media.episode.discovered`                     | leader of show-season-to-episode or podcast-to-episode sync when the created count is positive  |
| person/company media/group association signals | canonical credit-edge create from either population direction, plus newly added roles on update |

Anime/manga numeric counts belong only to `media.content-count.changed`. Episode and season
entity creation alone emits nothing; the parent-child relationship establishes the semantic
association.

### Detection behavior

- **Initial-population silence.** Hierarchical media detectors — status, counts, discovery,
  release dates, episode fields — emit nothing when the root was not previously populated.
  Association detectors stay silent only when the unpopulated root is the person/company subject
  itself, so a monitored person's own first population does not flood subscribers, while a newly
  populated media entity still announces its credits to users monitoring those persons/companies.
- **Specials.** Episode detectors emit nothing when the owning season identifies a special
  season.
- **Independence.** Each semantic fact emits on its own: one refresh adding a season and its
  episodes emits both a season-count change and one aggregate episode discovery, and
  name/image/date changes of existing episodes emit alongside a same-refresh discovery in that
  season. No cross-occurrence suppression or coordination; users disable either subscription.
- **Episode comparisons.** Image comparison is order- and duplicate-insensitive; release-date
  transitions where either side is null emit nothing.
- **Associations.** Credit edges have two writers resolving one canonical identity: media-rooted
  detail population additively writes incoming credit edges so new media immediately exposes cast
  and crew, and person/company-rooted population authoritatively owns that subject's filmography.
  The association detector runs on a canonical edge create regardless of which root appears as
  the scope entity, subject only to the initial-population rule. A material update emits only
  roles newly added relative to the immediate before snapshot; identical writes, already-present
  roles, removed roles, and deletions emit nothing. An authoritative delete followed by an
  additive re-create may notify again — accepted churn, no historical deduplication ledger.
- **`review.created`** and **`workout.created`.** Built-in detectors on the applicable built-in
  schemas emit the actor-audience signal only for `api` origin; all other origins emit nothing.
  Only the review author is eligible; there is no public or cross-user review visibility.

### Existing trigger migration

Move the Integration Progress Policy to an event-schema create policy. Move Auto-Complete on Full
Progress to an event-schema create subscription; its inherited-properties configuration (copying
the consumed-on date from the triggering event) moves from the deleted trigger row into the
rule's metadata and reaches the script as rule metadata. Move the Radarr, Sonarr, and Jellyfin
pushes to subscriptions. Delete the trigger table and its repository methods once all consumers
are automation rules; automation rules are the only trigger system.

### Media monitoring

The media-monitoring module keeps provider refresh scheduling and entity population ownership.
Notification delivery and semantic notification vocabulary leave the module: detector scripts
emit built-in signals whose audience policy resolves users connected to the parent media, person,
or company through the media-monitoring relationship, and notification subscriptions consume
those signals. Where population does not expose sufficient before/after information, the generic
write path is enhanced to capture it rather than adding feature-specific diff branches.

### Notification model

- Remove `configuredEvents` from channels, contracts, repositories, and delivery filtering, along
  with the `NotificationEventType` union and the legacy event-kind delivery request.
- Delivery accepts a message with no caller-selected channel; the built-in action targets all
  enabled channels for the subscription user.
- New-user bootstrap installs one notification rule per active built-in signal schema, for
  auth-created and migrated users alike, inside its existing transactional, idempotent,
  session-gated flow. Activating a catalog schema later does not backfill existing users, and
  seeding never recreates a rule a user deleted; users opt in through the catalog.
- Channel CRUD manages delivery configuration only and never creates or changes subscriptions.
  Notification runs with zero enabled channels complete successfully with zero deliveries.

### Public API

List/get/delete the authenticated user's installed notification rules; activate/deactivate an
installed notification rule; install or reinstall an active built-in catalog signal; list/get
built-in signal schemas (only active catalog schemas are offered; hidden schemas are internal).
Catalog installation is the only rule-creation path: the client supplies the active built-in
signal-schema target, and the server selects the shared notification script and server-owned rule
metadata. Reinstalling recreates the same user-owned rule row after deletion. The endpoints
accept no arbitrary script IDs, lifecycle targets, rule kinds, operations, or configuration, and
there is no generic rule update. Internal services still use the generic persisted model for
seeded policies and detectors. Run and signal history endpoints are deferred; the persisted rows
support adding them later. Contract-facing schemas and endpoint groups live in the shared
contract library per the existing module boundary rules.

### Security

- A subscription never expands data visibility.
- Schema lifecycle subscriptions run only for the owning user; global rows run built-in rules
  only.
- Signal recipients are derived server-side from the audience policy and snapshotted; no script
  or workflow supplies recipient IDs.
- Cross-user audience policies and system-context emission are built-in-only. System execution
  requires both a built-in rule and built-in script and cannot send notifications.
- Direct sandbox enqueue executions and policy runs can never call emit-signal or
  send-notification; those require a rule-bound subscription run.
- Every rule mutation verifies rule, schema, and script ownership.
- Disabled users are excluded from audiences and matching, and rechecked at run start.
- Run logs and results are visible to the rule owner; a run created by a global built-in rule
  under a user principal is visible to its execution user; system-principal runs are not exposed.
  Existing sandbox secret redaction is preserved.
- A get for an inaccessible or nonexistent record returns the same 404 so existence is not
  leaked.
- All policy outputs, signal properties, rule metadata, and host-function inputs are validated
  with Effect Schema.

### Legacy bootstrap

Startup ordering: seed global built-in schemas, scripts, and rules before migrating users, so
active signal schemas and the shared notification script exist when the user bootstrap runs for
migrated users. Migrated users receive the same active default subscriptions as new users. A
migrated user's bootstrap failure aborts migration; it is never caught-and-logged. Migration
writes suppress lifecycle dispatch and emit nothing for historical entities, events, or signals.

### Documentation cutover

Land these with the implementation, not before the documented behavior becomes current: the
builtins module agent guide (describe the trigger built-ins as automation rules with automation
context rather than trigger rows); the backend agent guide (schema-write-path trigger wording,
durable-ownership guidance, and the pinned workflow owners); the decisions document and the
Effect workflow guide (wherever they encode the trigger table, configured events, or the old
notification/monitoring workflow ownership); and the V1-to-V2 port gap analysis (describe signal
producers and user-owned subscriptions for the event-driven-alert guidance; keep
calendar-dependent behavior deferred on the calendar feature). After release, no sibling document
may present configured events or the trigger model as current behavior.

### Phases

Phases 1–4 sit behind an unreleased feature boundary; the catalog and default bootstrap behavior
are not exposed until the built-in producers, shared notification script, and legacy-bootstrap
changes are ready together. Mark a signal schema active only when its producer is enabled, so
users created between steps do not permanently miss defaults under the no-backfill policy.

1. **Foundation.** Signal schemas/signals/recipients, automation rules, subscription runs, the
   automation service and generic audience resolver, origin threading, lifecycle occurrence
   dispatch, the SDK automation entry point, the emit-signal and send-notification host
   functions, and the subscription-execution workflow. Preserve current behavior while the
   dispatcher is introduced; send-notification uses the existing message-kind delivery request
   and never passes a notification event type.
2. **Trigger migration.** Move the existing event trigger rows and execution to automation rules;
   delete the trigger table.
3. **Built-in notification subscriptions.** Shared notification script; `review.created`,
   `workout.created`, and `integration.disabled` producers; default installs through user
   bootstrap; remove `configuredEvents` and `NotificationEventType`; ship the catalog and
   rule-management API.
4. **Media-monitoring conversion.** Seed the media signal schemas and detector scripts, thread
   the population context, establish parity per the detection-behavior rules above, then delete
   the module's direct notification fan-out and message construction.

Each phase leaves one owner for every side effect; old and new notification paths never run
simultaneously after parity is established.

## Testing Decisions

A good test exercises external behavior through public service, workflow, or endpoint interfaces
and asserts observable outcomes — rows written, signals emitted, notifications enqueued, typed
errors returned — never implementation details. Assertions stay inline; duplicated setup is
extracted, test intent is not. Assertion functions are used for test-only type narrowing. Tests
prove app-owned behavior and branching, not library behavior.

Modules under test (all of them, per the confirmed module sketch):

- **Automation persistence and rule service**: database constraints (one target,
  target/operation compatibility, partial unique indexes, cascades) and every allowed and
  forbidden ownership/visibility combination.
- **Signal emission service**: payload validation, actor derivation, subject authorization,
  audience resolution for both policy kinds (including a valid empty related-user audience),
  atomic recipient snapshots, duplicate-emission short-circuit.
- **Lifecycle occurrence dispatcher**: origin threading per dispatch root, envelope construction,
  deterministic occurrence IDs, durable and non-durable paths, replay non-duplication.
- **Policy engine**: allow/skip/replace ordering, replaceable-field enforcement, validation and
  reauthorization of replacements, no transaction held across sandbox execution.
- **Subscription execution workflow**: run lifecycle, principal resolution, skip reasons,
  artifact truncation with markers, failure isolation.
- **Notification delivery**: message-kind deliveries reach every enabled channel and no disabled
  channel; zero enabled channels succeeds with zero deliveries.
- **Built-in seeding**: idempotency across restarts, loud failure on contract drift, rejection of
  a global rule whose script requests send-notification.
- **Detector and notification scripts**: colocated unit tests per script against the SDK types,
  covering the detection-behavior rules (initial-population silence, specials, independence,
  comparison semantics, association role diffs, origin gates).
- **Trigger migration and media-monitoring conversion**: behavior parity for auto-complete
  (including inherited consumed-on), integration progress filtering, and arr pushes; proof that
  no direct notification workflow call remains in media monitoring.
- **Public API**: endpoint tests for catalog listing, install/reinstall, activate/deactivate,
  list/get/delete, rejection of arbitrary scripts/targets/operations, and identical 404s for
  inaccessible and nonexistent records.

Prior art: existing backend service tests with mocked Effect layers (the notification delivery
tests), colocated sandbox script unit tests next to the built-in scripts, the workflow-boundaries
pinning test for durable ownership, and the end-to-end suites under the repository test package —
legacy bootstrap is validated with restored V1 dumps per its own guidelines. Backend checks run
through Turbo; app-owned tests run from the backend app directory.

Acceptance criteria the test suite must establish:

- Database constraints enforce one rule target, target/operation compatibility, referential
  integrity, and unique recipient snapshots; service tests cover every allowed and forbidden
  ownership combination.
- Catalog installation accepts only an active built-in signal target with the server-selected
  script; arbitrary script IDs, lifecycle targets, operations, and generic updates are rejected.
- Global schema rows never fan out to user subscriptions.
- Public script creation rejects the emit-signal and send-notification capabilities; policies and
  direct sandbox executions never receive either host function.
- Policies preserve allow/skip/replace behavior and ordering without holding a transaction open.
- The event create endpoint returns actual per-item outcomes and never reports uncommitted items
  as created.
- Subscription failures are isolated and recorded with useful logs, error, and timing; stored
  artifacts obey the single truncation cap with explicit markers, and truncation never changes
  run status.
- Workflow replay does not duplicate runs, signals, or delivery executions.
- Emit-signal validates payloads, derives actors, rejects unauthorized subjects, and prevents
  caller-selected recipients; `integration.disabled` derives its actor from the integration owner
  loaded by the workflow.
- Actor and related-user audience policies enforce their prerequisites and snapshot the correct
  recipients; duplicate emission returns the existing signal without re-resolving.
- Deleting one user removes their private signals, recipient rows, and runs without changing
  another recipient's shared history; deleting a rule preserves its runs, findable through the
  original-rule ID.
- `review.created` and `workout.created` emit exactly once for direct API creation and never for
  any other origin or legacy-bootstrap writes; `review.created` reaches only the review author.
- Nested population tests prove show-episode entity updates and season-to-episode syncs carry the
  parent show as the scope entity, and detectors construct correct signal subjects and names
  without post-commit entity queries.
- Population relationship syncs classify genuinely new child rows as creates, so episode
  discovery fires with an accurate created count on the sync leader.
- Initial population of a monitored entity emits no hierarchical signals; a monitored
  person/company's own first population emits no association signals, while first population of a
  media entity still emits association signals for monitored credit subjects.
- Special-season episode changes emit nothing; sibling episode changes emit alongside a
  same-refresh discovery; season-count and episode-discovery signals both emit when both facts
  occur.
- Episode image comparison is order- and duplicate-insensitive; null-sided release-date
  transitions emit nothing.
- Dual-writer association tests cover media-first, person/company-first, and concurrent discovery
  of one canonical edge: exactly one insertion classifies as a create, an identical second write
  is a noop, and the detector uses the person/company endpoint as subject regardless of scope
  entity. Update tests emit each newly added role once, nothing for unchanged or removed roles,
  and permit a new notification after a real delete/re-create cycle.
- Media-monitoring tests cover every detected change and prove no direct notification workflow
  call remains in the module.
- Every seeded property contract accepts its supported variants, rejects unknown or
  variant-incomplete fields, preserves nullable episode-name transitions, and accepts an episode
  date change without a season number.
- Built-in seeding is idempotent across restarts and fails loudly when an existing schema's
  contract fields differ.
- Legacy migration initializes migrated users with active defaults through user bootstrap and
  emits nothing for historical writes.
- The documentation cutover is complete; no sibling document describes configured events or the
  trigger table as current behavior.

## Out of Scope

- The custom automation surface (former Phase 5) in its entirety: user scripts, custom signal
  schemas and emitters, generic rule create/update contracts, rule and script quotas, and the
  loop-prevention machinery — effect ledger, correlation budgets, automation depth/breadth
  limits, and runtime capability ceilings.
- Run and signal history endpoints (the persisted rows support adding them later).
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
- A release-published signal; it depends on the separately scoped calendar feature.
- A transactional outbox or reconciliation worker for non-durable write paths.
- A separate lifecycle-occurrence table.
- Cross-level suppression between related signals (season-count and episode-discovery both fire
  by design).

## Further Notes

- Signal and run retention remains indefinite initially and should be revisited once storage
  becomes material.
- The full design rationale lives in the source plan document under the repository's plans
  directory (database-driven automations); this PRD is the implementation contract derived from
  it.
- When this PRD is broken into tasks, a mandatory final cleanup task is appended: a final pass
  over the touched files and directly affected modules following the codebase-cleanup skill.

---

## Tasks

**Overall Progress:** 0 of 15 tasks completed

**Current Task:** [Task 01](./01-signal-persistence-and-emission-service.md) (todo)

### Task List

| #   | Task                                                                                                                   | Type | Status |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ---- | ------ |
| 01  | [Signal Persistence and Emission Service](./01-signal-persistence-and-emission-service.md)                             | AFK  | todo   |
| 02  | [Automation Rules and Subscription Runs](./02-automation-rules-and-subscription-runs.md)                               | AFK  | todo   |
| 03  | [Subscription Execution Workflow and SDK Entry Point](./03-subscription-execution-workflow-and-sdk-entry-point.md)     | AFK  | todo   |
| 04  | [Host Functions and Capabilities](./04-host-functions-and-capabilities.md)                                             | AFK  | todo   |
| 05  | [Lifecycle Occurrence Dispatch for Creates](./05-lifecycle-occurrence-dispatch-for-creates.md)                         | AFK  | todo   |
| 06  | [Policy Engine on Event Creates](./06-policy-engine-on-event-creates.md)                                               | AFK  | todo   |
| 07  | [Trigger Migration](./07-trigger-migration.md)                                                                         | AFK  | todo   |
| 08  | [Shared Notification Script and First Producers](./08-shared-notification-script-and-first-producers.md)               | AFK  | todo   |
| 09  | [Catalog and Rule Management API with Default Installs](./09-catalog-and-rule-management-api-with-default-installs.md) | AFK  | todo   |
| 10  | [Remove Legacy Notification Vocabulary](./10-remove-legacy-notification-vocabulary.md)                                 | AFK  | todo   |
| 11  | [Population Context and Media Entity-Update Detectors](./11-population-context-and-media-entity-update-detectors.md)   | AFK  | todo   |
| 12  | [Sync Batch Leaders and Discovery Detectors](./12-sync-batch-leaders-and-discovery-detectors.md)                       | AFK  | todo   |
| 13  | [Association Detectors](./13-association-detectors.md)                                                                 | AFK  | todo   |
| 14  | [Media-Monitoring Notification Removal](./14-media-monitoring-notification-removal.md)                                 | AFK  | todo   |
| 15  | [Codebase Cleanup](./15-codebase-cleanup.md)                                                                           | AFK  | todo   |
