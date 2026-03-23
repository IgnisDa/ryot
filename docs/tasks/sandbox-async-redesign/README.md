# Sandbox Async Redesign

## Problem Statement

The sandbox subsystem allows users to run untrusted scripts that can call application-provided host functions (such as making HTTP requests or reading config values). The current implementation stores these host functions in an in-memory `Map` on the service instance that enqueued the job, and passes only a UUID key through BullMQ. When a worker on a different instance picks up the job, that instance has no copy of the functions and the execution fails.

This makes horizontal scaling impossible: the worker that processes a sandbox job must be the exact same process that enqueued it. In a multi-instance deployment this constraint cannot be guaranteed.

Additionally, the current API uses a synchronous `job.waitUntilFinished()` call that blocks the HTTP response for the entire duration of the sandbox execution. This design cannot support truly background job execution, makes the API fragile to network interruptions, and couples job duration to HTTP timeout limits.

## Solution

Replace the in-memory function Map with **function descriptors**: serializable JSON objects that describe which host function to invoke and what per-request data to bind to it. The descriptor is stored in the BullMQ job payload alongside the code, making the payload fully self-contained. Any worker instance can reconstruct and execute the functions without contacting the enqueuing instance.

Introduce a **static host function registry** on every instance: a map from string keys to factory functions. A factory accepts a serializable context object and returns a bound, callable function. Since the registry is code (not runtime state), it is identical on every instance.

Split the single synchronous endpoint into two: an **enqueue endpoint** that returns a job ID immediately, and a **poll endpoint** that the client calls to retrieve the result once complete.

Add a new host function, `getEntitySchemas`, as the first function with a real non-empty context (`{ userId }`), which exercises the full descriptor path end-to-end.

## User Stories

1. As a backend developer, I want every host function to follow a uniform context-first signature, so that the convention is enforced by the type system rather than relying on developer discipline.
2. As a backend developer, I want to add a new host function by implementing it in isolation and registering it in one place, so that the process is consistent and doesn't require touching unrelated code.
3. As a backend developer, I want the job payload to be fully self-contained JSON, so that any worker instance can process any job without coordination with the enqueuing instance.
4. As a backend developer, I want per-request data (such as `userId`) to be passed into a host function through a typed context object in the descriptor, so that it is serialized once at enqueue time and safely reconstructed on the worker.
5. As a backend developer, I want an unknown `functionKey` to cause the job to fail immediately before Deno is spawned, so that misconfiguration surfaces as a clean error rather than a runtime panic inside the script.
6. As a backend developer, I want sandbox jobs to have no automatic retries, so that scripts with side effects (HTTP POST calls, DB writes) are never executed twice due to a worker crash.
7. As a backend developer, I want worker concurrency set to 5, so that multiple scripts can run in parallel without overwhelming the host process with Deno subprocesses.
8. As a backend developer, I want completed job results retained for 1 hour in Redis, so that a polling client has a generous window to retrieve results.
9. As a backend developer, I want failed job records retained for 24 hours in Redis, so that infrastructure failures can be debugged after the fact.
10. As a backend developer, I want the bridge server's per-execution function map to be populated immediately before spawning Deno and cleared in a `finally` block, so that no execution's functions are visible to another execution.
11. As a backend developer, I want the `QueueEvents` abstraction removed from the queue setup, so that code is not carrying infrastructure that is no longer needed.
12. As an API client developer, I want to submit a script to `POST /sandbox/enqueue` and receive a `jobId` immediately, so that I can proceed without blocking on execution time.
13. As an API client developer, I want to poll `GET /sandbox/result/:jobId` and receive a stable `pending | completed | failed` status, so that I can implement a simple polling loop without coupling to BullMQ internals.
14. As an API client developer, I want a `completed` response to include `logs`, `value`, and `error`, so that I receive both the script's output and any script-level error in one response.
15. As an API client developer, I want a `failed` response to include the infrastructure error message, so that I can distinguish a crashed worker from a script-level error.
16. As an API client developer, I want a missing or expired job to return `404`, so that my client has a single error code for "no result available".
17. As an API client developer, I want a job belonging to another user to return `404` (not `403`), so that the existence of another user's job is not revealed.
18. As an API client developer, I want job IDs to be random UUIDs rather than sequential integers, so that I cannot enumerate other users' job IDs.
19. As a script author, I want to call `getEntitySchemas(["slug-a", "slug-b"])` inside a sandbox script and receive the full entity schema objects for those slugs, so that I can use schema metadata in my script logic.
20. As a script author, I want `httpCall`, `getAppConfigValue`, `getUserConfigValue`, and `getEntitySchemas` to be available as named functions in the script scope, so that I can call them without any special setup.
21. As a script author, I want the `context` variable (provided by the caller at enqueue time) to remain available in my script, so that I can use caller-supplied runtime data such as `context.query` or `context.page`.
22. As a script author, I want a script-level error (thrown exception, failed `httpCall`) to produce `status: "completed"` with `error` set, not `status: "failed"`, so that I can distinguish my script's own errors from infrastructure failures.
23. As a system operator, I want the worker to drain gracefully on shutdown (finishing in-flight jobs before stopping), so that a deployment does not orphan active Deno executions.
24. As a system operator, I want the bridge server to listen on a randomly allocated port, so that multiple instances on the same host do not conflict.
25. As a system operator, I want all execution limits (10s timeout, 64 MB heap, 20,000 char code limit) to be enforced server-side and not overridable by the client, so that resource usage is predictable.
26. As a developer, I want E2E tests that exercise the full enqueue → execute → poll path against a live backend, so that regressions in the async job lifecycle are caught before deployment.

