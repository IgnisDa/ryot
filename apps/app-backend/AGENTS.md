# App Backend Guidelines

## Effect And Types

- Keep explicit return types only for predicates or when inference widens literals, Effect unions, callback parameters, or heterogeneous arrays. Prefer `as const` and `satisfies` over trailing annotations.
- Prefer Effect platform primitives, then Bun APIs, then Bun built-ins. Keep any lower-level choice justified locally.
- Use `Effect.tryPromise` or `Effect.try` instead of raw `try`/`catch`; sandbox scripts may use host-style handling.
- Avoid diagnostic and lint suppressions. Scope and explain unavoidable suppressions.
- Assert typed failures with `assertExitFails` from `src/lib/test-utils/assertions.ts`; structural `Exit.fail` equality misses error messages.

## Module Boundaries

- Routes stay thin: validate request data, call a service, and return direct values or typed tagged errors. Define one handler per endpoint.
- Services own business rules and return effects with typed errors.
- Repositories own persistence and row-to-domain normalization only. They return effects and read the active database executor from shared context.
- Define services and repositories as Effect service classes; provide dependencies through layer composition, not hand-passed dependency parameters.
- Access control lives in services, as pure helpers or direct checks after loading the smallest resource scope.
- Do not add barrel re-exports in app-backend; import from the defining module directly.
- Follow `packages/contract/AGENTS.md` for HTTP boundary ownership and endpoint changes.
- Modules may depend only on more generic modules. Invert upward side effects through a generic `DurableQueue` hook, a specific worker, and layer wiring.
- Every table has exactly one owning repository that performs its writes; every other consumer routes through that repository, and service code never issues raw table writes.
- Cross-module side effects go through the owning module's service and never write another module's tables directly. Reach into another module's repository only when atomicity within one shared transaction requires it, and only to write tables that module owns.
- Importers, background jobs, sandbox callbacks, and bootstrap paths use the same write paths as HTTP request handling.
- Provider catalog search, resolution, details, and population use sandbox provider scripts. Source-ingestion connectors may fetch user data but must not enrich it through provider APIs directly.
- Resolve foreign identifiers through a sandbox resolve operation; pass provider-native identifiers through as resolved inputs.

## Persistence And Transactions

- Keep runtime schemas, persisted JSON, and TypeScript types aligned. Use timezone-aware database timestamps and ISO 8601 UTC JSON dates.
- Validate schema-backed entity, event, and relationship properties before writing. Allow arbitrary top-level keys only for genuine passthrough schemas.
- Services choose transaction boundaries; repositories use the active executor from context.
- Do not hold a transaction across sandbox execution, network calls, durable workflow boundaries, sleeps, or fan-out work.
- Provider-backed population composes the import workflow. External event creation evaluates automation policies and dispatches lifecycle subscriptions.
- Migration and `legacy-bootstrap` code are the only exceptions to normal write paths.

## Durable Work

- Every durable business operation has one owning workflow or durable-queue worker. Other workflows compose that owner.
- Parent workflows are orchestration shells. Cron ticks and multi-stage pipelines fan out to feature-owned child workflows instead of inlining another feature's activities.
- Use a durable-queue worker when dependency inversion requires it; otherwise prefer a workflow.
- Activities never start workflows or durable queues, directly or through service calls. Dispatch from workflow bodies.
- Child workflow `executionId` values must be deterministic and derived from the parent; random IDs can spawn children on every replay.
- Durable owners must be idempotent because ownership does not guarantee single-flight execution.
- Do not introduce a third-party job-queue library. Background work uses the durable workflow engine, durable queues, and durable deferred signals.
- See `docs/effect-workflow-guide.md` for mechanics and ownership details.

## Shared Infrastructure

- Centralize Redis keys, channel names, payload codecs, and parsing in the Redis infrastructure module.
- Sandbox scripts enter through plugin or kernel source-zero ingestion; see `src/lib/infrastructure/sandbox-runtime/README.md`.
- Follow `src/modules/entity-interest/README.md` for entity read, population, translation, and interest semantics.
- Public and service-owned event creates await `EventCreateWorkflow`. Callers using `discard: true` must poll to observe results.
