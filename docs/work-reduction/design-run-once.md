# Slice 4 design: run each script once

Status: draft. It is measured against the `probes6` and `bytes2` runs.

## Problem

A script that writes runs at least twice:

1. It runs until its first write. The write is mutable, so the run ends with the request pending.
2. The workflow settles the request as a child workflow or activity and journals the result.
3. The script runs again from the start. It replays the journal and continues.

An event create starts 5 scripts that take 9 sandbox runs between them; a review starts 13 that take
25. Each replay costs:

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

Every write capability becomes one durable workflow per call: `ScriptHostCallWorkflow`, with
execution ID `${scriptExecutionId}-host-${index}`. Its payload is the request plus the slim
principal. Both paths dispatch it the same way: as an independent root, admitted under the
principal's account.

- **Inline:** the queue worker executes it and awaits the result, while the sidecar holds the
  isolate parked.
- **Deferred or replay:** the script workflow body executes the same ID. The engine returns the
  stored result, or waits for the execution in flight.

Because both paths use the same identity and the same root choice, a crash at any point resolves to
one write. The lifecycle-workflow, service-workflow, event-workflow and notification strategies
fold into this one workflow. Their activities and children move into its body unchanged, under
deterministic names derived from the host-call ID.

Cancelling the script no longer cancels a write already in flight. A write is one bounded
operation, and account retirement still interrupts it, because the engine lists executions by
account.

### Parked runs are evictable

A run parked on a host-call workflow releases its queue slot and its admission concurrency, but
keeps its memory reservation.

When admission cannot place a new run, it evicts the oldest parked run instead of waiting:

1. The sidecar disposes of the parked isolate.
2. The evicted run ends with its request pending, as a deferred run does today. The host-call
   workflow keeps running.
3. The script workflow body executes the same host-call ID, waits for it, and replays.

Run-once is therefore the fast path whenever capacity allows. Under pressure the system falls back
to today's suspend and replay, with no 30 s stall and no deadlock: nested runs never wait behind
parents that are parked.

### Bounds

- At most `G` active runs. Parked runs are bounded by the memory budget.
- An inline write still counts toward the five-minute absolute settlement bound. Past it, the run
  defers.
- Sleeps longer than 1 s, rate-limit waits longer than 1 s, and child script workflows defer as
  today.

## Expected effect

- Event create: 9 → 5 sandbox runs, and 4 fewer `observe` activities and `sandbox-request`
  deferreds.
- Review operation: 25 → 13 runs.
- The `SandboxDurableHostServiceWorkflow` layer disappears into `ScriptHostCallWorkflow`, so the
  number of executions per flow stays about the same.

## Work

1. `ScriptHostCallWorkflow`, with both paths dispatching it. This is behavior-neutral on its own.
2. Settle write capabilities inline through it. This needs a sandbox protocol change: write
   capabilities become eligible for inline settlement, with result-size bounds per capability.
3. Admission:
   - parked runs release their concurrency;
   - eviction of parked runs (sidecar `evict` frame, backend admission);
   - `maximumActive` counts active runs only.
4. Tests:
   - crash before journaling the result: replay finds the same write;
   - eviction under `G = 1` with a nested policy;
   - cancellation and retirement of in-flight writes.
