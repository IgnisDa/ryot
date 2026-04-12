# Minimal Interface Design: Query Engine & Views Orchestration Refactor

**Design Constraint:** MINIMIZE the interface — 1-3 entry points max.

**Status:** ✅ Design Complete — 1 Primary Function + 1 Utility Function

---

## Executive Summary

Move orchestration out of `lib/views/definition.ts` (library level) into a thin module-level orchestrator in `query-engine/view-orchestrator.ts`. This eliminates bidirectional coupling, enables pure-function validation testing, and provides a single clear entry point for all callers.

| Aspect | Before | After |
|--------|--------|-------|
| **Orchestrator Location** | `lib/views/definition.ts` (wrong layer) | `query-engine/view-orchestrator.ts` (correct layer) |
| **Module Coupling** | `lib/views ↔ query-engine` (bidirectional) | `query-engine → lib/views` (unidirectional) |
| **Entry Points** | `.prepare()` then `.execute()/.assertSavable()` | `.validateAndPrepareView()` + `.execute()/.assertSavable()` |
| **Testable Validation** | Requires full mock deps | Pure function `.validateViewDefinitionOnly()` |
| **File Count** | 1 (definition.ts) | 2 (view-orchestrator.ts + validator-public.ts) |

---

## The Interface (2 Public Functions + 2 Methods)

### 1. Primary Function: `validateAndPrepareView()`

```typescript
export async function validateAndPrepareView(input: {
  userId: string;
  source: ViewSource; // "runtime" | "saved-view"
}): Promise<PreparedView>;
```

**What it does:**
1. Loads visible schemas with user permission checks
2. Loads event joins (if defined)
3. Builds canonical schema/event-join maps
4. Validates all references and display configuration
5. Returns a `PreparedView` object

**Where:** `query-engine/view-orchestrator.ts` (new file)

**Callers:** `query-engine/routes.ts`, `saved-views/routes.ts`

---

### 2. PreparedView Methods

```typescript
export type PreparedView = {
  assertSavable(): void;
  toRuntimeRequest(layout: SavedViewLayout, pagination: any): QueryEngineRequest;
  execute(input?: RuntimeExecutionInput): Promise<QueryEngineResponse>;
};
```

- **`assertSavable()`** — Throws if source is not "saved-view"
- **`execute()`** — Run query, return paginated results
- **`toRuntimeRequest()`** — Build UI request for layout rendering

---

### 3. Utility Function: `validateViewDefinitionOnly()` (Tests Only)

```typescript
export function validateViewDefinitionOnly(input: {
  queryDefinition: SavedViewQueryDefinition;
  displayConfiguration: DisplayConfiguration;
  context: ViewDefinitionValidationContext;
}): void;
```

**What it does:** Pure validation with no DB or HTTP access.

**Where:** `lib/views/validator-public.ts` (new file)

**Callers:** Unit tests only

---

## Architecture Changes

### Current State (Problem)

```
lib/views/definition.ts (280 LOC)
├─ Orchestrates: schema loading + validation + execution
├─ Depends on: db, executePreparedQuery
├─ Lives at: library level (wrong!)
└─ Exported: viewDefinitionModule.prepare()

Module Coupling:
  lib/views ←→ query-engine (BIDIRECTIONAL!)
  ├─ lib/views imports: executePreparedQuery
  └─ query-engine imports: viewDefinitionModule
```

### Target State (Solution)

```
query-engine/view-orchestrator.ts (NEW, 250 LOC)
├─ Orchestrates: schema loading + validation + request building
├─ Depends on: lib/views validators, DB functions
├─ Lives at: module level (correct!)
└─ Exported: validateAndPrepareView()

lib/views/validator-public.ts (NEW, 30 LOC)
└─ Exported: validateViewDefinitionOnly() (pure validation)

Module Coupling:
  query-engine → lib/views (UNIDIRECTIONAL!)
  └─ query-engine imports: validators + reference builders
```

---

## Implementation: What Changes

### Files to Create

1. **`query-engine/view-orchestrator.ts`** (250 LOC)
   - Move orchestration logic from `lib/views/definition.ts`
   - Implement `validateAndPrepareView()` function
   - Implement `PreparedView` methods (as closures)
   - Export types: `ViewDefinition`, `ViewSource`, `SavedViewLayout`, `PreparedView`

