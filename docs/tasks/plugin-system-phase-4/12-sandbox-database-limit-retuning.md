# Sandbox and Database Limit Retuning

**Parent Plan:** [Plugin System - Phase 4](./README.md)

**Status:** todo

## What to build

Re-baseline and retune the final post-migration runtime after disk modules and host-call concurrency
land. Read the overview, Phase 4 plan, parent PRD, and this task first; tasks 10 and 11 are
prerequisites.

Measure standard e2e wall-clock and the standalone operational gate with consistent instrumentation.
Use observed sandbox overlap, app/workflow pool utilization and waits, PostgreSQL connection pressure,
locks/deadlocks, Redis projections, and per-script-kind behavior to choose coherent worker, pool, and
budget values. Record arithmetic and results in the owning docs.

## Acceptance criteria

- [ ] Baseline methodology and machine/runtime context are recorded
- [ ] Standard e2e wall-clock and pressure measurements are captured
- [ ] The unchanged standalone operational workload completes and records all pressure metrics
- [ ] Sandbox worker concurrency and app/workflow pool sizes have documented arithmetic
- [ ] PostgreSQL max connections cover both pools plus measured overhead without arbitrary excess
- [ ] Per-script-kind timeout, context, result, durable-call, and host-call budgets are reviewed and justified
- [ ] No workload, assertion, or timeout is weakened to obtain green results
- [ ] The standard suite and operational file pass as separate required gates
- [ ] Running the operational file with the whole suite remains diagnostic only
- [ ] Test and runtime documentation contains the final values and symptoms of mis-sizing

## User stories addressed

- User story 27
- User story 28
- User story 29
