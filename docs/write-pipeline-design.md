# Write Pipeline Design

Approved design, **2026-11-17**, against commit `98fed6f435`. This is an engineering reference; once
each part ships, the owning package README replaces the corresponding section.

## Goal

A write costs the same on a large library as on an empty one, and an empty library keeps its current
feel. First-party plugins stay sandboxed and dogfood the same contract as third-party plugins.

## Evidence

Measured on a clone of live data, build `09e7aa092`, 2 cores and 4 GB:

| Action             | Live configuration (shared admission) | Lane admission | Kernel SQL statements | Plugin query statements |
| ------------------ | ------------------------------------: | -------------: | --------------------: | ----------------------: |
| Review delete      |            4.4 s server, ~11 s screen |          2.7 s |                   240 |      14 (859 rows read) |
| Movie progress log |                                  30 s |          1.6 s |                   218 |         6 (11 ms total) |
| Workout save       |                                  36 s |            7 s |                   n/a |                     n/a |

- **Nested admission.** An operation holds its sandbox lease while the policy or fold it triggered
  waits for another. Shared admission has one permit, so the child waits 1 s (fold) or 27 s (policy),
  then the attempt is redone durably.
- **Kernel bookkeeping dominates.** Workflow rows, automation trigger, run and attempt rows,
  authority reloads on every host call (`SandboxExecutionAuthority.resolve` runs `getScriptPin` per
  call), and journal writes account for most statements. Host-call overhead outside SQL is 41–53% of a
  write; isolate execution is 4–7%.
- **Folds re-read whole histories.** The Media fold reads every event of its subject in pages of
  100; the Fitness fold reads every set of the exercise.
- **No shipped hook uses `delivery: "required"`.** Every first-party and kernel after-hook is
  `async`.

## Contract

Plugin code never waits for other plugin code and never writes through a host call. The kernel calls
plugin functions one after another; data goes in as arguments and changes come back as return values.

| Kind                    | Called by                | Receives                                                      | Returns                                    |
| ----------------------- | ------------------------ | ------------------------------------------------------------- | ------------------------------------------ |
| Operation               | HTTP, page bridge, Ryo   | Input                                                         | `{ output, changes? }`                     |
| Policy                  | Validate phase           | Every proposed item matching its targets, in one batch        | Per item: allow, reject, or transform      |
| Fold                    | Derive phase             | Subject, previous state, and the changed events' before/after | New state and changed outputs              |
| After hook (automation) | Job queued by the commit | Retained trigger evidence                                     | `{ changes? }`                             |
| Workflow step           | Durable workflow engine  | Checkpoint                                                    | Next checkpoint or output, plus `changes?` |
| Provider                | Population job           | Provider request                                              | Global entity and relationship changes     |

Host capabilities are reads only: batched RyotQL, configuration, settings, preferences, entitlements,
cache values, diagnostics, and `httpCall` where the kind allows network access. Writes are only
returned changes.

### Change set

One schema for every kind. It generalizes today's `UserCommand`:

- `entity`: an optional root entity create or update, with the expected baseline for updates.
- `events`: `creates`, `changes` (updates and deletes with expected snapshots), and optional
  `expected` session IDs and scope `baselines`.
- `relationships`: user relationship changes referencing the root or existing entities.
- `settings`: a patch of the plugin's user settings.

Later rollout steps add the vocabulary the remaining scripts need, each in this same schema: entity
deletes and merges, signals, notifications, global upserts, and fold requests.

### Response

An operation cannot see its own commit. The response is `{ output, committed }`; `committed` carries
the root entity ID and each written event's ID by item identity. Commit conflicts reach the caller
as one typed conflict error. The client uses `committed` to update its cache; that design belongs to
the client discussion.

## Pipeline

Every write takes the same path: UI operations, import chunks, integration syncs, provider
population, after hooks, and Ryo tool calls.

1. **Decide.** The operation reads and returns its change set. Its isolate is released before the
   kernel does anything with the changes.
