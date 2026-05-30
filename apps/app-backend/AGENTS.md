# App Backend Guidelines

> Inherits from root `AGENTS.md`. Keep this file limited to backend-specific rules.

## Module Boundaries

- Routes stay thin: validate request data via `HttpApiBuilder`, call services, and return direct values or typed tagged errors.
- Define HTTP routes with `HttpApiBuilder.group` and wire handlers per endpoint.
- Services own business rules and return `Effect.Effect<A, E, R>` with typed errors. No legacy `ServiceResult` wrappers.
- Repositories own persistence and row-to-domain normalization only. They return `Effect`s and use `CurrentDb` for the active executor.
- Use `Effect.Service` classes for services and repositories. Dependencies are provided through Layer composition, not `deps` parameters.
- Access control lives in services as pure helpers or direct checks after loading the smallest resource scope.

## Cross-Module Infrastructure

- Modules must reuse the owning module's service or intentionally-internal infrastructure for cross-module side effects; do not write another module's schema tables directly.
- Importers, background jobs, sandbox callbacks, and bootstrap paths follow the same entity, event, relationship, and collection write paths as HTTP modules.
- Provider API knowledge belongs in sandbox scripts, not app modules. App modules can normalize source input and choose provider fallback policy, but provider-specific HTTP stays in sandbox drivers.
- If app code only has a foreign identifier such as an ISBN or IMDB id, resolve it through sandbox `resolve` drivers before provider-backed population.
- If app code already has a provider-native identifier such as a TMDB id or Hardcover id, pass it as a resolved provider ref/input directly.

## Validation And Persistence

- Runtime schemas, persisted JSON structures, and TypeScript types must stay aligned.
- Reusable request/response schemas belong in module `schemas.ts` files.
- Drizzle schema timestamps must use `timestamp({ withTimezone: true })`.
- Persist JSONB date values as ISO 8601 UTC strings.
- Use Effect Schema for all HTTP payloads, service boundaries, and domain types. Zod is not used in application code.

## Transactions

- `TransactionRunner` runs an Effect inside a PostgreSQL transaction. Services depend on it directly and choose the transaction boundary.
- Repository effects read the active executor from `CurrentDb`. `TransactionRunner` replaces `CurrentDb` with the transaction executor.
- Expected Effect failures throw an internal rollback sentinel through Drizzle. After rollback, the original typed failure is restored.
- Do not hold a transaction across sandbox execution, HTTP calls, durable workflow boundaries, sleeps, or fan-out work.

## Queues

- BullMQ is not used in the new backend. Background work uses Effect Workflow, durable queues, and durable deferred signals.

## Redis

- Centralize all app-defined Redis keys and pub/sub channel names in `src/lib/redis-keys.ts`; do not construct them inline anywhere else in `src/`.
- Access Redis-stored app payloads through the codecs in `src/lib/redis-keys.ts` so serialization and parsing stay typed in one place.

## Schema Write Path

- `entity`, `event`, and `relationship` writes must validate `properties` against the matching schema table's `propertiesSchema`.
- User-owned entity creation goes through `modules/entities: createEntity`.
- Provider-backed global population goes through `modules/entities/population: populateGlobalEntity` and is populate-only: it may write global entities and provider-related global relationships, but not user library membership.
- Create user-owned `in-library` relationships through `modules/entities: ensureEntityInLibrary`.
- External event creation goes through event APIs that also dispatch event-schema triggers, such as `createEventsWithTriggers` or `createEventsBestEffortWithTriggers`.
- Collection membership creation goes through `modules/collections: addToCollection`.
- Generic relationship writes go through `writeRelationship` or `writeEntityRelationship`; collection membership validation belongs in `addToCollection`.
- Repository-level write primitives must not be exported through module barrels for runtime callers.
- `modules/legacy-bootstrap` is the migration-only exception to runtime write-path rules.
- Use `AppSchema.unknownKeys: "passthrough"` only when relationship or collection property schemas must accept arbitrary top-level keys.
- Keep collection properties and person/company relationship properties aligned with their built-in schemas.
