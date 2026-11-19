# Change sets

Every kernel write commits through `ChangeSets`. Kernel writers build `Changes` (`changes.ts`), whose
schema references are owner-qualified, and call `commit` or `commitOnce`. Every plugin writer returns
one `ChangeSet` (`@ryot-app/contract/modules/changes/change-set`), and `commitScript` commits it
atomically under the writer's principal (`command.writeContext`) after translating it with
`fromScriptChangeSet`, which qualifies every schema with the writing plugin. A change set may carry:

- `entity`: a user-owned root entity create or update, with the expected baseline for updates.
- `entities`: user entity `deletes`, data `clears` and `merges` (both through
  `EntityUserDataService`; a kernel writer's `null` schema accepts the entity's own), `updates` of existing user entities (each shaped and checked like a root
  entity update, at most once per entity), and bootstrap `ensures`.
- `relationships`: user relationship `upserts` (`merge` or `replace` properties) and `deletes`;
  endpoints are the root or existing entities.
- `events`: event creates, updates and deletes, optional `expected` session event IDs and scope
  `baselines`.
- `settings`: a patch of the writing plugin's user settings.
- `signals`: signal emissions, planned like `SignalEmissionService.planSignal`.
- `notifications`: messages for the run's account; admission queues delivery as a job.
- `globalEntities` and `globalRelationships`: provider-owned global upserts. A global relationship
  endpoint or selector anchor names an existing entity or an entity this change set upserts, by
  schema slug and external ID. Global writes persist like provider population and run no policies.
- `folds`: fold requests for the writer's user (`scope: "user"`) or every user with events on the
  entities (`scope: "all-users"`), limited to the writing plugin's folds.

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
in one lookup each and rejects a foreign reference, or an entity a delete, clear, merge or update
names under another schema, with `ChangeSetRejected`; a reference that does not exist is left to
preparation, which fails it as a conflict.

Agent and projection executions and before-stage automation runs write nothing. Ownership,
provenance, global scope and `populatedAt` are not expressible for user writes. Services keep their
own checks: exact schema/plugin ownership through `DomainWriteChecks`, merge and clear rules in
`EntityUserDataService` (same plugin and schema, owned events and relationships), and settings
validation in `PluginUserSettingsWriter`.

Kernel writers (HTTP routes, including the user-data clear and merge, imports, integrations,
collections and the provider entry event) skip
script authority and rely on these service checks, under whatever `writeContext` their command
carries. Scripts reach `ChangeSets` only through `ScriptChanges`, which always calls `commitScript`.
Parts only a script principal resolves (`settings`, `folds`, `signals`, global upserts, event
`expected` and `baselines`) fail a kernel commit with `ChangeSetRejected`.

## Preparation and commit

Preparation holds no database transaction over sandbox execution. The root entity, relationships,
ensures, entity deletes (grouped by schema), data clears and merges, and entity updates are prepared
first, each running its own entity and relationship policies. Entity deletes, clears and merges also
plan event changes, which join the change set's event changes (see [events](../events/README.md)):
an entity delete cascades a delete to every event referencing its entities, a clear deletes the
captured state's events, and a merge deletes transient evidence and moves every other event. Their
event policies run with the rest of the batch. The root entity and each entity update share one path:
`EntitiesService.prepareUserSave` checks the expected baseline and runs entity policies, and
`persistPreparedUserSave` rechecks it under the entity lock.

Event changes are then prepared in one events transaction, with positions matching the change list,
and grouped into policy chunks of at most 50 items in which a subject's items share a chunk, so a
once-per-subject policy runs once per subject. Policies are matched inside that transaction. When none
matches, the commit continues in the same transaction. Otherwise the transaction ends, each matched
policy is called once per chunk through `LifecyclePolicies` with every item it targets (nothing about
the call is persisted), and a second events transaction commits.

The commit transaction applies, in order: the receipt's `load`, the precondition's `check`, the
settings patch, source writes (event group capture, then each clear's and merge's account admission,
locks and state recheck, then root entity, relationships, events, baselines), the precondition's
`written` when an event was written, ensures, entity deletes (which fail when an event still
references a deleted entity), the rest of each clear and merge, entity updates in entity ID
order, global entity upserts and global relationship reconciliation, signal plans, notification
admissions, fold requests, and the receipt's `record`. Lifecycle dispatch starts after commit; a
failure in any part rolls back every part. Durable callers run the whole commit inside one activity.

A background-lane commit queues its folds; an interactive commit folds inline.

