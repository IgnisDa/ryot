# Per-Execution Host-Call Concurrency

**Parent Plan:** [Plugin System - Phase 4](./README.md)

**Status:** done

## What to build

Add a per-execution in-flight host-call bound to the bridge session. Read the overview, Phase 4 plan,
parent PRD, and this task first.

Observe representative batch/import activity to select a limit, record the evidence, and add an
interruption-safe semaphore separate from total and HTTP call-count budgets. Calls above the bound
wait within the execution lifetime. Session expiry/removal and execution failure must release or
interrupt every waiter without affecting another execution id.

## Acceptance criteria

- [x] The chosen in-flight limit is based on recorded representative behavior
- [x] Every active execution owns an independent semaphore with that limit
- [x] Total host-call and HTTP-call count budgets remain independently enforced
- [x] Calls above the bound wait rather than bypassing the limit or failing arbitrarily
- [x] Success, typed failure, defect, timeout, cancellation, expiry, and session removal release permits safely
- [x] Removing a session does not leave blocked bridge requests or leak state
- [x] Controlled tests prove maximum overlap, queued progress, and isolation between execution ids
- [x] Batch-first media/fitness scripts remain green; the owner waived the standalone operational rerun
- [x] The selected limit and rationale are recorded in the Phase 4 plan/runtime docs

## Implementation notes

The per-execution limit is four. Current intentional fan-out peaks at two concurrent media metadata
or Netflix searches, three Movary artifact reads, and four backend tasks; import and monitoring batch
dispatch is otherwise sequential. Each active bridge session owns its own Effect semaphore and close
signal. Removal completes that signal before deleting Redis state, interrupting active and queued
calls without coupling separate execution ids. Existing cumulative host-call budgets are unchanged.

Verification passed the backend check, all 137 backend test files and 952 tests, the 19-test imports
e2e file covering media and fitness, and the 11-test provider search/import e2e file. The owner waived
rerunning the standalone 1,001-item operational gate.

## User stories addressed

- User story 24
- User story 25
- User story 26
