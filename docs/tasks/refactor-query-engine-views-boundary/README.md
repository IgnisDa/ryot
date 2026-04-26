# Refactor: Query Engine / Views Boundary Clarification

## Problem

`lib/views/definition.ts` acts as the system's execution orchestrator despite living at the
library layer. It receives `executePreparedView` — a query-engine function — as an injected
default dependency, creating a circular intent: routes call into `lib/views`, which calls back
into `modules/query-engine`, which calls back into `lib/views` for type inference.

**Shallow modules involved:**

- `lib/views/definition.ts` (432 lines): Owns the `ViewDefinitionModule` factory. Prepares a
  `PreparedView` from either a runtime request or a saved-view definition, then delegates
  execution to the injected `executePreparedView`. It acts as an orchestrator but is located
  in a layer that should contain only pure validation and type logic.
- `modules/query-engine/routes.ts` (71 lines): Calls `viewDefinitionModule.prepare().execute()`
  — a library module — rather than calling the query-engine's own execution logic directly.
- `modules/saved-views/routes.ts` (317 lines): Calls `viewDefinitionModule.prepare().assertSavable()`
  before delegating to the service. Validation lives in the route handler, not the service.

**Integration risk in the seams:**

- Any new execution entry point (background job, CLI, admin route) must either import
  `lib/views/definition.ts` (wrong layer) or re-implement the context-building ceremony itself.
- The dependency injection default (`viewDefinitionModuleDeps`) means tests that forget to
  override the dep will silently hit the real database.
- `lib/views` is supposed to be pure and portable. Its coupling to `executePreparedView` breaks
  that guarantee and makes it harder to reason about what the library layer may or may not do.

## Proposed Interface

Move orchestration to `modules/query-engine/preparer.ts`. Expose three intent-named functions
that cover every current call site. `lib/views/` retains only pure validation and type-inference
logic; it no longer imports or receives anything from the query-engine.

```typescript
// modules/query-engine/preparer.ts

/**
 * Load context, validate the request, execute the query.
 * The common path — call from query-engine routes.
 */
export async function prepareAndExecute(input: {
  userId: string;
  request: QueryEngineRequest;
}): Promise<QueryEngineResponse>

/**
 * Load context, validate the definition, throw if invalid.
 * Used before persisting a saved view.
 */
export async function prepareForValidation(input: {
  userId: string;
  queryDefinition: SavedViewQueryDefinition;
  displayConfiguration: DisplayConfiguration;
}): Promise<void>

/**
 * Load context, validate, return an executable handle.
 * Used when the caller needs to execute with a different layout later
 * (e.g. saved-view execution with a caller-supplied layout override).
 */
export async function prepareSavedView(input: {
  userId: string;
  viewId: string;
}): Promise<{ execute(layout?: QueryEngineLayoutOverride): Promise<QueryEngineResponse> }>
```

**Usage in query-engine routes (before → after):**

```typescript
// Before
const prepared = await viewDefinitionModule.prepare({
  userId,
  source: { kind: "runtime", request: body },
})
const result = await prepared.execute()

// After
const result = await prepareAndExecute({ userId, request: body })
```

**Usage in saved-views routes:**

```typescript
// Before
await viewDefinitionModule.prepare({
  userId,
  source: { kind: "saved-view", definition: { queryDefinition, displayConfiguration } },
}).assertSavable()

// After
await prepareForValidation({ userId, queryDefinition, displayConfiguration })
```

**What it hides internally (inside `prepareAndExecute`):**

1. Load visible schemas for the user (DB query)
2. Load visible event joins (DB query)
3. Build `schemaMap` and `eventJoinMap` for O(1) lookups
4. Call `validateQueryEngineReferences()` from `lib/views/validator.ts` (pure, no DB)
5. Call `executePreparedQuery()` (SQL compilation + execution)
6. Map rows to `QueryEngineResponse`

`lib/views/` is never imported by routes — only by `preparer.ts` and by the query-engine's
internal compilation files.

## Dependency Strategy

**Category: In-process + Local-substitutable (Postgres via Drizzle)**

The validation logic (`lib/views/validator.ts`, `expression-analysis.ts`, etc.) is pure
in-process computation — no I/O. It can be tested directly without any stand-in.

The context-loading step (schema and event-join queries) uses Drizzle against Postgres. For
tests, use a PGLite in-memory instance (already available in the repo test harness) to run
`prepareAndExecute` end-to-end without a real database server.

