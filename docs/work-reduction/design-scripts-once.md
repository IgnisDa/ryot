# Design: scripts run once (step 9)

Status: proposed. Step 9 of [`order-of-work.md`](order-of-work.md), taken before step 8's moves 3–5, with step 8's
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
2. **Writes settle in the run.** A script's write runs in its own transaction from the queue worker and appends one
   journal row in that transaction, keyed by the host-call index, and the script continues in the same isolate. On
   a crash, the next run reads the journal and skips completed calls, so replay happens only for recovery. Writes
   that start policies now settle too, because policies no longer need queue slots. `SandboxDurableHostServiceWorkflow`
   remains only for calls that truly wait: durable sleeps, child script workflows and external deliveries.
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
