# App Backend Guidelines

## Return Types

Remove explicit return type annotations when TypeScript can trivially infer them. Keep them when:

- **Discriminated union narrowing**: a function returning a discriminated union needs the explicit type, because TypeScript widens string-literal discriminants to `string`.
- **Contextual parameter inference**: object-literal methods whose parameters rely on contextual typing need an explicit shape return type to recover that inference.
- **`as const` preservation**: prefer `as const` on the returned value over an explicit type to keep nested literal types.
- **Effect inference**: annotate when a function returns an effect with both a failure and a success branch whose inferred union would otherwise break downstream chaining.
- **Type predicates**: keep `value is X` predicate returns — they are not inferrable. Omit the type on `as X` assertions.
- **Array factory functions**: annotate factories returning arrays of objects with differing optional fields, so the element type does not widen optional fields to `undefined`.
- **`satisfies`**: prefer `satisfies T` over a trailing return type when only the value, not every caller, needs the constraint.

## Testing

- Use `bun run test` instead. `bun test` does not work in this app.

## Runtime APIs And Diagnostics

- Prefer Effect's platform primitives over Bun built-in modules. Use Bun APIs when Effect offers no suitable primitive, and Bun built-ins only when neither has a practical equivalent — keep that reason local and explicit.
- Prefer Effect's exception-capture primitives over raw `try`/`catch`: the promise-aware variant for promise-based APIs, the synchronous variant for parsing or row-level fallbacks. Sandbox scripts may use host-style error handling when they need it.
- Do not add diagnostic- or lint-suppression comments by default. Prefer typed errors, schema decoding and encoding, promise-returning callbacks, and small pure helpers that satisfy the checks. If a suppression is unavoidable, scope it narrowly and explain why the API cannot be expressed cleanly.

## Module Boundaries

- Routes stay thin: validate request data, call a service, and return direct values or typed tagged errors. Define one handler per endpoint.
- Services own business rules and return effects with typed errors.
- Repositories own persistence and row-to-domain normalization only. They return effects and read the active database executor from shared context.
- Define services and repositories as Effect service classes; provide dependencies through layer composition, not hand-passed dependency parameters.
- Access control lives in services, as pure helpers or direct checks after loading the smallest resource scope.

## Cross-Module Infrastructure

- Feature modules form a dependency gradient from most generic to most specific. A module may depend only on more generic modules; a generic module must never import a more specific one. Sandbox execution is orthogonal infrastructure.
- When a generic module needs a side effect owned by a more specific module, invert the dependency instead of importing it: the generic module defines an abstract hook with a no-op default, the specific module provides the implementation, and application wiring composes them.
- Every table has exactly one owning repository that performs its writes; every other consumer routes through that repository, and service code never issues raw table writes.
- Cross-module side effects go through the owning module's service and never write another module's tables directly. Reach into another module's repository only when atomicity within one shared transaction requires it, and only to write tables that module owns.
- Importers, background jobs, sandbox callbacks, and bootstrap paths use the same write paths as HTTP request handling.
- Provider-specific knowledge belongs in sandbox scripts, not application modules. Application modules may normalize source input and choose provider fallback policy, but provider-specific network calls stay in sandbox drivers.
- When app code has only a foreign identifier, resolve it through a sandbox resolution driver before provider-backed population. When it already has a provider-native identifier, pass it through as a resolved provider input.

## Validation And Persistence

- Runtime schemas, persisted JSON structures, and TypeScript types must stay aligned.
- Reusable request and response schemas live in their module's schema definitions.
- Database timestamps must be timezone-aware.
- Persist JSON date values as ISO 8601 UTC strings.
- Use Effect Schema for all HTTP payloads, service boundaries, and domain types. Do not use Zod in application code.

## Transactions

- A shared transaction runner runs an effect inside one PostgreSQL transaction; services depend on it and choose the transaction boundary.
- Repository effects read the active executor from shared context; the transaction runner swaps that executor for the transactional one.
- Expected failures roll back through an internal sentinel, after which the original typed failure is restored.
- Do not hold a transaction across sandbox execution, network calls, durable workflow boundaries, sleeps, or fan-out work.

## Queues

- Do not introduce a third-party job-queue library. Background work uses the durable workflow engine, durable queues, and durable deferred signals.

## Redis

- Centralize all app-defined Redis keys and pub/sub channel names in one module; never construct them inline elsewhere.
- Access Redis-stored payloads through that module's codecs, so serialization and parsing stay typed in one place.

## Schema Write Path

- Writes to schema-backed entity, event, and relationship tables must validate their properties against the matching schema's property definition.
- Each table has a single owning write path; every caller routes through it. Cross-cutting work that spans tables composes the owning repositories inside one transaction.
- Provider-backed population in background flows composes the established import workflow rather than calling lower-level population helpers directly.
- External event creation goes through the path that also dispatches schema-defined triggers.
- Do not export repository write primitives through module barrels for runtime callers.
- Migration and bootstrap code is the only exception to the write-path rules.
- Allow arbitrary top-level keys in a property schema only when relationship or collection properties genuinely require passthrough; otherwise keep properties aligned with their built-in schemas.
