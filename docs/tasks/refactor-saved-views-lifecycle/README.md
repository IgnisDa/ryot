# Refactor: Saved Views Lifecycle Centralization

## Problem

The saved-view lifecycle — validate → assert savable → persist → execute — is split across
HTTP route handlers and a dumb service layer, with no single owner of the full contract.

**Shallow modules involved:**

- `modules/saved-views/routes.ts` (317 lines): Contains validation logic. Every mutating
  route calls `viewDefinitionModule.prepare({...}).assertSavable()` before delegating to the
  service. Routes know about `ViewDefinitionModule` — an implementation detail that should
  be invisible to HTTP handlers.
- `modules/saved-views/service.ts` (269 lines): Pure CRUD. Validates names and ownership but
  has no concept of definition validity. A caller who constructs the service directly — or any
  future background job — can persist an invalid definition without triggering any validation.
- `modules/saved-views/schemas.ts` (170 lines): Defines `EventJoinDefinition`. The same
  concept is then represented as `QueryEngineEventJoinLike` in `lib/views/reference.ts` and
  as `QueryEnginePreparedEventJoin` in `modules/query-engine/query-builder.ts`. Three names,
  one concept, scattered ownership.

**Integration risk in the seams:**

- Any new code path that creates or updates a saved view (e.g., an import job, an admin
  migration, a clone-on-signup feature) must replicate the `viewDefinitionModule.prepare()
  .assertSavable()` call or it will silently bypass validation.
- The three event-join representations have no shared documentation and no single point where
  the transformation between them is visible. Adding a field to `EventJoinDefinition` requires
  hunting down all three representations and updating each independently.
- Testing the create-view lifecycle requires an HTTP stack (because validation is in the
  router) or duplicating the route's validation sequence in test setup.

## Proposed Interface

Introduce `SavedViewManager` — a facade that replaces the current service + route-level
validation split. Routes become thin HTTP adapters: they decode the request, call one method,
and encode the response.

```typescript
// modules/saved-views/manager.ts

export type SavedViewManager = {
  createAndValidate(input: {
    userId: string;
    name: string;
    icon?: string | null;
    accentColor?: string | null;
    trackerId: string;
    queryDefinition: SavedViewQueryDefinition;
    displayConfiguration: DisplayConfiguration;
  }): Promise<ListedSavedView>;

  updateAndValidate(input: {
    userId: string;
    viewId: string;
    name?: string;
    icon?: string | null;
    accentColor?: string | null;
    isDisabled?: boolean;
    queryDefinition?: SavedViewQueryDefinition;
    displayConfiguration?: DisplayConfiguration;
  }): Promise<ListedSavedView>;

  cloneAndValidate(input: {
    userId: string;
    viewId: string;
    name: string;
  }): Promise<ListedSavedView>;

  prepareForExecution(input: {
    userId: string;
    viewId: string;
  }): Promise<{ execute(): Promise<QueryEngineResponse> }>;

  delete(input: { userId: string; viewId: string }): Promise<void>;

  reorder(input: { userId: string; viewIds: string[] }): Promise<void>;
};
```

**Unified event join type** (replaces the three scattered representations at the service
boundary):

```typescript
// modules/saved-views/types.ts

/**
 * A validated event join ready to be passed to the query engine.
 * Replaces EventJoinDefinition (schema), QueryEngineEventJoinLike (lib/views),
 * and QueryEnginePreparedEventJoin (query-builder) as the single public currency.
 */
export type ValidatedEventJoin = {
  key: string;
  eventSchemaSlug: string;
  joinColumn: string;
  entityColumn: string;
};
```

**Usage in saved-views routes (before → after):**

```typescript
// Before: route knows about viewDefinitionModule
try {
  await viewDefinitionModule.prepare({
    userId,
    source: { kind: "saved-view", definition: { queryDefinition, displayConfiguration } },
  }).assertSavable()
} catch (err) {
  const result = resolveSavedViewValidationErrorResult(err)
  return c.json(result.body, result.status)
}
const result = await createSavedView({ body, userId })

// After: route is a thin HTTP adapter
const view = await manager.createAndValidate({ userId, ...body })
return c.json({ savedView: view }, 201)
```

**What `SavedViewManager` hides internally:**

- Validation via `prepareForValidation()` from the query-engine preparer (see the companion
  RFC for that refactor)
- The distinction between built-in (system) views and user-defined views for update rules
- Name trimming, uniqueness checks, ownership assertions
- The transformation from `EventJoinDefinition` (stored in DB) to `ValidatedEventJoin`
  (passed to execution layer) — callers never see the intermediate representations
- Error normalization: `QueryEngineNotFoundError` from validation becomes a typed
  `SavedViewValidationError` with a stable code

## Dependency Strategy

**Category: In-process + Local-substitutable (Postgres via Drizzle)**

`SavedViewManager` depends on two things:
1. The repository (`modules/saved-views/repository.ts`) — Drizzle against Postgres
2. The validation function from `modules/query-engine/preparer.ts` — pure once context is built

