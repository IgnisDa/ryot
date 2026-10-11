# Backend Performance Follow-up Plan

## Goal and scope

Reduce the remaining backend cost of item writes, event creation, workflow bookkeeping and catalog reads, without changing domain behavior. This document is an implementation plan and reference, not current product documentation.

The fixed per-item costs are already gone. Hot paths no longer read `plugin_revision_manifest`, and the lint rule `ryot/no-hot-manifest-read` enforces this. Writers lock, look up and record receipts set-based per batch. User bootstrap and event creation run in batches. This plan covers the remaining costs, ordered by expected value per unit of risk.

Do not redesign the lifecycle policy path, change receipt identities, change advisory lock keys, modes or order, or raise timeouts as a fix. Keep all artifact, API, compiler, archive and protocol version constants unchanged.

## Current state

The perf harness runs the 146-test e2e subset in `tmp/perf-audit/files.txt` with OpenTelemetry span metrics and `pg_stat_statements`. The YouTube Music import trace is separate.

| Measure                                     | Program start | Current        |
| ------------------------------------------- | ------------- | -------------- |
| Harness database time                       | 384 s         | 119 s          |
| Harness statements                          | 940k          | 622k           |
| `user_sandbox_provider_operation` view time | 11.8 s        | 0.82 s         |
| Event-create workflow activities per run    | 112           | 80             |
| YouTube Music import statements             | 8,785         | 3,344          |
| Import application statements               | —             | 1,324 of 3,344 |

The current import total is made up of:

- 1,324 application statements;
- 1,179 workflow-cluster statements (`cluster_messages`, `cluster_replies`, `workflow_execution`);
- 632 Postgres foreign-key checks;
- 171 transaction and lock statements.

Per statement, the client spends about 1.5 ms against about 0.2 ms of server execution time.

The workflow engine and its garbage-collection layer are the largest statement source. In the harness (`runs/p2h`) they issue 53% of statements and take 57% of database time (67 s of 119 s). Application queries take 22%, and transaction and lock statements take 20%.

Part of that cost is app-owned. `WorkflowGarbageCollectionStorageLive` (`modules/garbage-collection/workflow-storage.ts`) wraps every saved envelope in a transaction that calls `WorkflowGarbageCollectionRepository.admit`. `admit` locks the execution and its root row with `lockExecution` to fence the message against tree expiry. Every reply runs `prepareReply` and `complete` in a second transaction. In the harness, `admit` and `lockExecution` each run about 62–64k times at about 1.2 ms per call, about 150 s of span time combined.

## Measurement rules

- The harness and its scripts live in `tmp/perf-audit` (`setup.sh`, `run.sh`, `import-trace.sh`, `analyze.py`). Its README describes the collector container and the run procedure. Baseline runs: `runs/head2` (program start) and `runs/p2h` (current).
- Claim a timing only from a run that starts at load average below 5, with no other builds, tests or agents running. Statement and span counts are load-independent and can be compared from any run. Workflows whose amount of work depends on elapsed time are the exception.
- Each slice reports before and after numbers from the same machine state, plus `bun run check` and `bun turbo --filter='!@ryot-app/e2e' test`.

## Slices

### PF-1: attribute per-statement client overhead

**Outcome.** A measured breakdown of the roughly 1.3 ms of client-side time per statement, covering:

- Effect fiber and span overhead;
- drizzle query building and SQL rendering;
- `@effect/sql-pg` encoding and decoding;
- connection-pool acquisition;
- the per-call executor creation in `DatabaseSession.run`.

**Context.**

- `platform/db/session.ts`'s `withExecutor` reuses the transaction or connection executor when one is present.
- When `DatabaseConnectionLimit` is set and no executor is active, it acquires a pooled client and builds a fresh executor with `PgDrizzle.makeWithDefaults()` for every call.
- Every call also goes through `mapDatabaseErrors` and creates a traced span.

**Scope.** This slice is profiling only, with no source change.

- A CPU profile of the harness or a focused micro-benchmark: one connection, N trivial selects, through `DatabaseSession.run`, with and without `DatabaseConnectionLimit`, compared against a raw `PgClient` query.
- A count of which call sites run with `DatabaseConnectionLimit` set and no active executor.

**Acceptance.** A short written breakdown that attributes at least 80% of client time per statement to named causes, with the measurement method, so that PF-2 targets a measured cause.

**Stop.** If client overhead turns out to be under 0.5 ms per statement on a quiet machine, the earlier figure was load noise. Close PF-2 and report that.

### PF-2: remove the dominant per-statement client cost

**Outcome.** Client time per statement falls by at least 50% against PF-1's measurement, and harness database plus client wall time falls by a corresponding amount.

**Scope.** Decided by PF-1. Likely candidates, in order of preference:

- Reuse one drizzle executor per pooled client instead of building one per call.
- Drop per-statement spans where a parent span already covers the operation, if span overhead dominates.
- Avoid repeated SQL rendering for hot fixed-shape statements, if rendering dominates.