### Preconditions

`CommitOptions.precondition` holds `{ check, written }` for writers whose durable state decides
whether to write. `check` runs in the events transaction before preparation; false commits the
check's own writes and records an empty result without running policies. When policies ran, `check`
runs again in the commit transaction after the receipt's `load`, before any source write, so a write a
concurrent writer superseded records an empty result instead. `written` runs after source writes that
wrote an event. Locks taken by `check` (account admission first) precede the commit's stream and
entity reference locks.

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

| Caller                     | Key                                                             | Identities |
| -------------------------- | --------------------------------------------------------------- | ---------- |
| Generic import event group | The group's operation identities                                | verbatim   |
| Integration sample         | The sample's operation identity; the stream is the precondition | verbatim   |
| Data import event          | The record's operation identity                                 | verbatim   |
| Provider entry event       | The entity import job's ID                                      | prefixed   |

A commit's result also lists each clear's and merge's response (`cleared`, `merged`), which the
user-data HTTP routes return.

HTTP event creation and collection membership events commit independently without a receipt; a
deferred integration flush commits with the stream precondition alone. HTTP event updates and deletes
commit one event change without a receipt, its policies matched and called like any event batch.

## Script changes and exactly-once commits

Scripts commit their returned changes through one port, `ScriptChanges`
(`#modules/scripts/executions/script-changes`), implemented here by `ScriptChangesLayer`. It builds
the command with `scriptChangesCommand`: an automation run's changes descend from its trigger
(`automationLifecycleCausation`, so depth and the root budget carry over); every other script starts a
root causation (`bootstrap`, `integration` or `api` for user subjects, `provider-refresh` for system
ones). The caller passes the durable identity of the script's execution as `executionId`; every
trigger, entity and event ID the commit derives comes from it. Failures are normalized to
`ScriptChangesRejected` (`conflict`, `policy-rejected` or `invalid`) for each caller to map. A
failure whose reason code is a `CommitConflictCode` is a `conflict`: stale baselines, and the
`EntityUserDataService` refusals a user causes by acting on changed data (`state-conflict` when the
captured user data changed, `child-mapping-conflict` when merged child data has no unique match). A
clear's or merge's event changes fail like any event change (`event-stale`, `policy-rejected`).
Refusals the writing plugin can rule out from its own reads (same-entity merges, schema or identity
property mismatches, denied operations) stay `invalid`.

`commitOnce` and `commitScript` make a commit exactly-once against the caller's durable state through
a `CommitReceipt` (`receipts.ts`). `receipt.load` returns a result an earlier commit recorded: it is
read once before preparation (so a replay runs no policies) and again first in the commit transaction,
where a stored result ends the commit before any write. `receipt.record` runs after every write, so
the result commits with the changes it describes. An absent or empty script change set only runs
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
still rechecks the stored entity, but plans no entity lifecycle batch, and a change set without
relationships plans no relationship batch. The commit changes no plugin, installation, or account
rows, so it runs each locked domain write check once per writer, owner, and scope
(`reuseLockedWriteChecks`); the check's shared locks keep its result valid until commit.
Preparation reads and plans without writing, so its checks share one resolution of the writer's
execution authority (`shareExecutionAuthority`); the commit transaction's locked checks resolve it
again, so a revocation committed during preparation still rejects the commit.

Asset uploads and storage are separate from the change set transaction. A change set may refer to managed
assets; the write boundary validates and locks those references while committing metadata.

Every change set item derives its identity as `<change set itemIdentity>:<item itemIdentity>`.
Event creates and changes carry a required `itemIdentity`; the entity and each relationship may
carry one and otherwise use `entity`, `relationship:<index>` and `relationship-delete:<index>`, and
each entity update may carry one and otherwise uses `entity-update:<entityId>`. Other parts derive
theirs from their position or identity (`entity-deletes:<schema>`, `entity-clear:<index>`,
`signal:<discriminator>`, `global-entity:<schema, externalId>`); notifications use
`<runId>-changes-<index>-notification` as their source key.

Event policy items retain their unique `itemIdentity` through preparation and policy results.
Accepted changes are committed together with the rest of the change set. The result pairs each
written event ID with its item identity and returns the root entity ID when the change set has one.
Repeated event identities or duplicate existing event IDs are rejected.

Declared event-group constraints are captured once for the complete prepared change set and checked only
after all event chunks commit within its transaction. The generic import commits each record's
grouped entity, relationships and events as one script change set, and its remaining event groups as
independent creates under their operation identities.

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
