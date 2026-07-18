# Establish Sandbox Performance Baselines

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** todo

## What to build

Implement Phase 1 plan section 0 before changing sandbox execution semantics. Add a repeatable,
hermetic benchmark harness that measures the current standard/workflow runtime with warm backend and
sandbox pools. Cover the exact representative paths and metrics named by the plan, including a
no-host automation, a full automation branch, controlled one/two-call provider work, multi-call
Youtubei, bounded import/population, and the production-size media population operational gate.

Record machine/configuration, warm-up, sample count, p50/p95, orchestration time, sandbox executions,
replays/module loads, workflow/Redis round trips, and import throughput in Phase 1 plan section 0.
This task establishes evidence only; it must not introduce universal-runtime behavior or timing
assertions into ordinary E2E.

## Acceptance criteria

- [ ] One documented command runs the warm hermetic benchmark harness repeatably.
- [ ] Every representative path and metric required by Phase 1 section 0 has a recorded baseline.
- [ ] Controlled upstream delay is reported separately from Ryot orchestration overhead.
- [ ] The benchmark does not depend on live providers and does not make ordinary E2E timing-sensitive.
- [ ] The media population operational baseline is recorded using its documented standalone gate.
- [ ] Harness-focused checks/tests and every touched package check pass.
- [ ] Baseline evidence and any environment caveats are written into the authoritative Phase 1 plan.

## User stories addressed

- User story 12
- User story 13
