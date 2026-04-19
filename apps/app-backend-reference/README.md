# Ryot Effect Backend Reference

`apps/app-backend-reference` is the runnable pattern source for migrating `apps/app-backend` to Effect.

The migration is a **full rewrite** — Effect is not being layered onto existing code incrementally. Each module will be rewritten from scratch using Effect primitives, with this reference as the pattern authority for every seam: services, layers, HTTP contracts, repositories, transactions, workflows, sandbox execution, and schema definitions. The app stays intentionally small; its purpose is to prove patterns, not to build a production-complete service.

The sample domain is an Audible sync backend that matches the real backend architecture:

- provider-specific HTTP and parsing live inside sandbox scripts
- app code owns auth, routing, workflow orchestration, persistence, and uploads
- file uploads feed durable background work

## What It Demonstrates

- `HttpApi` contracts shared with `HttpApiClient` across a package boundary
- Better Auth bridged into Effect without an Effect-native adapter
- `Effect.Service` classes replacing the `Context.Tag` + separate `*Live` layer pattern
- Drizzle repositories wrapped in services and layers, returning `Effect`s
- Redis-backed coordination for notifications and sandbox bridge sessions (not a queue backend)
- PostgreSQL-backed `@effect/workflow` orchestration
- `DurableQueue` workers for sandbox execution
- `DurableDeferred` signals for externally completed workflow events
- a Deno sandbox bridge with slug-based builtin scripts, with subprocess lifecycle managed through Effect
- `.txt` uploads that feed background workflows
- pure Effect access-control helpers for service-local authorization
- short Drizzle transactions with typed Effect failures preserved through rollback
- PostgreSQL constraint metadata mapped to domain errors at the repository boundary
- recursive Effect Schema (`Schema.suspend`) with correct OpenAPI `$ref` output, replacing `z.lazy` from Zod

## Main Flows

### Audible run from query

1. Sign in.
2. `POST /api/audible/runs` with `{ query }`.
3. The backend starts a durable workflow.
4. The workflow runs the builtin sandbox script `audiobook.audible` with the `search` driver.
5. The top Audible match is then fetched with the `details` driver.
6. The parent workflow persists the import preview and waits for confirmation.
7. `POST /api/audible/runs/:runId/confirm-import` completes the durable confirmation signal.
8. The workflow writes the final summary and publishes a Redis notification.
9. The user polls status through the shared `HttpApiClient` contract.

### Audible run from uploaded file

1. Upload a `.txt` file to `POST /api/uploads/temporary`.
2. Each non-empty line is treated as an Audible query.
3. `POST /api/audible/runs` with `{ uploadId }`.
4. The workflow reads the file with `FileSystem`, fans out one child workflow per query, persists the import preview, waits for confirmation, then finalizes the run.

### Direct sandbox demo

`POST /api/sandbox/run` is slug-based only. The direct demo runs the same `audiobook.audible` builtin script used by the workflow and supports the `search` and `details` drivers.

### Patterns demo

`POST /api/patterns/db-transaction` writes one `audible_run` row and one `workflow_step` row inside a `TransactionRunner` session. With `{ mode: "commit" }`, both rows commit. With `{ mode: "rollback" }`, both rows roll back and the endpoint returns the typed `PatternsRejected` error instead of collapsing the failure into `DbError`.

`POST /api/patterns/unique-constraint` reuses `audible_run` and `audible_item` to demonstrate PostgreSQL constraint handling. A duplicate insert against `reference_audible_item_run_query_idx` is first normalized to `DbError` with structured pg metadata, then translated by the repository to `PatternsDuplicateItem`, which the contract exposes as `409 Conflict`. The typed domain failure rolls the transaction back without leaking the raw constraint name through the service layer.

`POST /api/patterns/filter-condition` demonstrates recursive Effect Schema. The payload carries a `FilterCondition` — a self-recursive discriminated union with five variants (`and`, `or`, `not`, `contains`, `equals`) keyed on `kind`. The `HttpApiBuilder` decode step validates the full nested tree at request time. The schema appears in the generated OpenAPI spec as a single named `$ref` rather than an inlined recursive definition. This is the proven replacement pattern for `z.lazy` from Zod.

## API Surface

All API routes are mounted under `/api` to mirror the real backend. The contract paths themselves stay unprefixed. The seed script constructs its typed client with `baseUrl: "http://localhost:3000/api"`.

### Audible runs

- `GET /api/audible/runs`
- `POST /api/audible/runs`
- `GET /api/audible/runs/:runId`
- `POST /api/audible/runs/:runId/confirm-import`

