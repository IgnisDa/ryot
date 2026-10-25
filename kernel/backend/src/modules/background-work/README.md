# Background work

`BackgroundWorkService` and `BackgroundWorkWorkflow` own durable admission and settlement for
independent pinned user scripts, event-projection steps, and relationship-projection steps. `background_work` is the canonical job
record; feature-owned tables retain application state and checkpoints.

## Admission and dispatch

Admission runs in the caller's transaction. It validates exact, purpose-bound user authority, records
the wrapper's workflow-owner receipt, and retains the existing pinned script
and configuration references. The row records the work identity, purpose, scope, input hash, and
`queued`, `running`, `succeeded`, or `failed` status. The user-scoped `backgroundWork` RyotQL table
exposes status and scope, not the execution payload or pins.

Dispatch starts only after commit and serializes by scope: at most one job runs at a time per
`(userId, pluginId, purpose, scope)`. Dispatching any job dispatches its scope. Under a transaction-scoped
advisory lock on that key, dispatch fails a running job whose workflow wrapper expired or ended, then
claims the oldest `queued` job (`createdAt`, then ID) by setting it `running` only when no job in the
key is running. After the claim commits, dispatch registers the workflow-owner receipt and starts the
deterministic `BackgroundWorkWorkflow` for the key's running job, which also repairs a claim whose
start was lost. Order is best-effort FIFO because `createdAt` is transaction-start time. A hung running
job holds its scope until its workflow expires.

The workflow starts only a `running` row, so a row settled by recovery is never revived, runs the
pinned script through `ScriptExecutionWorkflow`, registering its child ownership before execution, and
after settlement dispatches its own scope from the workflow body so the next queued job starts.
Plugins do not separately dispatch the generic worker. User work and projections use the same
owner, while their admission rules and feature state remain with their respective modules.

Projection preparation runs as a persisted activity before script execution. The event feature
settles superseded claims without executing their scripts; normal settlement recovery and scope
handoff still run. Publication retains its own claim check for changes after preparation.

`requestUserWork` is the script-host adapter for independent user work. Its identity is keyed by
account generation, plugin, script, and caller key. Reusing the identity with changed input or scope is
rejected; a retry or continuation uses a fresh deterministic key.

`requestEventStreamWork` admits one projection step. The event module owns its read-only execution
subject and processor binding, and `event_stream_work` retains stream revision, dirty boundary,
checkpoint, current job, and step state. Publication rechecks the canonical running job, current job
identity, source revision, and processor binding. It commits projection output/checkpoint, canonical job
settlement, and any continuation admission atomically. Dispatch follows the transaction/activity.

## Recovery and settlement

Recovery keyset-pages running rows and scopes whose oldest queued row has no running sibling, at
most 100 heads per page, then dispatches each distinct scope in that page once. Queued rows behind a
running head are never selected individually, so they cannot crowd out heads. A wrapper that is
expired or already failed/succeeded before the job settles is recorded as failed and its scope moves
on, rather than leaving the job pending. Suspension is
not failure. Terminal settlement only transitions queued/running rows, so late or repeated settlement
cannot change a terminal result; settling also releases retained execution references.

The frequent cron deletes succeeded and failed rows 168 hours after settlement in bounded batches.
It keeps the newest row of each scope, which plugins read as the scope's latest status, and any row an
`event_stream_work` or `relationship_projection_work` record still names as its current job. An event
stream's claimed input-repair root is protected by the same retention rule, including after success.

Input-repair roots use the existing user-script purpose and a kernel-owned feature claim. Ordinary
`requestUserWork` admission continues to store `featureInput: null`. The existing feature finalizer
requires the repair root's `null` result, settles it, and releases dependent projection admission from
the workflow body after settlement commits. Root success does not publish projection values.

After settlement commits, the workflow body calls account-scoped relationship recovery for repair
roots, trusted silent user-script descendants (including `featureInput: null`), and event-projection
steps. This callback runs outside activities and does not revive failed repair. Startup and post-restore
recovery close a missed-callback gap by running event reconciliation, common background recovery,
then relationship reconciliation after workflow registration. Ordinary user work does not call it.

Projection-specific freshness and discovery remain event-owned: reconciliation finds missing or stale
bindings and dirty streams, and projection values are visible only while their source revision,
plugin revision/configuration/installation, and processor binding remain current. See [events and
projections](../events/README.md#stream-work-and-freshness).
