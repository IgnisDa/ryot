# Background work

`BackgroundWorkService` and `BackgroundWorkWorkflow` own durable admission and settlement for
independent pinned user scripts and event-projection steps. `background_work` is the canonical job
record; feature-owned tables retain application state and checkpoints.

## Admission and dispatch

Admission runs in the caller's transaction. It validates exact, purpose-bound user authority, records
the wrapper's workflow-owner receipt, and retains the existing pinned script
and configuration references. The row records the work identity, purpose, scope, input hash, and
`queued`, `running`, `succeeded`, or `failed` status. The user-scoped `backgroundWork` RyotQL table
exposes status and scope, not the execution payload or pins.

Dispatch starts only after commit. The deterministic `BackgroundWorkWorkflow` starts the row and runs
the pinned script through `ScriptExecutionWorkflow`, registering its child ownership before execution;
plugins do not separately dispatch the generic
worker. User work and event projections use the same owner, while their admission rules and feature
state remain with their respective modules.

`requestUserWork` is the script-host adapter for independent user work. Its identity is keyed by
account generation, plugin, script, and caller key. Reusing the identity with changed input or scope is
rejected; a retry or continuation uses a fresh deterministic key.

`requestEventStreamWork` admits one projection step. The event module owns its read-only execution
subject and processor binding, and `event_stream_work` retains stream revision, dirty boundary,
checkpoint, current job, and step state. Publication rechecks the canonical running job, current job
identity, source revision, and processor binding. It commits projection output/checkpoint, canonical job
settlement, and any continuation admission atomically. Dispatch follows the transaction/activity.

## Recovery and settlement

Recovery examines at most 100 pending rows per pass, in update-time and ID order. It re-dispatches
admitted queued/running jobs through their deterministic owner. A wrapper that is expired or already
failed/succeeded before the job settles is recorded as failed rather than left pending. Suspension is
not failure. Terminal settlement only transitions queued/running rows, so late or repeated settlement
cannot change a terminal result; settling also releases retained execution references.

Projection-specific freshness and discovery remain event-owned: reconciliation finds missing or stale
bindings and dirty streams, and projection values are visible only while their source revision,
plugin revision/configuration/installation, and processor binding remain current. See [events and
projections](../events/README.md#stream-work-and-freshness).