2. **`lib/views/validator-public.ts`** (30 LOC)
   - Implement `validateViewDefinitionOnly()` function
   - Re-export validation helpers from `validator.ts`
   - Pure function, no DB access

### Files to Delete

1. **`lib/views/definition.ts`** (entire file)
   - All logic moved to `query-engine/view-orchestrator.ts`

### Files to Update

1. **`query-engine/routes.ts`** (71 LOC)
   ```typescript
   // Before
   import { viewDefinitionModule } from '~/lib/views/definition';
   const result = await (
     await viewDefinitionModule.prepare({ userId, source: {...} })
   ).execute();

   // After
   import { validateAndPrepareView } from './view-orchestrator';
   const prepared = await validateAndPrepareView({ userId, source: {...} });
   const result = await prepared.execute();
   ```

2. **`saved-views/routes.ts`** (317 LOC)
   ```typescript
   // Before
   import { viewDefinitionModule } from '~/lib/views/definition';
   (await viewDefinitionModule.prepare({...})).assertSavable();

   // After
   import { validateAndPrepareView } from '~/modules/query-engine';
   const prepared = await validateAndPrepareView({...});
   prepared.assertSavable();
   ```

3. **`query-engine/index.ts`** (19 LOC)
   ```typescript
   export type { ViewDefinition, ViewSource, PreparedView, SavedViewLayout } from './view-orchestrator';
   export { validateAndPrepareView, createViewOrchestrator } from './view-orchestrator';
   ```

4. **Test files** (update mocks + imports)
   - `lib/views/definition.test.ts` — Rewrite to use `createViewOrchestrator(deps)`
   - All saved-views tests — Update imports

---

## Usage Examples

### Query Engine Route (Runtime Request)

```typescript
// query-engine/routes.ts
import { validateAndPrepareView } from './view-orchestrator';

export const queryEngineApi = new OpenAPIHono().openapi(
  executeQueryEngineRoute,
  async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");

    try {
      const prepared = await validateAndPrepareView({
        userId: user.id,
        source: { kind: "runtime", request: body },
      });
      const result = await prepared.execute();
      return c.json(successResponse(result), 200);
    } catch (error) {
      if (error instanceof QueryEngineNotFoundError) {
        return c.json(createNotFoundErrorResult(error.message).body, 404);
      }
      if (error instanceof QueryEngineValidationError) {
        return c.json(createValidationErrorResult(error.message).body, 400);
      }
      throw error;
    }
  }
);
```

### Saved Views Route (Validation + Persistence)

```typescript
// saved-views/routes.ts
import { validateAndPrepareView } from '~/modules/query-engine';

export const savedViewsApi = new OpenAPIHono().openapi(
  createSavedViewRoute,
  async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");

    try {
      const prepared = await validateAndPrepareView({
        userId: user.id,
        source: {
          kind: "saved-view",
          definition: {
            queryDefinition: body.queryDefinition,
            displayConfiguration: body.displayConfiguration,
          },
        },
      });
      prepared.assertSavable(); // Validate before persisting
    } catch (error) {
      return c.json(resolveSavedViewValidationErrorResult(error).body, 400);
    }

    // Validation passed, persist to DB
    const result = await createSavedView({ body, userId: user.id });
    if ("error" in result) {
      return c.json(createValidationServiceErrorResult(result).body, 400);
    }
    return c.json(createSuccessResult(result.data).body, 201);
  }
);
```

### Pure Validation (Unit Test — No Infrastructure)

```typescript
// tests/src/tests/query-engine.test.ts
import { validateViewDefinitionOnly } from '~/lib/views/validator-public';

describe('view definition validation', () => {
  it('rejects undefined property', () => {
    const schemas = new Map([
      ['smartphones', {
        id: 'schema-1',
        slug: 'smartphones',
        propertiesSchema: { type: 'object', properties: { name: {...} } },
      }],
    ]);

    expect(() => {
      validateViewDefinitionOnly({
        queryDefinition: {
          entitySchemaSlugs: ['smartphones'],
          filter: null,
          sort: { expression: {...}, direction: 'asc' },
          eventJoins: [],
          computedFields: [],
        },
        displayConfiguration: {
          grid: {
            titleProperty: {
              type: 'entity-property',
              slug: 'smartphones',
              property: 'undefined_property', // ERROR!
            },
          },
        },
        context: { schemaMap: schemas, eventJoinMap: new Map() },
      });
    }).toThrow(QueryEngineValidationError);
  });
});
```

