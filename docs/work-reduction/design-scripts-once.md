# Design: scripts run once (step 9)

Status: move 1 built for HTTP event creates (`probesB6`); moves 2 and 3 proposed. Step 9 of [`order-of-work.md`](order-of-work.md), taken before step 8's moves 3–5, with step 8's
direct policy calls folded in. Builds on [`design-run-once.md`](design-run-once.md), whose steps 1 and 2 are in.

## Why now

After step 8's first move, the kernel's own write path is small next to what scripts start (`probesB4`):

| Flow | Statements | Workflows | Script executions | Sandbox runs | Host-call workflows | Automation runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Event, no hooks | 95 | 0 | 0 | 0 | 0 | 0 |
| Event, `backlog` | 582 | 11 | 3 | 3 | 2 | 1 |
| Review operation | 1,223 | 24 | 7 | 11 | 5 | 4 |
| Workout editor save, 10 × 15 | 9,920 | 59 | 13 | 22 | 16 | 11 |

Step 8's remaining moves trim a constant per kernel write. The workflows above multiply those writes, so they come
first.

## How a script runs today

- Every execution is a `ScriptExecutionWorkflow`: pin the script, then loop: submit a sandbox run through the
  durable `SandboxExecutionQueue`, observe the replay, settle pending host calls, append them to the Redis journal,
  and run again until the script completes. Then release the pin.
- Reads settle inline in the run. Each write runs in its own `SandboxDurableHostServiceWorkflow` and settles inline
  only when that workflow completes without suspending; otherwise the run ends and the script replays from the
  start.
- A policy, which is read-only, is an `AutomationRunWorkflow` (claim, prepare, finalize) around a
  `ScriptExecutionWorkflow`, started from `PolicyBatchWorkflow`.

The queue worker's own execution path already reserves an admission lease from `SandboxExecutor` and calls
`sandbox.run` with an inline host; the workflow around it is what makes a run durable.

## Moves, in order

1. **Policies run directly.** A policy writes nothing, so it has nothing to recover: if the process dies, the
   request fails and the client retries the command. The request claims and prepares the attempt, reserves an
   admission lease, runs the sandbox with the inline read host and finalizes the attempt, with no
   `AutomationRunWorkflow`, `ScriptExecutionWorkflow`, queue hop or journal. The attempt rows stay, so logs and
   failures read as today. `PolicyBatchWorkflow` becomes a plain function, and step 8's direct create widens to
   creates that match policies.
   Built: `DirectPolicies` runs them for HTTP event creates. A run that reaches a host call only the replay loop
   settles, which the inline host defers routinely under load, releases its claim and runs that policy through
   `AutomationRunWorkflow`. Policies started from script writes and entity commands still take the workflow until
   move 2 and step 8's command moves.
2. **Writes settle in the run.** A script's write runs in its own transaction from the queue worker and appends one
   journal row in that transaction, keyed by the host-call index, and the script continues in the same isolate. On
   a crash, the next run reads the journal and skips completed calls, so replay happens only for recovery. Writes
   that start policies now settle too, because policies no longer need queue slots. `SandboxDurableHostServiceWorkflow`
   remains only for calls that truly wait: durable sleeps, child script workflows and external deliveries.
   Measured after move 1 (`probesB6`), the 10 × 15 workout save's 59 workflows are 11 automation runs, 4 policy
   batches and 10 relationship preparations started by script writes, 16 host-call workflows, and 13 script
   executions taking 22 sandbox runs. Most of it is policies that script writes start, so the move starts there.
   A parked isolate releases its CPU slot but keeps its admission lease, and global concurrency defaults to 2:
   a write that waited for a nested policy run while its parent is parked could deadlock against another parked
   parent. That is why today a write that needs a policy suspends and the parent run ends. The first slice
   therefore adds a reservation that never waits: a policy inside a script write runs directly only when a lease
   is free at once, as a journaled activity in the write's workflow, and otherwise takes today's path. A direct
   attempt claimed by a process that died is left to the reconciler's stale-claim handling, which the slice must
   cover before it lands.
3. **One job table.** `automation_run`, `background_work` and the projection work rows become one job model with
   attempts, deadlines and a coalescing key, drained by a worker loop. Scripts with external effects keep the durable
   engine.

## Check

No workflow per script write, a review and a workout save with at most one sandbox run per script, and the recovery
tests rewritten for the new shape pass (`order-of-work.md`). Flow probes after each move.

## Risks

- **Admission while a request waits on a policy.** The request holds its connection-free wait on an admission
  lease, as the queue worker does; the interactive lane keeps its share. Policy deadlines stay as today.
- **Crash between a write and its journal row.** Both commit in one transaction, so a recovered run sees either both
  or neither; a write whose transaction rolled back is retried with the same receipt identity.
- **Sidecar sizing** for isolates parked on writes, from `design-run-once.md` step 3, applies to move 2.