2. **Validate.** The kernel prepares the changes (schemas, references, properties), then calls each
   matching policy once with all of its items. Policies keep today's batch contract. No automation
   trigger, run, attempt, or job rows are written for a policy.
3. **Commit.** One transaction locks references, rechecks baselines, writes source changes, derives
   folds (phase 4), checks event groups, plans after-hook jobs, and records the idempotency receipt.
4. **Derive.** Inside that transaction, each affected subject's fold gets its previous state and the
   changed events. Outputs are written as a patch.
5. **Respond.** `{ output, committed }`.
6. **Afterwards.** After hooks, notifications, pushes, and signals run as jobs queued by the commit.

### Admission

Each phase acquires one sandbox lease, runs, and releases it before the next phase starts. Nothing
holds a lease while another script runs, so shared admission (one permit) cannot deadlock, and the
inline-then-durable fallback has nothing left to do. A parked parent, such as a workflow step waiting
on HTTP, keeps only its own lease.

A workflow replay keeps its lease and its lane's transient pool while it settles an inline batch.
The batch holds only host reads, and admission refuses any run started from host-call work, so no
script waits on a lease its caller holds. A step's changes commit in the workflow body after the
replay job has returned, so that commit's policies and folds take admission as their own phases.
Agent runs follow the same shape: each round releases its lease before its capability calls run.

### Authority

Authority, the catalog, and compiled recipes are resolved once per isolate activation, not on each
host call. A run is bounded by its execution timeout, so a revocation takes effect at the next
activation.

### Consistency

Phases 3 and 4 share one transaction, as inline folds do today. Locks are held only while fold code
runs. Operations and policies read outside it; the commit rechecks their baselines (`expected`
snapshots and `event_scope` revisions), which already exist.

## Folds

The fold input gains the change list:

- `changes: null` asks for a full replay. The fold reads the subject's history and returns every
  output, and the kernel replaces all of the subject's rows. Rebuilds and new subjects use it.
- Otherwise `changes` lists each changed event's `before` and `after` image, so a deleted event's
  data is still available. The fold returns only outputs that changed; the kernel deletes outputs of
  deleted events and of events that left the subject.

An append combines the previous state with the new events and reads no history. An edit or delete in
the past reads a bounded range the fold chooses: Fitness reads later sets that could beat the
changed maximum; Media replays the affected consumption run. A fold may still return `changes`, and
the two-run settle limit stays.

A revision install queues a replay only when the fold's script hash or its declared event schemas
change. Replays run in background batches of subjects.

As built: the kernel records each event's image before the transaction first changes it and reads the
image after at fold time, so a fold sees one `{ before, after }` per event. Relationship-only writes run
the fold with an empty list; fold jobs, absorbed values, entity content changes and more than 500
changed events replay. Media appends read only events at the instants they land on; past edits replay
from the previous completion of the touched title or episode to the present (from the previous explicit
completion on Anime and Manga), and a Show or Podcast replays in full for anything but an append,
because coverage spans episodes. The fold contract and both plugins live in
[derived values](../kernel/backend/src/modules/derived-values/README.md).

## After hooks

`delivery` is removed; every after hook is a job queued by the commit. A hook returns changes, which
the job commits through the same pipeline under the hook's causation and root budget.

## Rollout

Intermediate states may be broken; there are no transitional paths. Each step deletes what it
replaces in the same step, and the type checker finds the callers that still need porting.

1. **Operations return changes** (done). The SDK operation result is `{ output, changes? }` and the
   response `{ result, committed }`. First slice ported: review delete, media progress log, workout
   save.
2. **Delete the old write surface.** Remove every write host capability from the SDK host
   contracts, its kernel implementation, and its durable dispatch and journal handling. Operations
   always run on the plain host; the workflow path and capability-based selection for operations
   are deleted. Whatever no longer compiles is the porting list.
3. **One change-set vocabulary.** Extend the change set, once, with everything the remaining writers
   need: entity deletes, merges and clears, global entity and relationship upserts, signals,
   notifications and fold requests. Shared builders live in the plugin SDK, not in each plugin.
4. **Port every writer.** Remaining operations, after hooks, providers, imports, integrations, and
   workflow steps return changes; the kernel commits them through the one pipeline.
