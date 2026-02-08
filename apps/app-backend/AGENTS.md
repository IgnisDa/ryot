# App Backend Guidelines

> Inherits from root `AGENTS.md`. Rules below are additive.

## Product Context

The backend powers a self-hosted personal tracking product. Favor explicit validation, stable contracts, and small composable helpers over clever implicit behavior.

## Engineering Guardrails

### Type Safety

- Treat module `schemas.ts` files as the source of truth; derive all TypeScript types from them.
- OpenAPI types at `libs/generated/src/openapi/app-backend.d.ts` are auto-generated in development.

### Validation

- Put reusable schemas in module `schemas.ts` files.
- Use `resolveValidationData` (`src/lib/openapi.ts`) instead of ad hoc `try/catch` 400 responses.

### Routes And OpenAPI

- Routes should be thin: parse input, check access, call service/repo, return response.
- Define routes with `createAuthRoute` (`src/lib/openapi.ts`).
- Response helpers (`createSuccessResult`, `createServiceErrorResult`, `createStandardResponses`, etc.) live in `src/lib/openapi.ts`. Use them — do not construct ad hoc JSON error responses.

### Error Handling

- Services return `ServiceResult<T, E>` (`src/lib/result.ts`): `{ data: T }` or `{ error: E, message: string }`. Use `serviceError` to construct errors.
- Access checks (`checkAccess`, `checkReadAccess`, `checkCustomAccess`) live in `src/lib/access/index.ts`.

### Repositories And Drizzle

- Centralize repeated Drizzle projections into shared constants.
- Keep row-to-domain normalization in one helper per module.
- Services own business rules; repositories own persistence.

### Module Imports

- Import from module barrels (`~/modules/X`) not sub-paths (`~/modules/X/service`).

### Schema And Database Modeling

- Keep runtime schemas, persisted JSON structures, and TypeScript types aligned.
- Extend existing types from `src/lib/db/schema/tables.ts` or module `schemas.ts` instead of cloning shapes.
- Always use `timestamp({ withTimezone: true })`; never bare `timestamp()`.
- JSONB date values must be ISO 8601 UTC strings. Use `dayjs().toISOString()`.

### Async Processing (BullMQ)

BullMQ with Redis. Infrastructure in `src/lib/queue/` and `src/lib/sandbox/`.

- **Queues**: `media`, `events`, `sandbox` in `src/lib/queue/queues.ts`, accessed via `getQueues()`.
- **Jobs**: Each module owns jobs (`src/modules/{module}/jobs.ts`) and workers (`src/modules/{module}/worker.ts`).
- **Dispatching**: `await getQueues().eventsQueue.add(jobName, payload)`. Use deterministic `jobId` for idempotency.
- **Naming**: Queues lowercase singular (`"media"`), jobs kebab-case (`"media-import"`).
- **Lifecycle**: `initializeQueues` → `initializeSandboxService` → `initializeWorkers` at startup; reverse on shutdown (30s timeout). See `src/app/runtime.ts`.

### Testing

- Run `bun run typecheck`, `bun run test`, and `bun run lint` after changes.
- Write pure functional tests; no external state or side effects.
- E2E tests go in `<root>/tests/src`.
- Shared fixtures in `src/lib/test-fixtures`. Module-specific fixtures preferred; cross-module primitives only in shared helpers.

### Code Review

After meaningful backend work, launch `backend-code-reviewer` via the Task tool before committing. Skip for trivial changes. Ensure tests pass before and after review.
