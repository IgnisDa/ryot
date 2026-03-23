# E2E Tests

**Parent Plan:** [Sandbox Async Redesign](./README.md)

**Type:** AFK

**Status:** done

## What to build

Add end-to-end tests that exercise the full enqueue → execute → poll path against a live backend (real Redis, real Postgres, real Deno subprocess). This slice validates every layer in combination and catches regressions that unit tests cannot.

Specifically:

- Create `tests/src/fixtures/sandbox.ts` with two helpers:
  - `enqueueSandboxScript(client, cookies, body)` — calls `POST /sandbox/enqueue`, asserts `200`, returns `{ jobId }`. Throws on failure.
  - `pollSandboxResult(client, cookies, jobId, options?)` — polls `GET /sandbox/result/:jobId` in a loop until status is not `"pending"`. Default: 30-second total timeout, 500ms interval. Throws if the terminal state is not reached within the timeout.
- Export both helpers from `tests/src/fixtures/index.ts`.
- Create `tests/src/tests/sandbox.test.ts` covering the following scenarios:

  1. **Happy path — plain return value:** Enqueue a script that returns a plain value (e.g., `return 42`). Poll to completion. Assert `status: "completed"`, `value: 42`, `error: null`.
  2. **Script using `httpCall`:** Enqueue a script that calls `httpCall("GET", "https://httpbin.org/get")`. Poll to completion. Assert `status: "completed"` and `value` contains a successful HTTP response.
  3. **Script using `getEntitySchemas`:** Create a tracker and entity schema for the test user. Enqueue a script that calls `getEntitySchemas(["<slug>"])`. Poll to completion. Assert `status: "completed"` and `value` contains the schema created in setup.
  4. **Script-level thrown error:** Enqueue a script that throws `new Error("intentional")`. Poll to completion. Assert `status: "completed"` (not `"failed"`) and `error` contains `"intentional"`.
  5. **Script syntax error:** Enqueue a script with invalid JavaScript (e.g., `{{{`). Poll to completion. Assert `status: "completed"` and `error` is set.
  6. **Non-existent job ID:** Call `GET /sandbox/result/:jobId` with a fabricated UUID. Assert `404`.
  7. **Cross-user access:** User A enqueues a script. User B polls with User A's `jobId`. Assert `404`.
  8. **Unauthenticated enqueue:** Call `POST /sandbox/enqueue` without cookies. Assert `401`.
  9. **Unauthenticated poll:** Call `GET /sandbox/result/:jobId` without cookies. Assert `401`.

Follow the fixture and test patterns established in `tests/src/fixtures/entity-schemas.ts` and `tests/src/tests/entity-schemas.test.ts`: fresh user per test via `createAuthenticatedClient()`, fixtures that throw on failure, assertions on both HTTP status and response payload.

## Acceptance criteria

- [x] `tests/src/fixtures/sandbox.ts` exists and exports `enqueueSandboxScript` and `pollSandboxResult`.
- [x] Both helpers are re-exported from `tests/src/fixtures/index.ts`.
- [x] All 9 test scenarios exist in `tests/src/tests/sandbox.test.ts` and pass.
- [x] The `getEntitySchemas` test creates real data and asserts on it — it does not use hardcoded IDs.
- [x] Cross-user and unauthenticated tests verify access control at the HTTP response level.
- [x] `bun run typecheck`, `bun test`, and `bun run lint` pass in `tests/`.

## Blocked by

- [Task 04](./04-get-entity-schemas-host-function.md)

## User stories addressed

- User story 26 (E2E tests exercise the full enqueue → execute → poll lifecycle)
- Validates user stories 12–22 (full API contract) in a live environment
