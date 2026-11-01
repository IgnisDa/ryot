# Strategy

The evidence is in [`probes.md`](probes.md), [`log.md`](log.md) and the two code readings. The
guarantees any redesign must keep are in [`durability-requirements.md`](durability-requirements.md).

## Diagnosis

1. **Orchestration, not sandboxing, does the work.**
   - Sandbox runs average ≈57 ms. One single-item `backlog` event create starts 36 durable
     workflows, writes ≈500 `cluster_messages`, runs ≈2,400 statements and burns ≈1.7 s of backend
     CPU, all to write three event rows.
   - The domain rows are under 1% of what is written.
2. **Durability is applied at the finest grain everywhere.**
   - Every command is a parent workflow plus child workflows, and every step is a persisted
     message plus reply.
   - Every sandbox write host call is its own workflow and is followed by a full replay of the
     script. That is ≈3.4 runs per automation script, each through the durable queue, the Redis
     journal and cluster storage.
   - [`durability-requirements.md`](durability-requirements.md) shows the product needs only four
     primitives: a sandbox host-call journal, durable timers, job rows with attempts and deadlines,
     and receipts.
3. **Cost is proportional to operation count; there is no hotspot.**
   - The backend JS thread is busy about as long as the caller waits.
   - That time is spread across the Effect run loop, socket writes, row decoding, spans and logs.
   - Kernel code itself is 6% of CPU. Optimizing functions will not help; removing operations will.
4. **Load coupling turns slowness into failures.**
   - The global `ryot-plugin-ingestion` advisory lock is taken shared by 16 paths and exclusively by
     every plugin install, uninstall and settings change.
   - Under the suite's load it was the largest single sink of database time: 295 s in 30 minutes.
   - Per-tree root-row `FOR UPDATE` on every reply serializes each workflow tree.
   - A 9-connection kernel pool and a background lane of 2 add queueing.
   - All failures seen in the full suite were 180 s timeouts in cascade-heavy tests.
5. **Fixed overhead per test.**
   - About 926 of 944 tests sign up a fresh user. Each signup costs ≈1 s of backend CPU (two
     one-entity bootstrap scripts through 5 workflows), ≈15 minutes of CPU per suite run.

## Target design

The command path is a function call and a transaction; durability exists only where a guarantee
needs it.

- **Commands run in the request fiber.**
  - Load, run before policies (sandbox, outside any transaction), then commit in one transaction:
    domain writes, receipts and an outbox of follow-up jobs.
  - No `EventCreateWorkflow`, `PolicyBatchWorkflow`, `UserCommandWorkflow` or
    `UserEntityPreparationWorkflow`.
  - Idempotency keys and receipts give the same retry semantics the workflows give today.
- **Sandbox executions run once.**
  - A host call executes when the script makes it: a write runs in its own short transaction and
    appends one row to the execution's journal, and the script continues in the same isolate.
  - The journal is read back only to recover after a crash. That keeps the replay guarantees the
    recovery tests pin, without paying replay on the normal path.
  - No `SandboxDurableHostServiceWorkflow` per call, no durable queue hop, no Redis journal
    projection.
- **One job table replaces the workflow engine.**
  - Row shape: `job(id, kind, dedupe_key, payload, state, attempt, run_after, deadline_at,
    lease_until, result)`.
  - Claim with `FOR UPDATE SKIP LOCKED`. In-process wake-up on insert, `LISTEN/NOTIFY` for other
    replicas, and a lease sweep for recovery.
  - Timers are `run_after`; required-hook waits use `deadline_at`; notifications claim without
    automatic retry, preserving at-most-once.
  - After-hooks, background work, projections, provider population, integrations, imports
    (checkpointed per chunk), backups and garbage collection become job kinds.
  - No shards, runners, heartbeats, message polling, replies or fence triggers.
- **Cascades run in a loop, not a tree.**
  - A hook's writes enqueue their follow-up jobs in the same transaction.
  - Required hooks of one command are drained by the same worker before the caller is answered,
    as the current required-hook semantics demand.
  - Batching per command and per import chunk falls out of the outbox.
- **Locks are scoped to what they protect.**
  - Plugin ingestion fences per package and per owner instead of globally.
  - Account admission, catalog locks and owner registration happen once per transaction, not once
    per receipt or per workflow layer.

## Slices

Each slice is measured before and after with the flow probes and, at milestones, the full suite.
Product behavior and the e2e suite stay green at every step.

| # | Slice | Expected effect | Size |
| --- | --- | --- | --- |
| 1 | Scope the plugin-ingestion lock (per package / owner) | Removes the largest cross-test stall; fewer suite-only timeouts | S |
| 2 | Run-once sandbox executions: inline host calls with journal append; replay only on recovery | Removes ≈3.4× script replays and one workflow per write call; largest per-flow win in hook cascades | L |
| 3 | Job table and runner; move after-hooks (`AutomationRunWorkflow`), `BackgroundWorkWorkflow`, notifications onto it | Removes most remaining cluster traffic for cascades | L |
| 4 | Commands without workflows: event create (incl. policy batch), entity commands, operations | Event create from ≈2,400 statements toward ≈150–300; caller latency toward sandbox time plus a few transactions | L |
| 5 | Signup and bootstrap: declarative per-plugin bootstrap entities, created in the signup transaction | Signup from ≈1 s CPU / 915 statements to tens of milliseconds | M |
| 6 | Remaining workflows (imports, integrations, provider population, backups, translation, GC, cron) onto jobs; delete Effect Cluster, the fence trigger and `cluster_*` tables | Removes idle background traffic (≈11 transactions/s) and the engine | L |
| 7 | Duplicate checks: account admission, catalog locks, batch bookkeeping, owner registration once per transaction | Lower constant factor everywhere | M |
| 8 | Pool and lane sizing re-derived after 2–6; operational gates re-measured | Gates within budget | S |

Order rationale:
- 1 is cheap and tests whether coupling, not raw cost, causes the suite-only failures.
- 2 comes before 3 and 4 because every cascade hop pays the replay multiplier, and because the
  run-once host makes the later job and command code simpler.
- 5 can run in parallel with 3 and 4.
- The suite should be dramatically faster after 2–5; 6 is cleanup that removes the old engine.

## Measurement

- **Flow probes** (`e2e/src/api/perf/flow-probes.test.ts`): per-flow statements, transactions,
  server CPU, workflows, hooks and table writes, on an idle server. Add probes as slices touch
  flows: import of N items, provider population, 100-set workout.
- **Full suite** (`vm-e2e.sh`): wall time, failures, slowest files, statement families, lock waits.
- **CPU profile** (`PROFILE=1`, `cpuprofile.py`): to confirm the operation count, not a hotspot,
  stays the driver.

## Open decisions for the owner

- Slices 2–6 change internal protocols, schema and the plugin-facing replay contract.
  - The guest-visible behavior stays the same: the same host functions and the same results on
    recovery.
  - The sandbox protocol changes: host calls are answered inline instead of by
    suspend-and-replay.
- The e2e server keeps `SERVER_LOG_LEVEL: "all"` (the owner debugs from it). Without an OTLP
  endpoint it adds only a few hundred lines per few minutes, so there is no logging slice.
- The harness could reuse pre-created users where a test is not about signup. That cuts suite time
  further, but it changes test isolation, so it should wait until the product-side fixes land.
