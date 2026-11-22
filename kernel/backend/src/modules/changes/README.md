# Change sets

Every kernel write commits through `ChangeSets`. Kernel writers build `Changes` (`changes.ts`), whose
schema references are owner-qualified, and call `commit` or `commitOnce`. Every plugin writer returns
one `ChangeSet` (`@ryot-app/contract/modules/changes/change-set`), and `commitScript` commits it
atomically under the writer's principal (`command.writeContext`) after translating it with
`fromScriptChangeSet`, which qualifies every schema with the writing plugin. A change set may carry:

- `entity`: a user-owned root entity create or update, with the expected baseline for updates.
- `entities`: entity `creates` (kernel writers only: an `externalId`, a `provider` identity, and
  `populatedAt`; with `updateExisting` an existing provider entity is updated, and without it a
  populated one is kept and an unpopulated one is filled; a `key` that relationships and events of
  the same change set name it by; and a `match`, an entity ID in scope or a normalized name with
  properties (a `prefer`red entity first when it qualifies), whose entity is kept instead of
  created, failing the change set when `required` finds none), kernel `references` (an existing entity the change set names by key without writing it,
  recorded as an `unchanged` import item; a matched or kept create records one too, except a
  `kernelCollection` create, which belongs to its membership rather than the item), entity `deletes` (an entity that no longer
  exists is skipped, so a repeated delete is a no-op; `preserveHistory` refuses an entity with events
  instead of cascading), data `clears` and `merges` (both through `EntityUserDataService`; a kernel
  writer's `null` schema accepts the entity's own), `updates` of existing entities (each shaped and
  checked like a root entity update, at most once per entity), and bootstrap `ensures`.
- `relationships`: user relationship `upserts` (`merge` or `replace` properties) and `deletes`;
  endpoints are the root, existing entities or keyed entities, and a change of a keyed relationship
  schema names the relationship's `key` (see [relationships](../relationships/README.md)). Kernel writers may also send `updates`
  (the relationship must exist), `ensures` (written only when absent), `deletesById`, and `events`
  that a relationship change records from what it wrote (no event when its `properties` returns
  `null`); see [relationships](../relationships/README.md).
