# Slice 4 design: run each script once

Status: steps 1 and 2 are implemented; step 3 waits on their measurements. The baseline is the
`probes6` and `bytes2` runs.

## Problem

A script that writes runs at least twice:

1. It runs until its first write. The write is mutable, so the run ends with the request pending.
2. The workflow settles the request as a child workflow or activity and journals the result.
3. The script runs again from the start. It replays the journal and continues.

An event create starts 5 scripts that take 9 sandbox runs between them; a review starts 13 that take 25. Each replay costs:

- a sandbox run: queue round trip, admission, isolate, protocol frames;
- an `observe-sandbox-workflow-replay` activity;
- a `sandbox-request` deferred;
- a journal append in Redis;
- an authority check for every replayed host call.

Inline settlement already covers reads (the `activity` strategy) and short sleeps. Writes stay
deferred because of two constraints.

### Constraint 1: durability of the write

Deferred writes run inside the script's workflow body. They are child workflows or steps of the
`ScriptExecutionWorkflow`, with deterministic names. An inline write runs in the queue worker,
outside any workflow instance. If the write completes and the process dies before the run
journals the result, the replay issues the same request again, and it must find the same durable
write.

### Constraint 2: capacity while parked

A run that waits on an inline write keeps its isolate. The write can start policy scripts, for
example the before-stage hooks of an event create, and those need isolates of their own.

- The sidecar sizes isolate memory for `G` runs (`maximumActive: G`, `isolateMemoryBytes:
G × …`).
- Both backend gates count a parked run: the queue capacity and the admission concurrency.
- With the default `G = 2`, two parked parents leave nothing for their nested policies. They would
  stall until the 30 s settlement bound and only then defer.

## Design

### Durable host-call workflows, the same on both paths

Every write capability runs in one durable workflow per call: `SandboxDurableHostServiceWorkflow`,
with execution ID `${scriptExecutionId}-host-service-${index}`. Its payload is the request, the slim
principal, the lane and the script input, which is everything the host scope reads. Both paths
dispatch it the same way: as a child of the script execution, admitted under the principal's
account. The workflow resolves authority itself.

- **Why a child:** the inline path runs in the queue worker, outside the script's workflow instance.
  It provides `WorkflowInstance.initial(ScriptExecutionWorkflow, executionId)` as the parent; the
  engine identifies a parent only by name and execution ID, and admits the child under the parent
  row's root.
- **What that gives:** both paths agree on the root and the parent, cancelling the script cancels
  the write, and completion wakes the parent.
- **Cost:** the wake can replay the parent's body against cached steps while its sandbox run is
  still pending. That costs about 1 ms.
- **Why not an independent root:** a waiting body would get no wake and would have to poll.

- **Inline:** the queue worker executes it in a child fiber and awaits the result, while the
  sidecar holds the isolate parked. If the workflow suspends, the engine interrupts that fiber
  through the synthetic parent, the settlement returns `null`, and the run defers. The workflow
  keeps running.
- **Deferred or replay:** the script workflow body executes the same ID. The engine returns the
  stored result, or waits for the execution in flight.

Because both paths use the same identity and the same root choice, a crash at any point resolves to
one write. The lifecycle-workflow, service-workflow, event-workflow and notification strategies
fold into this one workflow. Their activities and children move into its body unchanged, under
deterministic names derived from the host-call ID.

### A suspending write defers (step 2)

A write settles inline only when its host-call workflow completes without suspending. When it
suspends, for example because the write waits on a nested policy run, the run defers as it does
today, and the script workflow joins the same execution.

Waiting instead would stall. The fair queue gives the background lane `max(1, G / 2)` slots, so with
`G = 2` a parked background parent holds the only slot its nested policy job could be claimed
through. That job never reaches sandbox admission, so admission pressure cannot see it either.

### Parked runs are evictable (step 3)

Step 3 would let writes with nested runs settle inline too. A run parked on a host-call workflow
releases its queue slot and its admission concurrency, but keeps its memory reservation.

When admission cannot place a new run, it evicts the oldest parked run instead of waiting:

1. The sidecar disposes of the parked isolate.
2. The evicted run ends with its request pending, as a deferred run does today. The host-call
   workflow keeps running.
3. The script workflow body executes the same host-call ID, waits for it, and replays.

Eviction needs no new sidecar frame, because the inline path already defers whenever
`settleInline` returns `null`. The sidecar side is sizing only. A parked isolate blocks its worker
thread in a synchronous `block_on` (`execute.rs`), so `--threads` must cover active plus parked
runs, and the sidecar's memory budget must agree with the backend admission's.

### Bounds

- An inline batch, writes included, is bounded by the sidecar's 30 s settlement limit and the
  five-minute absolute settlement bound. Past either, the run defers.
- Sleeps longer than 1 s, rate-limit waits longer than 1 s, and child script workflows defer as
  today.

## Expected effect

- Writes that need no nested sandbox run settle in the run that issued them. Each saves a replay
  run, an `observe` activity and a `sandbox-request` deferred.
- Writes that start policy runs keep the replay until step 3.
- Executions per flow grow by one per lifecycle, event or notification write, which now runs in its
  own host-call workflow.

## Work

1. Done: every write runs in its host-call workflow, a child of the script execution, on both
   paths.
2. Done: write capabilities are eligible for inline settlement, with a 1 MiB result bound each.
   A larger result fails the inline checkpoint and the run defers. A suspending host-call workflow
   defers the run.
3. Pending measurement: release parked runs' queue slots and admission concurrency, evict parked
   runs under pressure, and size sidecar threads for parked isolates.
