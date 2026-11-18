# Change sets

Every plugin writer returns one `ChangeSet` (`@ryot-app/contract/modules/changes/change-set`), and
`ChangeSets.commit` commits it atomically under the writer's principal (`change set.writeContext`). A
change set may carry:

- `entity`: a user-owned root entity create or update, with the expected baseline for updates.
- `entities`: user entity `deletes`, data `clears` and `merges` (both through
  `EntityUserDataService`), `updates` of existing user entities (each shaped and checked like a root
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

`authorizeChangeSet` (`authority.ts`) resolves what the principal may write once, before any
preparation, and `undeclaredSchema` rejects a schema the pinned plugin revision does not declare.
A violation fails with `ChangeSetRejected`, naming the part:

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

Agent and projection executions and before-stage automation runs write nothing. Ownership,
provenance, global scope and `populatedAt` are not expressible for user writes. Services keep their
own checks: exact schema/plugin ownership through `DomainWriteChecks`, merge and clear rules in
`EntityUserDataService` (same plugin and schema, owned events and relationships), and settings
validation in `PluginUserSettingsWriter`.

## Preparation and commit

`ChangeSets.commit` prepares every part before the commit transaction, so no database transaction
is held over sandbox execution: the root entity, relationships, event items in pages with their
event policies, ensures, entity deletes (grouped by schema), data clears and merges, and entity
updates. Each matched policy is called once through `LifecyclePolicies` with every item it targets,
and nothing about the call is persisted. The root entity and each entity update share one path:
`EntitiesService.prepareUserSave` checks the expected baseline and runs entity policies, and
`persistPreparedUserSave` rechecks it under the entity lock. It then runs one events transaction that
applies, in order: the receipt's `load`, the settings patch, source writes (root entity,
relationships, events, baselines), ensures, deletes, clears, merges, entity updates in entity ID
order, global entity upserts and global relationship reconciliation, signal plans, notification
admissions, fold requests, and the receipt's `record`. Lifecycle dispatch starts after commit; a
failure in any part rolls back every part. Durable callers run the whole commit inside one activity.

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
captured user data changed, `child-mapping-conflict` when merged child data has no unique match).
Refusals the writing plugin can rule out from its own reads (same-entity merges, schema or identity
property mismatches, denied operations) stay `invalid`.

`ChangeSets.commitOnce(changes, command, receipt)` makes a commit exactly-once against the caller's
durable state. `receipt.load` returns a result an earlier commit recorded: it is read once before
preparation (so a replay runs no policies) and again first in the commit transaction, where a stored
result ends the commit before any write. `receipt.record` runs after every write, so the result
commits with the changes it describes. An absent or empty change set only runs `load`/`record` in a
transaction. Receipts per caller:

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

Asset uploads and storage are separate from the change set transaction. A change set may refer to managed
assets; the write boundary validates and locks those references while committing metadata.

Every change set item derives its identity as `<change set itemIdentity>:<item itemIdentity>`.
Event creates and changes carry a required `itemIdentity`; the entity and each relationship may
carry one and otherwise use `entity`, `relationship:<index>` and `relationship-delete:<index>`, and
each entity update may carry one and otherwise uses `entity-update:<entityId>`. Other parts derive
theirs from their position or identity (`entity-deletes:<schema>`, `entity-clear:<index>`,
`signal:<discriminator>`, `global-entity:<schema, externalId>`); notifications use
`<runId>-changes-<index>-notification` as their source key.

Event policy items retain their unique `itemIdentity` through preparation and policy results. Event
preparation is chunked at 50 items, while accepted changes are committed together with the rest of
the change set. The result pairs each written event ID with its item identity and returns the root entity
ID when the change set has one. Repeated event identities or duplicate existing event IDs are rejected.

Declared event-group constraints are captured once for the complete prepared change set and checked only
after all event pages commit within its transaction. The generic import owner uses this same change set,
setting item identities to its operation IDs; it does not create a parallel event writer.

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

## Standalone event creation

`EventsService.create` is intentionally different: it prepares items independently, commits the
accepted ones in one transaction, and returns per-item written, skipped, or failed outcomes. A policy
rejection or commit conflict commits none of them. It is not the atomic
entity-plus-relationships-plus-events change set described above.
