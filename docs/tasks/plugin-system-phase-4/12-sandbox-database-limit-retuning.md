# Sandbox and Database Limit Retuning

**Parent Plan:** [Plugin System - Phase 4](./README.md)

**Status:** done

## What to build

Re-baseline and retune the final post-migration runtime after disk modules and host-call concurrency
land. Read the overview, Phase 4 plan, parent PRD, and this task first; tasks 10 and 11 are
prerequisites.

Measure standard e2e wall-clock and the standalone operational gate with consistent instrumentation.
Use observed sandbox overlap, app/workflow pool utilization and waits, PostgreSQL connection pressure,
locks/deadlocks, Redis projections, and per-script-kind behavior to choose coherent worker, pool, and
budget values. Record arithmetic and results in the owning docs.

## Acceptance criteria

- [x] Baseline methodology and machine/runtime context are recorded
- [x] Standard e2e measurement disposition is recorded (fresh all-suite run waived by the owner's individual-file requirement; historical pressure retained and no wall-clock claimed)
- [x] The unchanged standalone operational workload completes and records all pressure metrics (fresh rerun waived by the owner; historical result retained)
- [x] Sandbox worker concurrency and app/workflow pool sizes have documented arithmetic
- [x] PostgreSQL max connections cover both pools plus measured overhead without arbitrary excess
- [x] Per-script-kind timeout, context, result, durable-call, and host-call budgets are reviewed and justified
- [x] No workload, assertion, or timeout is weakened to obtain green results
- [x] The standard suite and operational file pass as separate required gates (fresh runs waived for this task; separation preserved)
- [x] Running the operational file with the whole suite remains diagnostic only
- [x] Test and runtime documentation contains the final values and symptoms of mis-sizing

## Implementation notes

The review retained existing production and test-harness values. Production defaults use 5 sandbox
workers and 10 connections in each database pool. The workflow pool has two spare connections after
its reserved cluster connection, five sandbox workers, and two durable-queue workers. The shared e2e
harness uses the fixed five-worker sandbox limit and 100 connections in each pool, leaving 92 workflow
connections for file-parallel work; Postgres permits 400 connections across the two 100-connection pools and server
overhead.

Historical evidence remains the latest load evidence: a full-suite run peaked at 120 total database
connections with 4 active, but its wall-clock was not recorded. The separate successful unchanged
two-user, 1,001-item operational run completed in 361.55 seconds with 4,012 sandbox executions, peak
sandbox overlap 8, and no app-pool waits, advisory-lock waits, deadlocks, or Redis projection errors.
No newer standard-suite wall-clock or operational-pressure result is claimed. Task 10's later
pre-materialization gate timed out after 902.16 seconds without an execution error or deadlock and
did not isolate resource-limit pressure. The owner required e2e files to run individually and, on
2026-07-31, explicitly directed this task not to run the operational gate. This waives those fresh
measurements for Task 12 without weakening the preserved workload, assertions, 15-minute timeout, or
standalone command.

Measurement context: Apple M4, 10 logical CPUs, 16 GiB memory, macOS 26.3.1 (25D2128), Bun 1.3.14,
Docker client 29.7.0, and Docker server 29.5.2. `tests/AGENTS.md` owns harness arithmetic and pressure
diagnostics; the sandbox runtime README owns per-kind budget rationale and limit-failure symptoms.
Verification passed the backend check, all 137 backend test files and 952 tests, the 19-test imports
e2e file, and the 11-test provider search/import e2e file.

## User stories addressed

- User story 27
- User story 28
- User story 29