5. **One executor.** Policies, folds, operations and after hooks run on the plain host through one
   executor without automation persistence. `DirectScriptExecutor`, `DirectPolicyAttempts`,
   `DirectScriptDeferred`, fold busy fallbacks and required delivery are deleted.
6. **Incremental folds** (done). Media and Fitness folds move to the change-list contract; replays run
   only on fold changes.
7. **Host-call overhead.** Authority once per run everywhere, including sidecar placement; catalog
   resolution once per run.
8. **Measure** the first slice on the clone in its live configuration.
9. **Full validation.** Repo-wide check, the full test suite, affected e2e files, and cleanup.

Acceptance for the first slice: warm server time at most 250 ms on the clone in its live
configuration; cost independent of history size; no old path left.

## One commit path for every kernel write

Approved **2026-11-19**. Every kernel write commits through `ChangeSets`, not only script writes.
Paths are relative to `kernel/backend/src/`.

### Writers outside `ChangeSets` today

| Writer                                                                                                        | Callers                                                                                                                   | Target                                                                                             |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `makeEventCreate` (`events/event-create.ts`, via `EventsService.create`)                                      | HTTP create, `kernel:event-create`, generic and data imports, integration event writes, collections, provider entry event | `commit` in independent-items mode; file deleted                                                   |
| `EventsService` edit, delete, batch update and delete, move references, prepare and persist helpers, cascades | HTTP update and delete, entity cascades, user-data clear and merge                                                        | event changes with `expected` and a `move` change; `events/service.ts` deleted                     |
| `EntitiesService` create, upsert, update, `commitMutation`, step helpers, deletes                             | HTTP, collections, editor, plugin bootstrap, imports, test support                                                        | owner-qualified entity creates and upserts in `Changes`; batch entity policies                     |
| `automations/lifecycle/write-step.ts`                                                                         | entities, relationships, collections, generic import                                                                      | deleted                                                                                            |
| `EntityEditorService` save and remove                                                                         | HTTP editor                                                                                                               | `commitOnce` keyed by the editor idempotency key                                                   |
| `EntityUserDataService` HTTP clear and merge                                                                  | HTTP                                                                                                                      | `commit` with clears and merges                                                                    |
| `RelationshipsService` over `relationships/mutation-pipeline.ts`                                              | HTTP, collections, imports, test support                                                                                  | relationship update, ensure, merge and delete modes; batch relationship policies; pipeline deleted |
| `CollectionsService`                                                                                          | HTTP                                                                                                                      | one atomic change set (relationship plus membership event); compensation deleted                   |
| Provider population, relationship population and synchronization                                              | population workflow                                                                                                       | internal global upserts with population flags; `populationWriteGuard` becomes a precondition       |
| Provider-import completion trigger                                                                            | entity import workflow                                                                                                    | internal `triggers` part                                                                           |
| Reminder and signal-schedule workers                                                                          | cron                                                                                                                      | kernel `signals` part with a ledger precondition                                                   |

Not writers in this sense: backup historical restore, fold-derived writes (already inside the
commit), and import bookkeeping, plugin, account and settings administration (no policies or
lifecycle). The HTTP `entities.create`, `relationships.create` and user-data routes stay as thin
`commit` callers.

### `ChangeSets` changes

- **Kernel writers.** An internal `Changes` type carries owner-qualified schema references;
  `fromScriptChangeSet` translates the contract `ChangeSet` for scripts. Script authority checks run
  only for script writers; kernel writers (`writeContext: null`) rely on `DomainWriteChecks`. Scripts
  cannot reach the kernel-writer path.
- **Independent items.** `commit(changes, command, { events: { independent, verbatimIdentities } })`
  allows per-item outcomes for event creates; other parts stay all-or-nothing. Outcomes keep today's
  semantics exactly: a preparation failure fails only that item, a policy rejection is
  `skipped_by_policy`, a policy item error is `failed`, a policy execution error writes nothing and
  marks the rest `policy-execution-failed`, and a commit conflict writes nothing and marks the rest
  `mutation-conflict` or `asset-forbidden`. Rejected results are recorded through the receipt.
  `verbatimIdentities` keeps each item's own identity, so event IDs, import item keys and coalescing
  lookups do not change. `CreateEventsResponse` does not change.
