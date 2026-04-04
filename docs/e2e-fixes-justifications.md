# E2E Fixes and Justifications

Status: the standard Turbo e2e gate, backend checks, and opt-in Phase 3 operational gate pass.

## Baseline

The repair began from the Phase 3 Task 10/11 baseline and reproduced every documented failure
before changing code:

- Watcharr in `tests/src/tests/plugins/media/imports/imports.test.ts` stayed `running` until the 60-second poll
  expired.
- The Kodi episode-progress integration reached terminal `failed` with
  `Workflow activity reference could not be resolved`.
- The below-minimum progress case subsequently exposed
  `SandboxWorkflowNondeterminism: replay ended before recorded journal[3] activity:chunks-0`.
- The full-size operational gate had previously timed out after 901,013 ms with all eight workflows
  pending, low database pressure, no lock waits, and sandbox overlap peaking at five.

These results ruled out Vitest timeout sizing and PostgreSQL connection exhaustion as the primary
cause. The deterministic failures reproduced with one test file, one worker, one backend, and low
resource use.

## Fixes

### Integration adapters are durable script requests

The ten media integration adapters were authored with `defineScript` and `kind: "script"`, while
the media import workflow invokes the selected adapter through `replay.activity`. The kernel's
workflow resolver resolves that durable request only to a script in the owning plugin and dispatches
the exact script pin through `SandboxScriptWorkflow`.

All sink and yank adapters under `plugins/media/scripts/integrations/` use `defineScript` and
`kind: "script"`. Their input/output schemas, capabilities, provider declarations, and adapter logic
are unchanged; durability belongs to the universal runtime rather than a separate definition kind.

### Normal workflow suspension is not failure

`WorkflowEngine.execute` suspends an awaiting parent by calling `Workflow.suspend`, which marks the
workflow instance suspended and interrupts its fiber. `Workflow.intoResult` normally translates
that interrupt-only cause into `Workflow.Suspended` so the engine can replay the body later.

`imports/plugin-import-workflow.ts` and `integrations/integration-workflow-live.ts` wrapped awaited
plugin workflows in `Effect.catchAllCause`. Those handlers intercepted the interrupt before
`Workflow.intoResult`, mistook a normal durable boundary for an unexpected error, and either failed
the import run or started cleanup during replay. They now re-raise
`Cause.isInterruptedOnly(cause)` and retain existing status/cleanup behavior for genuine failures
and defects. Focused unit tests verify that child suspension does not mark a run failed.

### Discarded workflows do not retain a parent

The pinned `@effect/workflow@0.18.2` implementation includes the current `WorkflowInstance` in a
child payload even when `discard: true`. A discarded child is fire-and-forget: its caller does not
wait or suspend for it. Retaining the parent nevertheless lets the child send a later parent resume.
In the event path, a lifecycle subscription could reset a terminal event-workflow reply while an
importer was reading it.

`apps/app-backend/src/lib/infrastructure/workflow.ts` wraps the cluster engine so discarded
executions run with `WorkflowInstance` omitted. Awaited child executions preserve normal parent
linkage. A focused unit test verifies both branches. This fixes the semantic mismatch centrally
instead of making each fire-and-forget caller remember an engine-specific workaround.

### Replay-critical children use terminal polling

