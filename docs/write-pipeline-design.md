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
- `events`: one `changes` list of creates, updates and deletes (updates and deletes with expected
  snapshots), and optional `expected` session event IDs and scope `baselines`.
- `relationships`: user relationship changes referencing the root or existing entities.
- `settings`: a patch of the plugin's user settings.

As built, the same schema also carries entity deletes, clears, merges and updates, bootstrap
ensures, signals, notifications, global entity and relationship upserts, keyed relationships and fold
requests; kernel writers add triggers and population bookkeeping in the internal `Changes`. The
[change sets](../kernel/backend/src/modules/changes/README.md) README is the reference.

### Response

An operation cannot see its own commit. The HTTP response is `{ result, committed }`: `result` is
the operation's `output`, and `committed` carries the root entity ID and each written event's ID by
item identity. Commit conflicts reach the caller as one typed conflict error. The client uses
`committed` to update its cache; that design belongs to the client discussion.

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
5. **Respond.** `{ result, committed }`.
6. **Afterwards.** After hooks, notifications, pushes, and signals run as jobs queued by the commit.

### Admission

Each phase acquires one sandbox lease, runs, and releases it before the next phase starts. Nothing
holds a lease while another script runs, so shared admission (one permit) cannot deadlock, and the
inline-then-durable fallback has nothing left to do. A parked parent, such as a workflow step waiting
on HTTP, keeps only its own lease.

A workflow replay keeps its lease and its lane's transient pool while it settles an inline batch.
The batch holds only host reads, and live runs and inline batches bind only capabilities that start no
run, so no script waits on a lease its caller holds. A step's changes commit in the workflow body after the
replay job has returned, so that commit's policies and folds take admission as their own phases.
Agent runs follow the same shape: each round releases its lease before its capability calls run.

As built: admission keeps a bounded waiting queue of 64 runs that hold nothing while they wait; past it a
reservation fails `resource-unavailable` at once. No caller retries admission, inside a transaction or
outside one.

### Authority

Authority, the catalog, and compiled recipes are resolved once per isolate activation, not on each
host call. A run is bounded by its execution timeout, so a revocation takes effect at the next
activation.

As built: a commit resolves script authority once in `authorizeChangeSet`, and `DomainWriteChecks`
keeps one locked authority cache per transaction (configuration lock, pinned and active revision and
execution authority per principal, installation per plugin and user, account per user); there is no
ambient authority state. Preparation takes no authority locks.

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
because coverage spans episodes. A Media value past half the fold value limit drops its append carry,
so that subject's next change replays. The fold contract and both plugins live in
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
2. **Delete the old write surface** (done). Remove every write host capability from the SDK host
   contracts, its kernel implementation, and its durable dispatch and journal handling. Operations
   always run on the plain host; the workflow path and capability-based selection for operations
   are deleted. Whatever no longer compiles is the porting list.
3. **One change-set vocabulary** (done). Extend the change set, once, with everything the remaining writers
   need: entity deletes, merges and clears, global entity and relationship upserts, signals,
   notifications and fold requests. Shared builders live in the plugin SDK, not in each plugin.
4. **Port every writer** (done). Remaining operations, after hooks, providers, imports, integrations, and
   workflow steps return changes; the kernel commits them through the one pipeline.
5. **One executor** (done). Policies, folds, operations and after hooks run on the plain host through one
   executor without automation persistence. `DirectScriptExecutor`, `DirectPolicyAttempts`,
   `DirectScriptDeferred`, fold busy fallbacks and required delivery are deleted.
6. **Incremental folds** (done). Media and Fitness folds move to the change-list contract; replays run
   only on fold changes.
7. **Host-call overhead** (done). Authority once per run everywhere, including sidecar placement; catalog
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
   independent-mode change set, and when that commit fails as a whole its events without an outcome of
   their own commit again one per record, so a record still fails alone. Generic import collection memberships commit in the item's change
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
8. **Docs and audit** (done). `EventsService`, `makeEventCreate`, `runLifecycleWrite` and
   `runItemPolicy` return nothing in the backend. `planner.planChange` remains outside `changes/` only
   inside the commit path: `entities/mutation-persistence.ts` (saves, deletes and ensures) and
   `relationships/mutation-primitives.ts` (prepared relationship writes and planned reconciliation,
   reached from `ChangeSets` and the clears and merges it runs). `persistPlannedProviderUpserts` is
   called only from `changes/service.ts`.