- **Policies.** Matching runs inside the prepare transaction. Policy chunks group items by subject
  (at most 50) for every change set, so a once-per-subject policy runs once per subject. When no
  policy matches, the commit continues in the same transaction.
- **Precondition.** `{ check, written }`: `check` runs in the prepare transaction before preparation
  (false commits its side effects and returns an empty result) and again in the commit transaction
  after the receipt load (the deferred re-check); `written` receives the commit result after every
  other write when anything was written. It replaces the event commit guard and serves population
  and the reminder and signal ledgers.
- **Fold lane.** Background-lane commits, and commits passing `queueFolds`, queue their folds;
  interactive commits fold inline.
- **Stale retry.** An update whose field `expected` still matches retries up to twice on `EventStale`.

### Rollout

Each slice is one subagent, in order, deleting what it replaces. Each runs the kernel-backend check
and its named tests, then its e2e files.

1. **Core plus event creates** (done). Kernel writers, independent items, subject chunks, the precondition,
   lane fold mode; port every create caller. Deletes `event-create.ts`, `EventsService.create`,
   `kernel:event-create` and the entry-event transient key. Adds `changes/independent-events.test.ts`
   (ported from `events/event-create.test.ts`) and `imports/integration-event-writes.test.ts`.
2. **Event changes** (done). HTTP update and delete through `commit` with the stale retry.
3. **Moves, cascades and user data** (done). The `move` change; cascade authorization inside
   `EventMutations`; user-data HTTP through `commit`. Deletes `events/service.ts`.
4. **Relationships** (done). Modes and batch policies. Deletes `relationships/mutation-pipeline.ts`.
5. **Entities, editor, bootstrap and test support** (done). Entity creates and upserts, batch entity
   policies. `write-step.ts` went here, its last callers having moved; the plugin bootstrap port lost
   its dispatch plans because bootstrap entities now commit with their own dispatch.
6. **Imports and collections** (done). One change set per import item; atomic collection membership.
   Deletes the collection compensation and `EntitiesService.recordImportReference`. Deviations: the
   kernel `Changes` gained keyed entity creates, a create `match` decided in preparation and rechecked
   in the commit, `references` for entities an item names without writing, and relationship `events`,
   built from what the relationship wrote, because a membership event needs the relationship's
   generated ID and rank; the script `ChangeSet` is unchanged. Entity saves persist at one position,
   with the root entity before relationships and events, whether or not the change set has other
   source writes. Data import entity and relationship records commit one per record, since later
   records reference IDs earlier commits generate; a run of consecutive event records commits as one
   independent-mode change set. Generic import collection memberships commit in the item's change
   set through `CollectionsService`'s builder, whose collection creates, `member-of` writes and
   membership events carry `kernelCollection`; a chunk reads its collections' member fields once,
   and a membership they reject is left out with `membership-event-failed`. A provider-resolved
   entity is checked against its intent's match by the same name-match query, as its `prefer`red
   entity. Coalesced import events still commit through `IntegrationEventWrites` after the item.
   `CommitReceipt.peek` reads a keyed receipt without a transaction, so a receipt per item adds no
   transaction.
