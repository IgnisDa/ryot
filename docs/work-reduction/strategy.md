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
- **A lean PostgreSQL engine replaces Effect Cluster, under the same Workflow API.**
  - The genuinely durable flows (imports, script executions with sleeps and children, background
    work, hooks) keep their `Workflow`/`Activity`/`DurableDeferred`/`DurableClock` code.
  - Storage is the existing `workflow_execution` row plus one row per completed step (activity
    result, deferred result) and one row per armed timer. A resume loads an execution's steps in one
    query; each completed step is one insert.
  - Execution is in-process. Wake-ups come from step completion, without polling; timers are armed
    in memory and persisted for recovery; a boot (and lease) sweep resumes unfinished executions.
  - Admission and expiry fencing move from the `ryot_cluster_message_fence` trigger into the
    engine's step insert.
  - Effect's in-memory engine (`effect/workflow/WorkflowEngine.layerMemory`, ≈270 lines) defines
    the semantics to match. The durable version adds persistence and recovery to it.
  - No shards, runners, heartbeats, message polling, replies, root-row reply locks or fence
    triggers.
  - Retry and timer semantics stay as today: after-hooks retry per numbered attempt, required-hook
    waits use journaled deadlines, notifications stay at-most-once.
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
| 2 | Lean PostgreSQL workflow engine replacing Effect Cluster; delete `cluster_*` tables, the fence trigger and the reply root lock | Removes 34–41% of statements and the per-step message/reply/fence overhead in every flow; removes idle background traffic (≈11 transactions/s) | L |
| 3 | Remove workflow layers from hot paths: event create (incl. a zero-policy policy batch), entity commands, user commands, entity preparation, per-call host-service workflows | Event create from ≈2,400 statements toward a few hundred; signup and bootstrap shrink with it | L |
| 4 | Run-once sandbox executions: host calls answered inline with a journal append; nested runs borrow the blocked parent's concurrency; replay only on recovery | Removes ≈3.4× script replays per hook; caller latency toward sandbox time plus a few transactions | L |
| 5 | Duplicate checks: account admission, catalog locks, batch bookkeeping, owner registration once per transaction | Lower constant factor everywhere | M |
| 6 | Pool and lane sizing re-derived; operational gates re-measured | Gates within budget | S |

Order rationale:
- 1 is cheap and tests whether coupling, not raw cost, causes the suite-only failures.
- 2 lowers the cost of every durable step at once and keeps all 33 workflows and their tests
  unchanged, so behavior risk sits in one new component. It is also what 3 and 4 build on.
- 3 removes durability where no guarantee needs it. Each removed layer is a direct call inside its
  parent's activity, so its idempotency comes from the parent.
- 4 changes the sandbox protocol and nested admission. It goes last because it is the subtlest, and
  because after 2 and 3 a replay costs little more than sandbox time, so its gain is easiest to
  measure in isolation.
- Signup bootstrap gets no slice of its own. The bootstrap scripts are a plugin feature, and with
  2–4 a bootstrap costs one execution plus two short sandbox runs.

## Measurement

- **Flow probes** (`e2e/src/api/perf/flow-probes.test.ts`): per-flow statements, transactions,
  server CPU, workflows, hooks and table writes, on an idle server. Add probes as slices touch
  flows: import of N items, provider population, 100-set workout.
- **Full suite** (`vm-e2e.sh`): wall time, failures, slowest files, statement families, lock waits.
- **CPU profile** (`PROFILE=1`, `cpuprofile.py`): to confirm the operation count, not a hotspot,
  stays the driver.

## Open decisions for the owner

- Slices 2–4 change internal protocols, schema and the plugin-facing replay contract (owner: the
  sandbox protocol change is accepted).
  - The guest-visible behavior stays the same: the same host functions and the same results on
    recovery.
  - The sandbox protocol changes: host calls are answered inline instead of by
    suspend-and-replay.
- The e2e server keeps `SERVER_LOG_LEVEL: "all"` (the owner debugs from it). Without an OTLP
  endpoint it adds only a few hundred lines per few minutes, so there is no logging slice.
- The harness could reuse pre-created users where a test is not about signup. That cuts suite time
  further, but it changes test isolation, so it should wait until the product-side fixes land.