## Implementation Decisions

### Host function convention

Every host function has the signature `(context: TContext, ...args: unknown[]) => Promise<unknown>`. A `HostFunction<TContext>` type alias in `types.ts` makes this convention explicit and machine-checked. The context type for functions with no per-request state is `Record<string, never>` (an empty object).

### Function descriptor type

`ApiFunctionDescriptor` is defined as `{ functionKey: string; context: Record<string, unknown> }`. `functionKey` serves double duty: it is both the registry lookup key and the name exposed to user code inside the Deno script. There is no separate `name` field.

### Static function registry

A new `function-registry.ts` module exports `hostFunctionRegistry`, a plain object mapping each `functionKey` to a factory: `(context: Record<string, unknown>) => ApiFunction`. The factory applies the context and returns a bound, callable function. Stateless functions use `(_ctx) => (...args) => fn(...args)`. Stateful functions use `(ctx) => (...args) => fn(ctx as TContext, ...args)`.

### Job payload

The `sandboxRunJobData` Zod schema replaces `apiFunctionsId` (removed) with `apiFunctionDescriptors`: an optional array of `{ functionKey: string; context: Record<string, unknown> }` objects. Validation is shape-only; `functionKey` is not checked against the registry at the schema layer — that check happens at the start of `executeQueuedRun`.

### Function reconstruction on the worker

`executeQueuedRun` iterates `apiFunctionDescriptors`. For each descriptor it looks up the factory by `functionKey`. If any key is absent from the registry, an error is thrown immediately before Deno is spawned and the job transitions to `failed`. Otherwise it calls `factory(descriptor.context)` to produce the bound `ApiFunction` and registers it under `descriptor.functionKey`.

### SandboxService interface

- `enqueue(options)` — validates and enqueues a job using a `generateId()`-derived custom BullMQ job ID; returns the job ID.
- `executeQueuedRun(jobData)` — called by the BullMQ worker; reconstructs functions from descriptors; delegates to `execute()`.
- `execute()` — private; owns the Deno subprocess lifecycle, bridge session management, stream collection, and result formatting.
- `start()` / `stop()` — public lifecycle methods.

`httpCall` is no longer auto-injected. It must be listed explicitly as a descriptor by the route handler.

### Queue configuration

- `removeOnComplete: { age: 3600, count: 1000 }` (1 hour)
- `removeOnFail: { age: 86400, count: 1000 }` (24 hours)
- `attempts: 1` (no retries)
- Worker `concurrency: 5`
- `QueueEvents` is removed entirely.

### API contract

**`POST /sandbox/enqueue`**

- Request body: `{ code: string, context?: Record<string, unknown> }`
- Response: `{ data: { jobId: string } }`
- The route handler builds `apiFunctionDescriptors` server-side. The client never touches descriptors.

