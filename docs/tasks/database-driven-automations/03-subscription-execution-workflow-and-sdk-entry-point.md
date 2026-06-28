# Subscription Execution Workflow and SDK Entry Point

**Parent Plan:** [Database-Driven Automations, Signals, and Subscriptions](./README.md)

**Type:** AFK

**Status:** todo

## What to build

The end-to-end execution path: signal emission enqueues subscription dispatch after commit,
matching rules produce runs, and a feature-owned durable subscription-execution workflow drives
each run to completion. This slice makes the first full tracer visible: emit a signal, watch a
run row reach `succeeded`.

Implement the workflow per the PRD's Subscription Execution section: create or resume the
deterministic run row, mark it running, await the existing sandbox-run workflow with the resolved
sandbox identity, record outcome, logs, returned value, and timing, and complete without
affecting sibling subscriptions or the source operation. Resolve the hidden execution principal
(user or system) per the PRD's rules; system runs have no execution user and are not
user-visible. Runs resolve the latest compiled script at start; completed script failures are
recorded, not retried; a run whose execution user is disabled at start is skipped with a
user-disabled reason. Stored artifacts obey the single truncation cap with explicit markers, and
truncation never changes run status.

Add the sandbox SDK automation entry point following the existing provider and trigger
entry-point patterns, exporting the typed automation context defined in the PRD's Sandbox Scripts
section (rule ID, rule metadata, occurrence ID, origin, operation, discriminated source with the
four snapshot shapes, optional population block). Author a trivial built-in automation script in
the automations grouping (compiled through the existing registry pipeline, seeded idempotently)
and a seeded global rule binding it to a test signal schema so the tracer is provable in tests.

Builds on tasks 01 and 02. Follow the PRD's Subscription Execution, Sandbox Scripts, and
Deterministic Identity sections.

## Acceptance criteria

- [ ] Emitting a signal enqueues dispatch after commit and starts one durable execution per
      matching active rule; sibling failures are isolated
- [ ] The run row transitions queued → running → succeeded/failed/skipped with queued, started,
      and finished timestamps recorded
- [ ] Principal resolution follows the PRD: rule owner for user rules, row owner for built-in
      rules on user rows, system for built-in rules on global rows (requiring built-in rule and
      script)
- [ ] Disabled execution users produce a skipped run with a structured user-disabled reason and
      no automatic replay on re-enablement
- [ ] Logs, error, and returned value are truncated at the single cap with explicit markers;
      truncation never changes run status; the sandbox receives the complete context
- [ ] Workflow replay does not duplicate runs
- [ ] The SDK automation entry point type-checks the seeded script, and the end-to-end
      signal-to-succeeded-run tracer passes

## User stories addressed

- User story 30
- User story 32