### Post-slice work

1. **Signal-schedule due evaluation** (done). A run lists only targets without a current evaluation
   or whose next known occurrence fell due; an evaluation keeps its PostgreSQL snapshot, time zone and
   content language, and a target is evaluated again when its snapshot does not see a newer
   `data_change` row for its user (see [signal schedules](../kernel/backend/src/modules/signal-schedules/README.md)).
2. **Per-transaction write checks** (done). `DomainWriteChecks` reads and locks each piece of
   authority once per transaction (see [Authority](#authority)).
3. **Keyed relationships** (done). Relationship endpoints and changes of keyed relationship schemas
   carry a `key` through the contract `ChangeSet`, the kernel `Changes`, the relationship HTTP create,
   imports and user-data merge retargeting; Media copy management, the inventory reconcile activity
   and import copy records return change sets.
4. **Admission and executor wiring** (done). Admission has a bounded waiting queue and no caller
   retries it; a host call cannot start a run because the plain host binds no run-starting
   capability. Boot provides `ScriptCalls` to the runtime graph only. One classifier,
   `scriptChangesFailure`, maps a rejected script change set for every caller, and every boundary
   names a commit conflict `changes-conflict`.
5. **One fold run per fold** (done). `FoldInput` lists up to 25 subjects and `FoldOutput` returns one
   result per subject; `foldEachSubject` in the plugin SDK keeps Media and Fitness per-subject. A fold
   step groups its subjects by user and fold script, locks and reads them set-based, and packs their
   inputs first-fit by decreasing size into the fewest runs within the 1 MiB input bound, so a 7-exercise
   workout makes one fold run instead of seven. On the clone the 34-set workout save went from 382 ms to
   258 ms warm (p50), and a full rebuild of 29,241 subjects from about 17 minutes to 5. Settling runs once for every subject that returned
   changes. Fold jobs carry up to 25 subjects of one fold, so a rebuild batches too; a failed
   multi-subject job queues its subjects one by one.
6. **Incremental background folds and explicit write state** (done). Every write transaction has a
   `WriteTransaction` that its owner creates and hands to the repositories, `EventMutations` and the
   planner; fold marks, event group captures and reference clears are per-transaction state keyed on
   it, and the ambient `Context.Reference`s are gone. `PreparedPins` stays ambient: it is a read memo
   across one commit's preparation, outside any transaction, and a missing memo only rereads. A
   background-lane transaction stores each subject's changed events with their first image before in
   `derived_change`, marks the subject row `pending` and bumps its `revision`; a fold job builds the
   same change list a commit would, runs the fold with no transaction open, and writes in a short
   transaction that rechecks the revision, rerunning a changed subject at most twice before folding it
   under its lock. Interactive commits keep folding inline: on the clone the lock on the subject's
   entity row is held 112 ms for the largest show and 107 ms for the 34-set workout (p50), of which the
   fold script is 91 ms and 44 ms, but folding after commit would let a save succeed without its
   derived state, and keeping the guarantee would repeat the source writes in a second transaction.
   For background jobs the lock hold fell from 616 ms to 20 ms (p50) while importing 981 events into
   50 existing subjects (36.6 s to 34.9 s wall, SQL time 19.2 s to 8.0 s), and seeding 3,817 events
   went from 353 s to 118 s because imports no longer wait on fold jobs' locks. The Fitness workout
   exercise policy now reads its batch's taxonomy in one query instead of two per exercise, which took
   the 34-set workout save from 258 ms to 231 ms (p50).
7. **One catalog reading per write scope** (done). A commit's preparation carries a `WritePreparation`
   and each of its transactions a `WriteTransaction` naming it; `writeState` keeps feature state for
   either, and `PreparedPins`/`sharePreparedPins` are gone. Each commit transaction takes its user's
   catalog lock first, then reads the user's installed plugins once under the ingestion fence; every
   definition read, policy match, planner match, write check, membership derivation and fold output
   check in it shares that reading. Preparation keeps one unlocked reading of its own, which the commit
   cannot reuse because an installation change may land between them. Held configuration keys are
   skipped, so the planner and the write check share one acquisition, and the commit's locked check
   reuses the prepared pin while the transaction's reading shows the writer on the same active revision
   and the principal's configuration revision active; otherwise it reads the pin again. Pinned
   declarations come from the immutable revision cache. Per generic import item (500 items, kernel
   test) user-plugin reads fell from 9 to 2, configuration lock statements from 2 to 1, pin reads from 2
   to 1 and pinned declaration reads from 2 to 0 (68 to 57 statements); an interactive commit of an
   entity, three events and a relationship went from 6, 2, 2 and 5 to 2, 1, 1 and 0 (59 to 48
   statements). On the real-data import (981 events) user-plugin reads fell from 1397 to 770 and
   pinned declaration reads from 15 to 0, and SQL time from 8.7 s to 7.3 s; warm interactive writes
   run 6 to 26 fewer statements at unchanged latency. `RunUserPlugins` stays a per-run reference
   around bound host calls: they reach the catalog through RyotQL, the plugin runtime resolver and
   message catalogs, which HTTP shares.
8. **Signal-schedule evaluation at scale** (done). A global data change records the changed entity's
   or relationship's schema slug, and a schedule's ingested `read_schema_slugs` bounds the global
   rows its recipe queries can read, from schema slug conditions on each entity and relationship
   table and the declared subject schemas; a global change to another schema no longer re-evaluates
   its targets, while user changes and global plugin changes still reach every target they did. The
   one-day refresh is gone: nothing but data, settings and `next_due_at` moves a result, so each run
   instead moves an unchanged evaluation's snapshot forward once it is an hour old, which keeps an
   hour of `data_change` rows without running its query (see
   [signal schedules](../kernel/backend/src/modules/signal-schedules/README.md)). On a synthetic
   instance of 2,000 users with four first-party-shaped schedules each (8,000 targets, 3,200 global
   titles and 2,000 episodes), a show population went from 8,000 targets in 16 runs (138 s) to 2,000
   in 4 (56 s), a movie refresh from 8,000 (129 s) to 2,000 (35 s), and a global change to an unread
   schema from 8,000 to none. Over a simulated 26 hours of five-minute runs with no data changes, the
   daily refresh evaluated all 8,000 targets again in 16 runs of 500 (mean 28 per run over the day);
   now no target is evaluated, and a run takes 100 ms on average (155 ms at most, before 451 ms and
   8.3 s). Trigger cost per statement is unchanged within noise: 6 to 10 µs for single-row global
   entity inserts, 11 µs for single-row updates, 7 to 9 µs for user relationship inserts and none
   measurable for a 2,000-row insert.

9. **System package validation off the event loop** (done). A system package ingestion (a changed
   package at boot, runtime system install, update and uninstall) and boot's kernel definition
   replacement lease one `@ryot-app/compiler-worker` worker before taking the ingestion lock and run
   two jobs on it: the source check (catalogs, compiled script matching and audits, the client
   artifact and the content hash) and the definition set, through the definitions-owned
   `@ryot-app/definitions/definition-set-protocol`. The worker exits when the lease ends. The manifest
   decode, deployment rules and manifest references stay in process and keep their errors and order;
   a failed check or invalid set keeps its `PluginValidationError` and message, and a worker that
   cannot start, exits or times out raises a defect inside the ingestion transaction, which rolls
   back. User installations still validate in process (75 to 100 ms), since the worker would take
   290 to 450 ms, add its memory per install and serialize concurrent installs. Measured on the
   shipped Media and Fitness archives against PostgreSQL:

   | Operation      | Longest stall: in process → definition set in worker → source too | Wall time           |
   | -------------- | ------------------------------------------------------------------- | ------------------- |
   | Media update   | 1.3 s → 0.82 s → 0.16 s                                             | 2.6 → 2.95 → 3.4 s  |
   | Fitness update | 0.84 s → 0.17 s → 0.04 s                                            | 1.2 → 1.58 → 1.73 s |
   | Boot full set  | 1.95 s → 13 ms → 15 ms                                              | 2.0 → 2.5 → 2.6 s   |

   The remaining Media stall is the in-process manifest decode, which the rest of ingestion reads
   and Effect Schema cannot decode without its checks. The worker peaks at 600 to 660 MB during a
   Media update and 370 MB for the full set; the parent's peak is unchanged at 230 to 400 MB. The peak
   is the source check's garbage, not retained sources: from a 55 MB idle worker, reading the 30 MB
   request line adds about 50 MB, parsing it about 80 to 100 MB, decoding the manifest 130 to 215 MB
   and the script audits and hash 35 to 90 MB, about 400 to 500 MB in all. The definition set alone
   peaks at 330 MB, and in the same lease it runs on the heap the check leaves, since Bun returns
   little of it to the system. Forcing a full collection between and inside the jobs did not lower
   the peak reliably (595 MB against 493 MB without it in one run). Getting below about 500 MB needs
   a larger change, such as auditing scripts as they stream in or not decoding the manifest twice.

10. **Reads on a real library** (measured). `library-check` and `warm-writes` in `e2e/src/api/perf`
   run against an external server ([real-data probes](../e2e/README.md#real-data-probes)). On the
   migrated V1 clone (28,962 library members, 180k events, 1,254 workouts; 2 cores, 4 GB), warm,
   10 samples per read, most pages answer in 25 to 230 ms round trip (p50). Over the 250 ms target:

   | Read                         | p50 before → after | SQL per request before → after |
   | ---------------------------- | -----------------: | -----------------------------: |
   | Media activity (365 days)    |   3,060 → 1,509 ms |               2,867 → 1,302 ms |
   | Analytics summary, year      |   6,209 → 2,069 ms |               6,029 → 1,892 ms |
   | Analytics records, all time  |     1,447 → 122 ms |                  1,348 → 32 ms |
   | Analytics summary, all time  |   1,912 → 1,928 ms |               1,736 → 1,753 ms |
   | Analytics trend, all time    |   1,099 → 1,071 ms |                   958 → 940 ms |
   | Music view, three pages      |       973 → 977 ms |                   904 → 917 ms |
   | Fitness totals, all time     |       605 → 589 ms |                   465 → 459 ms |
   | Show detail activity         |       429 → 422 ms |                   262 → 263 ms |
   | Analytics ranking / hours    |  473 / 374 → 583 / 356 ms |      379 / 278 → 495 / 263 ms |
   | Fitness target ranking       |       334 → 326 ms |                   215 → 220 ms |
   | Continue / backlog shows     |  315 / 285 → 302 / 287 ms |          49 / 20 → 48 / 19 ms |
   | Show detail summary          |       315 → 312 ms |                     29 → 29 ms |

   Schema catalogs reach SQL as `user_*` relations built from `jsonb_array_elements`, which
   PostgreSQL estimates at one row once any filter applies. Media's analytics joined them inner for
   type and event labels, so the planner made the catalog the outer side of a nested loop and
   scanned the user's events once per catalog row (24 to 105 times; 790k–886k entity lookups for
   33k events). Those label joins are left joins now: the event policy already limits rows to Media's
   effective schemas, so they never filtered. The other slow statements aggregate every consumption
   event or workout set with per-row JSON extraction (5 to 10 µs a row), and the remaining catalog
   misestimates show up as per-row scans of `projectionDeclarations` and the projection-status
   lateral (about 80 ms each on 41k sets). Both grow with history; fixing them needs stored rollups
   or catalog relations the planner can estimate, which this item does not attempt. Lists pay about
   70 ms per page walking all library memberships to filter by schema, and the music view rebuilds
   its sorted 27k-member set for each page.

   Earlier findings: the plugin catalog is 663 KB on every refresh, 98% Media `clientEntities`
   (show and podcast owner presentations are 160 KB and 146 KB of RyotQL); it does not grow with
   data. Movies and shows carry on average 220 images (up to 1,020, about 26 KB), and list rows select
   the whole array, so home rails return 197 to 453 KB for 20 rows and a show detail summary 48 KB.
   RyotQL statements are 1 to 191 KB with up to 1,473 parameters; planning is 1 to 6 ms of that. No
   measured page read is bound by the GIN-only property indexes; the property lookups found earlier
   are on the write path and were not measured again here. Server time outside SQL is 70 to 280 ms
   for the larger recipes, split about evenly between request preparation, execution scope,
   response encoding and row decoding. Warm writes did not move (p50, through the host forwarder,
   which adds 10 to 20 ms): review delete 121 to 138 ms, movie and music logs 152 to 161 ms, show
   episode logs 200 to 235 ms (the 69 KB fold state 235 ms against 212 and 223 ms before), one-exercise
   saves 197 ms and a 35-set, 9-exercise repeat 286 ms.

11. **Real data at the merged head** (measured). `5cb1615d59` against `70935b1882`, before #1878's
   performance fixes, on the measurement host: 2 shared cores (other tenants used 20–40% of a core),
   app 2 GB, database 768 MiB, no egress. Three V1 dumps were restored unpatched. `file2` has 319
   users, 175 with events; its largest library has 14.7k members and 302k events. It is a newer copy
   of the 299-user dump measured before. `file3` has one user with 16.2k members, 198k events and
   602 workouts. `file.sql` (one user, 29k members) was last measured at `4c64f50ae7`, before the
   ultra-rewrite merge, and migrated at `13463d2959`; its numbers are in
   [the follow-up plan](performance-follow-up.md).

   | Dataset  | Legacy migration | Artwork cutover | Drain after listening |
   | -------- | ---------------: | --------------: | --------------------: |
   | file2    |  47.9 → 46.4 min |      2 h 21 min |   2 h 01 → 2 h 33 min |
   | file3    |   8.6 → 12.9 min |          18 min |           66 → 72 min |
   | file.sql |   11.4 → 4.1 min |         not run |                     – |

   `file3`'s earlier migration ran on a copy patched after five aborts. The collection phase fell
   from 201 to 79 s on `file2` and from 430 to 17 s on `file.sql`. The artwork cutover from the
   ultra-rewrite merge runs in one transaction between the legacy migration and listening. It read
   380,130 rows in 763 pages (9.5 s mean) on `file2` and 153,075 rows in 308 pages (2.8 s) on
   `file3`. Each page index-scans every Media entity, with the id cursor only as a filter, and runs
   the translation lateral for each remaining row, so the total is quadratic. ultra-rewrite
   `7b09e6fc93` pages by primary key instead (0.15 ms per id page and 18 ms per page of artwork rows
   on `file2`), and #1878 includes it.

   Folds drain on the single background sandbox slot: attempt time is 9,067 s of `file2`'s 9,193 s
   drain. That drain includes a one-minute app restart, and it cost 3.9 CPU-seconds per fold job,
   against 2.9 before. Each fold job made 52 host RyotQL calls at 44 ms, against 55 at 31.5 ms. The
   regression found at `13463d2959` is gone: `file3` drained in 72 min instead of 6 h 52 min, at 2.2
   CPU-seconds per fold job instead of 8.1.

   One abort on `file2`'s newer dump: one of its 153 OIDC users has a name that is not an email. The
   copy got a placeholder email, as the abort message asks. Without a Media provider token,
   handed-off history waits: 12 users and 470 watches on `file2`, and one user with 1,306 watches
   and one review on `file3`. With a placeholder token, `file.sql` admitted one import run and
   recorded the provider failure as an import issue. The handoff table was dropped, and a second
   restart changed nothing.

   Reads, p50 round trip over 10 warm samples, before → after:

   | Read                         |             file2 before → after |              file3 before → after |
   | ---------------------------- | -------------------------------: | --------------------------------: |
   | All shows / search           |    10,962 / 4,278 → 717 / 382 ms |          943 / 559 → 453 / 380 ms |
   | Continue / backlog shows     |     7,014 / 1,941 → 660 / 693 ms |      2,290 / 1,813 → 516 / 543 ms |
   | Show detail summary          |                   2,181 → 705 ms |                    1,540 → 624 ms |
   | Continue / backlog podcasts  |         658 / 573 → 265 / 281 ms |        1,027 / 586 → 337 / 277 ms |
   | Upcoming                     |             1,078 ms → over 30 s |                    915 → 8,689 ms |
   | Show episode calendar        |               166 ms → over 30 s |                    274 → 4,158 ms |
   | Analytics summary, all time  |                9,605 → 19,788 ms | 21,201 → 25,760 ms, some time out |
   | Analytics records, all time  |               11,288 → 17,147 ms |                      573 → 560 ms |
   | Analytics trend, all time    |                 7,339 → 9,205 ms |                11,564 → 11,754 ms |
   | Analytics ranking / hours    | 3,552 / 5,785 → 8,364 / 7,685 ms |  7,534 / 2,252 → 8,928 / 2,420 ms |
   | Fitness totals, all time     |                     765 → 778 ms |                    775 → 1,848 ms |

   Show lists and details no longer grow with the library. List rows carry one preferred image
   (ultra-rewrite `45a33088a1`). Backlog rows fell from 71.0 to 4.7 KB on `file2` and from 137.6 to
   12.7 KB on `file3`. Backlog shows fell from 43.8 to 8.8 KB and from 66.4 to 19.9 KB, and
   `file3`'s upcoming fell from 60.0 to 3.3 KB.

   Upcoming and the show episode calendar regressed with the merged release-time airing. On `file3`,
   the calendar looks up every episode of every library show to find the episodes airing in the
   window: 187,190 entity lookups across 3,296 shows return 30 rows. Upcoming's statements make 65k
   and 100k such lookups. Both reads are linear in the episodes of the user's library shows. On
   `file2`'s largest library they exceed the 30 s RyotQL statement timeout, so the home page fails
   its upcoming rail (page load 16.9 → 32.9 s; `file3` 10.4 → 17.2 s). At `4c64f50ae7` they took 463
   and 103 ms on `file.sql`. Signal-schedule evaluation runs the same airing statements, so idle
   cost grew too:
   - `file2` database time per 5-minute cron: 0.7 s → 35 s right after the drain, and 5.7 s two
     hours later;
   - `file3`: 0.08 → 3.0 s.

   On `file2`, some evaluations hit the statement timeout. `frequent-cron` logs them, and a schedule
   worker run takes 30–40 s at p50 (18–20 s on `file3`). Idle app CPU stays at 3–4%.

   Analytics trend went from 2.7 to 4.4 s on `file.sql` across #1878 with the same statement. That
   was host I/O and cache state, not a plan change:
   - The captured `file2` plans before and after have the same nodes and the same 24.4k entity
     lookups, and read about as many blocks (122k → 113k).
   - Only one hash join swapped its build side.
   - The extra time is in reading the same uncached blocks: the event heap scan read 17k blocks in
     1.0 s before and 4.1 s after.

   Analytics summary and hours on `file2` show the same pattern. In the plan capture, ranking and
   records ran at their earlier speed, so their slower probe p50s are the same host variance.
   Analytics stays linear in history, as item 10 says. Some of `file3`'s all-time summaries now
   exceed the 30 s timeout.

   Warm writes, p50 over 20 samples, before → after. The median user is rank 24 of 49 users with
   events before and rank 20 of 40 after, because the dumps differ.

   | Write                          |     file2, largest library | file2, median user |                      file3 |
   | ------------------------------ | -------------------------: | -----------------: | -------------------------: |
   | Review delete, movie / show    | 549 / 774 → 600 / 1,020 ms |   – → 504 / 917 ms | 601 / 833 → 532 / 1,010 ms |
   | Movie log                      |               793 → 745 ms |       772 → 735 ms |               807 → 743 ms |
   | Show log, short history        |           1,165 → 1,362 ms |   1,106 → 1,368 ms |           1,165 → 1,385 ms |
   | Show log, long history         |           1,441 → 2,291 ms |   1,213 → 1,417 ms |           1,236 → 1,673 ms |
   | Show log, oversized fold state |           2,427 → 5,186 ms |                  – |           1,860 → 1,958 ms |
   | Workout save, one exercise     |                          – |                  – |           1,034 → 1,007 ms |

   A write still makes about 2.6 sandbox runs. Show logs' SQL grows with the library and the show's
   history: on `file2`'s largest library it went from 232 to 803 ms at 2.8k events, and from 822 to
   3,508 ms for the 1.9k-event oversized state. `file.sql` added 60–90 ms at 300–400 events. With
   `file2`'s four largest users writing at once:
   - p50 was 1.9–11.3 s and p95 reached 28.7 s, against 0.7–9.1 s and 15.1 s before;
   - `reserveRun` waited p50 0.79 s, p95 3.3 s and at most 21 s, against 0.66 s, 2.4 s and 11.9 s;
   - nothing was refused.

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