**Non-goals.** No change to transaction semantics, connection limits, error mapping or retry behavior.

**Acceptance.**

- PF-1's benchmark shows the reduction.
- The harness has 0 failures.
- `platform/db` tests pass, including the connection-invalidation path in `session.ts`.

**Rollback.** Revert the slice commit.

### PF-3: workflow garbage-collection admission cost

**Outcome.** The garbage-collection layer's statements per cluster message fall by at least half, with the same fencing against tree expiry.

**Context.** `admit` runs `lockExecution` (a join that takes `for share` on the root row) for every non-`run` envelope, and up to three lookups for `run` requests. It runs inside its own transaction around `saveEnvelope`. Replies pay `prepareReply` and `complete` in a second transaction.

**Scope.** `modules/garbage-collection/workflow-repository.ts` and `workflow-storage.ts`. Candidates:

- skip the per-message lock for envelopes whose execution was already admitted in the same root transaction;
- merge the admission lock into the envelope insert's statement;
- fence expiry with one statement per root rather than per message.

**Non-goals.** No change to the `effect/cluster` storage contract, delivery guarantees or tree expiry semantics.

**Acceptance.**

- Garbage-collection tests pass, including the expiry races the fence exists for.
- In the harness, `admit` and `lockExecution` calls per `cluster_messages` insert fall by at least half, with 0 failures.

**Stop.** If the fence cannot be preserved with fewer statements, record why and close the slice.

### PF-4: workflow engine statement volume (investigation)

**Outcome.** A decision, backed by numbers, on whether engine bookkeeping per activity can be reduced. In the import trace it is 1,179 statements, close to the application's own 1,324.

**Scope.** Read-only analysis of statements per activity:

- the message insert;
- the reply insert;
- processed-flag updates;
- the polling `UPDATE … last_read`.

Count activities per workflow type, and look for workflows whose activities could be merged without breaking replay. Merging activities removes the whole per-step cost: message, reply, admission and transactions.

**Stop.** Changing the cluster storage contract or the engine's delivery guarantees is a separate, explicitly approved project.

### PF-5: RyotQL entity-schema catalog query

**Outcome.** `user_sandbox_provider_operation` time in the harness is at most 5% of the program-start time.

**Context.**

- The view itself takes 1.2–1.7 ms on the reference dump.
- The remaining cost is the RyotQL entity-schema catalog query, which references the view in a subselect: 156 calls at 6.1 ms each.

**Scope.** The catalog query builder in `kernel/backend/src/modules/ryotql/`. It should read provider operations once per query, or join the view rather than evaluating it per row.

**Acceptance.**

- The query returns identical rows on the reference dump (`tmp/perf-audit/dumps`).
- The harness view metric is at most 5% of program start.

### PF-6: bounded statement inputs

**Outcome.** No repository statement can exceed the driver's 32,767 bind limit.

**Scope.**

- Chunk `EntitiesRepository.lockEntityReferencesByIds` at `STATEMENT_CHUNK_SIZE`, keeping lock order global across chunks.
- Deduplicate and chunk the scopes in `countGlobalEntitiesByProvenanceScopes`.

**Acceptance.** A test per method with more than 32,767 binds' worth of input. Lock order stays globally sorted with `collate "C"`.

## Deferred

- **Policy-path batching for event creation.** Each event item with a matching policy needs its own prepare, policy and write activities, because policies cannot run inside a transaction or activity body. Reducing that requires a lifecycle design change. Revisit only if real event workloads with policies are measured to be slow.
- **`planner.concurrency.test.ts` under load.** The suspected cause is the advisory key `plugin-config:fixture-plugin`, shared across suites; a likely fix is an isolated database layer for that suite. Partial work exists in `tmp/worktrees/perf-p29`.
- **`ryot/no-hot-manifest-read` blind spots.** These are string-assembled SQL, bracket access by camelCase name, and aliases re-exported from exempt files. Today's code has none. Revision immutability is backstopped by a database trigger.
- **Test-only production methods.** `findRevisionClientArtifact` in `plugins/packages/repository.ts` and `listPrivateInstallations` in `plugins/installations/repository.ts` are allowlisted manifest readers with no production callers. Removing them also shrinks the lint allowlist.

## Engine choice

Keep `effect/cluster` and `effect/workflow`. The cost above is the price of durable steps: each activity persists a message, a reply and status updates. Temporal, DBOS and pg-boss pay a similar cost. A Redis job queue such as BullMQ is cheaper only because it gives weaker guarantees. It has no deterministic replay, durable activities or deferred results, which event creation, imports, receipts and crash recovery depend on. It would also add Redis as a required service. Reconsider the engine only if PF-3 and PF-4 cannot bring the workflow share down.

## Order

1. PF-1, then PF-2. Client overhead applies to engine statements as well.
2. PF-3, then PF-4. Start them after PF-2 lands, so their numbers reflect the cheaper client path.
3. PF-5 and PF-6 are independent and can run at any time.

The harness is a heavy e2e subset, so its workflow share is likely higher than production traffic's.