- `events`: one `changes` list of tagged event `create`, `update` and `delete` items (a kernel
  writer's create may name its entity and session by key), with optional `expected` session event IDs
  and scope `baselines`. `eventMutation` translates each item to an event mutation, for change sets
  and fold outputs alike.
- `globalRelationships`: groups reconciled under a `self` selector, the self relationships of one
  entity schema's entities, or an `anchored` one.

An entity create, relationship write and relationship event that `CollectionsService` builds carries
`kernelCollection`, so a plugin writer's change set commits it under the kernel collection and
`member-of` schemas, as the collection routes do; every other part keeps the writer's own authority.

- `settings`: a patch of the writing plugin's user settings.
- `signals`: signal emissions, each planned through `SignalEmissionService.planSignal` under its
  `principal`, schema `reference`, optional subject entity and `itemIdentity`. A script's signals
  take the script's plugin, its execution user (or the system principal) and `signal:<discriminator>`.
- `notifications`: messages for the run's account; admission queues delivery as a job.
- `globalEntities` and `globalRelationships`: provider-owned upserts in the change set user's scope
  (global for `userId: null`). An entity upsert names its provider identity: an existing entity is
  updated when `updateExisting` or while it is an unpopulated stub and kept otherwise, and
  `preservePopulatedAt` keeps a stored `populatedAt`. A script's upserts take its provider and never
  update existing entities. A relationship endpoint or selector anchor names an existing entity or an
  entity this change set upserts, by schema slug, external ID and provider. These writes persist
  through `persistPlannedProviderUpserts` (the save path, without policies) and
  `persistPlannedReconciliation`. A kernel writer's group may page (`paging: { kind: "page" }`),
  upserting without reconciling the selector, sweep (`paging: { kind: "sweep", kept }`), deleting
  what is not kept, or `preserveExisting`, keeping the properties of relationships that exist.
  Under a population command the reconciliation records one population batch.
- `triggers` (kernel writers only): changes recorded for a scope's hooks under the writer's domain
  write check of `owner`, planned through `LifecyclePlanner.planChange`; the provider-import
  completion commits this way.
- `population` (kernel writers only): related-population bookkeeping on existing provider entities
  at the command's time, `claims` starting related populations under a generation and
  `relatedPopulated` stamping them complete.
- `folds`: fold requests for the writer's user (`scope: "user"`) or every user with events on the
  entities (`scope: "all-users"`), limited to the writing plugin's folds.

Entity parts write in the change set user's scope. A kernel writer may send `userId: null` to write
global entity `creates`, `updates` and `deletes`; the root `entity`, `events`, `relationships`, and
entity `ensures`, `clears` and `merges` need a user and fail a global commit with
`ChangeSetRejected`. The entity and relationship HTTP routes refuse a change set naming a kernel-owned
schema with `kernel-owned-schema` (`rejectKernelOwnedSchemas`) before committing it.

`CHANGE_SET_LIMITS` holds every per-part bound. `isEmptyChangeSet` lets callers skip a commit that
writes nothing.

## Authority

Script authority applies only to `commitScript`. `authorizeChangeSet` (`authority.ts`) resolves what
the principal may write once, before any preparation, and `undeclaredSchema` rejects a schema the
pinned plugin revision does not declare. A violation fails with `ChangeSetRejected`, naming the part:

| Part                                                                 | Writer                                                                                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `events`, `relationships`, `folds` (user)                            | Pinned plugin, with an execution user (user execution or user automation run)                                       |
| `entity`, `entities.deletes`/`clears`/`merges`/`updates`, `settings` | Pinned plugin, direct user execution                                                                                |
| `entities.ensures`                                                   | Also the plugin's designated user bootstrap script                                                                  |
| `settings`                                                           | Not integration, import, initialization or bootstrap executions                                                     |
| `signals`                                                            | Automation runs and system executions; system ones need a pinned system plugin automation                           |
| `notifications`                                                      | User automation runs; plugin messages are stamped with the plugin namespace, kernel ones may carry trusted messages |
| `globalEntities`, `globalRelationships`                              | System executions of a pinned system plugin; entity upserts also need its provider                                  |
| `folds` (all users)                                                  | Pinned plugin; a system execution needs a system plugin                                                             |

Every existing entity and event a user change set names (`changeSetReferences`) must belong to the
writing plugin, and a user entity or event to the execution user. Preparation resolves their owners
in one lookup each and rejects another plugin's reference, or an entity a delete, clear, merge or
update names under another schema, with `ChangeSetRejected`. Another user's entity or event fails as
`entity-not-found` or `event-not-found`, like a reference that does not exist, which preparation
fails as a conflict.

Agent and projection executions and before-stage automation runs write nothing. Ownership,
provenance, global scope and `populatedAt` are not expressible in a script change set. Services keep their
own checks: exact schema/plugin ownership through `DomainWriteChecks`, merge and clear rules in
`EntityUserDataService` (same plugin and schema, owned events and relationships), and settings
validation in `PluginUserSettingsWriter`.

Kernel writers (HTTP routes, including the entity and relationship creates and the user-data clear
and merge, the entity editor, plugin bootstrap entities, imports, integrations, collections,
provider population and its completion trigger, reminders, signal schedules, test support and the
provider entry event) skip
script authority and rely on these service checks, under whatever `writeContext` their command
carries. Scripts reach `ChangeSets` only through `ScriptChanges`, which always calls `commitScript`.
Parts only a script principal resolves (`settings`, `folds`, event `expected` and `baselines`) fail
a kernel commit with `ChangeSetRejected`; kernel writers name a signal's principal and an upsert's
provider themselves.

## Preparation and commit

Preparation holds no database transaction over sandbox execution. The root entity, entity creates and
updates, relationships, ensures, entity deletes (grouped by schema), and data clears and merges are
prepared first. A create's `match` is decided then: the commit rechecks a matched entity under its
lock, and for a create that matched nothing locks the match. When a matching entity appeared since,
the change set is prepared and committed once more, so two writers creating one name both commit
into the first one's entity; a match that appears again fails with `mutation-conflict`. Entity deletes, clears and merges also
plan event changes, which join the change set's event changes (see [events](../events/README.md)):
an entity delete cascades a delete to every event referencing its entities, a clear deletes the
captured state's events, and a merge deletes transient evidence and moves every other event. Their
event policies run with the rest of the batch. A clear or merge leaves the relationships the change
set's `relationships` part writes to those writes. The root entity, entity creates and entity updates
share one path: `EntitiesService.prepareSave` validates the draft, resolves a create's provider
identity and checks an update's expected baseline, and `persistPreparedSaves` persists a set of them
under one account admission, catalog lock and entity lock statement, rechecking each under the lock.
Every prepared entity write (saves, ensures and deletes) lists its policy items, which form one entity
policy batch chunked by entity.

Event changes are then prepared in one events transaction, with positions matching the change list,
and grouped into policy chunks of at most 50 items in which a subject's items share a chunk, so a
once-per-subject policy runs once per subject. The relationship writes of the `relationships` part and
of every clear and merge form one relationship policy batch, chunked the same way by source entity.
Event, relationship and entity policies are matched inside that transaction. When none matches, the commit
continues in the same transaction. Otherwise the transaction ends, each matched policy is called once
per chunk through `LifecyclePolicies` with every item it targets (nothing about the call is
persisted), and a second events transaction commits. A relationship or entity policy rejection or
invalid transform fails the whole change set, with the invalid property paths when properties fail
validation; an accepted entity transform replaces the draft, and each entity write validates its
final draft once more under the catalog lock. Entity policies run before event policies, which see
each saved entity as the entity policies left it. A policy batch stops calling policies once none of
its items is still active.

The commit transaction applies, in order: the receipt's `load`, the precondition's `check`, the
settings patch, source writes (event group capture, then each clear's and merge's account admission,
locks and state recheck, which a change set with only entity saves skips, then the root entity with
entity creates and updates as one set, relationships, the events relationship changes record,
events, baselines), ensures, entity deletes (which fail when an event still references a deleted
entity), the rest of each clear and merge, global entity upserts and global relationship
reconciliation, population claims and stamps, triggers, signal plans, notification admissions, fold
requests, the precondition's `written` when the commit wrote anything, and the receipt's `record`. Lifecycle dispatch starts
after commit; a failure in any part rolls back every part. Durable callers run the whole commit inside one activity.

Each commit transaction is an events transaction: its `WriteTransaction` is handed to every
repository write and to `EventMutations`, which keep their per-transaction state on it. A
background-lane commit, or one passing `queueFolds` (provider population), stores its change lists and
queues fold jobs, which fold outside any transaction; an interactive commit folds inline, so a
successful save includes its derived state (see [folds](../derived-values/README.md#when-a-fold-runs-and-in-which-mode)).

### Preconditions

`CommitOptions.precondition` holds `{ check, written }` for writers whose durable state decides
whether to write. `commitOnce` runs `check` after the receipt's first `load`, before preparation;
`check` also runs in the events transaction before policies are matched. False commits the check's
own writes and records an empty result without running policies. When policies ran, `check`
runs again in the commit transaction after the receipt's `load`, before any source write, so a write a
concurrent writer superseded records an empty result instead. `written` receives the commit's result
after every other write, when the commit wrote anything, so a writer records its own ledger from what
was planned (a signal's trigger and runs) in the same transaction. Locks taken by `check` (account
admission first) precede the commit's stream and entity reference locks.

Ledgers that are preconditions:

| Writer                   | `check`                                                                          | `written`                                                                          |
| ------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Provider population      | The request attempt owns its population; a related write's generation is current | The root base check, for the base stamp                                            |
| Signal schedule delivery | Account admission, then the occurrence's delivery lock finds it undelivered      | The `signal_schedule_delivery` row                                                 |
| Reminder due             | The reminder's lock finds it still due                                           | Its trigger, formatter run and dispatch, or the `subscription-disabled` settlement |

### Independent event creates

`CommitOptions.events.independent` gives each event create its own outcome; every other part stays
all-or-nothing. The result's `outcomes` list every create by position, and `toCreateEventsResponse`
(`outcomes.ts`) builds the HTTP `CreateEventsResponse` from them:

- a preparation failure fails only its item;
- a policy rejection is `skipped_by_policy`, and a policy item error fails the item
  (`session-entity-not-found` or `invalid-properties`);
- a policy execution failure writes nothing, keeps preparation failures, and fails every other item
  with `policy-execution-failed` and the run ID;
- a commit conflict writes nothing, keeps preparation and policy outcomes, and fails every other item
  with `mutation-conflict` or `asset-forbidden`.

A result that wrote nothing because of such a failure is recorded through the receipt in its own
transaction. `events.verbatimIdentities` keeps each create's `itemIdentity` as its write identity
instead of prefixing the command's, so event IDs, import item keys and coalescing lookups follow the
caller's operation identity.

`commitEventsKeyed(changes, command, key, options)` commits independent creates once per key, holding
the `CreateEventsResponse` in the account's idempotency key. Callers and keys:

| Caller                                     | Key                                                             | Identities |
| ------------------------------------------ | --------------------------------------------------------------- | ---------- |
| Integration sample, coalesced import event | The sample's operation identity; the stream is the precondition | verbatim   |
| Provider entry event                       | The entity import job's ID                                      | prefixed   |

A commit's result also lists each clear's and merge's response (`cleared`, `merged`), which the
user-data HTTP routes return, and each user relationship change's operation and row under its item
identity (`relationships`), which the relationship route, collections and data imports read.
`relationships.verbatimIdentities` keeps each relationship change's `itemIdentity` as its write
identity, so imports record their item keys and collections their membership commands unchanged.
The result's `entities` lists each saved root entity, entity create, update, reference and global
upsert under its item identity, `signals` each planned signal, and `deleted` every deleted entity ID.
`entities.verbatimIdentities` keeps the root entity's, creates', updates', references' and global
upserts' identities verbatim, so import entity IDs and item keys and
collection commands follow the caller's identity.

The entity editor commits through `commitOnce` with its idempotency key as the receipt (see
[entities](../entities/README.md)); plugin bootstrap entities commit `ensures` under the bootstrap
entry's root command. Generic import items, data import records and runs of data import events commit
through `commitImportItem`: `commitOnce` with the account's idempotency key under the item's command
identity, holding its entity, relationship and event results (see [imports](../imports/README.md)).

HTTP event creation commits independently without a receipt, and a collection membership commits its
relationship change with the membership event it records, alone from the collection routes or within
an import item; a deferred integration flush commits with the stream precondition alone. HTTP event updates and deletes
commit one event change without a receipt, its policies matched and called like any event batch.

## Script changes and exactly-once commits

Scripts commit their returned changes through one port, `ScriptChanges`
(`#modules/scripts/executions/script-changes`), implemented here by `ScriptChangesLayer`. It builds
the command with `scriptChangesCommand`: an automation run's changes descend from its trigger
(`automationLifecycleCausation`, so depth and the root budget carry over); every other script starts a
root causation (`bootstrap`, `integration` or `api` for user subjects, `provider-refresh` for system
ones). The caller passes the durable identity of the script's execution as `executionId`; every
trigger, entity and event ID the commit derives comes from it. Failures are normalized to
`ScriptChangesRejected` (`conflict`, `policy-rejected` or `invalid`), and every caller reports one
through `scriptChangesFailure`: a conflict is `resource-unavailable` with its conflict code, a policy
rejection a `script-failure` carrying the policy's reason, and anything else `invalid-output`. A
failure whose reason code is a `CommitConflictCode` is a `conflict`: stale baselines, and the
`EntityUserDataService` refusals a user causes by acting on changed data (`state-conflict` when the
captured user data changed, `child-mapping-conflict` when merged child data has no unique match). A
clear's or merge's event changes fail like any event change (`event-stale`, `policy-rejected`).
Refusals the writing plugin can rule out from its own reads (same-entity merges, schema or identity
property mismatches, denied operations) stay `invalid`.

`commitOnce` and `commitScript` make a commit exactly-once against the caller's durable state through
a `CommitReceipt` (`receipts.ts`). `receipt.load` returns a result an earlier commit recorded: it is
read once before preparation (so a replay runs no policies) and again first in the commit transaction,
where a stored result ends the commit before any write. A receipt with `peek` is read before
preparation without a transaction or lock instead. `receipt.record` runs after every write, so the
result commits with the changes it describes. An absent or empty script change set only runs
`load`/`record` in a transaction. Script receipts per caller:

| Caller                        | Receipt                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| Operations                    | The operation's idempotency key (`plugin-operation:result`), when the caller passed one                 |
| After hooks                   | The attempt row: `load` locks the run and returns a settled attempt; `record` finalizes it as succeeded |
| Workflow steps and activities | `commitKeyed`: the account's idempotency key under the step's or activity's execution ID                |
| User bootstrap scripts        | `commitKeyed` under the bootstrap execution ID and the script's content hash                            |

A keyed commit for a system execution has no account and no receipt; system executions may write only
global upserts, signals and all-user fold requests, whose deterministic IDs make a repeat a no-op.

## Source writes

The commit rechecks references and schema fingerprints, persists the entity, relationships, and
event changes, and plans dispatch atomically.

A settings patch is applied first in the commit transaction through `PluginUserSettingsWriter`;
integration, import, and bootstrap executions cannot write settings.

The commit holds its entity reference locks until it ends, so change sets that write events under the
same entity serialize on its row. It does only the work its changes need: an unchanged entity update
still rechecks the stored entity but records no lifecycle change, the root entity, creates and
updates share one entity lifecycle batch, and a change set without relationships plans no
relationship batch.

`DomainWriteChecks` keeps one locked authority cache per transaction, keyed by what each read
depends on: the writer's configuration lock, pinned and active revision, and execution authority
once per principal, its installation once per plugin and user, and the account once per user. The
ingestion fence takes each shared key once per transaction. Every locked check then applies the
owner, scope and kernel-collection rules to those reads. The shared locks keep the reads valid until
the transaction ends because the commit changes no plugin, installation, or account rows; a
transaction that changes them must not run a locked check before the change. A later transaction,
including a commit's second one after its policies ran, reads and locks everything again. A check
takes the fence, then the configuration lock, then the installation and account rows; the cache only
drops repeats, so each lock is still first taken where its caller first checked.

Preparation takes no authority locks and leaves installation, account and execution authority to the commit:
those reads only reject early and save no work on the common path, and the commit's locked check
rejects a revoked writer with the same errors. A prepared write still applies the owner and scope
rules and reads the writer's pinned and active revision, once per writer across the commit's
preparation (`sharePreparedPins`), since its declarations validate against them.

Asset uploads and storage are separate from the change set transaction. A change set may refer to managed
assets; the write boundary validates and locks those references while committing metadata.

Every change set item derives its identity as `<change set itemIdentity>:<item itemIdentity>`.
Event creates and changes carry a required `itemIdentity`; the entity and each relationship may
carry one and otherwise use `entity`, `relationship:<index>`, `relationship-update:<index>`,
`relationship-ensure:<index>`, `relationship-delete:<index>` and `relationship-delete-by-id:<index>`, and
each entity create and update may carry one and otherwise uses `entity-create:<index>` or
`entity-update:<entityId>`. Other parts derive theirs from their position or identity
(`ensures`, `entity-deletes:<schema, preserveHistory>`, `entity-clear:<index>`, `trigger:<index>`,
`global-entity:<schema, externalId>`), and signals carry theirs; notifications use
`<runId>-changes-<index>-notification` as their source key.

Event policy items retain their unique `itemIdentity` through preparation and policy results.
Accepted changes are committed together with the rest of the change set. The result pairs each
written event ID with its item identity and returns the root entity ID when the change set has one.
Repeated event identities or duplicate existing event IDs are rejected.

Declared event-group constraints are captured once for the complete prepared change set and checked only
after all event chunks commit within its transaction. The generic import commits an item with
declared event groups as one change set whose events are all-or-nothing.

## Replay and optimistic baselines

Plugin callers can pass `idempotencyKey` to `operations.invoke`. Keep the same key and exact immutable
input when retrying. The operation's key returns the original execution result; reusing a key with
different input conflicts. Without a key, a retried change set derives the same entity and event IDs. Bridge `requestId` values correlate individual transport attempts
and are not write identities.

Entity updates, the root one and `entities.updates`, carry an expected name, properties, and
`updatedAt`; a stale or vanished entity fails with `entity-stale` or `entity-not-found`. Event updates and deletes may
carry expected entity/session references, occurrence time, present property values, and absent
property names. Change sets can also declare the expected set of session event IDs. These baselines
detect stale writes; a changed baseline fails the atomic change set rather than merging silently.

A kernel commit that fails with `EventStale` for an event it updates or deletes with a field
`expected` is prepared and committed again, at most twice, while the event's current snapshot still
matches that `expected`: the concurrent change touched only fields the caller did not depend on. A
stale event without `expected`, or one whose fields no longer match, fails the commit. Script commits
are not retried.

Optional event `baselines` protect read-dependent change sets. Each names a visible entity owned by
the change set's plugin and the revision of that user's plugin event scope. Each insert, edit, deletion,
or reference move advances the scope revision for both entity and session references. The commit
locks entity references before comparing the revision; writers take compatible reference locks,
including standalone deletions. Readers obtain the revision from RyotQL's `eventScope` table, using
zero for a scope with no row. The baseline size is independent of history length.
Change sets can guard source and evidence scopes together; unchanged root entities are not rewritten.

Event creates can name an `orderAfter` anchor and suffix. The anchor must be an existing event in
the same user's plugin scope, sharing an entity or session with the output. Preparation captures its
revision and commit rechecks it under an event lock. An update can replace the anchor or set it to
null to return to the record's own creation order. Logical ordering does not rewrite audit timestamps.