`POST /api/audible/runs` accepts exactly one of:

```ts
{
  query?: string;
  uploadId?: string;
}
```

### Sandbox

- `POST /api/sandbox/run`
- `GET /api/sandbox/run/:runId`

Sandbox execution is slug-based only:

```ts
{
  scriptSlug: "audiobook.audible";
  driverName: "search" | "details";
  context?: unknown;
}
```

### Uploads

- `POST /api/uploads/temporary`

Uploads are `.txt` files only. Each non-empty line becomes one Audible query.

### Patterns demo

- `POST /api/patterns/db-transaction`
- `POST /api/patterns/unique-constraint`
- `POST /api/patterns/filter-condition`

```ts
{
	mode: "commit" | "rollback";
}
```

```ts
{
	query: string;
	duplicate: boolean;
}
```

These endpoints are authenticated user-only and exist only to demonstrate `TransactionRunner`, constraint mapping, and recursive schema on existing tables.

### Auth and docs

- `/api/auth/*`
- `/api/docs` — interactive Scalar OpenAPI documentation

## Access Control Design

Authentication and authorization stay separate.

`AuthMiddleware` proves who the caller is and provides `CurrentUser`. Services then load the smallest resource scope they need and pass that scope through `requireAccess`, `requireReadAccess`, or `requireCustomAccess` from `src/lib/access.ts`.

The helper is intentionally pure. It is not a service and has no Layer because it does not own I/O. Callers provide the exact domain error to raise, so route contracts stay precise.

Migration rules:

- missing scopes and cross-user scopes should usually fail with the same not-found error to avoid leaking resource existence
- custom ownership or permission checks belong in `requireAccess` rules
- built-in resource mutation checks use `requireCustomAccess` and map to the module's mutation error, usually `ValidationError`
- repositories may query user-scoped rows, but services remain responsible for deciding whether the returned scope is usable for the current operation

The sandbox `GET /api/sandbox/run/:runId` endpoint demonstrates the ownership rule: the row is loaded by id, then a rule checks `row.userId === user.id`; both a missing row and an owned-by-someone-else row return the same not-found error.

## Transaction Design

Short PostgreSQL transactions stay separate from durable workflows.

`TransactionRunner` is a `Context.Tag` service in `src/lib/db.ts` that runs an Effect inside a PostgreSQL transaction. Services depend on it directly, keeping the transaction boundary injectable and unit-testable without faking Drizzle's complex db type.

- repository effects read the active executor from `CurrentDb`
- `TransactionRunner` runs the effect with `CurrentDb` replaced by the transaction executor
- services choose the transaction boundary instead of threading `database?: DbClient` through each repository call
- expected Effect failures throw an internal rollback sentinel through Drizzle
- after Drizzle rolls back, the original typed failure is restored with `Effect.failCause`
- unexpected database or driver failures still become `DbError`

The demo deliberately does not hold a transaction across sandbox execution, HTTP calls, durable workflow boundaries, sleeps, or fan-out work. Those remain workflow concerns.

### Constraint handling

`DbError` preserves structured PostgreSQL metadata (`code`, `constraint`, `table`, and `column`) when `dbEffect` catches a driver failure. Repositories use that metadata to translate known persistence constraints into domain errors. Services should not inspect raw PostgreSQL constraint names.

`POST /api/patterns/unique-constraint` demonstrates this with existing tables. The endpoint creates an `audible_run` row, then inserts into `audible_item`. When asked to insert the same `query` twice for one run, the `reference_audible_item_run_query_idx` unique index raises PostgreSQL `23505`. The repository maps that `DbError` to `PatternsDuplicateItem`; the contract exposes it as `409 Conflict`; `TransactionRunner` rolls back both the run and first item insert while preserving the typed domain failure.

Migration rules:

- preserve database metadata at the DB boundary
- translate expected named constraints in repositories
- expose domain errors, not constraint names, from services
- let unexpected constraints remain `DbError` so they surface as internal errors
- prefer `onConflict...` for expected idempotent flows that can stay in SQL

## Workflow Design

### Top-level workflow

`ProcessAudibleRunWorkflow` is the parent durable workflow.

Responsibilities:

1. Load the run row.
2. If `uploadId` is present, read and parse the uploaded query file through an activity.
3. Mark the run `processing`.
4. Fan out one child workflow per query.
5. Wait for all child workflow results.
6. Persist the import preview rows.
7. Store a `DurableDeferred` token and mark the run `awaiting_confirmation`.
8. Race the durable confirmation signal against a durable timeout.
9. If confirmed, persist the final result and publish a Redis completion notification.
10. If the timeout wins, mark the run `expired` and leave the preview rows for inspection.

