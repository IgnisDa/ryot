# App Backend Guidelines

> Inherits from root `AGENTS.md`. Keep this file limited to backend-specific rules.

## Module Boundaries

- Routes stay thin: validate request data, check access, call services, and return OpenAPI helper responses.
- Define HTTP routes with `createAuthRoute` from `src/lib/auth`.
- Use response helpers from `src/lib/openapi.ts`; do not hand-roll JSON error envelopes.
- Services own business rules and return `ServiceResult<T, E>` for expected errors.
- Repositories own persistence and row-to-domain normalization only.
- Use `checkAccess`, `checkReadAccess`, or `checkCustomAccess` from `src/lib/access` for access decisions.
- Use module barrels for cross-module public service APIs. Use subpaths only for route mounting, same-module internals, tests, or intentionally internal infrastructure.

## Validation And Persistence

- Runtime schemas, persisted JSON structures, and TypeScript types must stay aligned.
- Reusable request/response schemas belong in module `schemas.ts` files.
- Use `resolveValidationData` from `src/lib/openapi.ts` when a route must manually parse data outside `c.req.valid(...)`.
- Drizzle schema timestamps must use `timestamp({ withTimezone: true })`.
- Persist JSONB date values as ISO 8601 UTC strings, usually via `dayjs().toISOString()`.

## Queues

- BullMQ queues are `event`, `entity`, `import`, and `sandbox`; access them through `getQueues()`.
- Module jobs live in `src/modules/{module}/jobs.ts`; workers live in `src/modules/{module}/worker.ts`.
- Job names are kebab-case. Queue names are lowercase singular.
- Use deterministic `jobId` only when a job is intended to be idempotent.
- After migrations, runtime startup initializes Redis, queues, sandbox service, workers, then built-in entity preload dispatch. Shutdown closes workers before queues, sandbox, and Redis.

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
