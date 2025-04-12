# Service and Queue Refactor

**Parent Plan:** [Sandbox Async Redesign](./README.md)

**Type:** AFK

**Status:** done

## What to build

Refactor the core BullMQ and `SandboxService` layers to make job payloads fully self-contained. This is the slice that eliminates the in-memory `queuedApiFunctions` Map and enables any worker instance to execute any job.

Specifically:

- Update the `sandboxRunJobData` Zod schema: remove `apiFunctionsId`, add `apiFunctionDescriptors` as an optional array of `{ functionKey: string; context: Record<string, unknown> }` objects. Validation is shape-only — `functionKey` is not checked against the registry at the schema layer.
- Update queue configuration: `removeOnComplete` to 1 hour, `removeOnFail` to 24 hours, `attempts: 1` (no retries), worker `concurrency: 5`. Remove `QueueEvents` and all code that references it.
- Rewrite `SandboxService`:
  - Remove the `queuedApiFunctions` Map and `setQueuedApiFunctions` / `consumeQueuedApiFunctions` helpers.
  - Add `enqueue(options)` — accepts `{ userId, code, context?, apiFunctionDescriptors? }`, generates a UUID job ID via `generateId()`, enqueues the job with the full descriptor payload, and returns `{ jobId }`.
  - Rewrite `executeQueuedRun(jobData)` — iterates `apiFunctionDescriptors`, looks up each `functionKey` in `hostFunctionRegistry`, throws immediately if any key is missing (before Deno is spawned), and calls `execute()` with the reconstructed `apiFunctions` map.
  - Make `execute()` private.
- Write unit tests for `executeQueuedRun()`.

See the **Job payload**, **Function reconstruction on the worker**, **Queue configuration**, and **SandboxService interface** sections of the parent PRD for precise details.

## Acceptance criteria

- [ ] `sandboxRunJobData` schema contains `apiFunctionDescriptors` and does not contain `apiFunctionsId`.
- [ ] Queue is configured with 1-hour completed retention, 24-hour failed retention, `attempts: 1`, worker `concurrency: 5`.
- [ ] `QueueEvents` is removed from queue setup and lifecycle management.
- [ ] `SandboxService` has no `queuedApiFunctions` Map, no `setQueuedApiFunctions`, no `consumeQueuedApiFunctions`.
- [ ] `SandboxService.enqueue()` is public and returns `{ jobId }` where `jobId` is a random UUID.
- [ ] `SandboxService.execute()` is private.
- [ ] `executeQueuedRun()` throws before spawning Deno if any `functionKey` is not in the registry.
- [ ] `executeQueuedRun()` with an empty or absent `apiFunctionDescriptors` calls `execute()` with no extra functions (only defaults).
- [ ] Unit tests pass for `executeQueuedRun()`: valid descriptors reconstruct correctly; unknown key throws; empty descriptors pass through cleanly.
- [ ] `bun run typecheck`, `bun test`, and `bun run lint` pass in `apps/app-backend`.

## Blocked by

- [Task 01](./01-foundation-types-convention-registry.md)

## User stories addressed

- User story 3 (fully self-contained job payload)
- User story 4 (per-request context serialized at enqueue time)
- User story 5 (unknown `functionKey` throws before Deno spawns)
- User story 6 (no retries — scripts with side effects never run twice)
- User story 7 (worker concurrency 5)
- User story 8 (completed job retention 1 hour)
- User story 9 (failed job retention 24 hours)
- User story 10 (bridge function map populated before Deno, cleared in finally)
- User story 11 (QueueEvents removed)
- User story 23 (graceful drain on shutdown)
- User story 24 (random port bridge server — unchanged, confirmed still in place)
- User story 25 (execution limits enforced server-side)
