# Per-Execution Host-Call Concurrency

**Parent Plan:** [Plugin System - Phase 4](./README.md)

**Status:** todo

## What to build

Add a per-execution in-flight host-call bound to the bridge session. Read the overview, Phase 4 plan,
parent PRD, and this task first.

Observe representative batch/import activity to select a limit, record the evidence, and add an
interruption-safe semaphore separate from total and HTTP call-count budgets. Calls above the bound
wait within the execution lifetime. Session expiry/removal and execution failure must release or
interrupt every waiter without affecting another execution id.

## Acceptance criteria

- [ ] The chosen in-flight limit is based on recorded representative behavior
- [ ] Every active execution owns an independent semaphore with that limit
- [ ] Total host-call and HTTP-call count budgets remain independently enforced
- [ ] Calls above the bound wait rather than bypassing the limit or failing arbitrarily
- [ ] Success, typed failure, defect, timeout, cancellation, expiry, and session removal release permits safely
- [ ] Removing a session does not leave blocked bridge requests or leak state
- [ ] Controlled tests prove maximum overlap, queued progress, and isolation between execution ids
- [ ] Batch-first media/fitness scripts and the standalone operational path remain green
- [ ] The selected limit and rationale are recorded in the Phase 4 plan/runtime docs

## User stories addressed

- User story 24
- User story 25
- User story 26