7. **Population, completion trigger, reminders and signal schedules** (done). Provider population,
   child sets, related pages and sweeps, root and related stamps and related-population claims
   commit through `commitPopulation`: global upserts in the entity scope (kernel writers name the
   provider, `updateExisting` and `preservePopulatedAt`), relationship groups that page, sweep a
   `kept` set or `preserveExisting`, and a `population` part for claims and related stamps. The
   population owner and related generation are the precondition; a released request still fails
   and a superseded one returns null. Each step is one commit, as it was one transaction. The
   completion trigger is a `triggers` part. `signals` became a part kernel writers commit with an
   explicit principal, schema reference, subject and item identity; scripts translate theirs in
   `fromScriptChangeSet`. The signal-schedule ledger is a precondition whose check takes an
   occurrence delivery lock and whose `written` inserts the row, replacing `SignalScheduleRecorded`;
   the reminder's `written` reads its formatter run from the result's planned signal. Deleted
   `relationship-synchronization.ts`, `populationWriteGuard`, `dispatchPopulationPlans`,
   `EntitiesService.persistPlannedProviderUpsert` and `guardPopulation`;
   `persistPlannedProviderUpserts` remains as the global-upsert adapter over `planCreates` and
   `persistPreparedSaves`, called only from `changes/`. Deviations: `written` moved after every
   write and takes the commit result, since a ledger needs the planned signal; a create whose match
   appeared before commit re-prepares once; a `kernelCollection` create records no import item; a
   reminder whose subscription is disabled now dispatches its planned signal's runs, since the
   signal commits before `written` settles the reminder; `planner.planChange` in
   `entities/mutation-persistence.ts` is already inside the commit path (reached only from
   `persistPreparedSaves`, deletes and ensures).
8. **Docs and audit.** These return nothing outside `changes/` and `events/mutations.ts`:
   `EventsService`, `makeEventCreate`, `runLifecycleWrite`, `runItemPolicy`, `planner.planChange`.

## Code placement

Code shared by plugins lives in the plugin SDK or a package, and kernel code shared by features
lives in the kernel's owning module; nothing is duplicated per plugin or per feature. Each step
reviews its diff for duplication with related features and lifts it before the step is done.

## Exit audit

These must return nothing outside this design record and history: `git grep` for the write
capability names in `SANDBOX_HOST_CAPABILITIES` and the SDK host contracts, `DirectScriptDeferred`,
`DirectPolicyAttempts`, `DirectScriptExecutor`, `delivery: "required"`, `hasRequiredHooks`,
`RYOT_FOLD_BUSY`, `isReadOnlyOperation`, and `inlineDurableCapabilities` entries for write
capabilities. The deletion list below is checked against the final diff.

## Deletion list

End state after step 6. Whole files unless marked partial; counts exclude tests unless noted.

| Area                       | Files                                                                                                                                                                                                                     | Lines |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----: |
| Write host implementations | `events/script-host.ts`, `entities/script-host.ts`, `relationships/script-host.ts`, `user-commands/script-host.ts`, `automations/script-host.ts` (signals, notifications), write parts of `derived-values/script-host.ts` |  ~940 |
| SDK write contracts        | Write entries of `core/host-contracts.ts`; write argument and result schemas in `core/events.ts`, `core/entities.ts`, `core/relationships.ts`, `core/user-commands.ts`, `core/automation.ts` (partial)                    |  ~450 |
| Durable write dispatch     | `scripts/host/lifecycle-host.ts`; write paths of `durable-dispatcher.ts` and `durable-dispatcher-live.ts` (partial; HTTP and workflow children stay)                                                                      |  ~450 |
| Policy persistence         | `automations/lifecycle/policy-batch.ts`, `DirectPolicyAttempts` and policy branches of `automations/execution.ts` and `run-job-live.ts` (partial)                                                                         |  ~600 |
| Required delivery          | `required-hooks*.ts` (test support), required branches of the planner, execution, and run job (partial)                                                                                                                   |  ~350 |
| Inline-then-durable        | Fold busy and deferral paths in `derived-values/service.ts`, `DirectScriptDeferred` callers (partial)                                                                                                                     |  ~150 |
| Fold history paging        | Full-target validation per run and the per-revision rebuild queueing in `derived-values/service.ts` and `plugins/installations/job.ts` (partial)                                                                          |  ~150 |
| User commands module       | `user-commands/service.ts` becomes the pipeline's commit phase; `user-commands/layer.ts`                                                                                                                                  |  ~360 |

Total: roughly 3,450 lines of implementation, plus their tests (about 3,500 lines, mostly
`durable-dispatcher-live.test.ts`, `user-commands/service.test.ts`, and the policy and required-hook
tests). The new pipeline module is expected to add 600–900 lines.
