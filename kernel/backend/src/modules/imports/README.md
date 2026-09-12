# Imports

This module owns import admission, durable execution, progress, failures, cancellation, temporary
artifacts, and domain writes. Plugin sources normalize provider-specific input into generic write
chunks for the kernel. The kernel-native `data-json` source accepts the shared data document without
a plugin installation. Both paths write through the owning services.

The `data-json` source validates records against definitions already available to the user. Its
document-local keys resolve entity and relationship dependencies, including schema-declared nested
property references. Provider entities use normal provider resolution; custom entities remain
user-owned. Writes are append-only, use the normal lifecycle hooks, and commit incrementally, so
failed records do not roll back earlier committed records.

## Root ownership and IDs

Every import run has one durable root selected by its persisted `executionKind`:

- A manual source run is owned by `ProcessImportRunWorkflow`.
- An integration run is owned by `ProcessIntegrationRunWorkflow`, including integration
  finalization and optional continuous-error handling.

Both roots use the import run ID as their workflow execution ID and idempotency key. The sandbox
import workflow uses `${runId}-import`, and other descendants derive their IDs from their parent.
`CancelImportRunWorkflow` uses `${runId}-cancellation`. These durable IDs let any server instance
address the correct root without retaining a process-local workflow handle.

`dispatchImportRun` is the only post-admission dispatch path for manual imports. It pins the import
workflow, stores durable source state, and starts the root workflow. A failure before dispatch owns
its rollback; after the run is admitted, terminal workflow handling owns status and cleanup.

## Cancellation

The cancellation endpoint verifies ownership and rejects completed or failed runs. It then starts
the cancellation workflow and returns without waiting for all cleanup to finish. The cancellation
workflow:

1. Conditionally changes `pending` or `running` to `cancelling`.
2. Reads the persisted execution kind.
3. Interrupts the manual or integration root by its import run ID.
4. Lets that root interrupt its sandbox and generic-import descendants.
5. Lets the root release retained resources before conditionally changing `cancelling` to
   `cancelled`.

A cancellation received before the root starts is handled by the root's initial state transition:
it observes `cancelling`, performs cancellation cleanup, and never starts source work. A repeated
request for a `cancelling` or `cancelled` run is idempotent.

## State machine and races

The persisted state machine is:

```text
pending -> running
pending -> failed
pending -> cancelling -> cancelled
running -> completed
running -> failed
running -> cancelling -> cancelled
```

All competing transitions are conditional database updates:

- Start accepts only `pending`.
- Progress accepts only `running`.
- Completion accepts only `running`.
- Failure accepts only `pending` or `running`.
- Cancellation requests accept only `pending` or `running`.
- Cancellation completion accepts only `cancelling`.

The database therefore selects one winner when completion, failure, and cancellation race. A
workflow that loses a terminal transition preserves the winning state instead of overwriting it.
The transient `cancelling` state also prevents late progress and normal finalization from changing
the run while interruption and cleanup are in progress.

## Partial results

Cancellation is not a transaction-wide rollback. Generic chunks commit incrementally, so entities,
events, collections, relationships, and other items committed before interruption remain. Existing
item failures and the latest persisted counters also remain. Final cancellation preserves those
partial results, records `finishedAt`, clears a run-level failure reason, and changes the run status
to `cancelled`.

## Resource cleanup

Manual import admission can own a pre-registered sandbox workflow pin, durable source state,
claimed uploads, materialized input artifacts, and retained artifact references. Normal completion,
failure, and cancellation release these resources through durable activities:

- Release the sandbox workflow registration and its revision/configuration pin when the root no
  longer needs it.
- Release the orchestration and dispatch references that keep sandbox artifacts alive.
- Remove claimed durable source state.
- Delete claimed temporary uploads.
- Remove generated sandbox artifacts after their consumers release them.

Cancellation interrupts descendants before the root finishes this cleanup. Best-effort cleanup is
idempotent, and artifact expiry remains a leak safeguard rather than the normal lifecycle. This work
can leave a run in `cancelling` briefly after the request succeeds.

Admission failures use the same ownership boundaries. Before workflow start, the dispatch path
removes uploads and source state and releases a pin that it newly registered. Once durable execution
starts, the root owns those resources and records a terminal run instead of deleting its history.

## Restart and configuration pinning

Run status is persisted, workflow execution is durable, and roots and children have deterministic
IDs. Server restart or execution on another replica therefore resumes the same run rather than
creating a replacement. Manual source state retains the exact plugin revision selected at
admission. Before source code runs, the sandbox workflow registration also retains the matching
plugin configuration revision. Replay and restart do not resolve current plugin code or
configuration again. Changes after pinning affect later runs, not the retained run.

Manual imports capture `executionSettings.userSettings` at admission after defaults are applied.
Integration runs also capture `executionSettings.integration` with `providerSpecifics`,
`minimumProgress`, `maximumProgress`, and `syncOwnership` when execution is released. The existing
`admitted-source` capture encrypts this state with the `ryot/ingestion/admitted-input` purpose for the
exact ingestion scope. For a blocked integration delivery, release evaluates readiness and captures
the same settings used for that readiness and plan. The prepared release is encrypted with
`PluginConfigEncryptionKey` and bound to the exact ingestion scope; recovery reuses it rather than
selecting settings again.

These settings are execution inputs, not snapshots of user data or authority. Ordinary data reads and
writes, cancellation, deletion and revocation checks, and OAuth connection validity and refresh remain
live during execution.

## Integration finalization

Cancelling an integration import cancels only that run; it does not disable the integration or stop
future scheduled or webhook runs. Continuous-error auto-disable runs only during normal integration
finalization, when the setting is enabled and the five most recent runs are all `failed`.
`cancelled` is not a failure and breaks that sequence.

`import_run.integration_lot` records whether an integration run came from yank or sink admission.
The partial unique index on active yank runs makes concurrent admission choose one winner without a
pre-read. Sink deliveries remain independent runs.

## Why status transitions, not flags or a registry

A separate cancellation flag would duplicate lifecycle state and still require atomic arbitration
with completion and failure. The `cancelling` status makes that arbitration one conditional update
and prevents normal writes after cancellation wins.

An in-memory registry of workflow handles would be local to one process and would be lost on
restart. It would also require replica affinity or cross-node coordination. Persisted execution kind
plus deterministic durable IDs gives the workflow engine enough information to interrupt the owner
from any replica.

## Failure stages

- `input_transformation`: parsing or normalization failed.
- `provider_resolution`: a source reference could not be mapped to a supported provider ID.
- `provider_details`: provider detail lookup or entity population failed.
- `event_policy`: policy evaluation failed before an imported event was written.
- `database_commit`: an entity, event, collection, relationship, or library write failed.
- `source_fetch`: source payload or external source retrieval failed before normalization.
