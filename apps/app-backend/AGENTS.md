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

## Sandbox Scripts

- Sandbox script sources live under `src/lib/sandbox/` with the `.sandbox.js` extension (providers, triggers, script-helpers, and the Deno runner). They are plain JavaScript executed inside a Deno subprocess, not app modules.
- Each file is a function-body fragment, not an ES module: it must contain no top-level `import`/`export` (the runner wraps it in `new Function`). Injected globals (`driver`, host functions like `httpCall`, and helper functions such as `toTitleCase`) are provided at runtime — script-helpers are concatenated ahead of the consuming script. Dependencies load via Deno-style dynamic `await import("npm:...")`.
- They are pulled into the app as raw strings via `import code from "....sandbox.js" with { type: "text" }`. `src/sandbox-scripts.d.ts` declares the `*.sandbox.js` module so `tsc` types the import as `string` and never type-checks the body.
- `check` (tsc + oxfmt + oxlint) covers these files. oxfmt/oxlint treat them as ordinary JS, so keep them lint-clean and formatted like the rest of the codebase — but remember they are linted in isolation, so functions defined only for a consuming script (e.g. helpers) will still read as "unused" to the linter.

## Module Boundaries

- Routes stay thin: validate request data, call a service, and return direct values or typed tagged errors. Define one handler per endpoint.
- Services own business rules and return effects with typed errors.
- Repositories own persistence and row-to-domain normalization only. They return effects and read the active database executor from shared context.
- Define services and repositories as Effect service classes; provide dependencies through layer composition, not hand-passed dependency parameters.
- Access control lives in services, as pure helpers or direct checks after loading the smallest resource scope.
- Do not add barrel re-exports in app-backend; import from the defining module directly.
- Contract-facing schemas, errors, auth middleware, and `HttpApiGroup` definitions live in `@ryot/contract` (`libs/contract`), not here. Adding a module's HTTP endpoints means editing `libs/contract/src/contract.ts` and that module's files under `libs/contract/src/modules/<name>/` too, not just `apps/app-backend`. See `libs/contract/AGENTS.md` for the boundary rules.

## Cross-Module Infrastructure

- Feature modules form a dependency gradient from most generic to most specific. A module may depend only on more generic modules; a generic module must never import a more specific one. Sandbox execution is orthogonal infrastructure.
- When a generic module needs a side effect owned by a more specific module, invert the dependency instead of importing it: the generic module defines a `DurableQueue` (the hook), enqueues work without knowing the handler, the specific module registers a worker via `DurableQueue.worker()`, and `app/layers.ts` wires the two together.
- Every table has exactly one owning repository that performs its writes; every other consumer routes through that repository, and service code never issues raw table writes.
- Cross-module side effects go through the owning module's service and never write another module's tables directly. Reach into another module's repository only when atomicity within one shared transaction requires it, and only to write tables that module owns.
- Importers, background jobs, sandbox callbacks, and bootstrap paths use the same write paths as HTTP request handling.
- Provider catalog knowledge for entity search, resolution, and details belongs in sandbox scripts, not application modules. Provider-backed population and unresolved identifier resolution must reach external provider APIs through sandbox drivers.
- Source-ingestion connectors that fetch a user's source data during imports or yank integrations may perform bounded network calls in app adapter loading, then emit normalized refs. They must not call provider catalog APIs for enrichment directly.
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
- When a workflow runs a child workflow (e.g. an import writing events via `EventCreateWorkflow`), give the child a deterministic `executionId` derived from the parent (parent executionId + loop indices), never a fresh random one. A child that durably suspends — e.g. an event firing an after-create trigger — replays the parent, and a random id spawns a new child each replay, looping forever. Match the keying used by `populateMediaEntityGroups` (`imports/media/population-workflow.ts`) and `resolveMediaEntityGroups` (`imports/media/resolution-workflow.ts`). Note: `library-membership/service.ts`'s own `importEntity` is an unrelated top-level dispatch, not an example of this pattern.

