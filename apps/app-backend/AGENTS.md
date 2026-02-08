# App Backend Guidelines

> Inherits from root `AGENTS.md`. Rules below are additive.

## Product Context

The backend powers a self-hosted personal tracking product. Favor explicit validation, stable contracts, and small composable helpers over clever implicit behavior. Error paths should be unsurprising, persistence logic easy to audit, and API responses consistent across modules.

## Engineering Guardrails

### Type Safety

- Treat module `schemas.ts` files as the source of truth; derive all TypeScript types from them.
- OpenAPI types at `libs/generated/src/openapi/app-backend.d.ts` are generated automatically when the backend starts in development.

### Validation

- Put reusable schemas in module `schemas.ts` files.
- Use `resolveValidationData` (`src/lib/openapi.ts`) for route validation instead of ad hoc `try/catch` 400 responses. It wraps a callback, catches errors, and returns either `{ data }` or a 400 error result.
- Keep custom validation narrow and layered on top of schemas.

### Routes And OpenAPI

- Routes should be thin: parse input, check access, call service/repo, return response.
- Define routes with `createAuthRoute` (`src/lib/openapi.ts`) which injects auth middleware, 401 response, and security requirements.
- Use `createStandardResponses` to compose 200/400/404 response schemas. Other response helpers: `notFoundResponse`, `validationErrorResponse`, `payloadErrorResponse`.
- Map service results to HTTP responses using `createSuccessResult`, `createNotFoundErrorResult`, `createValidationErrorResult`, `createServiceErrorResult`, and `createCustomEntityAccessErrorResult` (all in `src/lib/openapi.ts`).
- Keep OpenAPI schemas colocated with their module.

### Error Handling

- Services return `ServiceResult<T, E>` (`src/lib/result.ts`): either `{ data: T }` or `{ error: E, message: string }`. Use the `serviceError` helper to construct errors.
- Access checks live in `src/lib/access/index.ts`: `checkAccess` (generic), `checkReadAccess` (existence check), and `checkCustomAccess` (existence + rejects builtin resources). They return either `{ data }` or `{ error, message }`.
- Routes translate service results to HTTP with the result helpers in `src/lib/openapi.ts` — do not construct ad hoc JSON error responses.

### Repositories And Drizzle

- Centralize repeated Drizzle projections into shared constants.
- Keep row-to-domain normalization in one helper per module.
- Let services own business rules; let repositories own persistence.

### Module Imports

- Import from module barrels (`~/modules/X`) not sub-paths (`~/modules/X/service`). Each module's `index.ts` defines its public API.

### Schema And Database Modeling

- Keep runtime schemas, persisted JSON structures, and TypeScript types aligned.
- Extend existing types from `src/lib/db/schema/tables.ts` or module `schemas.ts` instead of cloning shapes.
- Always use `timestamp({ withTimezone: true })` for all timestamp columns; never use bare `timestamp()`.
- Date values stored inside JSONB columns must always be ISO 8601 UTC strings (e.g. `"2024-01-15T12:00:00.000Z"`). Use `dayjs().toISOString()` or `z.iso.datetime()` validation to enforce this.

### Async Processing (BullMQ)

The backend uses BullMQ with Redis for background jobs. Infrastructure lives in `src/lib/queue/` and `src/lib/sandbox/`.

- **Queues**: `media`, `events`, `sandbox`. Created in `src/lib/queue/queues.ts`, accessed via `getQueues()`.
- **Job definitions**: Each module owns its jobs in `src/modules/{module}/jobs.ts` with zod-validated payloads.
- **Workers**: Each module owns its worker in `src/modules/{module}/worker.ts`. A single worker handler can process multiple job types.
- **Dispatching**: `await getQueues().eventsQueue.add(jobName, payload)`. Use deterministic `jobId` values for idempotency where appropriate.
- **Sandbox jobs**: Use parent-child orchestration (`moveToWaitingChildren` + `getChildrenValues`) for multi-step operations like media import.
- **Naming**: Queues are lowercase singular (`"media"`), job names are kebab-case (`"media-import"`).
- **Lifecycle**: `initializeQueues` → `initializeSandboxService` → `initializeWorkers` at startup; graceful shutdown in reverse order (30s timeout). See `src/app/runtime.ts`.

### Testing

- Run `bun run typecheck`, `bun run test`, and `bun run lint` in `apps/app-backend` after changes.
- Write only pure functional tests that don't require external state or side effects.
- Add end-to-end tests in `<root>/tests/src` as appropriate.
- Prefer shared test fixtures in `src/lib/test-fixtures` for repeated test data and mock deps.
- Favor module-specific fixture files; only put truly cross-module primitives in shared helpers.
- Fixtures should return fresh values and support partial overrides; avoid mutable shared state.

### Code Review

After completing meaningful backend work (endpoints, service logic, repository changes, auth, workers, error handling), launch the `backend-code-reviewer` agent before marking tasks complete or creating commits. Skip for trivial changes and pure formatting.

**Workflow:**

1. Ensure all tests pass
2. Launch `backend-code-reviewer` via the Task tool; provide context on what changed and which files
3. Address any issues identified
4. Re-run tests, then mark the task complete