Both dependencies are injected via a `SavedViewManagerDeps` type so tests can supply a PGLite
instance (already available in the repo test harness) for the repository, and can call the real
`prepareForValidation` against that PGLite instance rather than mocking it.

```typescript
export type SavedViewManagerDeps = {
  repo: SavedViewRepository;
  prepareForValidation: typeof import("../query-engine/preparer").prepareForValidation;
};

export const createSavedViewManager = (deps: SavedViewManagerDeps): SavedViewManager => { ... }
```

The production wiring creates one `SavedViewManager` instance at application startup and
passes it into route handlers. No service-locator globals.

## Testing Strategy

**New boundary tests to write:**

- `createAndValidate` with a valid definition → persists and returns the created view
- `createAndValidate` with a type-mismatched filter predicate → throws `SavedViewValidationError`
  before any DB write; row count in saved_views table is unchanged
- `createAndValidate` with a duplicate name for the same user → persists and returns the created view
- `updateAndValidate` on a built-in (system) view with a definition change → throws an
  immutability error
- `updateAndValidate` with a valid new definition → re-validates and persists the update
- `cloneAndValidate` for a view the user does not own → throws authorization error
- `prepareForExecution` for a view with no accessible schemas → throws or returns empty results
  (document expected behavior)
- `reorder` with a viewId that belongs to another user → rejected

**Old tests to delete:**

- Any test that calls `viewDefinitionModule.prepare()` via route-level test setup to satisfy
  the validation step — these test the route's manual orchestration, which no longer exists
- Any test that directly imports and calls the old `createSavedView()` / `updateSavedView()`
  service functions to verify that they skip validation — the behavior is now impossible and
  those tests become dead

**Test environment needs:**

- PGLite instance with saved_views table and schema rows for integration tests
- A `createSavedViewManager` factory accepting PGLite-backed deps for full lifecycle tests

## Implementation Recommendations

**What `SavedViewManager` should own:**

All decision-making for the saved-view lifecycle: whether a definition is valid, whether a
user is allowed to mutate a given view, what the default display configuration looks like for
a fresh view, how event joins are transformed between their storage representation and their
execution representation.

**What it should hide:**

- `viewDefinitionModule` / `prepareForValidation` — callers never know validation happens
- The `EventJoinDefinition` → `ValidatedEventJoin` mapping
- The difference between built-in and user-defined views (surfaces only as error messages)
- Retry logic, quota checks, and any future auditing concerns

**What it should expose:**

Intent-named async methods. No `prepare()` + fluent chaining. No `assertSavable()` exposed
to callers. Each method either succeeds or throws a typed error; callers never inspect
intermediate state.

**Migration path for callers:**

1. Create `modules/saved-views/manager.ts` with `createSavedViewManager`.
2. Move validation logic from each route handler into the corresponding manager method.
3. Inject `prepareForValidation` into the manager (from the query-engine preparer — see
   companion RFC `refactor-query-engine-views-boundary`).
4. Replace route handler bodies with single manager method calls.
5. Delete `viewDefinitionModule` import from `modules/saved-views/routes.ts`.
6. Deprecate the old service functions that are now superseded by manager methods.

**Dependency on companion RFC:**

This refactor is loosely coupled to `refactor-query-engine-views-boundary`. If that RFC lands
first, inject `prepareForValidation` from `modules/query-engine/preparer.ts`. If this RFC
lands first, inject the current `viewDefinitionModule.prepare().assertSavable()` call wrapped
in a thin adapter function — swap it out when the companion RFC ships.

## Status

- [x] RFC accepted
- [x] Implementation started
- [x] Implementation complete (see deviation notes below)
- [x] Old tests deleted
- [x] New boundary tests written

## Deviation From RFC

**Service vs. Manager facade**: The implementation achieved the RFC's goals without creating a
separate `SavedViewManager` facade. Instead, `service.ts` was enhanced directly:

- `SavedViewServiceDeps` now includes `prepareForValidation` as an injected dependency
- An internal `validateDefinition()` helper calls it before every mutating operation (`create`,
  `update`, `clone`)
- Routes import only from the service barrel — no `viewDefinitionModule` anywhere in
  `modules/saved-views/routes.ts`

The behavioral contract is identical to what the RFC specified: validation is enforced before
persistence and callers cannot bypass it.

**Event-join unification not needed**: The RFC proposed `ValidatedEventJoin` to unify the three
event-join representations at the service boundary. On implementation it became clear that the
service boundary does not need enriched event joins at all. The service passes
`EventJoinDefinition[]` through `SavedViewQueryDefinition` untouched; all enrichment (DB
lookup, schema attachment) happens inside `preparer.ts` and is purely internal. The three
representations (`EventJoinDefinition`, `PreparedEventJoin`, `QueryEngineEventJoinLike`) map to
genuinely different stages of processing within `preparer.ts` — there is no leaked complexity
at the service boundary to unify. `types.ts` and the `ValidatedEventJoin` export were
removed as dead code.
