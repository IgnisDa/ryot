# Kernel Backend Guidelines

## Boundaries

- Routes validate request data and call one service handler. Services own business rules and access control; repositories own persistence and row normalization.
- Define services and repositories as Effect service classes and provide dependencies through layers.
- Do not add barrel exports. Import from the defining module.
- Each table has one writing repository. Cross-module writes go through the owning service, except repository access required for one shared transaction.
- Importers, jobs, sandbox callbacks, bootstrap code, and HTTP handlers use the same write paths.
- Modules depend only on more generic modules. Invert upward effects through a generic `DurableQueue` hook, its worker, and layer wiring.
- Provider search, resolution, details, and population use sandbox provider scripts. Source connectors may fetch user data but must not call provider enrichment APIs.
- Resolve foreign identifiers through sandbox resolve operations; pass provider-native identifiers only as resolved inputs.
- Follow `packages/contract/AGENTS.md` for HTTP boundary changes.

## Persistence

- Keep runtime schemas, persisted JSON, and TypeScript types aligned. Store timezone-aware timestamps and emit ISO 8601 UTC dates.
- Validate schema-backed entity, event, and relationship properties before writes.
- Services set transaction boundaries; repositories use the active executor from context.
- Lifecycle planning may invert module dependencies through the generic `LifecyclePlanner` transaction-scoped persistence port. Source writes, immutable triggers, recipients, and pinned runs share the caller's transaction; the port must not execute sandbox code or start workflows. Start execution only after commit.
- The backup restore writer is the only kernel production caller allowed to use repository restore methods. The architecture check enforces this historical-write boundary; runtime callers use owning services.
- Never hold a transaction across sandbox execution, network I/O, workflow boundaries, sleeps, or fan-out.
- Provider population composes the import workflow. External event creation runs before-stage policy hooks, then plans pinned after-hook runs in the committing transaction.

## Durable Work

- One workflow or durable-queue worker owns each durable business operation; other workflows compose that owner.
- Activities never start workflows or durable queues. Workflow bodies dispatch them.
- Derive child `executionId` values deterministically from the parent; random IDs can create children on replay.
- Durable owners remain idempotent because ownership does not guarantee single-flight execution.
- Background work uses the workflow engine, durable queues, and durable deferred signals; do not add another job queue.

## Infrastructure

- Centralize Redis keys, channels, codecs, and parsing in Redis infrastructure.
- Keep sandbox and client-plugin compiler engines separate. They may share `@ryot-app/typescript-compiler` and server process supervision, but not policies, limits, protocols, output models, or public APIs.
- Sandbox runtime: `src/lib/infrastructure/sandbox-runtime/README.md`.
- Entity interest: `src/modules/entity-interest/README.md`.
- Authentication and proxy rules: `src/modules/auth/README.md`.
- Public and service-owned event creates await `EventCreateWorkflow`; callers that use `discard: true` must poll for results.
- Assert typed Effect failures with `assertExitFails` from `src/lib/test-utils/assertions.ts`; structural `Exit.fail` equality omits error messages.
- `global-setup.ts` provisions one PostgreSQL for the whole run, reusing an externally supplied `TEST_DATABASE_URL` when present, and hands it to suites through vitest `provide`/`inject`. Database-backed suites read it with `testDatabaseUrl` and isolate themselves in a throwaway schema or database; they never skip when it is absent.