### Child workflow

`ResolveAudibleQueryWorkflow` handles exactly one query.

Responsibilities:

1. Run `audiobook.audible` with driver `search`.
2. Take the top match if one exists.
3. Run the same script with driver `details` for the matched ASIN.
4. Return the resolved import item to the parent workflow.

This preserves the real backend pattern: app code chooses the script and driver, while provider HTTP stays in the script.

### Import confirmation signal

`AudibleImportConfirmationSignal` demonstrates the Effect replacement for BullMQ waits such as `job.waitUntilFinished(queueEvents, timeout)`:

- the workflow creates a `DurableDeferred` token after it has persisted the import preview
- the token is stored on `audible_run.confirmationToken`
- the workflow waits with `DurableDeferred.raceAll`
- one branch awaits `DurableDeferred.await(AudibleImportConfirmationSignal)`
- the other branch uses `DurableClock.sleep` for the timeout
- the HTTP confirmation endpoint loads the stored token and calls `DurableDeferred.succeed`

This is intentionally durable. The app can restart while the run is awaiting confirmation; the workflow resumes after either the signal is completed or the durable timeout fires. Do not model this with an in-memory `Deferred`, a raw promise, Redis pub/sub alone, or a database transaction held open across the wait.

### Tagged result matching

Workflow branches that produce tagged union results should use `Schema.TaggedStruct` for each variant and `Match.value(...).pipe(Match.tag(...), Match.exhaustive)` to consume the result.

`ProcessAudibleRunWorkflow` uses this pattern for the confirmation race result: `confirmed` continues to final persistence, while `timed_out` marks the run `expired`. This keeps branching exhaustive and avoids direct `_tag` checks in application code.

### BullMQ import mapping

The real backend's BullMQ import pattern maps to this reference shape:

- parent BullMQ job -> `ProcessAudibleRunWorkflow`
- child sandbox jobs -> `ResolveAudibleQueryWorkflow` plus `AudibleSandboxQueue`
- `moveToWaitingChildren()` -> awaiting child workflow executions in `Effect.forEach`
- child return values -> the `items` array returned by the child workflow executions
- `getChildrenValues()` -> normal typed workflow results from the awaited child executions
- `waitUntilFinished(queueEvents, timeout)` -> `DurableDeferred.raceAll` over a signal and `DurableClock.sleep`
- BullMQ progress data -> durable `workflow_step` rows

## Activity Design

`ReadUploadedQueries` is the file-backed activity.

Responsibilities:

1. Load the upload row with an ownership check.
2. Read the file from disk with `FileSystem`.
3. Split by newline.
4. Trim empty lines.
5. Fail if no valid queries remain.

This is the minimal faithful upload-consumption pattern from the main backend: upload first, then background work claims and processes the persisted file.

## Sandbox Design

### Builtin scripts

Builtin scripts live in `src/lib/builtin-scripts.ts`. The reference app currently ships one script:

- `audiobook.audible`

It supports the `search` and `details` drivers. Locale is intentionally hardcoded to US for the sample app.

### Host functions

The host exposes only generic infrastructure:

- `httpCall`
- `getCachedValue`
- `setCachedValue`

This mirrors `app-backend` and avoids leaking provider-specific behavior back into app services.

### Direct sandbox demo

The direct sandbox module exists to prove that the slug-based execution path is shared by both user-triggered demo requests and workflow-triggered provider jobs.

## Upload Story

Uploads are meaningful in this app. They are not a detached multipart example anymore. The end-to-end flow:

1. User uploads `queries.txt`.
2. Upload metadata is persisted in PostgreSQL.
3. User creates an Audible run with `uploadId`.
4. The workflow reads the file and fans out one child workflow per line.

This demonstrates the real file-import shape from `app-backend` without pulling in the whole imports module.

## Data Model

The app owns these application tables:

- `audible_run`
- `audible_item`
- `workflow_step`
- `sandbox_run`
- `upload`
- `audible_schedule`
- Better Auth tables (`user`, `session`, `account`, `verification`)

### `audible_run`

Stores one top-level user run with:

- `query` for direct single-query runs
- `uploadId` for batch runs
- `status`
- `executionId`
- `confirmationToken`
- `finalResult`

### `audible_item`

