# Integration Yank Workflow Orchestration

**Parent Plan:** [Effect Workflow Orchestration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Refactor scheduled or manually triggered yank integration runs so the integration run workflow owns the full yank process. A yank run should load and validate the integration, check disabled state and user-wide integration settings, mark the run started, fetch or adapt provider data as durable workflow-owned work, merge ownership data when configured, feed adapter results into shared media import orchestration, finalize the import run, update the integration's last successful completion on success, and apply continuous-error disabling behavior.

YouTube Music history fetching is the key sandbox-composition tracer bullet for this task. The YouTube Music adapter must no longer call the sandbox workflow through the raw workflow engine as a hidden step. The integration workflow should own the history sandbox execution as a child workflow or direct sandbox durable queue step.

After this task, the integration run workflow should no longer have a temporary whole-run queue-worker fallback for supported sink or yank integrations.

## Acceptance criteria

- [ ] Yank integration runs execute through explicit workflow phases instead of one opaque integration-run queue worker
- [ ] Provider data fetching and ownership syncing are represented as durable activities, bounded durable queue steps, or workflow-owned sandbox child steps according to provider needs
- [ ] YouTube Music history sandbox execution is owned by the integration workflow and no longer hidden behind raw workflow-engine execution in adapter code
- [ ] Adapter row-level failures and catastrophic provider failures preserve existing product-compatible run behavior
- [ ] Successful yank adapter results flow through shared media import orchestration
- [ ] Integration finalization updates import-run state, last successful completion, and continuous-error disabling behavior consistently with existing behavior
- [ ] Any temporary integration run queue-worker fallback left by the sink task is removed or reduced to bounded step work with a clear durable queue purpose
- [ ] The integration workflow `toLayer` is not a single pass-through durable queue call for any supported integration path
- [ ] Tests cover at least one non-sandbox yank provider and the YouTube Music sandbox-backed provider, including success, provider failure, ownership sync where applicable, finalization, and continuous-error disabling

## User stories addressed

Reference by number from the parent PRD:

- User story 1
- User story 2
- User story 5
- User story 6
- User story 7
- User story 9
- User story 12
- User story 13
- User story 17
- User story 18
- User story 19
- User story 23
- User story 24
- User story 25
- User story 26
- User story 28
- User story 30
- User story 31
- User story 32
- User story 33
