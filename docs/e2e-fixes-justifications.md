# E2E Fixes and Justifications

Status: targeted repair complete. The previously documented imports and integrations files are
green in isolation, and the tests-package check passes. The file-by-file sweep, opt-in operational
gate, and final Turbo e2e gate have not run.

## Baseline

The repair began from the Phase 3 Task 10/11 baseline and reproduced every documented failure
before changing code:

- Watcharr in `tests/src/tests/imports/imports.test.ts` stayed `running` until the 60-second poll
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

### Integration adapters are workflow activities

The ten media integration adapters were authored with `defineScript` and `kind: "script"`, while
the media import workflow invokes the selected adapter through `replay.activity`. The kernel's
workflow resolver intentionally accepts only `kind: "activity"` at that boundary. This structural
guard prevents a deterministic workflow from invoking an arbitrary direct script as durable work.

All sink and yank adapters under `plugins/media/scripts/integrations/` now use `defineActivity` and
`kind: "activity"`. Their input/output schemas, capabilities, provider declarations, and adapter
logic are unchanged. The previous definitions were wrong because the migration changed who invokes
the adapters without changing their script kind to match that invocation contract.

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

Two composition boundaries now omit `WorkflowInstance` while awaiting their deterministically keyed
child:

- The generic import writer awaiting `EventCreateWorkflow`.
- `performSandboxWorkflowChild` awaiting plugin or kernel workflow references.

Without a parent instance, the engine uses its top-level terminal-result polling path rather than
the unreliable parent-resume RPC. Durable ownership and idempotency remain unchanged. A process
restart replays the parent, derives the same child execution id, and reads the persisted child result
instead of re-running its side effects. Activities, durable queues, script pinning, and journal
validation are unchanged.

This workaround is intentionally limited to the two boundaries that reproduced the fault through
the real SQL-backed `ClusterWorkflowEngine`. Remove it only after an upstream upgrade proves nested
completion through that production path; in-memory workflow tests cannot establish that behavior.

## Verification

Current verified results:

- `tests/src/tests/imports/imports.test.ts`: 10/10 passed.
- `tests/src/tests/integrations/integrations.test.ts`: 21/21 passed.
- The Watcharr episode-resolution test passed independently.
- The Kodi episode-attachment test passed independently.
- The below-minimum progress-filter test passed independently.
- Focused backend workflow regression tests passed.
- `bun turbo --filter=@ryot/tests check`: 12/12 tasks passed with zero warnings and errors.

No full-suite or Phase 3 gate claim is made because the remaining verification listed in the status
line has not run.