The repository already tracks open upstream issue
[`Effect-TS/effect#6294`](https://github.com/Effect-TS/effect/issues/6294): later child completions can
miss the in-process parent wake and wait for storage polling. The existing 250 ms
`entityMessagePollInterval` mitigation was insufficient for the nested import chain. Debug traces
showed `EventCreateWorkflow` reach terminal success while `ProcessGenericImportChunksWorkflow`
remained suspended indefinitely. The same missed resume made the sandbox workflow shell rebuild
only a prefix of its journal, producing a false nondeterminism failure.

At the time of this fix, six feature-to-feature composition boundaries omitted `WorkflowInstance`
while awaiting their deterministically keyed child. This list is historical; the native library
workflow in the final entry was later removed:

- The generic import writer awaiting `EventCreateWorkflow`.
- `performSandboxWorkflowChild` awaiting plugin or kernel workflow references.
- `SubscriptionExecutionWorkflow` dispatching its automation script through `SandboxExecutionQueue`.
- `ProcessImportRunWorkflow` awaiting its sandbox import workflow.
- `ProcessIntegrationRunWorkflow` awaiting its sandbox import workflow.
- Superseded `LibraryEntityImportWorkflow` awaiting provider population.

Without a parent instance, the engine uses its top-level terminal-result polling path rather than
the unreliable parent-resume RPC. Durable ownership and idempotency remain unchanged. A process
restart replays the parent, derives the same child execution id, and reads the persisted child result
instead of re-running its side effects. Activities, durable queues, script pinning, and journal
validation are unchanged.

Three supporting durable boundaries described below applied the same workaround around sandbox
replay, active-script queue ownership, and the now-removed native library-membership queue shell.
These historical boundary classes reproduced SQL-backed `ClusterWorkflowEngine` failures. Retained
active workarounds should be removed only after an upstream upgrade proves nested completion through
that production path; in-memory workflow tests cannot establish that behavior.

The automation boundary was exposed later by the fail-fast sweep: both manga progress events were
written successfully, but their subscription workflow never resumed to create the completion event
under full-suite load. The API remained healthy through 236 event-list polls, and the same case
passed alone in 1.5 seconds. Detached terminal polling preserves the subscription run's deterministic
sandbox execution id while avoiding the missed parent wake.

The integration boundary was exposed after that repair: the progress-normalization case completed in
4 seconds alone, but its import run remained `running` for the full 60-second poll budget under
full-suite load. Detaching only the parent registration retains the sandbox child's synchronous
result and error propagation while avoiding the same missed wake. Execution ids, run finalization,
and failure handling are unchanged.

The equivalent plugin-import boundary remained structured until a later full sweep reached 78 of 80
files, then left a Hevy import `running` for its full 60-second poll budget. The same case completed
in 1.8 seconds alone. `ProcessImportRunWorkflow` now awaits its deterministically keyed sandbox import
without parent registration, preserving direct result/error propagation, artifact grants, cleanup,
and run finalization while using the terminal-result polling path.

The library-import boundary then reproduced the same symptom: prior imports in the file completed,
but a later provider-population job remained `running` for its full 30-second poll budget under
full-suite load. Its parent awaits provider population before processing library membership, so it
now reads the deterministically keyed population result through terminal polling while preserving
the existing population and membership ordering.

The next run exposed the same defect inside `SandboxScriptWorkflow` itself. A plugin workflow
alternates deterministic replays with sandbox activities and child workflows, so one execution can
await the sandbox queue several times. The fourth sequential failed integration run remained
`running` for 60 seconds before its adapter failure was recorded. Replay and activity sandbox calls
now dispatch through `SandboxExecutionQueue` with their already-deterministic execution ids and
await terminal results. Exact pinned script ids, authority, filesystem grants, queue ownership,
journal validation, and result/error propagation are preserved.

The same direct queue boundary also existed in active-script sandbox calls used by provider details,
translation, event policy, and integration operations. A loaded media-monitoring baseline cron
entered provider population and then held its HTTP request for the remaining 179 seconds of the test.
Those callers now compose `SandboxScriptWorkflow`; its deterministic execution id, authority, and
exact script pin preserve the existing ownership while the queue remains only the local replay
executor.

The full-size operational gate exposed one final failure inside that owner. Under sustained load,
`SandboxExecutionQueue` processing could remain suspended after the sandbox work had stopped making
progress. Repeated runs ended with different subsets of the eight root workflows pending even
though PostgreSQL had no pool pressure or deadlocks, Redis journal projections remained valid, and
the sandbox process count stopped below the expected minimum. The varying cutoff ruled out a
deterministic bad item; the stable boundary was the producer-side durable queue wait.

`processSandboxExecutionQueue` now gives that idempotent queue wait one minute to resolve and retries
it with the same `executionId`, payload, and `SandboxExecutionQueue` idempotency key. A retry therefore
re-offers or re-reads the same durable operation rather than creating another logical sandbox
execution. The durable queue worker, process isolation, workflow journal, Redis projection, database
path, result/error propagation, and configured workload remain unchanged. The structural
workflow-boundary test pins the durable queue call and its timeout/retry policy so cleanup cannot
silently restore the indefinite wait.

The gate's advisory-lock assertion was also corrected to measure contention rather than incidental
lock presence. Ryot deliberately disables Effect Cluster's shard advisory locks because its shared
`pg` connection does not support concurrent queries; unrelated operations can still make the total
lock count transiently zero or nonzero. The meaningful invariant is that no advisory lock waits are
observed, so the gate now asserts `maxWaitingAdvisoryLocks === 0` while retaining the database pool,
deadlock, Redis, workflow-overlap, result-count, and sandbox-execution assertions.

Library import had one final direct deferred after provider population: ensuring the user's library
membership. A later loaded run again completed earlier imports but left the final job pending for 30
seconds at that boundary. A one-shot `EnsureLibraryMembershipWorkflow` now owns the wait for the
existing membership queue, keyed by the already-deterministic membership execution id. The parent
awaits the shell through terminal polling; queue ownership and write behavior remain unchanged.

### Monitoring population batches use bounded fan-out

The full suite's media-monitoring fixtures legitimately accumulated 20 monitored targets in the
shared backend. The sweep already bounded each kernel population batch to 100 items, but the kernel
awaited every deterministically keyed provider workflow serially. Cron duration grew with every
preceding monitor until one manual sweep remained in-flight for 170 seconds and exhausted the test's
180-second budget.

Provider-population batches now execute with concurrency 4 after all items pass authorization.
Index-derived execution ids and result ordering are unchanged, while the bound stays below the
default sandbox worker capacity and avoids unbounded pressure on the workflow and database pools.

### SSE heartbeats precede the server idle timeout

Repeated full-suite failures in different association lifecycle cases were strict SSE failures, not
detector or notification assertion drift. Correlated backend diagnostics showed the failing stream
register interest in the target entity, then close after 9.08 seconds. The provider workflow
published the entity update at 13.84 seconds, Redis delivered it to the backend subscriber, and the
registry correctly found zero interested streams because the connection had already been removed.

Bun closes quiet HTTP connections after its default 10-second `idleTimeout`; its SSE documentation
requires disabling that timeout or sending traffic sooner. Ryot's first heartbeat was scheduled at
25 seconds, so loaded refreshes outlived the connection while fast isolated runs hid the defect. The
heartbeat now runs every 5 seconds, preserving the strict `entity:updated` assertion and keeping the
stream active without changing detector, notification, or fallback behavior. Temporary diagnostic
logs were removed after establishing the timeline.

### Adapter-only integration failures remain failed runs

After the integration adapters became resolvable activities, the fail-fast sweep exposed
`tests/src/tests/kernel/integrations/continuous-error-disable.test.ts`: an empty Kodi payload correctly produced a
structured `input_transformation` failure, but the generic import writer finalized the run as
`completed`. The pre-migration sink path treated an adapter result with failures and no entity
groups as a failed run. The earlier activity-resolution defect had accidentally preserved that
observable status by failing before the adapter ran.

The media import workflow now marks only this adapter-only integration case on its kernel child
input. The generic writer still records the structured failure and counters, but finalizes the run
as `failed` with the first failure message. Ordinary imports, partial-success integrations, and
failures discovered after a valid adapter group reaches resolution, population, or writing retain
their existing completion semantics. Finalizing in the kernel child also prevents terminal polling
from observing a transient `completed` status before the parent integration workflow can react.

### Built-in schema lookup does not refetch catalogs per plugin

The next fail-fast run timed out in the first
`tests/src/tests/plugins/media/query-engine/media-suggestions.test.ts` case after 180 seconds. The query itself was not the
bottleneck: both cases passed independently in 5.17 seconds before the fix. Each global-book fixture
called `findBuiltinSchemaBySlug`, which fetched all entity definitions and sandbox scripts, then
repeated those same two full-catalog requests for every installed plugin before filtering
the already-returned data locally. The media-suggestions setup called the fixture six times, and the
full suite had accumulated enough temporary plugin workspaces to amplify that scan into thousands of
redundant requests.

`findBuiltinSchemaBySlug` now fetches the schema/script catalogs once, lists plugins once, and
selects the matching schema from the original result in plugin order. Selection behavior is
unchanged, but request growth is constant rather than proportional to the number of plugins. The
focused file now completes both cases in 2.39 seconds.

### The isolated observability backend gets its hook's startup budget

The observability fixture's backend did not crash: its debug log showed first-party plugin bootstrap
still running when the default 30-second health-check retry budget expired. This backend starts its
own complete infrastructure and enables debug tracing while the shared suite is loaded, and its
setup hook already allows 120 seconds. Its health check now retries for up to 90 seconds, leaving
30 seconds for the remainder of setup rather than failing during a healthy but slower bootstrap.

## Verification

Current verified results:

- Import coverage now owned by `tests/src/tests/kernel/imports/imports.test.ts`, `tests/src/tests/plugins/media/imports/imports.test.ts`, and `tests/src/tests/plugins/fitness/imports/imports.test.ts`: the original 10/10 passed.
- Integration coverage now owned by `tests/src/tests/kernel/integrations/integrations.test.ts` and `tests/src/tests/plugins/media/integrations/integrations.test.ts`: the original 21/21 passed.
- `tests/src/tests/kernel/integrations/continuous-error-disable.test.ts`: 1/1 passed after reproducing the
  original failure independently.
- `plugins/media/scripts/imports/import.test.ts`: 12/12 passed, including the adapter-only failure
  dispatch regression.
- `tests/src/tests/plugins/media/query-engine/media-suggestions.test.ts`: 2/2 passed in 2.39 seconds after the
  catalog lookup repair.
- `tests/src/tests/plugins/media/media-monitoring/association-detectors.test.ts`: 4/4 passed independently.
- All four media-monitoring files passed together: 13/13 tests in 40.92 seconds.
- The manga auto-completion case passed independently in 1.5 seconds before applying the same
  terminal-polling workaround to its loaded execution path.
- The Watcharr episode-resolution test passed independently.
- The Kodi episode-attachment test passed independently.
- The below-minimum progress-filter test passed independently.
- Focused backend workflow regression tests passed.
- `bun turbo --filter=@ryot/app-backend check`: 11/11 tasks passed with zero warnings and errors.
- `bun turbo --filter=@ryot/tests check`: 12/12 tasks passed with zero warnings and errors.
- `bun turbo --filter=@ryot/tests test`: 79/79 standard files and 501/501 standard tests passed;
  the opt-in operational file/test was skipped as configured.
- The opt-in media-population gate passed separately with its unchanged two-concurrent-1,001-item
  workload and 15-minute budget. All eight workflows completed in 361,548 ms, both imports returned
  1,001 completed results, 4,012 sandbox executions were observed, sandbox overlap peaked at eight,
  database activity peaked at five active and 34 total connections with no app-pool or advisory-lock
  waits, and the run recorded no deadlocks or Redis projection errors.

The operational suite no longer prints its large timeout and success metric strings. Those logs were
useful while locating the stalled boundary, but after the behavior was pinned they duplicated test
assertions and required several otherwise-dead peak counters and completion timestamps. Failures now
surface through the focused timeout or assertion message, while this document preserves the final
diagnostic evidence and justification.