## Redis

- Centralize all app-defined Redis keys and pub/sub channel names in one module; never construct them inline elsewhere.
- Access Redis-stored payloads through that module's codecs, so serialization and parsing stay typed in one place.

## Schema Write Path

- Writes to schema-backed entity, event, and relationship tables must validate their properties against the matching schema's property definition.
- Provider-backed population in background flows composes the established import workflow rather than calling lower-level population helpers directly.
- External event creation goes through the path that also dispatches schema-defined triggers.
- Migration and `legacy-bootstrap` code is the only exception to the write-path rules.
- Allow arbitrary top-level keys in a property schema only when relationship or collection properties genuinely require passthrough; otherwise keep properties aligned with their built-in schemas.

## Entity Translation & Localization

Observable read-path semantics pinned by the e2e suite; keep them in mind when touching localization.

- Each entity's canonical language comes from its provider script metadata (`providerInformation.canonicalLanguage`); the read path uses it to compute `translationStatus` and to decide whether to localize at all.
- A localized read overlays the per-`(entity, language)` `entity_translation` row on the canonical entity: the overlay `name` and overlaid property values win, while canonical-only properties survive the `properties || et.properties` merge. Sorting and filtering on `name` key off the localized value, so a canonical name is no longer matchable once a localized overlay exists.
- `translationStatus` resolves to `none` when the entity has no sandbox script (regardless of language or population), when `populated_at` is null even with a canonical script (populate-before-translate gate), or when the viewer's resolved language is the canonical one or unset. For a non-canonical viewer of a populated entity it is `pending` when no overlay row exists yet, `ready` when a content-bearing overlay exists, and `none` when the overlay is an all-null negative-cache row.
- Overlays are shared: once one viewer's declared interest fills an overlay, other non-canonical viewers read it directly without declaring interest.
- A provider that returns no translation writes an all-null overlay (negative cache) and does not refetch. Declaring interest on an unpopulated entity enqueues population only, never a translate — a premature all-null overlay would permanently mislabel the status as `none`.

## Interest & Population Dispatch

- Entity reads are side-effect-free: they dispatch nothing. Population and translation fills are driven by declaring interest (POST `/api/entity-interest`, or opening an interest stream), which runs the entity's provenance sandbox script (`sandbox_script_id`) and, on completion, fans out an `entity:updated` frame (`reason: "populated" | "translated"`) over the SSE stream.
- Declaring interest on an already-terminal entity (e.g. populated, with no pending localization for a no-language reader) returns an immediate catch-up frame in the POST response itself, with no SSE round-trip.
- Interest is authorization-scoped: an entity the requesting user cannot see (another user's private entity) is never surfaced by the reconciler — no catch-up, no completion event, and nothing enqueued on that user's behalf.

## Query Engine Read Semantics

- Property null semantics: a property read resolves to null when the row's schema does not define the property (including a multi-schema source where the property is qualified by a different schema) or the value is absent, and such rows are excluded from positive comparisons. `neq` compiles as null-as-false (null rows excluded); `not(eq)` is a double negation that keeps null rows. `isNull`/`isNotNull` treat a missing value as null. Comparisons are operand-order-preserving, and text orders under `COLLATE "C"` (byte order, uppercase before lowercase).
- A query returns only the fields a row selects; an unselected field (e.g. `translationStatus`) is absent rather than null.
- Time-series buckets are contiguous and gap-filled: each bucket's `endAt` equals the next bucket's `startAt`, empty spans between populated buckets are emitted as zero buckets, and week buckets align to the ISO Monday start.

## Sandbox Script Cache

- The sandbox key/value cache is isolated per `(user, scriptId)`: a user-owned script cannot read another user's cache entry even under the same key.

## Events

- Event writes are fire-and-forget: after a run reports complete its events may not be queryable yet, so readers must poll for them (as the `waitForEventSlugs` test helper does).