---

## Dependency Injection (For Testing)

To mock DB lookups in integration tests:

```typescript
import { createViewOrchestrator } from './view-orchestrator';

const customDeps = {
  loadVisibleSchemas: async ({ entitySchemaSlugs }) => [
    { id: '1', slug: 'smartphones', propertiesSchema: {...} },
  ],
  loadVisibleEventJoins: async () => [],
  executePreparedQuery: async () => ({
    items: [],
    meta: { pagination: { total: 0, page: 1, limit: 10, totalPages: 0, hasNextPage: false, hasPreviousPage: false } },
  }),
};

const orchestrator = createViewOrchestrator(customDeps);
const prepared = await orchestrator({
  userId: 'user-1',
  source: { kind: 'runtime', request: {...} },
});
```

---

## What Gets Hidden by Interface

### Inside `validateAndPrepareView()` (Orchestrator)
- Schema visibility filtering (permission checks)
- Event join schema resolution
- Building canonical maps (schemaMap, eventJoinMap)
- Validation routing (saved-view vs runtime paths)
- Error translation with context

### Inside `PreparedView.execute()`
- Conditional request building (based on source type)
- Layout projection (grid/list/table)
- Pagination offset calculation
- SQL compilation & execution
- Result mapping

### Handled by Callers
- HTTP error responses (routes catch and respond)
- Authorization (routes check user.id)
- Persistence (saved-views service owns it)

---

## Trade-offs

### Wins ✅
1. **Single clear entry point** — `validateAndPrepareView()` is obvious
2. **Reduced coupling** — lib/views ← query-engine only (unidirectional)
3. **Testable validation** — `validateViewDefinitionOnly()` with no DB setup
4. **Centralized orchestration** — All coordination in one place
5. **Clear error contract** — Specific error types caught by routes

### Costs ⚠️
1. **Moves orchestration out of lib/** — But orchestrator is thin (250 LOC)
2. **More files to import** — Mitigation: single barrel export from query-engine
3. **No intermediate state** — Use `.toRuntimeRequest()` if you need built request
4. **Removes factory pattern** — Use `createViewOrchestrator()` if needed

### Eliminated (Not Needed)
- `PreparedViewState` exposed type (internal only)
- `ViewDefinitionModule` type (use function directly)
- `createViewDefinitionModule()` factory (use `createViewOrchestrator()`)

---

## Implementation Checklist

- [ ] Create `query-engine/view-orchestrator.ts` (new file, 250 LOC)
- [ ] Create `lib/views/validator-public.ts` (new file, 30 LOC)
- [ ] Update `query-engine/routes.ts` to use new import
- [ ] Update `saved-views/routes.ts` to use new import
- [ ] Update `query-engine/index.ts` to export new types + function
- [ ] Delete `lib/views/definition.ts`
- [ ] Update all test files (import paths, mock setup)
- [ ] Run full test suite: `bun run test`
- [ ] Run linter: `bun turbo --filter=@ryot/app-backend lint`
- [ ] Run type checker: `bun run typecheck`
- [ ] Code review (emphasis on orchestration logic)

---

## Summary: The 3 Entry Points (Actually 1 Primary + 1 Utility)

| Function | Location | Purpose | Callers |
|----------|----------|---------|---------|
| `validateAndPrepareView()` | `query-engine/view-orchestrator.ts` | Single orchestration point (load + validate + build PreparedView) | query-engine/routes.ts, saved-views/routes.ts |
| `PreparedView.execute()` | Returned object method | Execute prepared request, return results | routes.ts, UI code |
| `PreparedView.assertSavable()` | Returned object method | Validate saved-view is persistable | saved-views/routes.ts |
| `validateViewDefinitionOnly()` | `lib/views/validator-public.ts` | Pure validation without DB | unit tests |

**Total Public Functions:** 1 (primary) + 1 (utility for tests)  
**Total Methods:** 2 on PreparedView  
**Constraint:** ✅ Achieved (1 primary + 1 utility = minimal interface)

---

## See Also

- `/REFACTOR_INTERFACE_SUMMARY.txt` — Quick reference guide
- `/REFACTOR_INTERFACE_TYPES.ts` — Exact TypeScript signatures
