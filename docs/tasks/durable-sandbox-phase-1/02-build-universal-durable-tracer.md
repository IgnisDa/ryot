# Build the Universal Durable Tracer

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** todo

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

- [ ] A role-specific test plugin executes through `SandboxScriptWorkflow` without using explicit
      `replay.activity` authoring.
- [ ] Recorded host successes and typed failures replay without repeating completed operations.
- [ ] Caught pending control flow still yields a pending workflow result.
- [ ] Deterministic sequential/parallel calls validate index, capability, arguments, and result order.
- [ ] The tracer composes both an activity-safe service write and an owning child workflow write.
- [ ] Forced interruption tests prove no duplicated application write.
- [ ] The runner rejects return with detached/in-flight host work.
- [ ] Redis projection loss can be reconstructed from authoritative workflow completion state.
- [ ] Focused SDK, compiler, backend, plugin-kit, and kernel sandbox E2E tests pass.
- [ ] The tracer benchmark is recorded and catalog migration remains blocked pending Task 03.

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 4
- User story 11
- User story 13
