# App Backend Guidelines

## Documentation Layout

This file holds cross-cutting rules only. A module's behavior, boundaries, and design rationale live in that module's `AGENTS.md`; reference material (the query language spec, the sandbox runtime) lives in `README.md` files read on demand. Every fact has exactly one owning document — other documents point at it instead of restating it.

## Return Types

Remove explicit return type annotations when TypeScript can trivially infer them. Keep them for type predicates (`value is X`), functions returning discriminated unions (literal discriminants widen to `string` otherwise), object-literal methods whose parameter inference depends on an explicit return shape, effects whose inferred failure/success union would break downstream chaining, and array factories whose element type would widen differing optional fields to `undefined`. Prefer `as const` on the returned value to keep nested literal types, and `satisfies T` over a trailing return type when only the value — not every caller — needs the constraint. Omit the type on `as X` assertions.

## Testing

- Use `bun run test` instead. `bun test` does not work in this app.

## Runtime APIs And Diagnostics

- Prefer Effect's platform primitives over Bun built-in modules. Use Bun APIs when Effect offers no suitable primitive, and Bun built-ins only when neither has a practical equivalent — keep that reason local and explicit.
- Prefer Effect's exception-capture primitives over raw `try`/`catch`: the promise-aware variant for promise-based APIs, the synchronous variant for parsing or row-level fallbacks. Sandbox scripts may use host-style error handling when they need it.
- Do not add diagnostic- or lint-suppression comments by default. Prefer typed errors, schema decoding and encoding, promise-returning callbacks, and small pure helpers that satisfy the checks. If a suppression is unavoidable, scope it narrowly and explain why the API cannot be expressed cleanly.

## Sandbox Scripts

- Sandbox script sources use the `.sandbox.js` extension: providers, triggers, and script-helpers live under `src/modules/builtins/sandbox-scripts/`, while the Deno runner (`runner-source.sandbox.js`) lives under `src/lib/infrastructure/sandbox-runtime/`. They are plain JavaScript executed inside a Deno subprocess, not app modules.
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

## Durable Ownership

- Every business operation that runs durably has exactly one owner: a single workflow definition or durable-queue worker. No two workflows may implement the same operation. When a workflow needs work another owns, it composes the owner — awaiting the child when it needs the result, or dispatching it fire-and-forget with a deterministic execution id when it does not.
- Parent workflows are orchestration shells. Cron ticks and multi-stage pipelines fan out to feature-owned child workflows instead of inlining another feature's activities.
- A durable-queue worker is the canonical owner when the module gradient requires dependency inversion (hook in the generic module, worker in the specific one); otherwise prefer a workflow.
- Activities never start durable work: no `engine.execute`, workflow `.execute`, or `DurableQueue.process` from inside an `Activity.make` execute body, including transitively through service calls — dispatch from the workflow body. `sandbox/workflow-boundaries.test.ts` pins the current owners.
- Single ownership is not single-flight: different parents may run the owner concurrently for the same target, so owners must be idempotent (ensure-mode short-circuits, preserve-existing upserts). Add cross-execution coordination only when duplicate in-flight work is measurably harmful.
- `docs/effect-workflow-guide.md` documents the mechanics and the audit of current owners.

## Queues

- Do not introduce a third-party job-queue library. Background work uses the durable workflow engine, durable queues, and durable deferred signals.
- When a workflow runs a child workflow (e.g. an import writing events via `EventCreateWorkflow`), give the child a deterministic `executionId` derived from the parent (parent executionId + loop indices), never a fresh random one. A child that durably suspends — e.g. an event firing an after-create trigger — replays the parent, and a random id spawns a new child each replay, looping forever. Match the keying used by `populateMediaEntityGroups` (`imports/media/population-workflow.ts`) and `resolveMediaEntityGroups` (`imports/media/resolution-workflow.ts`).

## Redis

- Centralize all app-defined Redis keys and pub/sub channel names in one module; never construct them inline elsewhere.
- Access Redis-stored payloads through that module's codecs, so serialization and parsing stay typed in one place.

## Schema Write Path

- Writes to schema-backed entity, event, and relationship tables must validate their properties against the matching schema's property definition.
- Provider-backed population in background flows composes the established import workflow rather than calling lower-level population helpers directly.
- External event creation goes through the path that also dispatches schema-defined triggers.
- Migration and `legacy-bootstrap` code is the only exception to the write-path rules.
- Allow arbitrary top-level keys in a property schema only when relationship or collection properties genuinely require passthrough; otherwise keep properties aligned with their built-in schemas.

## Entity Translation, Localization & Interest

- Entity reads are side-effect-free: they dispatch nothing. Population and translation fills are driven only by declared interest.
- Each entity's canonical language comes from its provider script metadata; localized reads overlay the per-`(entity, language)` `entity_translation` row on the canonical entity, and the read path computes `translationStatus` from populate/overlay state.
- The full semantics — the interest wire protocol and invariants, the overlay merge, the `translationStatus` truth table, and the negative-cache rules — are owned by `src/modules/entity-interest/AGENTS.md` and pinned by the e2e suite.

## Query Engine

- Query-language read semantics (null handling, collation, response shapes, time-series bucketing) are specified in `src/modules/query-engine/README.md`.
- Construct application-owned query documents through `@ryot/query-engine`. Its primitives stay dependency-free (they never import `@ryot/contract`) so any layer can build documents without risking a dependency cycle; production reads should use a named shared recipe when one exists.

## Sandbox Script Cache

- The sandbox key/value cache is isolated per `(user, scriptId)`: a user-owned script cannot read another user's cache entry even under the same key.

## Events

- Event writes are fire-and-forget: after a run reports complete its events may not be queryable yet, so readers must poll for them (as the `waitForEventSlugs` test helper does).
