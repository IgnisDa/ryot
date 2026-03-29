# Build the Universal Durable Tracer

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** done

## What to build

Implement the synthetic tracer from Phase 1 sections 1-4 as one complete additive vertical slice.
Add the universal role-preserving definition/runtime shape alongside temporary legacy compatibility,
generalize the runner's durable request collection, persist/replay typed success and failure, and
dispatch the tracer's representative mutable read, query, service-backed write,
owning-workflow-backed write, immediate HTTP request, child workflow, and diagnostics.

The runner must own pending state so caught pending signals cannot produce false completion, assign
deterministic call indices/hashes, preserve deterministic parallel result order, reject detached
host work, and reconstruct replay from authoritative workflow state. Install the tracer through the
real plugin ingestion path and cover forced interruption before/after side-effect completion in
backend tests and kernel sandbox E2E. Do not migrate the production catalog or delete legacy APIs in
this task.

## Acceptance criteria

- [x] A role-specific test plugin executes through `SandboxScriptWorkflow` without using explicit
      `replay.activity` authoring.
- [x] Recorded host successes and typed failures replay without repeating completed operations.
- [x] Caught pending control flow still yields a pending workflow result.
- [x] Deterministic sequential/parallel calls validate index, capability, arguments, and result order.
- [x] The tracer composes both an activity-safe service write and an owning child workflow write.
- [x] Forced interruption tests prove no duplicated application write.
- [x] The runner rejects return with detached/in-flight host work.
- [x] Redis projection loss can be reconstructed from authoritative workflow completion state.
- [x] Focused SDK, compiler, backend, plugin-kit, and kernel sandbox E2E tests pass.
- [x] The tracer benchmark is recorded and catalog migration remains blocked pending Task 03.

## Completion evidence

- The runtime-installed operation tracer durably exercises preference and query reads, a persistent
  claim, `createEvents`, successful and typed-failure HTTP calls, parallel cache reads, a nested
  workflow, and replay-tagged diagnostics.
- Backend tests cover caught pending control flow, deterministic parallel collection, detached work,
  replay identity, typed success/failure, and interruption after a completed write. The kernel E2E
  deletes the Redis projection after both writes and completes without duplicate HTTP or event writes.
- Checks passed for `@ryot/app-backend`, `@ryot/sandbox-sdk`, `@ryot/tests`, and the fitness and media
  plugins. Their affected unit suites and the focused tracer E2E passed.
- The opt-in benchmark passed with controlled-provider p50/p95 of `253/471 ms` and durable-provider
  p50/p95 of `858/1,352 ms`. The review threshold did not trigger because the durable p95 was under
  both `3x` baseline and `+1 second`. Catalog migration remains blocked until Task 03 completes.

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 4
- User story 11
- User story 13
