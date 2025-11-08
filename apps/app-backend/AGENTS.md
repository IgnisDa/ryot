# App Backend Guidelines

## Return Types

Remove explicit return type annotations when TypeScript can trivially infer them. Keep them when:

- **Discriminated union narrowing**: Functions returning a discriminated union (e.g. `AppSchema`, `AppPropertyDefinition`) need the explicit return type since TS widens string literal `type` discriminants to `string`.
- **Contextual parameter inference**: object literal methods passed to `Effect.Service`'s `sync` need the shape type return if method parameters rely on contextual typing.
- **`as const` preservation**: Use `as const` on return values instead of an explicit type to preserve literal types for nested objects (e.g. `sort.direction: "asc"` in `buildDefaultQueryDefinition`).
- **Effect type inference**: Functions returning `Effect.Effect<A, E, R>` need explicit annotation when the return contains both `Effect.fail(E)` and `Effect.succeed(A)` branches, as the inferred union breaks `.pipe(Effect.flatMap(...))` inference.
- **Type predicates**: Keep `value is X` return types — they are not inferrable. Omit `X` on `as X` assertions.
- **Array factory functions**: Factory functions returning arrays of objects with different optional fields (e.g. `builtinSavedViews`, `builtinRelationshipSchemas`) need the explicit return type to prevent the union element type from widening optional fields to `undefined`.
- **`satisfies`**: Prefer `satisfies T` over a trailing return type when only the return value (not all callers) needs the constraint.

## Testing

- `bun test` does not work in this app. Use `bun run test` instead.

## Runtime APIs And Diagnostics

- Prefer Effect platform primitives over `node:*` imports in app-backend code. Use Bun APIs when Effect has no suitable primitive. Use Node built-ins only when neither Effect nor Bun provides a practical equivalent, and keep the reason local and explicit.
- Prefer Effect exception-capture primitives over raw `try/catch` in app-backend TypeScript. Use `Effect.try` / `Effect.tryPromise` when the surrounding API is already Effect-based, and `Either.try` for synchronous parsing or row-level fallback logic. Sandbox scripts are the exception when they need direct host-style error handling.
- Do not add `@effect-diagnostics` or `oxlint-disable` comments by default. Prefer typed Effect errors, Effect Schema decoding/encoding, promise-returning callbacks, and small pure helpers that satisfy the diagnostics. If a suppression is unavoidable, keep it narrowly scoped and explain why the API cannot be expressed cleanly.

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
- Provider-backed global population inside background flows should compose the entity import workflow or its workflow-friendly helpers; do not reintroduce direct sandbox details helpers outside workflow orchestration.
- Create user-owned `in-library` relationships through `modules/entities: ensureEntityInLibrary`.
- External event creation goes through event APIs that also dispatch event-schema triggers, such as `createEventsWithTriggers` or `createEventsBestEffortWithTriggers`.
- Collection membership creation goes through `modules/collections: addToCollection`.
- Generic relationship writes go through `writeRelationship` or `writeEntityRelationship`; collection membership validation belongs in `addToCollection`.
- Repository-level write primitives must not be exported through module barrels for runtime callers.
- `modules/legacy-bootstrap` is the migration-only exception to runtime write-path rules.
- Use `AppSchema.unknownKeys: "passthrough"` only when relationship or collection property schemas must accept arbitrary top-level keys.
- Keep collection properties and person/company relationship properties aligned with their built-in schemas.