Dependency injection is no longer needed at the module boundary. `preparer.ts` imports Drizzle
directly. For unit tests that want to skip DB entirely, test `validateQueryEngineReferences()`
from `lib/views/validator.ts` directly with a constructed `QueryEngineReferenceContext` — no
DB required.

## Testing Strategy

**New boundary tests to write:**

- `prepareAndExecute` with a valid runtime request against a PGLite instance → returns
  well-formed `QueryEngineResponse`
- `prepareAndExecute` with a request referencing a non-existent schema property → throws
  `QueryEngineValidationError` before any SQL executes
- `prepareForValidation` with a valid definition → resolves without throwing
- `prepareForValidation` with a type-mismatched filter predicate → throws with a descriptive
  error that maps to the correct HTTP 422 response
- `prepareSavedView` for a view the user does not own → throws authorization error

**Old tests to delete:**

- Any test that exercises `viewDefinitionModule.prepare()` with a mocked `executePreparedView`
  dependency — these test the DI wiring, not the behavior
- Any test that constructs `createViewDefinitionModule(deps)` with a custom dep to avoid DB
  hits — replace with direct calls to `validateQueryEngineReferences()` or with PGLite

**Test environment needs:**

- PGLite instance seeded with schema rows and event-join rows for integration-level tests
- Constructed `QueryEngineReferenceContext` fixtures for pure validation unit tests

## Implementation Recommendations

**What the module should own:**

`modules/query-engine/preparer.ts` owns the full request lifecycle: load context from DB,
validate against the context, execute SQL, return response. It is the single entry point for
anything that wants to run a query.

**What it should hide:**

- Context construction (schema loading, map building)
- The distinction between `schemaMap` and `runtimeSchemas` (an internal detail of the SQL
  compiler)
- Error normalization (mapping `QueryEngineNotFoundError` to validation errors, etc.)

**What it should expose:**

Three public async functions named after caller intent. No class, no factory, no module
object. Each function is independently importable and independently testable.

**What `lib/views/` should own after this refactor:**

Pure functions and types only: expression type inference, predicate validation, reference
resolution helpers, property display policy. No imports from `modules/`. No default
dependency injection. Safe to import from anywhere in the codebase without triggering side
effects.

**Migration path for callers:**

1. Create `modules/query-engine/preparer.ts` with the three functions.
2. Update `modules/query-engine/routes.ts` to call `prepareAndExecute`.
3. Update `modules/saved-views/routes.ts` to call `prepareForValidation`.
4. Delete `lib/views/definition.ts` and `viewDefinitionModuleDeps`.
5. Remove the `viewDefinitionModule` import from all route files.

## Status

- [x] RFC accepted
- [x] Implementation started
- [x] Implementation complete
- [x] Old tests deleted
- [x] New boundary tests written

## Progress Notes

- Added `apps/app-backend/src/modules/query-engine/preparer.ts` with the new additive
  boundary functions: `prepareAndExecute`, `prepareForValidation`, and `prepareSavedView`.
- Exposed `getSavedViewByIdForUser` from `~/modules/saved-views` to support
  `prepareSavedView` without reaching into the repository file directly.
- Updated `apps/app-backend/src/modules/query-engine/routes.ts` to call
  `prepareAndExecute(...)` directly instead of routing execution through
  `viewDefinitionModule.prepare(...).execute()`.
- Updated `apps/app-backend/src/modules/saved-views/routes.ts` to validate through
  `prepareForValidation(...)`.
- Updated remaining execution callers in `modules/media/service.ts` and
  `lib/sandbox/host-functions/execute-query.ts` to use `prepareAndExecute(...)`.
- Removed the old boundary implementation and its mocked tests by deleting
  `apps/app-backend/src/lib/views/definition.ts` and
  `apps/app-backend/src/lib/views/definition.test.ts`.
- Removed `lib/views` imports from `modules/` type barrels by making
  `lib/views/validator.ts` depend on local structural types instead.
- Added integration coverage in `tests/src/tests/query-engine.test.ts` and
  `tests/src/tests/sandbox.test.ts` for real boundary behavior after the migration.
- `tests` package typecheck passes, but full targeted e2e execution was blocked by an
  unrelated backend startup failure during DB migration/bootstrap in the test harness.