Stores one resolved result per query with:

- original `query`
- matched `asin`
- `title`
- `author`
- `status` (`matched` or `not_found`)
- raw `details` payload from the sandbox result

It also has `reference_audible_item_run_query_idx`, a unique index on `(runId, query)`. The transaction demo intentionally reuses that index to show where PostgreSQL constraint details are converted into domain errors.

### `workflow_step`

Replaces BullMQ `job.data` progress snapshots with durable user-facing progress rows keyed by `runId`.

## Seed Script

`seed-script.ts` should verify all core paths:

1. Sign up and sign in.
2. Create one query-based Audible run.
3. Upload a `.txt` file with multiple queries.
4. Create one upload-based Audible run.
5. Poll both runs until they are awaiting confirmation.
6. Confirm both imports through the typed contract endpoint.
7. Poll both runs until complete.
8. Execute a direct sandbox `search` run by script slug.
9. Print a JSON summary and exit successfully.

## E2E Test Client Migration

The `tests/` package should move from the generated `openapi-fetch` client to the Effect `HttpApiClient` pattern shown in `seed-script.ts`. Test churn is acceptable: call sites can change from `client.POST("/entities", ...)` to contract-shaped calls such as `client.entities.create(...)`.

The test intent should stay the same. Preserve the existing scenarios, fixtures, setup, polling behavior, and assertions, while changing only the HTTP client boundary and helper shape needed to call the Effect contract.

Use `HttpApiClient` for contract-valid backend requests. Keep low-level `fetch` helpers for requests that intentionally sit outside the contract, such as Better Auth endpoints, malformed payloads, invalid multipart bodies, missing or wrong auth headers, and admin/API-key edge cases.

## Schema Library Migration

Zod will be fully removed from `apps/app-backend` application code. Effect Schema (`Schema` from `effect`) replaces it everywhere: HTTP payloads, service boundaries, domain types, repository decode calls, and stored JSONB structures.

**Sandbox scripts are the only exception.** Scripts run inside the Deno sandbox and are intentionally isolated from the host's runtime dependencies. They may continue using Zod for any internal validation they need.

Migration rules:

- Replace `z.lazy` with `Schema.suspend`. The suspended schema must carry an `identifier` annotation (`Schema.annotations({ identifier: "..." })`) so the OpenAPI generator can emit `$ref` instead of attempting to inline a recursive definition.
- Declare recursive TypeScript types as explicit `type` aliases or `interface` declarations. `Schema.Schema.Type` cannot resolve self-referential types, just as `z.infer` cannot without an explicit `z.ZodType<T>` annotation.
- Replace `z.discriminatedUnion("key", [...])` with `Schema.Union(...)` over structs that each contain a matching `Schema.Literal` field. Effect Schema applies the same discriminant fast-path automatically.
- Keep `Schema.TaggedError` for typed domain errors and `Schema.Union` for multi-error workflow payloads — these have no Zod equivalent and are already the established pattern in this reference.
- `POST /api/patterns/filter-condition` is the runnable proof: a five-variant self-recursive discriminated union (`kind` field) parsed and served through `HttpApiBuilder`, with a correct `$ref` in the generated OpenAPI spec.

## Service Layer Migration

The `ServiceResult<T, E>` pattern (`serviceData` / `serviceError`) from `apps/app-backend` is a legacy pattern. It will **not** be migrated incrementally and will **not** be wrapped into `Effect`.

During the rewrite, every service module is rewritten from scratch using Effect primitives:

- `Effect<A, E, R>` replaces `ServiceResult<T, E>` entirely.
- `Schema.TaggedError` replaces the string-discriminated `{ error: E; message: string }` union.
- Services are defined as `Context.Tag` interfaces with `Effect.Effect` signatures, not as plain async functions returning unions.
- There is no transitional wrapper that turns `ServiceResult` into `Effect`. The old service file is deleted and a new one is written.

Why this matters: `ServiceResult` forces callers to branch on an `error` key at every call site, which Effect's typed failure channel (`Effect.fail`) eliminates. Keeping `ServiceResult` as an intermediate layer would defeat the purpose of the migration and would create a hybrid code style that is harder to maintain than either the old or the new approach.

Migration rule: if a service file still imports `serviceData` or `serviceError`, it has not been rewritten.

### Dependency Injection

The `deps` parameter pattern used in `apps/app-backend` (e.g., `async function fn(input, deps = defaultDeps)`) is also a legacy pattern. It will **not** be preserved or wrapped.