**`GET /sandbox/result/:jobId`**

- Auth required; `jobId` must belong to the requesting user — otherwise `404`.
- Responses:
  - Job not found or expired → `404`
  - BullMQ state `waiting | active | delayed` → `{ data: { status: "pending" } }`
  - BullMQ state `completed` → `{ data: { status: "completed", logs: string | null, value: unknown, error: string | null } }`
  - BullMQ state `failed` → `{ data: { status: "failed", error: string } }` using `job.failedReason`

### Error model

Script-level errors (thrown exceptions, `httpCall` failures, invalid arguments) cause the BullMQ job to complete with `error` set in the return value. Infrastructure errors (unknown `functionKey`, payload validation failure, worker crash) cause the BullMQ job to transition to `failed`.

### `getEntitySchemas` host function

- Context: `{ userId: string }` — bound at enqueue time from the authenticated user.
- Argument from script: `slugs: unknown` — validated to be `string[]` inside the function.
- Implementation: delegates to the existing `listEntitySchemas({ userId: context.userId, slugs })` service function.
- Return value: `apiSuccess(data)` with the full `ListedEntitySchema[]` shape, or `apiFailure(message)` on error.

### Unchanged components

The bridge server (`bridge.ts`), runner file manager (`runner.ts`), runner source (`runner-source.txt`), constants, utilities, and singleton lifecycle (`index.ts`) are unchanged. The Deno runner needs no modifications: it already builds stubs generically from the list of function names in the payload.

### E2E fixture and test files

A new `tests/src/fixtures/sandbox.ts` provides `enqueueSandboxScript` and `pollSandboxResult` helpers. A new `tests/src/tests/sandbox.test.ts` exercises the full enqueue → execute → poll path against a live backend, including the `getEntitySchemas` host function against real database state.

## Testing Decisions

Tests must be pure and functional: they test observable outputs given inputs, with no real Redis, BullMQ, Deno, or database connections. All external dependencies are injected or replaced with lightweight stubs.

### What makes a good test here

A good test calls a function with known inputs and asserts on its return value or the error it throws. It does not assert on internal state, private methods, or implementation details like which internal helper was called. For async functions it tests success paths, validation failure paths, and error propagation paths.

### Modules with tests

**Host functions** (`http-call`, `get-app-config-value`, `get-user-config-value`, `get-entity-schemas`)
Each host function is a pure async function. Tests cover: valid input returning expected shape, invalid argument types returning `apiFailure`, and for `getEntitySchemas`, a mocked `listEntitySchemas` service verifying that `userId` from context and `slugs` from args are forwarded correctly.

**`function-registry.ts`**
Tests cover: every registered `functionKey` resolves to a callable factory; calling a factory returns a function; the returned function is bound (context is not exposed as an argument to the caller); an unknown key look-up path (used by `executeQueuedRun`) throws as expected.

**`SandboxService.executeQueuedRun()`**
Tests cover: valid descriptors produce bound functions passed to `execute()`; an unknown `functionKey` throws before `execute()` is called; an empty `apiFunctionDescriptors` array results in `execute()` being called with no extra functions.

**Sandbox routes (`POST /sandbox/enqueue`, `GET /sandbox/result/:jobId`)**
No route-specific HTTP unit tests are required in this plan. HTTP-level contract coverage for these endpoints is intentionally deferred to the E2E slice in `tests/`.

### Prior art (unit tests)

Look at existing service and helper tests in `apps/app-backend/src` for fixture patterns (`src/lib/test-fixtures`) and how mock dependencies are injected.

### E2E tests (`tests/`)

E2E tests run against a real backend process with real Redis and Postgres (via `testcontainers`). They use the `openapi-fetch` typed client and follow the same patterns as `tests/src/tests/entity-schemas.test.ts` and `tests/src/tests/trackers.test.ts`.

This slice owns the HTTP-level verification for `POST /sandbox/enqueue` and `GET /sandbox/result/:jobId`, including auth, cross-user access, and response-shape assertions.

**Fixture file:** Add `tests/src/fixtures/sandbox.ts` with:

- `enqueueSandboxScript(client, cookies, body)` — calls `POST /sandbox/enqueue`, throws on non-200, returns `{ jobId }`.
- `pollSandboxResult(client, cookies, jobId, options?)` — polls `GET /sandbox/result/:jobId` in a loop until status is not `"pending"`, with a configurable timeout (default 30s, 500ms interval). Throws if the timeout is reached before a terminal state.

**Test file:** `tests/src/tests/sandbox.test.ts`

Tests cover:

- **Enqueue + complete (happy path):** Enqueue a script that returns a plain value; poll to completion; assert `status: "completed"` and correct `value`.
- **Script using `httpCall`:** Enqueue a script that calls `httpCall` to a real external URL (or a loopback server); poll to completion; assert the response is reflected in `value`.
- **Script using `getEntitySchemas`:** Create a tracker and entity schema for the test user; enqueue a script that calls `getEntitySchemas` with the schema's slug; poll to completion; assert the returned schema data matches what was created.
- **Script-level error:** Enqueue a script that throws an exception; poll to completion; assert `status: "completed"` and `error` is set (not `status: "failed"`).
- **Syntax error in script:** Enqueue a script with invalid JavaScript; poll to completion; assert `status: "completed"` and `error` is set.
- **Poll for non-existent jobId:** Call the poll endpoint with a fabricated UUID; assert `404`.
- **Cross-user jobId access:** User A enqueues a script; User B polls with User A's `jobId`; assert `404`.
- **Unauthenticated enqueue:** Call `POST /sandbox/enqueue` without cookies; assert `401`.
- **Unauthenticated poll:** Call `GET /sandbox/result/:jobId` without cookies; assert `401`.

### Prior art (E2E tests)

Follow the patterns in `tests/src/tests/entity-schemas.test.ts` for fixture composition and multi-user isolation tests. Follow `tests/src/fixtures/entity-schemas.ts` for the fixture file structure (builder functions with defaults, throw on failure, return extracted IDs).

## Out of Scope

- Per-request override of `timeoutMs` or `maxHeapMB` by the client.
- Context payload size cap on `apiFunctionDescriptors` (deferred to a future iteration once functions with large contexts exist).
- `getUserConfigValue` real implementation (remains a stub; will be revisited when user config is stored in the database).
- The `trackerId` filter on `getEntitySchemas` (mirrors the scope of the existing `/list` endpoint, which supports it, but it is intentionally excluded here).
- Any changes to `runner-source.txt` or the Deno execution model.
- WebSocket or server-sent event push notifications for job completion (polling is sufficient for now).
- A client-side polling library or SDK.

## Further Notes

The existing `POST /sandbox/run` endpoint is removed. Any consumers must migrate to the enqueue + poll pattern.

The `context` object in the enqueue request body is the user-facing script context (accessible as the `context` variable inside the script). It is distinct from the per-function `context` inside each `ApiFunctionDescriptor`. The naming coincidence is acceptable because the two are never in scope at the same layer.

All four current host functions end up with `context: Record<string, never>` after this migration. `getEntitySchemas` is the first function with a real per-request context, and its presence in this implementation exists specifically to validate the full descriptor path: context serialization into BullMQ, cross-instance reconstruction from the registry, and correct forwarding to a real database-backed service function.

---

## Tasks

**Overall Progress:** 4 of 6 tasks completed

**Current Task:** [Task 05](./05-e2e-tests.md) (todo)

### Task List

| #   | Task                                                                                        | Type | Status | Blocked By   |
| --- | ------------------------------------------------------------------------------------------- | ---- | ------ | ------------ |
| 01  | [Foundation: Types, Convention, and Registry](./01-foundation-types-convention-registry.md) | AFK  | done   | None         |
| 02  | [Service and Queue Refactor](./02-service-and-queue-refactor.md)                            | AFK  | done   | Task 01      |
| 03  | [New API Endpoints](./03-new-api-endpoints.md)                                              | AFK  | done   | Task 02      |
| 04  | [`getEntitySchemas` Host Function](./04-get-entity-schemas-host-function.md)                | AFK  | done   | Tasks 01, 03 |
| 05  | [E2E Tests](./05-e2e-tests.md)                                                              | AFK  | todo   | Task 04      |
| 06  | [Cleanup Old Code](./06-cleanup-old-code.md)                                                | AFK  | todo   | Task 05      |