Cross-module dependencies are expressed through `Effect.Service` and Effect's layer system:

- Each repository and service is declared as an `Effect.Service` class, which simultaneously defines the `Context.Tag` (for yielding the service) and the default `Layer` (via the `.Default` static property).
- Dependencies are declared in the `R` channel of `Effect.Effect<A, E, R>`.
- Callers provide dependencies through `Layer.provide` rather than through explicit function parameters.
- There is no transitional wrapper that injects `deps` objects into `Effect` programs.

Each repository and service is declared as a single `Effect.Service` class. The class is simultaneously the `Context.Tag` (yielded with `yield*`) and the source of its default `Layer` (via the `.Default` static property used in `Layer.provide`).

`Effect.Service` supports four implementation modes:

| Mode       | Replaces                     | When to use                               |
| ---------- | ---------------------------- | ----------------------------------------- |
| `effect:`  | `Layer.effect`               | Effectful construction with dependencies  |
| `scoped:`  | `Layer.scoped`               | Resource with acquire/release lifecycle   |
| `sync:`    | `Layer.succeed` with factory | Synchronous construction, no dependencies |
| `succeed:` | `Layer.succeed` with value   | Static value                              |

The `dependencies:` option on `Effect.Service` lets a service pre-bundle its internal sub-services into its own `.Default` layer, removing the need for callers to list those sub-services separately in `Layer.provide` chains. The sandbox services use this pattern: `ProcessPool` bundles `BridgeService` and `RunnerFile`; `SandboxService` bundles `ProcessPool` and `BridgeService`. `layers.ts` only provides `SandboxService.Default`.

**What is not converted to `Effect.Service`:**

- `HttpApiMiddleware.Tag` subclasses (`AuthMiddleware`, `AdminMiddleware`) — these extend a different base class that carries HTTP security scheme metadata.
- `Layer.scopedDiscard` side-effect layers (`ServerLive`, `SchedulerLive`) — these run forever and produce no service value.
- Ambient per-request context values (`CurrentUser`, `AdminAccess`, `CurrentDb`) — these are injected by middleware or transaction runners, not by a Layer lifecycle.
- `TransactionRunner` — its service type is a generic function, not an object with named methods.
- Workflow/Activity/DurableQueue definitions — these extend Effect Cluster primitives.

Why this matters: the `deps` pattern exists only to enable ad-hoc test-time substitution. `Effect.Service` and `Layer` solve the same problem with a unified, type-safe mechanism that does not require every function to accept a `deps` parameter. Keeping the `deps` pattern would mean maintaining two parallel dependency systems.

Migration rule: if a service file still accepts `deps` as an optional parameter, it has not been rewritten.

## Files That Matter

```text
src/
  contract.ts
  app/
    layers.ts
    server.ts
  lib/
    auth.ts
    builtin-scripts.ts
    config.ts
    db.ts
    errors.ts
    migrate.ts
    redis.ts
    sandbox.ts
    sandbox-runner-source.ts
    scheduler.ts
    schema.ts
    workflow.ts
  modules/
    audible/
      activities.ts
      contract.ts
      durable-queues.ts
      repository.ts
      routes.ts
      schemas.ts
      service.ts
      workflows.ts
    sandbox/
      contract.ts
      routes.ts
      schemas.ts
      service.ts
    uploads/
      contract.ts
      repository.ts
      routes.ts
      schemas.ts
      service.ts
    patterns/
      contract.ts
      repository.ts
      routes.ts
      schemas.ts
      service.ts
```

## How To Run

1. Start PostgreSQL and Redis.
2. Run `bun run dev` from `apps/app-backend-reference`.
3. In another shell, run `bun run seed`.

## Checks

- `bunx tsc --noEmit`
- `bun run test`
- `bun run check`

## Non-Goals

- Recreating the full imports module
- Implementing every Audible-related entity type from the main backend
- Adding locale preferences to the sample app
- Supporting raw sandbox code execution from the HTTP API

The goal is to prove the patterns, not to build a production-complete Audible integration service.

## Notes For Future Agents

- Read the current Effect and workflow docs before changing orchestration code.
- Keep sandbox provider logic in builtin scripts, not app services.
- Keep uploads meaningful by wiring them into workflows, not standalone demos.
- Zod will be fully removed from `apps/app-backend` application code. Use Effect Schema everywhere. Sandbox scripts are the only exception — they run in the Deno sandbox and may keep Zod. See the Schema Library Migration section above for the full migration rules including the `z.lazy` → `Schema.suspend` mapping.
